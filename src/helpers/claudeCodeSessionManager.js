/**
 * ClaudeCodeSessionManager — multi-conversation wrapper around ClaudeCodeSession.
 *
 * Holds one ClaudeCodeSession instance shared across all conversations. When
 * switching conversations, the session's cwd / claudeSessionId / permissionMode
 * are swapped in from the DB row. Each conversation keeps its own message log
 * and its own claude --resume token, so they don't pollute each other.
 *
 * Events re-emitted to subscribers (renderer via ipcHandlers) always include a
 * `conversationId` field so the UI can ignore events for other conversations.
 *
 *   - 'conv-list-changed' { }
 *   - 'turn-start'        { conversationId, userText, sessionId|null }
 *   - 'assistant-text'    { conversationId, text }
 *   - 'sentence'          { conversationId, text }
 *   - 'tool-use'          { conversationId, name, input }
 *   - 'tool-result'       { conversationId, name, ok }
 *   - 'turn-end'          { conversationId, sessionId, result, durationMs, costUsd }
 *   - 'cancelled'         { conversationId }
 *   - 'error'             { conversationId, message }
 *   - 'exit'              { conversationId, code, signal }
 */

const EventEmitter = require("events");
const ClaudeCodeSession = require("./claudeCodeSession");
const debugLogger = require("./debugLogger");

const TITLE_MAX = 30;

function deriveTitle(text) {
  const trimmed = (text || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "新会话";
  return trimmed.length <= TITLE_MAX ? trimmed : trimmed.slice(0, TITLE_MAX) + "…";
}

class ClaudeCodeSessionManager extends EventEmitter {
  constructor(databaseManager, { claudePath } = {}) {
    super();
    this.db = databaseManager;
    this.session = new ClaudeCodeSession({ claudePath });
    this.activeConvId = null;
    // Streaming write state — the current assistant row we're filling in.
    this._curAssistantRowId = null;
    this._curAssistantText = "";
    this._curAssistantTools = []; // [{name, input, ok?}]
    this._wireSessionEvents();
  }

  _wireSessionEvents() {
    const s = this.session;
    const tag = () => ({ conversationId: this.activeConvId });

    s.on("turn-start", (payload) => {
      // Create an empty assistant row we'll fill as the turn streams in.
      if (this.activeConvId != null) {
        try {
          this._curAssistantRowId = this.db.appendClaudeMessage(this.activeConvId, {
            role: "assistant",
            text: "",
          });
        } catch (err) {
          debugLogger.warn("claude-code-mgr: persist assistant row failed", {
            error: err.message,
          });
          this._curAssistantRowId = null;
        }
      }
      this._curAssistantText = "";
      this._curAssistantTools = [];
      this.emit("turn-start", { ...tag(), ...payload });
    });

    s.on("assistant-text", (payload) => {
      if (payload?.text) this._curAssistantText += payload.text;
      this.emit("assistant-text", { ...tag(), ...payload });
    });

    s.on("sentence", (payload) => {
      this.emit("sentence", { ...tag(), ...payload });
    });

    s.on("tool-use", (payload) => {
      if (payload?.name) {
        this._curAssistantTools.push({ name: payload.name, input: payload.input });
      }
      this.emit("tool-use", { ...tag(), ...payload });
    });

    s.on("tool-result", (payload) => {
      // Mark the latest matching tool as ok/failed.
      if (payload?.name) {
        for (let i = this._curAssistantTools.length - 1; i >= 0; i--) {
          if (this._curAssistantTools[i].name === payload.name && this._curAssistantTools[i].ok == null) {
            this._curAssistantTools[i].ok = !!payload.ok;
            break;
          }
        }
      }
      this.emit("tool-result", { ...tag(), ...payload });
    });

    s.on("turn-end", (payload) => {
      this._persistAssistantFinalState();
      if (this.activeConvId != null && payload?.sessionId) {
        try {
          this.db.updateClaudeConversation(this.activeConvId, {
            claude_session_id: payload.sessionId,
          });
        } catch (err) {
          debugLogger.warn("claude-code-mgr: persist sessionId failed", { error: err.message });
        }
      }
      this.emit("turn-end", { ...tag(), ...payload });
      this.emit("conv-list-changed");
    });

    s.on("cancelled", (payload) => {
      this._persistAssistantFinalState();
      this.emit("cancelled", { ...tag(), ...payload });
      this.emit("conv-list-changed");
    });

    s.on("error", (payload) => {
      this._persistAssistantFinalState();
      this.emit("error", { ...tag(), ...payload });
    });

    s.on("exit", (payload) => {
      this.emit("exit", { ...tag(), ...payload });
    });
  }

  _persistAssistantFinalState() {
    if (this._curAssistantRowId == null) return;
    try {
      const toolsJson = this._curAssistantTools.length
        ? JSON.stringify(this._curAssistantTools)
        : null;
      this.db.updateClaudeMessage(this._curAssistantRowId, {
        text: this._curAssistantText,
        toolsJson,
      });
    } catch (err) {
      debugLogger.warn("claude-code-mgr: finalize assistant row failed", { error: err.message });
    }
    this._curAssistantRowId = null;
    this._curAssistantText = "";
    this._curAssistantTools = [];
  }

  // ─── Conversation lifecycle ──────────────────────────────────────────

  createConversation({ title, cwd, permissionMode } = {}) {
    const id = this.db.createClaudeConversation({
      title: title || "新会话",
      cwd: cwd || null,
      permissionMode: permissionMode || "acceptEdits",
    });
    this.emit("conv-list-changed");
    return id;
  }

  listConversations() {
    return this.db.listClaudeConversations();
  }

  getConversation(id) {
    return this.db.getClaudeConversation(id);
  }

  renameConversation(id, title) {
    this.db.updateClaudeConversation(id, { title: title || "新会话" });
    this.emit("conv-list-changed");
  }

  deleteConversation(id) {
    if (this.activeConvId === id) {
      if (this.session.isBusy()) this.session.cancel();
      this.activeConvId = null;
      this.session.cwd = undefined;
      this.session.sessionId = null;
    }
    this.db.deleteClaudeConversation(id);
    this.emit("conv-list-changed");
  }

  switchConversation(id) {
    if (this.session.isBusy()) {
      throw new Error("busy — finish or cancel the current turn first");
    }
    const conv = this.db.getClaudeConversation(id);
    if (!conv) throw new Error("conversation_not_found");
    this.session.cwd = conv.cwd || undefined;
    this.session.sessionId = conv.claude_session_id || null;
    this.session.permissionMode = conv.permission_mode || "acceptEdits";
    this.activeConvId = id;
    return conv;
  }

  configureActive({ cwd, permissionMode } = {}) {
    if (this.activeConvId == null) throw new Error("no_active_conversation");
    const patch = {};
    if (cwd !== undefined) {
      this.session.cwd = cwd;
      patch.cwd = cwd;
    }
    if (permissionMode !== undefined) {
      this.session.permissionMode = permissionMode;
      patch.permission_mode = permissionMode;
    }
    if (Object.keys(patch).length) {
      this.db.updateClaudeConversation(this.activeConvId, patch);
      this.emit("conv-list-changed");
    }
    return {
      cwd: this.session.cwd,
      permissionMode: this.session.permissionMode,
      claudePath: this.session.claudePath,
      sessionId: this.session.sessionId,
    };
  }

  // ─── Sending / cancel ────────────────────────────────────────────────

  async send(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) throw new Error("empty_text");

    // Auto-create a conversation on first send if none is active.
    if (this.activeConvId == null) {
      const id = this.createConversation({ title: deriveTitle(trimmed) });
      this.switchConversation(id);
    }

    if (!this.session.cwd) throw new Error("no_cwd_configured");
    if (this.session.isBusy()) throw new Error("busy");

    // Persist the user message immediately.
    try {
      this.db.appendClaudeMessage(this.activeConvId, { role: "user", text: trimmed });
    } catch (err) {
      debugLogger.warn("claude-code-mgr: persist user msg failed", { error: err.message });
    }

    // If the conversation still has the default auto-title (user hasn't renamed
    // it yet and it matches an earlier auto-title or is the fallback), freshen
    // it from this message. Only do this for the very first user message.
    try {
      const conv = this.db.getClaudeConversation(this.activeConvId);
      if (conv && conv.messages.filter((m) => m.role === "user").length === 1) {
        this.db.updateClaudeConversation(this.activeConvId, { title: deriveTitle(trimmed) });
      }
    } catch {
      /* ignore */
    }

    this.emit("conv-list-changed");

    return this.session.send(trimmed);
  }

  cancel() {
    this.session.cancel();
  }

  status() {
    return {
      activeConvId: this.activeConvId,
      cwd: this.session.cwd || null,
      claudePath: this.session.claudePath,
      permissionMode: this.session.permissionMode,
      sessionId: this.session.sessionId,
      busy: this.session.isBusy(),
    };
  }
}

module.exports = ClaudeCodeSessionManager;
