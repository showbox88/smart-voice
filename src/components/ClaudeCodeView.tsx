import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Send,
  StopCircle,
  FolderOpen,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  VolumeX,
} from "lucide-react";
import AudioManager from "../helpers/audioManager";
import { cn } from "./lib/utils";

// ────────────── TTS playback helpers (same keys as AgentOverlay) ──────────
const TTS_ENABLED_KEY = "xiaozhi.tts.enabled";
const TTS_PROVIDER_KEY = "xiaozhi.tts.provider";
const TTS_VOICE_KEY = "xiaozhi.tts.voice";
const TTS_ELEVEN_VOICE_KEY = "xiaozhi.tts.elevenlabs.voiceId";
const TTS_ELEVEN_KEY_KEY = "xiaozhi.tts.elevenlabs.apiKey";

function buildTtsOpts(): Record<string, unknown> | null {
  if (localStorage.getItem(TTS_ENABLED_KEY) === "false") return null;
  const provider =
    (localStorage.getItem(TTS_PROVIDER_KEY) as "edge" | "elevenlabs" | null) || "edge";
  const opts: Record<string, unknown> = { provider };
  if (provider === "elevenlabs") {
    const vId = localStorage.getItem(TTS_ELEVEN_VOICE_KEY);
    const key = localStorage.getItem(TTS_ELEVEN_KEY_KEY);
    if (!vId || !key) return null;
    opts.voice = vId;
    opts.elevenLabsApiKey = key;
  } else {
    const v = localStorage.getItem(TTS_VOICE_KEY);
    if (v) opts.voice = v;
  }
  return opts;
}

interface TurnMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: Array<{ name: string; ok?: boolean; input?: unknown }>;
  streaming?: boolean;
}

interface ConversationListItem {
  id: number;
  title: string;
  cwd: string | null;
  claude_session_id: string | null;
  permission_mode: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "每次询问（当前不支持）",
  acceptEdits: "自动批准文件编辑（推荐）",
  bypassPermissions: "跳过所有批准（含命令行）",
  plan: "仅规划模式",
};

const ACTIVE_CONV_KEY = "xiaozhi.claudeCode.activeConvId";

export default function ClaudeCodeView() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("acceptEdits");
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [ttsSpeaking, setTtsSpeaking] = useState(false);

  const activeConvIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  const audioManagerRef = useRef<InstanceType<typeof AudioManager> | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  // TTS queue — sentences play sequentially via WebAudio for sample-0 start
  // (avoids <audio>'s decode-warmup eating the first 100-1000ms).
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsCtxRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const getAudioCtx = useCallback((): AudioContext => {
    if (!ttsCtxRef.current || ttsCtxRef.current.state === "closed") {
      const Ctor =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      ttsCtxRef.current = new Ctor();
    }
    return ttsCtxRef.current!;
  }, []);

  const stopTts = useCallback(() => {
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.onended = null;
        ttsSourceRef.current.stop();
      } catch {
        /* ignore — may already be stopped */
      }
      ttsSourceRef.current = null;
    }
    setTtsSpeaking(false);
  }, []);

  // Ask main for audio bytes with one retry on empty_audio / transient failure.
  const synthesizeWithRetry = useCallback(
    async (
      text: string,
      opts: Record<string, unknown>
    ): Promise<Uint8Array | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await window.electronAPI?.ttsSynthesize?.(text, opts);
        if (res?.success && res.audio) {
          return res.audio instanceof Uint8Array
            ? res.audio
            : new Uint8Array(res.audio as ArrayBuffer);
        }
        if (attempt === 0) {
          console.warn("[claude-code-view] tts retry after:", res);
          await new Promise((r) => setTimeout(r, 200));
        } else {
          console.warn("[claude-code-view] tts gave up:", res);
        }
      }
      return null;
    },
    []
  );

  const drainTtsQueue = useCallback(async () => {
    if (ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) {
      setTtsSpeaking(false);
      return;
    }
    ttsPlayingRef.current = true;
    setTtsSpeaking(true);

    const opts = buildTtsOpts();
    if (!opts) {
      ttsPlayingRef.current = false;
      return drainTtsQueue();
    }

    try {
      const bytes = await synthesizeWithRetry(next, opts);
      if (!bytes) {
        ttsPlayingRef.current = false;
        return drainTtsQueue();
      }

      const ctx = getAudioCtx();
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }

      // Full MP3 decode before playback — guarantees sample-0 start.
      // `decodeAudioData` detaches the ArrayBuffer, so copy into a fresh one.
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      const audioBuf = await ctx.decodeAudioData(ab);

      // Check we weren't cancelled while decoding
      if (!ttsPlayingRef.current) return;

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      ttsSourceRef.current = src;
      src.onended = () => {
        if (ttsSourceRef.current === src) ttsSourceRef.current = null;
        ttsPlayingRef.current = false;
        drainTtsQueue();
      };
      src.start(0);
    } catch (err) {
      console.warn("[claude-code-view] tts playback failed", err);
      ttsPlayingRef.current = false;
      drainTtsQueue();
    }
  }, [getAudioCtx, synthesizeWithRetry]);

  const enqueueTts = useCallback(
    (text: string) => {
      ttsQueueRef.current.push(text);
      setTtsSpeaking(true);
      drainTtsQueue();
    },
    [drainTtsQueue]
  );

  const refreshList = useCallback(async () => {
    const r = await window.electronAPI?.claudeCodeConvList?.();
    if (r?.success) setConversations(r.items || []);
  }, []);

  // Parse a DB message row into a TurnMessage.
  const rowToMessage = (row: {
    id: number;
    role: "user" | "assistant";
    text: string;
    tools_json: string | null;
  }): TurnMessage => {
    let tools: TurnMessage["tools"] | undefined;
    if (row.tools_json) {
      try {
        tools = JSON.parse(row.tools_json);
      } catch {
        tools = undefined;
      }
    }
    return {
      id: `db-${row.id}`,
      role: row.role,
      text: row.text,
      tools,
      streaming: false,
    };
  };

  const loadConversation = useCallback(
    async (id: number) => {
      stopTts();
      const r = await window.electronAPI?.claudeCodeConvSwitch?.(id);
      if (!r?.success) {
        setError((r as { error?: string })?.error || "切换会话失败");
        return;
      }
      const conv = r.conversation;
      setActiveConvId(conv.id);
      setCwd(conv.cwd || null);
      setPermissionMode((conv.permission_mode as PermissionMode) || "acceptEdits");
      setMessages(conv.messages.map(rowToMessage));
      setError("");
      currentAssistantIdRef.current = null;
      localStorage.setItem(ACTIVE_CONV_KEY, String(conv.id));
    },
    [stopTts]
  );

  // Initial load: conv list + last active
  useEffect(() => {
    (async () => {
      const listRes = await window.electronAPI?.claudeCodeConvList?.();
      const items = listRes?.success ? listRes.items : [];
      setConversations(items);

      const savedId = localStorage.getItem(ACTIVE_CONV_KEY);
      const target = savedId
        ? items.find((c) => c.id === Number(savedId))
        : items[0];
      if (target) {
        await loadConversation(target.id);
      }

      // Sync busy state from main
      const status = await window.electronAPI?.claudeCodeStatus?.();
      if (status?.busy) setBusy(true);
    })();
  }, [loadConversation]);

  const handlePermissionChange = useCallback(
    async (mode: PermissionMode) => {
      setPermissionMode(mode);
      if (activeConvId != null) {
        await window.electronAPI?.claudeCodeConfigure?.({ permissionMode: mode });
        refreshList();
      }
    },
    [activeConvId, refreshList]
  );

  // Subscribe to streaming events from main process
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const isForActive = (payload: any) => {
      const convId = payload?.conversationId;
      // Only respond to events scoped to our currently-active conversation.
      return convId == null || convId === activeConvIdRef.current;
    };

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("turn-start", (payload: any) => {
        if (!isForActive(payload)) return;
        const id = crypto.randomUUID();
        currentAssistantIdRef.current = id;
        setMessages((prev) => [
          ...prev,
          { id, role: "assistant", text: "", streaming: true },
        ]);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("assistant-text", (payload: any) => {
        if (!isForActive(payload)) return;
        const delta: string = payload?.text || "";
        if (!delta) return;
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m))
        );
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("sentence", (payload: any) => {
        if (!isForActive(payload)) return;
        const sentence = payload?.text;
        if (sentence) enqueueTts(sentence);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("tool-use", (payload: any) => {
        if (!isForActive(payload)) return;
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  tools: [...(m.tools || []), { name: payload?.name, input: payload?.input }],
                }
              : m
          )
        );
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("turn-end", (payload: any) => {
        if (!isForActive(payload)) return;
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, streaming: false } : m))
          );
        }
        currentAssistantIdRef.current = null;
        setBusy(false);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("cancelled", (payload: any) => {
        if (!isForActive(payload)) return;
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, streaming: false, text: m.text || "（已取消）" } : m
            )
          );
        }
        currentAssistantIdRef.current = null;
        setBusy(false);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("error", (payload: any) => {
        if (!isForActive(payload)) return;
        const msg = payload?.message || "unknown error";
        setError(msg);
        setBusy(false);
        currentAssistantIdRef.current = null;
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("conv-list-changed", () => {
        refreshList();
      }) ?? (() => {})
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [enqueueTts, refreshList]);

  // Audio manager (mic + whisper transcription, no reasoning)
  useEffect(() => {
    const am = new AudioManager();
    am.setSkipReasoning(true);
    am.setContext("agent");
    am.setCallbacks({
      onStateChange: () => {},
      onError: (e: { message?: string }) => {
        setError(e?.message || "Transcription failed");
        setRecording(false);
      },
      onTranscriptionComplete: (r: { text: string }) => {
        setRecording(false);
        setPartialTranscript("");
        setInput((prev) => (prev ? prev + " " + r.text : r.text));
      },
      onPartialTranscript: (t: string) => setPartialTranscript(t),
    });
    audioManagerRef.current = am;
    return () => {
      am.cleanup?.();
      if (ttsCtxRef.current) {
        try {
          ttsCtxRef.current.close();
        } catch {
          /* ignore */
        }
        ttsCtxRef.current = null;
      }
    };
  }, []);

  const handleNewConv = useCallback(async () => {
    if (busy) {
      setError("当前会话还在执行中，请先取消再新建");
      return;
    }
    if (!window.electronAPI?.claudeCodeConvCreate) {
      setError("IPC 未就绪 —— 请完全关闭应用并重新 npm run dev");
      return;
    }
    try {
      const r = await window.electronAPI.claudeCodeConvCreate({});
      if (r?.success) {
        await loadConversation(r.id);
        await refreshList();
      } else {
        setError((r as { error?: string })?.error || "新建会话失败");
      }
    } catch (e: any) {
      setError(`新建会话异常: ${e?.message || String(e)}`);
    }
  }, [busy, loadConversation, refreshList]);

  const handleSelectConv = useCallback(
    async (id: number) => {
      if (id === activeConvId) return;
      if (busy) {
        setError("当前会话还在执行中，请先取消再切换");
        return;
      }
      await loadConversation(id);
    },
    [activeConvId, busy, loadConversation]
  );

  const handleStartRename = useCallback(
    (conv: ConversationListItem, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingId(conv.id);
      setRenameDraft(conv.title);
    },
    []
  );

  const handleCommitRename = useCallback(async () => {
    if (renamingId == null) return;
    const title = renameDraft.trim() || "新会话";
    await window.electronAPI?.claudeCodeConvRename?.(renamingId, title);
    setRenamingId(null);
    setRenameDraft("");
    refreshList();
  }, [renamingId, renameDraft, refreshList]);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const handleDeleteConv = useCallback(
    async (id: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const conv = conversations.find((c) => c.id === id);
      const confirmed = window.confirm(
        `确定删除「${conv?.title || "此会话"}」？此操作不可恢复。`
      );
      if (!confirmed) return;

      await window.electronAPI?.claudeCodeConvDelete?.(id);
      if (id === activeConvId) {
        setActiveConvId(null);
        setMessages([]);
        setCwd(null);
        localStorage.removeItem(ACTIVE_CONV_KEY);
      }
      await refreshList();
    },
    [conversations, activeConvId, refreshList]
  );

  const handlePickCwd = useCallback(async () => {
    if (activeConvId == null) {
      // Create a conversation first so the cwd has a home.
      const created = await window.electronAPI?.claudeCodeConvCreate?.({});
      if (!created?.success) {
        setError((created as { error?: string })?.error || "新建会话失败");
        return;
      }
      await loadConversation(created.id);
    }
    const r = await window.electronAPI?.claudeCodePickCwd?.();
    if (r?.success && "cwd" in r) {
      await window.electronAPI?.claudeCodeConfigure?.({ cwd: r.cwd });
      setCwd(r.cwd);
      setError("");
      refreshList();
    }
  }, [activeConvId, loadConversation, refreshList]);

  const handleRecord = useCallback(async () => {
    if (recording) {
      await audioManagerRef.current?.stopRecording?.();
      setRecording(false);
    } else {
      setError("");
      await audioManagerRef.current?.startRecording?.();
      setRecording(true);
    }
  }, [recording]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (!cwd) {
      setError("请先选择工作目录");
      return;
    }
    if (busy) return;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);
    setInput("");
    setError("");
    setBusy(true);

    const r = await window.electronAPI?.claudeCodeSend?.(text);
    if (!r?.success) {
      setError((r as { error?: string })?.error || "send failed");
      setBusy(false);
    }
  }, [input, cwd, busy]);

  const handleCancel = useCallback(async () => {
    stopTts();
    await window.electronAPI?.claudeCodeCancel?.();
    setBusy(false);
    currentAssistantIdRef.current = null;
  }, [stopTts]);

  const activeTitle = useMemo(
    () => conversations.find((c) => c.id === activeConvId)?.title ?? "",
    [conversations, activeConvId]
  );

  return (
    <div className="flex h-full w-full bg-background">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border/20 flex flex-col">
        <div className="p-2">
          <button
            type="button"
            onClick={handleNewConv}
            className="w-full inline-flex items-center justify-center gap-1 text-xs px-2 py-2 rounded-md border border-border/50 hover:bg-foreground/5"
          >
            <Plus size={12} /> 新会话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-1 pb-2 space-y-0.5">
          {conversations.length === 0 && (
            <div className="text-[11px] text-muted-foreground/60 text-center py-4 px-2">
              还没有会话。点「新会话」开始。
            </div>
          )}
          {conversations.map((c) => {
            const isActive = c.id === activeConvId;
            const isRenaming = renamingId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => !isRenaming && handleSelectConv(c.id)}
                className={cn(
                  "group relative rounded-md px-2 py-1.5 text-xs cursor-pointer",
                  isActive
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-foreground/5 border border-transparent"
                )}
              >
                {isRenaming ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCommitRename();
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-background border border-border/50 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/40"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCommitRename();
                      }}
                      title="保存"
                      className="p-1 text-primary hover:bg-foreground/5 rounded"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelRename();
                      }}
                      title="取消"
                      className="p-1 text-muted-foreground hover:bg-foreground/5 rounded"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="truncate pr-10">{c.title || "新会话"}</div>
                    {c.cwd && (
                      <div className="truncate text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                        {c.cwd.split(/[\\/]/).slice(-2).join("/")}
                      </div>
                    )}
                    <div className="absolute top-1 right-1 hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(c, e)}
                        title="重命名"
                        className="p-1 rounded hover:bg-foreground/10 text-muted-foreground"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteConv(c.id, e)}
                        title="删除会话"
                        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {activeConvId ? activeTitle || "新会话" : "Claude Code 语音遥控"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">
              {activeConvId == null
                ? "选择左侧会话或点「新会话」开始"
                : cwd
                  ? `📁 ${cwd}`
                  : "⚠ 尚未选择工作目录"}
            </div>
          </div>
          <button
            type="button"
            onClick={handlePickCwd}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
          >
            <FolderOpen size={12} /> {cwd ? "换目录" : "选目录"}
          </button>
          <select
            value={permissionMode}
            onChange={(e) => handlePermissionChange(e.target.value as PermissionMode)}
            disabled={activeConvId == null}
            title="权限模式"
            style={{ colorScheme: "dark light" }}
            className="text-xs text-foreground bg-background border border-border/50 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-40"
          >
            {(Object.keys(PERMISSION_MODE_LABELS) as PermissionMode[]).map((m) => (
              <option key={m} value={m} className="bg-background text-foreground">
                {PERMISSION_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground/60 py-8 text-center">
              {activeConvId == null
                ? "在左侧选择或新建一个会话"
                : "说一句话或者直接输入，按 Send 发给 Claude Code。回复会自动朗读。"}
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-md px-3 py-2 text-sm whitespace-pre-wrap break-words",
                m.role === "user"
                  ? "bg-primary/10 border border-primary/20 ml-8"
                  : "bg-muted/30 border border-border/30 mr-8"
              )}
            >
              {m.text || (m.streaming ? <span className="opacity-50">思考中…</span> : "")}
              {m.tools && m.tools.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.tools.map((t, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-mono px-2 py-1 rounded bg-foreground/5 border border-border/20"
                    >
                      🔧 {t.name}
                      {t.ok === false && <span className="text-destructive ml-1">(failed)</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="px-4 py-2 text-[11px] text-destructive border-t border-destructive/30 bg-destructive/5 font-mono">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border/20 p-3 space-y-2">
          {recording && (
            <div className="text-[11px] text-primary flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              正在录音… {partialTranscript && <span className="opacity-60">{partialTranscript}</span>}
            </div>
          )}
          {ttsSpeaking && (
            <div className="text-[11px] flex items-center justify-between gap-2">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                正在朗读回复…
              </span>
              <button
                type="button"
                onClick={stopTts}
                title="停止朗读（不影响 Claude 继续执行）"
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border/50 hover:bg-foreground/5 text-muted-foreground"
              >
                <VolumeX size={11} /> 静音
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleRecord}
              disabled={busy}
              title={recording ? "停止录音" : "开始录音"}
              className={cn(
                "inline-flex items-center justify-center w-10 h-10 rounded-md border transition-colors shrink-0",
                recording
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border/50 hover:bg-foreground/5",
                busy && "opacity-40"
              )}
            >
              {recording ? <StopCircle size={16} /> : <Mic size={16} />}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="说完后点 Send 发给 Claude Code（Shift+Enter 换行）"
              rows={2}
              disabled={busy}
              className="flex-1 text-sm bg-transparent border border-border/50 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/30 disabled:opacity-50"
            />
            {busy ? (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1 text-sm px-3 h-10 rounded-md border border-destructive/50 text-destructive hover:bg-destructive/10 shrink-0"
              >
                <StopCircle size={14} /> 取消
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || !cwd}
                className="inline-flex items-center gap-1 text-sm px-4 h-10 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 shrink-0"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
