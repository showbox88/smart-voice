const { VeSync } = require("tsvesync");
let setVeSyncLogger = null;
try {
  ({ setLogger: setVeSyncLogger } = require("tsvesync/dist/lib/logger"));
} catch {
  /* optional — older tsvesync versions */
}
const debugLogger = require("./debugLogger");

// Tsvesync uses an internal logger and its login() only returns a boolean.
// Intercept it so we can report real failure reasons to the UI.
const _recentVeSyncLogs = [];
if (setVeSyncLogger) {
  try {
    setVeSyncLogger({
      debug: (msg, ...args) => debugLogger.debug(`[tsvesync] ${msg}`, ...args),
      info: (msg, ...args) => debugLogger.info(`[tsvesync] ${msg}`, ...args),
      warn: (msg, ...args) => {
        _recentVeSyncLogs.push(String(msg));
        if (_recentVeSyncLogs.length > 20) _recentVeSyncLogs.shift();
        debugLogger.warn(`[tsvesync] ${msg}`, ...args);
      },
      error: (msg, ...args) => {
        _recentVeSyncLogs.push(String(msg));
        if (_recentVeSyncLogs.length > 20) _recentVeSyncLogs.shift();
        debugLogger.error(`[tsvesync] ${msg}`, ...args);
      },
      setLevel: () => {},
      getLevel: () => 0,
    });
  } catch (err) {
    debugLogger.warn("Failed to install tsvesync logger hook", { error: err.message });
  }
}

function _drainVeSyncLogs() {
  const snapshot = [..._recentVeSyncLogs];
  _recentVeSyncLogs.length = 0;
  return snapshot;
}

// Wraps the VeSync cloud client so the renderer can log in, list devices, and
// toggle them without knowing about tsvesync internals.
//
// The client is stateful — once logged in, `this.client.devices` is the
// authoritative list. Refreshes re-hydrate device state (on/off) but re-use
// the same client + token.
class VeSyncManager {
  constructor(environmentManager) {
    this.env = environmentManager;
    this.client = null;
    this.loggedIn = false;
    this.lastLoginAt = 0;
  }

  _credentials() {
    return {
      email: this.env.getVeSyncEmail(),
      password: this.env.getVeSyncPassword(),
      countryCode: this.env.getVeSyncCountryCode() || "US",
    };
  }

  isLoggedIn() {
    return this.loggedIn;
  }

  // Log in with credentials currently in .env. Returns { success, error? }.
  async login({ force = false } = {}) {
    const { email, password, countryCode } = this._credentials();
    if (!email || !password) {
      return { success: false, error: "missing_credentials" };
    }
    if (this.loggedIn && !force && Date.now() - this.lastLoginAt < 12 * 60 * 60 * 1000) {
      return { success: true, cached: true };
    }
    _drainVeSyncLogs();
    try {
      this.client = new VeSync(email, password, "America/New_York", { countryCode });
      const ok = await this.client.login(3, 1000);
      if (!ok) {
        const logs = _drainVeSyncLogs();
        this.loggedIn = false;
        // Surface the most actionable line from tsvesync's internal logs.
        const credError = logs.find((l) =>
          /invalid credentials|credential_error/i.test(l)
        );
        const regionError = logs.find((l) =>
          /COUNTRY CODE REQUIRED|both US and EU|cross_region/i.test(l)
        );
        const msg = credError
          ? "credential_error"
          : regionError
            ? "region_mismatch"
            : logs.length
              ? logs[logs.length - 1].slice(0, 200)
              : "login_rejected";
        debugLogger.error("vesync login failed", {
          email,
          countryCode,
          tsvesyncLogs: logs,
        });
        return { success: false, error: msg, logs };
      }
      this.loggedIn = true;
      this.lastLoginAt = Date.now();
      _drainVeSyncLogs();
      return { success: true };
    } catch (err) {
      const logs = _drainVeSyncLogs();
      debugLogger.error("vesync login exception", {
        error: err.message,
        tsvesyncLogs: logs,
      });
      this.loggedIn = false;
      return {
        success: false,
        error: err.message || "login_exception",
        logs,
      };
    }
  }

  async listDevices({ refresh = true } = {}) {
    if (!this.loggedIn) {
      const r = await this.login();
      if (!r.success) return { success: false, error: r.error, devices: [] };
    }
    try {
      if (refresh) {
        await this.client.getDevices();
      }
      const devices = (this.client.devices || []).map((d) => ({
        cid: d.cid,
        uuid: d.uuid,
        name: d.deviceName,
        type: d.deviceType,
        category: d.deviceCategory,
        status: d.deviceStatus,
        online: d.connectionStatus === "online",
        mac: d.macId,
        region: d.deviceRegion,
      }));
      return { success: true, devices };
    } catch (err) {
      debugLogger.error("vesync listDevices failed", { error: err.message });
      return { success: false, error: err.message, devices: [] };
    }
  }

  _findDeviceByCid(cid) {
    if (!this.client) return null;
    return (this.client.devices || []).find((d) => d.cid === cid) || null;
  }

  async toggle(cid, desired /* "on" | "off" | undefined */) {
    if (!this.loggedIn) {
      const r = await this.login();
      if (!r.success) return { success: false, error: r.error };
    }
    const dev = this._findDeviceByCid(cid);
    if (!dev) return { success: false, error: "device_not_found" };

    const current = dev.deviceStatus;
    const target =
      desired === "on" || desired === "off"
        ? desired
        : current === "on"
          ? "off"
          : "on";

    try {
      const ok =
        target === "on"
          ? typeof dev.turnOn === "function"
            ? await dev.turnOn()
            : false
          : typeof dev.turnOff === "function"
            ? await dev.turnOff()
            : false;
      if (!ok) return { success: false, error: "device_rejected" };
      // Refresh single device state
      if (typeof dev.update === "function") {
        try {
          await dev.update();
        } catch {
          /* non-fatal */
        }
      }
      return { success: true, cid, status: dev.deviceStatus || target };
    } catch (err) {
      debugLogger.error("vesync toggle failed", { cid, target, error: err.message });
      return { success: false, error: err.message };
    }
  }

  logout() {
    this.client = null;
    this.loggedIn = false;
    this.lastLoginAt = 0;
  }
}

module.exports = VeSyncManager;
