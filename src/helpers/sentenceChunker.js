/**
 * SentenceChunker — accumulate streaming text deltas and emit complete
 * sentences when a terminator is hit. Used for TTS to speak as soon as a
 * natural pause lands, instead of waiting for the whole message.
 *
 * Usage:
 *   const c = new SentenceChunker({ minChars: 8, maxChars: 200 });
 *   c.onSentence = (s) => ttsQueue.enqueue(s);
 *   c.push("你好，")
 *   c.push("今天天气如何？")
 *   c.flush();
 */

const EventEmitter = require("events");

// Chinese full-width terminators + Latin terminators + newlines.
// Don't flush on comma — sentences should be long enough to sound natural.
const TERMINATORS = /[。！？.!?]|\n\n/;
const SOFT_BREAKS = /[；;：:]/; // only used when buffer exceeds maxChars

class SentenceChunker extends EventEmitter {
  constructor({ minChars = 8, maxChars = 200 } = {}) {
    super();
    this.minChars = minChars;
    this.maxChars = maxChars;
    this._buf = "";
  }

  push(text) {
    if (!text) return;
    this._buf += text;
    this._drain();
  }

  /** Force-flush any remaining buffered text as one final sentence. */
  flush() {
    const trimmed = this._buf.trim();
    if (trimmed.length > 0) {
      this.emit("sentence", trimmed);
    }
    this._buf = "";
  }

  _drain() {
    while (true) {
      const m = TERMINATORS.exec(this._buf);
      if (m) {
        const end = m.index + m[0].length;
        const chunk = this._buf.slice(0, end).trim();
        this._buf = this._buf.slice(end);
        if (chunk.length >= this.minChars) {
          this.emit("sentence", chunk);
        } else if (chunk.length > 0) {
          // Too short; prepend to next iteration by putting back.
          this._buf = chunk + this._buf;
          return;
        }
        continue;
      }

      // No hard terminator. If buffer is bigger than maxChars, force a break
      // on the nearest soft break to avoid unbounded latency.
      if (this._buf.length >= this.maxChars) {
        const sm = SOFT_BREAKS.exec(this._buf);
        if (sm) {
          const end = sm.index + sm[0].length;
          this.emit("sentence", this._buf.slice(0, end).trim());
          this._buf = this._buf.slice(end);
          continue;
        }
        // No soft break either — just flush what we have up to maxChars.
        this.emit("sentence", this._buf.slice(0, this.maxChars).trim());
        this._buf = this._buf.slice(this.maxChars);
        continue;
      }

      return;
    }
  }
}

module.exports = SentenceChunker;
