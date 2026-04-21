const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");

// Lightweight cross-domain state the agent wants to recall at startup: last
// played song, last-used smart device, anything that's genuinely session-
// spanning and doesn't have a better home (music uses its own index, VeSync
// creds live in env, etc.). Stored as a small JSON blob in userData so it
// survives app restarts.
const FILENAME = "agent-state.json";
const MAX_BYTES = 64 * 1024;

function filePath() {
  return path.join(app.getPath("userData"), FILENAME);
}

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw);
    _cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

function save(data) {
  const fp = filePath();
  const tmp = fp + ".tmp";
  const body = JSON.stringify(data, null, 2);
  if (body.length > MAX_BYTES) {
    debugLogger.warn("[agent-state] refusing to write — payload exceeds 64KB");
    return false;
  }
  try {
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, fp);
    _cache = data;
    return true;
  } catch (err) {
    debugLogger.warn("[agent-state] save failed:", err.message);
    return false;
  }
}

function get() {
  return load();
}

function set(patch) {
  if (!patch || typeof patch !== "object") return load();
  const next = { ...load(), ...patch };
  save(next);
  return next;
}

module.exports = { get, set };
