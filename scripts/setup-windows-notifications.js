// Creates a Start Menu shortcut on Windows with the matching AppUserModelID
// so dev-mode Electron notifications persist in the Action Center.
// One-shot, idempotent. No-op on non-Windows.
//
// Usage: npm run setup:windows-notifications

const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

if (process.platform !== "win32") {
  console.log("[setup-notifications] Not Windows — skipping.");
  process.exit(0);
}

const APP_ID = "com.herotools.openwispr.development";
const SHORTCUT_NAME = "OpenWhispr (Dev).lnk";

const projectRoot = path.resolve(__dirname, "..");
const electronExe = path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const ps1 = path.join(__dirname, "setup-windows-notifications.ps1");

if (!fs.existsSync(electronExe)) {
  console.error(`[setup-notifications] electron.exe not found at ${electronExe}`);
  console.error("[setup-notifications] Run `npm install` first.");
  process.exit(1);
}

const startMenu = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs"
);
const shortcutPath = path.join(startMenu, SHORTCUT_NAME);

const result = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ps1,
    "-ShortcutPath",
    shortcutPath,
    "-TargetPath",
    electronExe,
    "-WorkingDir",
    projectRoot,
    "-AppId",
    APP_ID,
  ],
  { stdio: "inherit" }
);

if (result.status !== 0) {
  console.error("[setup-notifications] PowerShell exited with code", result.status);
  process.exit(result.status || 1);
}

console.log("[setup-notifications] Done.");
console.log("[setup-notifications] Restart the dev app — next reminder will land in Action Center.");
