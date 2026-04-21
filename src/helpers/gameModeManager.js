const debugLogger = require("./debugLogger");

/**
 * Game Mode — one-click toggle that frees GPU/CPU for games by stopping heavy
 * background services (wake-word listener, whisper-server, llama-server) and
 * restarts them on exit. In-memory state only: a restart starts fresh with
 * services enabled per the user's saved settings.
 *
 * Takes getters for the volatile managers because wakeWordManager is created
 * in app.whenReady, strictly AFTER IPCHandlers construction — direct refs
 * would be null at wire time.
 */
class GameModeManager {
  constructor({ getWakeWordManager, getWhisperManager, getEnvironmentManager, getWhisperCudaManager }) {
    this._getWakeWord = getWakeWordManager || (() => null);
    this._getWhisper = getWhisperManager || (() => null);
    this._getEnv = getEnvironmentManager || (() => null);
    this._getWhisperCuda = getWhisperCudaManager || (() => null);
    this._enabled = false;
    // Snapshot of which services were actually running at enable time, so we
    // only restart those on exit and don't spuriously spin up services the
    // user had disabled.
    this._snapshot = null;
  }

  isEnabled() {
    return this._enabled;
  }

  async toggle() {
    if (this._enabled) return this.disable();
    return this.enable();
  }

  async enable() {
    if (this._enabled) return;
    const wakeWord = this._getWakeWord();
    const whisper = this._getWhisper();
    const modelManager = this._getModelManager();

    const whisperStatus = whisper?.getServerStatus?.();
    const llamaStatus = modelManager?.getServerStatus?.();

    this._snapshot = {
      wakeWordWasEnabled: !!wakeWord?.enabled,
      whisperWasRunning: !!(whisperStatus?.running || whisperStatus?.ready),
      llamaWasRunning: !!(llamaStatus?.running || llamaStatus?.ready),
    };

    debugLogger.info("Game mode enabling", this._snapshot, "game-mode");

    if (wakeWord?.enabled) {
      try {
        wakeWord.stop();
      } catch (err) {
        debugLogger.warn("Game mode: wake-word stop failed", { error: err?.message }, "game-mode");
      }
    }

    if (whisper?.stopServer) {
      try {
        await whisper.stopServer();
      } catch (err) {
        debugLogger.warn("Game mode: whisper stop failed", { error: err?.message }, "game-mode");
      }
    }

    if (modelManager?.stopServer) {
      try {
        await modelManager.stopServer();
      } catch (err) {
        debugLogger.warn("Game mode: llama stop failed", { error: err?.message }, "game-mode");
      }
    }

    this._enabled = true;
    debugLogger.info("Game mode enabled", {}, "game-mode");
  }

  async disable() {
    if (!this._enabled) return;
    const snapshot = this._snapshot || {};
    this._enabled = false;
    this._snapshot = null;

    debugLogger.info("Game mode disabling", snapshot, "game-mode");

    if (snapshot.whisperWasRunning) {
      const whisper = this._getWhisper();
      const env = this._getEnv();
      const whisperCuda = this._getWhisperCuda();
      if (whisper?.initializeAtStartup) {
        const settings = {
          localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
          whisperModel: process.env.LOCAL_WHISPER_MODEL,
          useCuda: process.env.WHISPER_CUDA_ENABLED === "true" && whisperCuda?.isDownloaded?.(),
        };
        whisper.initializeAtStartup(settings).catch((err) => {
          debugLogger.warn("Game mode: whisper restart failed", { error: err?.message }, "game-mode");
        });
      }
      void env; // reserved for future per-env overrides
    }

    if (snapshot.llamaWasRunning) {
      if (process.env.REASONING_PROVIDER === "local" && process.env.LOCAL_REASONING_MODEL) {
        const modelManager = this._getModelManager();
        modelManager?.prewarmServer?.(process.env.LOCAL_REASONING_MODEL).catch((err) => {
          debugLogger.warn("Game mode: llama restart failed", { error: err?.message }, "game-mode");
        });
      }
    }

    if (snapshot.wakeWordWasEnabled) {
      const wakeWord = this._getWakeWord();
      const env = this._getEnv();
      if (wakeWord?.start && env?.getWakeWordEnabled?.() && wakeWord.isModelDownloaded?.()) {
        const presetId = env.getWakeWordPreset?.();
        const threshold = env.getWakeWordThreshold?.();
        wakeWord.start({ presetId, threshold }).catch((err) => {
          debugLogger.warn("Game mode: wake-word restart failed", { error: err?.message }, "game-mode");
        });
      }
    }

    debugLogger.info("Game mode disabled", {}, "game-mode");
  }

  _getModelManager() {
    try {
      return require("./modelManagerBridge").default;
    } catch {
      return null;
    }
  }
}

module.exports = GameModeManager;
