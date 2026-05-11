const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const net = require("net");
const { spawn, execFile } = require("child_process");

function loadConfig() {
  const cfgPath = path.join(__dirname, "config.json");
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return { model: "base", language: "auto" };
  }
}

function findBinary(name) {
  const candidates = [
    process.env.LITE_BIN_DIR && path.join(process.env.LITE_BIN_DIR, name),
    path.join(__dirname, "bin", name),
    path.join(__dirname, "..", "resources", "bin", name),
    path.join(__dirname, "..", "..", "..", "..", "resources", "bin", name),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findFFmpeg() {
  const candidates = [
    path.join(__dirname, "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(__dirname, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    "ffmpeg.exe",
  ];
  for (const c of candidates) {
    if (c === "ffmpeg.exe" || fs.existsSync(c)) return c;
  }
  return null;
}

function convertToWav(inputPath, outputPath) {
  const ffmpeg = findFFmpeg();
  if (!ffmpeg) {
    return Promise.reject(
      new Error(
        "ffmpeg.exe not found. Looked in lite/node_modules/ffmpeg-static/ and ../node_modules/ffmpeg-static/. " +
          "Run `npm install ffmpeg-static` in lite/, or ensure the main project has it."
      )
    );
  }
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-loglevel", "error",
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      outputPath,
    ];
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

function modelPath(model) {
  return path.join(os.homedir(), ".cache", "openwhispr", "whisper-models", `ggml-${model}.bin`);
}

let serverProcess = null;
let serverPort = null;
let serverReady = false;

function findFreePort(start = 8888, end = 8898) {
  return new Promise(async (resolve, reject) => {
    for (let port = start; port <= end; port++) {
      const free = await new Promise((r) => {
        const sock = net.createServer();
        sock.once("error", () => r(false));
        sock.once("listening", () => sock.close(() => r(true)));
        sock.listen(port, "127.0.0.1");
      });
      if (free) return resolve(port);
    }
    reject(new Error(`No free port in ${start}-${end}`));
  });
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: serverPort, path: "/", method: "GET", timeout: 1000 },
      (res) => {
        resolve(true);
        res.resume();
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function startWhisperServer() {
  if (serverReady) return;
  const config = loadConfig();
  const binary = findBinary("whisper-server-win32-x64.exe");
  if (!binary) {
    throw new Error(
      "whisper-server-win32-x64.exe not found. Looked in lite/bin/ and ../resources/bin/. " +
        "Run the main app at least once to download it, or set LITE_BIN_DIR env var."
    );
  }
  const model = modelPath(config.model);
  if (!fs.existsSync(model)) {
    throw new Error(`Model not found: ${model}. Download via the main app first.`);
  }

  serverPort = await findFreePort();
  console.log(`[whisper] starting: ${binary} -m ${config.model} --port ${serverPort}`);
  serverProcess = spawn(
    binary,
    ["-m", model, "--port", String(serverPort), "--host", "127.0.0.1", "-t", "4"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  serverProcess.stdout.on("data", (d) => console.log("[whisper]", d.toString().trim()));
  serverProcess.stderr.on("data", (d) => console.error("[whisper]", d.toString().trim()));
  serverProcess.on("exit", (code) => {
    console.log(`[whisper] exited (code=${code})`);
    serverReady = false;
    serverProcess = null;
  });

  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await healthCheck()) {
      serverReady = true;
      console.log(`[whisper] ready on port ${serverPort}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("whisper-server failed to start within 30s");
}

async function transcribe(audioBuffer) {
  await startWhisperServer();
  const config = loadConfig();
  const ts = Date.now();
  const webmFile = path.join(os.tmpdir(), `lite-${ts}.webm`);
  const wavFile = path.join(os.tmpdir(), `lite-${ts}.wav`);
  fs.writeFileSync(webmFile, audioBuffer);

  try {
    await convertToWav(webmFile, wavFile);
    const boundary = "----LiteBoundary" + ts;
    const fileBuf = fs.readFileSync(wavFile);
    const lang = config.language || "auto";
    const useZhPrompt = lang === "auto" || lang === "zh" || lang === "zh-CN";
    const initialPrompt = useZhPrompt ? "以下是普通话的句子，请使用简体中文。" : "";

    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
    );
    let tailStr =
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${lang}\r\n`;
    if (initialPrompt) {
      tailStr +=
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${initialPrompt}\r\n`;
    }
    tailStr += `--${boundary}--\r\n`;
    const tail = Buffer.from(tailStr, "utf8");
    const body = Buffer.concat([head, fileBuf, tail]);

    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: serverPort,
          path: "/inference",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
          timeout: 300000,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve((json.text || "").trim());
            } catch {
              reject(new Error("Bad whisper-server response: " + data.slice(0, 200)));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } finally {
    try { fs.unlinkSync(webmFile); } catch {}
    try { fs.unlinkSync(wavFile); } catch {}
  }
}

function pasteWithPowerShell() {
  return new Promise((resolve) => {
    const ps =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "[System.Windows.Forms.SendKeys]::SendWait('^v')";
    execFile("powershell.exe", ["-NoProfile", "-Command", ps], { timeout: 5000 }, (err) => {
      if (err) console.error("[paste] PowerShell failed:", err.message);
      resolve();
    });
  });
}

async function pasteText(text) {
  clipboard.writeText(text);
  await new Promise((r) => setTimeout(r, 50));
  const fastPaste = findBinary("windows-fast-paste.exe");
  if (!fastPaste) return pasteWithPowerShell();
  return new Promise((resolve) => {
    execFile(fastPaste, [], { timeout: 5000 }, (err) => {
      if (err) {
        console.error("[paste] fast-paste failed, falling back to PowerShell:", err.message);
        return pasteWithPowerShell().then(resolve);
      }
      resolve();
    });
  });
}

let orbWindow = null;
let isRecording = false;

function createOrbWindow() {
  orbWindow = new BrowserWindow({
    width: 48,
    height: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  orbWindow.setAlwaysOnTop(true, "screen-saver");
  orbWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  orbWindow.once("ready-to-show", () => {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    orbWindow.setPosition(width - 64, height - 64);
    orbWindow.show();
  });
  orbWindow.on("closed", () => {
    orbWindow = null;
  });
}

function toggleRecording() {
  if (!orbWindow) return;
  isRecording = !isRecording;
  orbWindow.webContents.send(isRecording ? "start-recording" : "stop-recording");
}

ipcMain.handle("transcribe-and-paste", async (event, arrayBuffer) => {
  try {
    orbWindow.webContents.send("set-state", "processing");
    const text = await transcribe(Buffer.from(arrayBuffer));
    if (text) {
      await pasteText(text);
    }
    orbWindow.webContents.send("set-state", "idle");
    return { ok: true, text };
  } catch (e) {
    console.error("[transcribe-and-paste]", e);
    isRecording = false;
    if (orbWindow) orbWindow.webContents.send("set-state", "idle");
    dialog.showErrorBox("Transcription failed", e.message);
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  createOrbWindow();
  const ok = globalShortcut.register("numdec", () => {
    if (orbWindow) toggleRecording();
  });
  if (!ok) {
    console.error("Failed to register numpad . hotkey (numdec) — already in use?");
  } else {
    console.log("Hotkey numpad . (numdec) registered");
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
