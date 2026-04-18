/**
 * ClaudeCodeSession — voice-friendly wrapper around the `claude` CLI.
 *
 * Each call to `send(text)` spawns a fresh `claude --print` process with
 * --output-format stream-json. The session_id from the first response is
 * captured and passed via `--resume` on subsequent calls to chain turns,
 * so context is preserved across voice commands without keeping a long-
 * lived subprocess alive.
 *
 * Events emitted:
 *   - 'turn-start'       { userText, sessionId|null }
 *   - 'assistant-text'   { text }              raw text delta (for renderer)
 *   - 'sentence'         { text }              complete sentence for TTS
 *   - 'tool-use'         { name, input }       Claude invoking a tool
 *   - 'tool-result'      { name, ok }          tool result summary
 *   - 'turn-end'         { sessionId, result, durationMs, costUsd }
 *   - 'error'            { message }           non-fatal
 *   - 'exit'             { code, signal }      subprocess exited
 */

const { spawn } = require("child_process");
const EventEmitter = require("events");
const SentenceChunker = require("./sentenceChunker");
const debugLogger = require("./debugLogger");

const IS_WIN = process.platform === "win32";
const DEFAULT_CLAUDE_BIN = IS_WIN ? "claude.cmd" : "claude";

class ClaudeCodeSession extends EventEmitter {
  constructor({ cwd, claudePath, permissionMode } = {}) {
    super();
    this.cwd = cwd;
    this.claudePath = claudePath || DEFAULT_CLAUDE_BIN;
    // "default" | "acceptEdits" | "bypassPermissions" | "plan"
    // Default to acceptEdits so --print mode can actually make file edits
    // without needing an interactive approval dialog (which we don't show).
    this.permissionMode = permissionMode || "acceptEdits";
    this.sessionId = null;
    this._proc = null;
    this._chunker = null;
    this._buffer = ""; // Line buffer for NDJSON split
    this._cancelled = false;
  }

  isBusy() {
    return this._proc != null;
  }

  reset() {
    this.sessionId = null;
  }

  /**
   * Send user text, stream responses via events. Resolves when the turn
   * completes (success, error, or process exit).
   * @param {string} userText
   * @returns {Promise<{ sessionId: string|null, result: string, durationMs: number, costUsd?: number }>}
   */
  send(userText) {
    if (this.isBusy()) {
      return Promise.reject(new Error("claude_code_session_busy"));
    }
    const text = (userText || "").trim();
    if (!text) return Promise.reject(new Error("claude_code_empty_text"));
    if (!this.cwd) return Promise.reject(new Error("claude_code_no_cwd"));

    // Pass prompt via stdin (avoids Windows shell argument escaping issues
    // with spaces, colons, quotes, and Chinese punctuation).
    const args = ["--print", "--output-format", "stream-json", "--verbose"];
    if (this.permissionMode && this.permissionMode !== "default") {
      args.push("--permission-mode", this.permissionMode);
    }
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        this._proc = null;
        this._chunker = null;
        this._buffer = "";
        this._cancelled = false;
        fn(arg);
      };

      try {
        debugLogger.log("claude-code: spawn", {
          cwd: this.cwd,
          claudePath: this.claudePath,
          hasSession: !!this.sessionId,
          textPreview: text.slice(0, 80),
        });

        this._proc = spawn(this.claudePath, args, {
          cwd: this.cwd,
          shell: IS_WIN, // .cmd shim needs shell on Windows; stdin still works
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Write prompt to stdin, then close it so claude knows input is done.
        this._proc.stdin.write(text, "utf8", () => {
          try {
            this._proc.stdin.end();
          } catch {
            /* already closed */
          }
        });
        this._proc.stdin.on("error", (err) => {
          if (err.code !== "EPIPE") {
            debugLogger.warn("claude-code: stdin error", { error: err.message });
          }
        });
      } catch (err) {
        return finish(reject, err);
      }

      // Set up per-turn sentence chunker for TTS.
      const chunker = new SentenceChunker({ minChars: 8, maxChars: 200 });
      chunker.on("sentence", (s) => this.emit("sentence", { text: s }));
      this._chunker = chunker;

      let finalResult = {
        sessionId: null,
        result: "",
        durationMs: 0,
        costUsd: undefined,
      };

      this.emit("turn-start", { userText: text, sessionId: this.sessionId });

      this._proc.stdout.setEncoding("utf8");
      this._proc.stdout.on("data", (chunk) => {
        this._buffer += chunk;
        let idx;
        while ((idx = this._buffer.indexOf("\n")) >= 0) {
          const line = this._buffer.slice(0, idx).trim();
          this._buffer = this._buffer.slice(idx + 1);
          if (!line) continue;
          this._handleLine(line, finalResult);
        }
      });

      let stderrBuf = "";
      this._proc.stderr.setEncoding("utf8");
      this._proc.stderr.on("data", (d) => {
        stderrBuf += d;
        debugLogger.warn("claude-code: stderr", { data: d.slice(0, 400) });
      });

      this._proc.on("error", (err) => {
        debugLogger.error("claude-code: spawn error", { error: err.message });
        this.emit("error", { message: err.message });
        finish(reject, err);
      });

      this._proc.on("exit", (code, signal) => {
        // Handle any remaining buffered line.
        const tail = this._buffer.trim();
        if (tail) {
          this._handleLine(tail, finalResult);
          this._buffer = "";
        }
        if (chunker) chunker.flush();

        this.emit("exit", { code, signal });

        if (this._cancelled) {
          this.emit("cancelled", { sessionId: finalResult.sessionId || null });
          finish(reject, new Error("cancelled"));
          return;
        }

        if (code === 0) {
          this.emit("turn-end", finalResult);
          finish(resolve, finalResult);
        } else {
          const msg = `claude exited with code ${code}${signal ? ` (signal=${signal})` : ""}${
            stderrBuf ? `: ${stderrBuf.slice(0, 300)}` : ""
          }`;
          this.emit("error", { message: msg });
          finish(reject, new Error(msg));
        }
      });
    });
  }

  /** Kill any in-flight subprocess (e.g. user cancels). */
  cancel() {
    if (this._proc) {
      this._cancelled = true;
      try {
        this._proc.kill();
      } catch (err) {
        debugLogger.warn("claude-code: kill failed", { error: err.message });
      }
    }
  }

  _handleLine(line, finalResult) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (err) {
      debugLogger.warn("claude-code: non-JSON line", { line: line.slice(0, 200) });
      return;
    }

    switch (event.type) {
      case "system":
        if (event.subtype === "init" && event.session_id) {
          // First turn: capture session_id for later --resume.
          this.sessionId = event.session_id;
          finalResult.sessionId = event.session_id;
        }
        break;

      case "assistant": {
        const parts = event.message?.content || [];
        for (const p of parts) {
          if (p.type === "text" && typeof p.text === "string") {
            this.emit("assistant-text", { text: p.text });
            if (this._chunker) this._chunker.push(p.text);
          } else if (p.type === "tool_use") {
            this.emit("tool-use", { name: p.name, input: p.input });
          }
        }
        break;
      }

      case "user":
        // Usually contains tool_result — surface briefly.
        {
          const parts = event.message?.content || [];
          for (const p of parts) {
            if (p.type === "tool_result") {
              this.emit("tool-result", {
                name: p.tool_use_id,
                ok: !p.is_error,
              });
            }
          }
        }
        break;

      case "result":
        finalResult.sessionId = event.session_id || finalResult.sessionId;
        finalResult.result = event.result || "";
        finalResult.durationMs = event.duration_ms || 0;
        finalResult.costUsd = event.total_cost_usd;
        break;

      case "rate_limit_event":
        if (event.rate_limit_info?.status === "exceeded") {
          this.emit("error", {
            message: `rate_limit_${event.rate_limit_info.rateLimitType}`,
          });
        }
        break;

      default:
        // Ignore unknown event types gracefully to survive CLI upgrades.
        break;
    }
  }
}

module.exports = ClaudeCodeSession;
