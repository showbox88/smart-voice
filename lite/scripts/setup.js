#!/usr/bin/env node
// One-shot setup: downloads whisper-server + base model into lite/.
// Idempotent — re-running skips anything already in place.
// Runs automatically via `postinstall` hook in package.json.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BIN_DIR = path.join(ROOT, "bin");
const MODELS_DIR = path.join(ROOT, "models");

const WHISPER_ZIP_URL =
  "https://github.com/OpenWhispr/whisper.cpp/releases/latest/download/whisper-server-win32-x64-cpu.zip";
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_NAME = "ggml-base.bin";
const SERVER_BIN = "whisper-server-win32-x64.exe";

if (process.platform !== "win32") {
  console.log("[setup] Lite currently supports Windows only — skipping.");
  process.exit(0);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    function get(u, redirectCount) {
      if (redirectCount > 5) return reject(new Error("Too many redirects"));
      const req = https.get(u, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const next = new URL(res.headers.location, u).toString();
          return get(next, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        let lastPct = -1;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              process.stdout.write(
                `\r  ${pct.toString().padStart(3)}%  ${(received / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)}MB`
              );
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          process.stdout.write("\n");
          file.close((err) => (err ? reject(err) : resolve()));
        });
        file.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(60000, () => {
        req.destroy(new Error("Connection timed out"));
      });
    }
    get(url, 0);
  });
}

async function ensureWhisperServer() {
  const outPath = path.join(BIN_DIR, SERVER_BIN);
  if (fs.existsSync(outPath)) {
    console.log("[setup] whisper-server: already present, skip");
    return;
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, "whisper-server.zip");
  console.log("[setup] whisper-server: downloading (~7MB)...");
  await download(WHISPER_ZIP_URL, zipPath);

  console.log("[setup] whisper-server: extracting...");
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`,
    { stdio: "inherit" }
  );

  // Some releases extract as -cpu.exe; rename to the canonical name main.js looks for
  const cpuName = path.join(BIN_DIR, "whisper-server-win32-x64-cpu.exe");
  if (fs.existsSync(cpuName) && !fs.existsSync(outPath)) {
    fs.renameSync(cpuName, outPath);
  }
  if (!fs.existsSync(outPath)) {
    throw new Error(
      `Binary not found after extraction. Check ${BIN_DIR} — expected ${SERVER_BIN} or ${path.basename(cpuName)}.`
    );
  }

  try {
    fs.unlinkSync(zipPath);
  } catch {}
  console.log(`[setup] whisper-server: installed -> ${outPath}`);
}

async function ensureModel() {
  const outPath = path.join(MODELS_DIR, MODEL_NAME);
  if (fs.existsSync(outPath)) {
    console.log("[setup] model base: already present, skip");
    return;
  }
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  console.log("[setup] model base: downloading (~142MB, one time only)...");
  const tmpPath = outPath + ".tmp";
  await download(MODEL_URL, tmpPath);
  fs.renameSync(tmpPath, outPath);
  console.log(`[setup] model base: installed -> ${outPath}`);
}

async function main() {
  console.log("=== OpenWhispr Lite — setup ===");
  await ensureWhisperServer();
  await ensureModel();
  console.log("=== Done. Run: npm start ===");
}

main().catch((e) => {
  console.error("[setup] FAILED:", e.message);
  console.error(
    "[setup] You can retry with: npm run setup  (or download manually — see README)"
  );
  process.exit(1);
});
