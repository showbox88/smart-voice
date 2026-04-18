const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const debugLogger = require("./debugLogger");

const AUDIO_EXTS = new Set([".mp3", ".flac", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".wma"]);
const VLC_HTTP_PORT = 8765;
const VLC_HTTP_PASSWORD = "voicerc";
const VLC_LAUNCH_SETTLE_MS = 900;

const WINDOWS_VLC_CANDIDATES = [
  "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
  "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];
const MAC_VLC_CANDIDATES = [
  "/Applications/VLC.app/Contents/MacOS/VLC",
  "/usr/local/bin/vlc",
  "/opt/homebrew/bin/vlc",
];
const LINUX_VLC_CANDIDATES = ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"];

// Wraps VLC as a child process and drives it through its HTTP remote interface.
// One VLC window at a time — a new play() replaces the current playlist so users
// don't accumulate zombie players.
class MusicManager {
  constructor() {
    this.process = null;
    this.vlcPath = null;
    this.lastRoot = null;
    this.fileCache = { root: null, files: [], scannedAt: 0 };
  }

  _detectVlcPath() {
    if (process.env.VLC_PATH && fs.existsSync(process.env.VLC_PATH)) {
      return process.env.VLC_PATH;
    }
    const candidates =
      process.platform === "win32"
        ? WINDOWS_VLC_CANDIDATES
        : process.platform === "darwin"
          ? MAC_VLC_CANDIDATES
          : LINUX_VLC_CANDIDATES;
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  isVlcAvailable() {
    if (this.vlcPath) return true;
    this.vlcPath = this._detectVlcPath();
    return Boolean(this.vlcPath);
  }

  getVlcPath() {
    if (!this.vlcPath) this.vlcPath = this._detectVlcPath();
    return this.vlcPath;
  }

  async _walkDir(dir, out, depth = 0) {
    if (depth > 12) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this._walkDir(full, out, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          out.push(full);
        }
      }
    }
  }

  async listFiles(rootDir, { refresh = false } = {}) {
    if (!rootDir) return { success: false, error: "missing_root" };
    if (!fs.existsSync(rootDir)) return { success: false, error: "root_not_found" };

    const cacheFresh =
      !refresh &&
      this.fileCache.root === rootDir &&
      Date.now() - this.fileCache.scannedAt < 30_000;
    if (cacheFresh) {
      return { success: true, files: this.fileCache.files, cached: true };
    }

    const out = [];
    await this._walkDir(rootDir, out);
    out.sort((a, b) => a.localeCompare(b));
    this.fileCache = { root: rootDir, files: out, scannedAt: Date.now() };
    this.lastRoot = rootDir;
    return { success: true, files: out };
  }

  _vlcRequest(commandQuery) {
    return new Promise((resolve) => {
      const auth = Buffer.from(`:${VLC_HTTP_PASSWORD}`).toString("base64");
      const req = http.request(
        {
          host: "127.0.0.1",
          port: VLC_HTTP_PORT,
          path: `/requests/status.json${commandQuery ? `?${commandQuery}` : ""}`,
          method: "GET",
          headers: { Authorization: `Basic ${auth}` },
          timeout: 3000,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve({ ok: true, data: JSON.parse(body) });
              } catch {
                resolve({ ok: true, data: null });
              }
            } else {
              resolve({ ok: false, error: `http_${res.statusCode}` });
            }
          });
        }
      );
      req.on("error", (err) => resolve({ ok: false, error: err.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "timeout" });
      });
      req.end();
    });
  }

  _ensureProcess() {
    return new Promise((resolve, reject) => {
      if (this.process && !this.process.killed) return resolve();
      const vlc = this.getVlcPath();
      if (!vlc) return reject(new Error("vlc_not_found"));
      const args = [
        "--extraintf=http",
        `--http-host=127.0.0.1`,
        `--http-port=${VLC_HTTP_PORT}`,
        `--http-password=${VLC_HTTP_PASSWORD}`,
        "--no-qt-privacy-ask",
        "--no-one-instance",
        "--no-video-title-show",
        // Audio visualization — shows a spectrum when playing audio
        "--audio-visual=visual",
        "--effect-list=spectrum",
        "--effect-width=800",
        "--effect-height=400",
      ];
      debugLogger.info("[music] spawning VLC", { vlc, port: VLC_HTTP_PORT });
      const child = spawn(vlc, args, {
        detached: false,
        stdio: "ignore",
        windowsHide: false,
      });
      child.on("exit", (code) => {
        debugLogger.info("[music] VLC exited", { code });
        if (this.process === child) this.process = null;
      });
      child.on("error", (err) => {
        debugLogger.error("[music] VLC spawn error", { error: err.message });
        if (this.process === child) this.process = null;
      });
      this.process = child;
      // Wait briefly for HTTP interface to come up.
      setTimeout(resolve, VLC_LAUNCH_SETTLE_MS);
    });
  }

  async _waitForHttp(maxMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const r = await this._vlcRequest("");
      if (r.ok) return true;
      await new Promise((res) => setTimeout(res, 250));
    }
    return false;
  }

  async play(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: "no_files" };
    }
    try {
      await this._ensureProcess();
    } catch (err) {
      return { success: false, error: err.message };
    }
    const ready = await this._waitForHttp();
    if (!ready) {
      return { success: false, error: "vlc_http_unreachable" };
    }
    // Clear playlist, then play first file, enqueue the rest.
    await this._vlcRequest("command=pl_empty");
    const first = files[0];
    const firstUri = encodeURIComponent(first);
    const playR = await this._vlcRequest(`command=in_play&input=${firstUri}`);
    if (!playR.ok) {
      return { success: false, error: `in_play_failed:${playR.error}` };
    }
    for (let i = 1; i < files.length; i++) {
      const uri = encodeURIComponent(files[i]);
      await this._vlcRequest(`command=in_enqueue&input=${uri}`);
    }
    return { success: true, playing: first, queued: files.length };
  }

  async pause() {
    if (!this.process) return { success: false, error: "not_running" };
    const r = await this._vlcRequest("command=pl_pause");
    return r.ok ? { success: true } : { success: false, error: r.error };
  }

  async resume() {
    if (!this.process) return { success: false, error: "not_running" };
    // pl_forceresume is not standard; pl_pause toggles. Prefer pl_play.
    const r = await this._vlcRequest("command=pl_play");
    return r.ok ? { success: true } : { success: false, error: r.error };
  }

  async next() {
    if (!this.process) return { success: false, error: "not_running" };
    const r = await this._vlcRequest("command=pl_next");
    return r.ok ? { success: true } : { success: false, error: r.error };
  }

  async previous() {
    if (!this.process) return { success: false, error: "not_running" };
    const r = await this._vlcRequest("command=pl_previous");
    return r.ok ? { success: true } : { success: false, error: r.error };
  }

  async stop() {
    if (!this.process) return { success: true, alreadyStopped: true };
    await this._vlcRequest("command=pl_stop").catch(() => {});
    try {
      this.process.kill();
    } catch {
      /* ignore */
    }
    this.process = null;
    return { success: true };
  }

  // Set repeat mode: "off" (no loop), "all" (loop playlist), "one" (repeat single track).
  // VLC HTTP only offers toggles (pl_loop, pl_repeat), so we read current state first
  // and flip each flag only if needed.
  async setRepeatMode(mode) {
    if (!this.process) return { success: false, error: "not_running" };
    const s = await this._vlcRequest("");
    if (!s.ok) return { success: false, error: s.error };
    const currentLoop = Boolean(s.data?.loop);
    const currentRepeat = Boolean(s.data?.repeat);
    let targetLoop = false;
    let targetRepeat = false;
    if (mode === "all") targetLoop = true;
    else if (mode === "one") targetRepeat = true;
    // "off" keeps both false.
    if (currentRepeat !== targetRepeat) {
      await this._vlcRequest("command=pl_repeat");
    }
    if (currentLoop !== targetLoop) {
      await this._vlcRequest("command=pl_loop");
    }
    return { success: true, mode, loop: targetLoop, repeat: targetRepeat };
  }

  // Toggle shuffle on the currently-playing VLC playlist.
  async setShuffle(on) {
    if (!this.process) return { success: false, error: "not_running" };
    const s = await this._vlcRequest("");
    if (!s.ok) return { success: false, error: s.error };
    const current = Boolean(s.data?.random);
    if (current !== Boolean(on)) {
      await this._vlcRequest("command=pl_random");
    }
    return { success: true, shuffle: Boolean(on) };
  }

  async setVolume(volume0to100) {
    if (!this.process) return { success: false, error: "not_running" };
    const v = Math.max(0, Math.min(512, Math.round((volume0to100 / 100) * 256)));
    const r = await this._vlcRequest(`command=volume&val=${v}`);
    return r.ok ? { success: true, value: v } : { success: false, error: r.error };
  }

  async status() {
    if (!this.process) {
      return { success: true, running: false };
    }
    const r = await this._vlcRequest("");
    if (!r.ok) return { success: false, error: r.error };
    const d = r.data || {};
    const title =
      (d.information && d.information.category && d.information.category.meta && d.information.category.meta.filename) ||
      null;
    return {
      success: true,
      running: true,
      state: d.state || null,
      time: d.time || 0,
      length: d.length || 0,
      volume: d.volume || 0,
      title,
    };
  }

  async shutdown() {
    await this.stop().catch(() => {});
  }

  // Copy dropped audio files into the configured music folder. If a filename
  // already exists, append " (1)", " (2)", ... to avoid overwriting.
  async importFiles(rootDir, sourcePaths) {
    if (!rootDir) return { success: false, error: "no_folder_configured" };
    if (!fs.existsSync(rootDir)) return { success: false, error: "root_not_found" };
    const copied = [];
    const skipped = [];
    for (const src of Array.isArray(sourcePaths) ? sourcePaths : []) {
      if (typeof src !== "string" || !src) {
        skipped.push({ src: String(src), reason: "invalid_path" });
        continue;
      }
      try {
        const stat = await fs.promises.stat(src);
        if (!stat.isFile()) {
          skipped.push({ src, reason: "not_file" });
          continue;
        }
        const ext = path.extname(src).toLowerCase();
        if (!AUDIO_EXTS.has(ext)) {
          skipped.push({ src, reason: "not_audio" });
          continue;
        }
        const baseName = path.basename(src, ext);
        let dest = path.join(rootDir, baseName + ext);
        let counter = 1;
        while (fs.existsSync(dest)) {
          dest = path.join(rootDir, `${baseName} (${counter})${ext}`);
          counter++;
          if (counter > 999) {
            skipped.push({ src, reason: "too_many_duplicates" });
            dest = null;
            break;
          }
        }
        if (!dest) continue;
        await fs.promises.copyFile(src, dest);
        copied.push(dest);
      } catch (err) {
        skipped.push({ src, reason: err.message || "copy_failed" });
      }
    }
    // Invalidate scan cache so next list sees the new files.
    this.fileCache = { root: null, files: [], scannedAt: 0 };
    return { success: true, copied, skipped };
  }
}

module.exports = MusicManager;
