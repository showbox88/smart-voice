const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const debugLogger = require("./debugLogger");
const { getModelsDirForService } = require("./modelDirUtils");

const MODEL_NAME = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";
const MODEL_ARCHIVE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${MODEL_NAME}.tar.bz2`;

const WAKE_WORD_PRESETS = [
  { id: "xiaozhi", display: "小智", line: "x iǎo zh ì @小智" },
  { id: "xiaozhi_tongxue", display: "小智同学", line: "x iǎo zh ì t óng x ué @小智同学" },
  { id: "xiaoai", display: "小爱同学", line: "x iǎo ài t óng x ué @小爱同学" },
  { id: "nihao_xiaozhi", display: "你好小智", line: "n ǐ h ǎo x iǎo zh ì @你好小智" },
  { id: "zhushou", display: "助手", line: "zh ù sh ǒu @助手" },
  { id: "hei_zhushou", display: "嘿助手", line: "h ēi zh ù sh ǒu @嘿助手" },
];

const DEFAULT_PRESET_ID = "xiaozhi";
const DEFAULT_THRESHOLD = 1.5;
const MIN_DETECT_INTERVAL_MS = 1500;

class WakeWordManager extends EventEmitter {
  constructor() {
    super();
    this.enabled = false;
    this.spotter = null;
    this.stream = null;
    this.sherpaOnnx = null;
    this.presetId = DEFAULT_PRESET_ID;
    this.threshold = DEFAULT_THRESHOLD;
    this.lastDetectAt = 0;
    this.downloadInProgress = null;
    this.suppressed = false;
    this.initError = null;
  }

  getModelDir() {
    return path.join(getModelsDirForService("kws"), MODEL_NAME);
  }

  isModelDownloaded() {
    const sentinel = path.join(
      this.getModelDir(),
      "encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx"
    );
    return fs.existsSync(sentinel);
  }

  getPresets() {
    return WAKE_WORD_PRESETS.map((p) => ({ id: p.id, display: p.display }));
  }

  getStatus() {
    return {
      enabled: this.enabled,
      modelDownloaded: this.isModelDownloaded(),
      downloading: !!this.downloadInProgress,
      running: !!this.spotter && !!this.stream,
      suppressed: this.suppressed,
      presetId: this.presetId,
      threshold: this.threshold,
      error: this.initError,
    };
  }

  suppress(flag) {
    this.suppressed = !!flag;
  }

  async ensureModelDownloaded() {
    if (this.isModelDownloaded()) return true;

    if (this.downloadInProgress) {
      return this.downloadInProgress;
    }

    this.downloadInProgress = this._downloadModel().finally(() => {
      this.downloadInProgress = null;
    });
    return this.downloadInProgress;
  }

  async _downloadModel() {
    const { execFileSync } = require("child_process");
    const { downloadFile } = require("./downloadUtils");

    const modelsDir = getModelsDirForService("kws");
    fs.mkdirSync(modelsDir, { recursive: true });

    const archivePath = path.join(modelsDir, `${MODEL_NAME}.tar.bz2`);

    debugLogger.info("Downloading KWS model", { url: MODEL_ARCHIVE_URL }, "wake-word");
    this.emit("download-progress", { phase: "downloading", progress: 0 });

    await downloadFile(MODEL_ARCHIVE_URL, archivePath, {
      onProgress: (downloaded, total) => {
        if (total > 0) {
          this.emit("download-progress", {
            phase: "downloading",
            progress: downloaded / total,
          });
        }
      },
    });

    this.emit("download-progress", { phase: "extracting", progress: 1 });
    debugLogger.info("Extracting KWS model", { archivePath, modelsDir }, "wake-word");

    execFileSync("tar", ["-xjf", archivePath, "-C", modelsDir], {
      stdio: "inherit",
    });

    try {
      fs.unlinkSync(archivePath);
    } catch {
      // ignore
    }

    if (!this.isModelDownloaded()) {
      throw new Error("Model extraction completed but expected files are missing");
    }

    debugLogger.info("KWS model ready", { dir: this.getModelDir() }, "wake-word");
    this.emit("download-progress", { phase: "done", progress: 1 });

    return true;
  }

  _writeKeywordsFile(presetId, threshold) {
    const preset = WAKE_WORD_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      throw new Error(`Unknown wake-word preset: ${presetId}`);
    }
    const modelDir = this.getModelDir();
    const keywordsPath = path.join(modelDir, "keywords.user.txt");
    const thresh = Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD;
    const line = `${preset.line} :${thresh}\n`;
    fs.writeFileSync(keywordsPath, line, "utf8");
    return { keywordsPath, preset };
  }

  async start(config = {}) {
    if (this.spotter && this.stream) {
      debugLogger.info("Wake-word already running", {}, "wake-word");
      return true;
    }

    this.presetId = config.presetId || this.presetId || DEFAULT_PRESET_ID;
    this.threshold = Number.isFinite(config.threshold) ? config.threshold : this.threshold;
    this.initError = null;

    if (!this.isModelDownloaded()) {
      this.initError = "model-missing";
      throw new Error("Wake-word model not downloaded");
    }

    const modelDir = this.getModelDir();
    const { keywordsPath } = this._writeKeywordsFile(this.presetId, this.threshold);

    if (!this.sherpaOnnx) {
      try {
        this.sherpaOnnx = require("sherpa-onnx-node");
      } catch (err) {
        this.initError = err?.message || "sherpa-onnx-node load failed";
        debugLogger.error("Failed to require sherpa-onnx-node", { error: err }, "wake-word");
        throw err;
      }
    }

    const spotterConfig = {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(modelDir, "encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx"),
          decoder: path.join(modelDir, "decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx"),
          joiner: path.join(modelDir, "joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx"),
        },
        tokens: path.join(modelDir, "tokens.txt"),
        numThreads: 1,
        provider: "cpu",
        debug: 0,
      },
      keywordsFile: keywordsPath,
      numTrailingBlanks: 1,
    };

    try {
      this.spotter = new this.sherpaOnnx.KeywordSpotter(spotterConfig);
      this.stream = this.spotter.createStream();
      this.enabled = true;
      this.lastDetectAt = 0;
      debugLogger.info(
        "Wake-word started",
        { preset: this.presetId, threshold: this.threshold },
        "wake-word"
      );
      this.emit("started");
      return true;
    } catch (err) {
      this.initError = err?.message || "Failed to initialize KeywordSpotter";
      debugLogger.error(
        "Failed to start wake-word spotter",
        { error: err?.message, stack: err?.stack },
        "wake-word"
      );
      this.spotter = null;
      this.stream = null;
      this.enabled = false;
      throw err;
    }
  }

  stop() {
    this.enabled = false;
    this.stream = null; // release stream — GC'd
    this.spotter = null; // same
    debugLogger.info("Wake-word stopped", {}, "wake-word");
    this.emit("stopped");
  }

  async restart(config = {}) {
    this.stop();
    return this.start(config);
  }

  /**
   * Feed raw Float32 PCM samples (values in [-1, 1]) at the given sample rate.
   * The renderer sends 16kHz mono already-downsampled chunks.
   */
  acceptAudio(samples, sampleRate = 16000) {
    if (!this.enabled || !this.spotter || !this.stream) return;
    if (this.suppressed) return;
    if (!samples || !samples.length) return;

    // Throttled diagnostic — once every ~3s — helps confirm PCM is reaching us.
    const now = Date.now();
    if (!this._lastAudioLog || now - this._lastAudioLog > 3000) {
      this._lastAudioLog = now;
      let max = 0;
      const arr = samples instanceof Float32Array ? samples : new Float32Array(samples);
      for (let i = 0; i < arr.length; i++) {
        const v = Math.abs(arr[i]);
        if (v > max) max = v;
      }
      debugLogger.info(
        "Wake-word audio flowing",
        { samples: arr.length, sampleRate, peak: max.toFixed(3), suppressed: this.suppressed },
        "wake-word"
      );
    }

    try {
      const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples);
      this.stream.acceptWaveform({ sampleRate, samples: float32 });

      while (this.spotter.isReady(this.stream)) {
        this.spotter.decode(this.stream);
      }

      const result = this.spotter.getResult(this.stream);
      if (result && result.keyword) {
        const now = Date.now();
        if (now - this.lastDetectAt >= MIN_DETECT_INTERVAL_MS) {
          this.lastDetectAt = now;
          debugLogger.info(
            "Wake-word detected",
            { keyword: result.keyword, preset: this.presetId },
            "wake-word"
          );
          this.emit("wake-word-detected", {
            keyword: result.keyword,
            presetId: this.presetId,
          });
        }
        // Always reset after a match to avoid consecutive re-firing on the same audio.
        this.spotter.reset(this.stream);
      }
    } catch (err) {
      debugLogger.error(
        "acceptAudio error",
        { error: err?.message, stack: err?.stack },
        "wake-word"
      );
    }
  }
}

module.exports = WakeWordManager;
module.exports.WAKE_WORD_PRESETS = WAKE_WORD_PRESETS;
module.exports.DEFAULT_PRESET_ID = DEFAULT_PRESET_ID;
module.exports.DEFAULT_THRESHOLD = DEFAULT_THRESHOLD;
