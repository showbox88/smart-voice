/**
 * TTS Manager — multi-provider voice synthesis
 *
 * Providers:
 *   - "edge"       : Microsoft Edge Read Aloud (free, 14 Chinese voices, no auth)
 *   - "elevenlabs" : ElevenLabs cloud (paid, instant voice cloning, very natural)
 *
 * Returns audio as a Buffer (mp3) which the renderer plays via HTMLAudioElement.
 */

const https = require("https");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const debugLogger = require("./debugLogger");

// Natural female Chinese voice, good for daily assistant use.
// Alternatives: zh-CN-YunxiNeural (male), zh-CN-YunyangNeural (news anchor),
// zh-CN-XiaoyiNeural (warm young female), zh-CN-XiaochenNeural (casual).
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

// ────────────── Provider: ElevenLabs ──────────────
const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * Synthesize via ElevenLabs REST API.
 * @returns {Promise<Buffer>}  mp3 audio
 */
function synthesizeElevenLabs(text, { voiceId, apiKey, modelId = ELEVENLABS_DEFAULT_MODEL, stability, similarity, style }) {
  if (!apiKey) throw new Error("elevenlabs_missing_api_key");
  if (!voiceId) throw new Error("elevenlabs_missing_voice_id");

  const voiceSettings = {};
  if (stability != null) voiceSettings.stability = stability;
  if (similarity != null) voiceSettings.similarity_boost = similarity;
  if (style != null) voiceSettings.style = style;

  const body = JSON.stringify({
    text,
    model_id: modelId,
    ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
  });

  const options = {
    method: "POST",
    hostname: "api.elevenlabs.io",
    path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Accept: "audio/mpeg",
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(Buffer.concat(chunks));
        }
        const bodyText = Buffer.concat(chunks).toString("utf8").slice(0, 500);
        debugLogger.error("tts(elevenlabs): http error", {
          status: res.statusCode,
          body: bodyText,
        });
        reject(
          new Error(
            `elevenlabs_http_${res.statusCode}: ${bodyText || res.statusMessage || "unknown"}`
          )
        );
      });
    });
    req.on("error", (err) => {
      debugLogger.error("tts(elevenlabs): request error", { error: err.message });
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

// ────────────── Provider: Edge Read Aloud ──────────────
/**
 * Synthesize via msedge-tts. Fresh instance per call to avoid WebSocket
 * reuse issues across voice switches.
 * @returns {Promise<Buffer|null>}
 */
function synthesizeEdge(text, { voice = DEFAULT_VOICE, rate, pitch, volume }) {
  const tts = new MsEdgeTTS();

  return tts
    .setMetadata(voice, DEFAULT_FORMAT)
    .then(
      () =>
        new Promise((resolve, reject) => {
          const prosody = {};
          if (rate != null) prosody.rate = rate;
          if (pitch != null) prosody.pitch = pitch;
          if (volume != null) prosody.volume = volume;

          let stream;
          try {
            stream = tts.toStream(text, prosody).audioStream;
          } catch (err) {
            return reject(err);
          }

          const chunks = [];
          let settled = false;
          const finalize = (buf) => {
            if (settled) return;
            settled = true;
            resolve(buf);
          };

          stream.on("data", (c) => chunks.push(c));
          stream.on("close", () => {
            if (chunks.length === 0) return finalize(null);
            finalize(Buffer.concat(chunks));
          });
          stream.on("end", () => {
            if (chunks.length > 0) finalize(Buffer.concat(chunks));
          });
          stream.on("error", (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        })
    )
    .catch((err) => {
      debugLogger.error("tts(edge): failed", { error: err.message, voice });
      throw err;
    });
}

class TtsManager {
  constructor() {
    // No shared state across calls — providers create fresh clients
    // each invocation.
  }

  /**
   * Synthesize text → mp3 Buffer.
   *
   * @param {string} text
   * @param {object} [opts]
   * @param {("edge"|"elevenlabs")} [opts.provider="edge"]
   * @param {string} [opts.voice]                  Edge: ShortName; ElevenLabs: voiceId
   * @param {string} [opts.elevenLabsApiKey]       required for provider=elevenlabs
   * @param {string} [opts.elevenLabsModel]        default "eleven_multilingual_v2"
   * @param {number} [opts.stability]              ElevenLabs 0-1
   * @param {number} [opts.similarity]             ElevenLabs 0-1
   * @param {number} [opts.style]                  ElevenLabs 0-1
   * @param {string|number} [opts.rate]            Edge only
   * @param {string} [opts.pitch]                  Edge only
   * @param {string} [opts.volume]                 Edge only
   * @returns {Promise<Buffer|null>}
   */
  async synthesize(text, opts = {}) {
    const cleaned = (text || "").trim();
    if (!cleaned) return null;

    const provider = opts.provider || "edge";

    if (provider === "elevenlabs") {
      return synthesizeElevenLabs(cleaned, {
        voiceId: opts.voice,
        apiKey: opts.elevenLabsApiKey,
        modelId: opts.elevenLabsModel,
        stability: opts.stability,
        similarity: opts.similarity,
        style: opts.style,
      });
    }

    // Default: edge
    return synthesizeEdge(cleaned, {
      voice: opts.voice,
      rate: opts.rate,
      pitch: opts.pitch,
      volume: opts.volume,
    });
  }

  /**
   * Preset list shown in settings UI.
   * Only voices verified in the Edge Read Aloud catalog are listed here —
   * Azure-only voices (e.g. Xiaochen, Xiaohan, Xiaomo) will return empty audio.
   */
  static listVoices() {
    return [
      // Mainland Mandarin
      { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女, 自然)" },
      { id: "zh-CN-XiaoyiNeural", label: "晓伊 (女, 温暖)" },
      { id: "zh-CN-YunxiNeural", label: "云希 (男, 自然)" },
      { id: "zh-CN-YunjianNeural", label: "云健 (男, 沉稳)" },
      { id: "zh-CN-YunyangNeural", label: "云扬 (男, 播音)" },
      { id: "zh-CN-YunxiaNeural", label: "云夏 (男童, 轻快)" },
      // Regional / dialect — for fun
      { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓贝 (女, 东北话)" },
      { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮 (女, 陕西话)" },
      // Cantonese
      { id: "zh-HK-HiuMaanNeural", label: "曉曼 (女, 粵語/香港)" },
      { id: "zh-HK-WanLungNeural", label: "雲龍 (男, 粵語/香港)" },
      // Taiwan Mandarin
      { id: "zh-TW-HsiaoChenNeural", label: "曉臻 (女, 台灣)" },
      { id: "zh-TW-YunJheNeural", label: "雲哲 (男, 台灣)" },
      // English (for English replies)
      { id: "en-US-AriaNeural", label: "Aria (US English, female)" },
      { id: "en-US-GuyNeural", label: "Guy (US English, male)" },
    ];
  }
}

module.exports = TtsManager;
module.exports.DEFAULT_VOICE = DEFAULT_VOICE;
