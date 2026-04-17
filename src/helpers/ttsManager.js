/**
 * TTS Manager — Edge TTS (Microsoft Read Aloud) wrapper
 *
 * Uses msedge-tts to call Microsoft Edge's free cloud TTS service.
 * No API key needed. Requires internet. 20+ natural Chinese voices available.
 *
 * Returns audio as a Buffer (mp3) which the renderer plays via HTMLAudioElement.
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const debugLogger = require("./debugLogger");

// Natural female Chinese voice, good for daily assistant use.
// Alternatives: zh-CN-YunxiNeural (male), zh-CN-YunyangNeural (news anchor),
// zh-CN-XiaoyiNeural (warm young female), zh-CN-XiaochenNeural (casual).
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

class TtsManager {
  constructor() {
    this._tts = null;
    this._currentVoice = null;
    this._currentFormat = null;
  }

  async _ensureReady(voice) {
    if (!this._tts) {
      this._tts = new MsEdgeTTS();
    }
    if (this._currentVoice !== voice || this._currentFormat !== DEFAULT_FORMAT) {
      await this._tts.setMetadata(voice, DEFAULT_FORMAT);
      this._currentVoice = voice;
      this._currentFormat = DEFAULT_FORMAT;
    }
  }

  /**
   * Synthesize text → mp3 Buffer.
   * @param {string} text
   * @param {{ voice?: string, rate?: string|number, pitch?: string, volume?: string }} [opts]
   * @returns {Promise<Buffer|null>}
   */
  async synthesize(text, opts = {}) {
    const cleaned = (text || "").trim();
    if (!cleaned) return null;

    const voice = opts.voice || DEFAULT_VOICE;

    try {
      await this._ensureReady(voice);
    } catch (err) {
      debugLogger.error("tts: setMetadata failed", { error: err.message, voice });
      // Reset so next call reconnects.
      this._tts = null;
      this._currentVoice = null;
      throw err;
    }

    const prosody = {};
    if (opts.rate != null) prosody.rate = opts.rate;
    if (opts.pitch != null) prosody.pitch = opts.pitch;
    if (opts.volume != null) prosody.volume = opts.volume;

    return new Promise((resolve, reject) => {
      let stream;
      try {
        const result = this._tts.toStream(cleaned, prosody);
        stream = result.audioStream;
      } catch (err) {
        debugLogger.error("tts: toStream threw", { error: err.message });
        return reject(err);
      }

      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("close", () => {
        if (chunks.length === 0) {
          debugLogger.warn("tts: empty audio stream", { text: cleaned.slice(0, 80) });
          return resolve(null);
        }
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", (err) => {
        debugLogger.error("tts: stream error", { error: err.message });
        reject(err);
      });
    });
  }

  /**
   * Preset list shown in settings UI.
   */
  static listVoices() {
    return [
      { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女, 自然)" },
      { id: "zh-CN-XiaoyiNeural", label: "晓伊 (女, 温暖)" },
      { id: "zh-CN-XiaochenNeural", label: "晓辰 (女, 轻松)" },
      { id: "zh-CN-YunxiNeural", label: "云希 (男, 自然)" },
      { id: "zh-CN-YunyangNeural", label: "云扬 (男, 播音)" },
      { id: "zh-CN-YunjianNeural", label: "云健 (男, 沉稳)" },
      { id: "en-US-AriaNeural", label: "Aria (US English, female)" },
      { id: "en-US-GuyNeural", label: "Guy (US English, male)" },
    ];
  }
}

module.exports = TtsManager;
module.exports.DEFAULT_VOICE = DEFAULT_VOICE;
