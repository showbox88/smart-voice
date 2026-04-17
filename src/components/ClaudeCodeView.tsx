import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, StopCircle, FolderOpen, RefreshCw, Trash2, Loader2 } from "lucide-react";
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

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "每次询问（当前不支持）",
  acceptEdits: "自动批准文件编辑（推荐）",
  bypassPermissions: "跳过所有批准（含命令行）",
  plan: "仅规划模式",
};

export default function ClaudeCodeView() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("acceptEdits");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const audioManagerRef = useRef<InstanceType<typeof AudioManager> | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  // TTS queue — play sentences sequentially so we don't overlap
  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);

  const stopTts = useCallback(() => {
    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    if (ttsAudioRef.current) {
      try {
        ttsAudioRef.current.pause();
      } catch {
        /* ignore */
      }
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
  }, []);

  const drainTtsQueue = useCallback(async () => {
    if (ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;
    ttsPlayingRef.current = true;

    const opts = buildTtsOpts();
    if (!opts) {
      ttsPlayingRef.current = false;
      return drainTtsQueue();
    }

    try {
      const res = await window.electronAPI?.ttsSynthesize?.(next, opts);
      if (!res || !res.success) {
        console.warn("[claude-code-view] tts failed", res);
        ttsPlayingRef.current = false;
        return drainTtsQueue();
      }
      const bytes =
        res.audio instanceof Uint8Array ? res.audio : new Uint8Array(res.audio as ArrayBuffer);
      const blob = new Blob([bytes], { type: res.mime || "audio/mp3" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      ttsUrlRef.current = url;
      audio.addEventListener("ended", () => {
        if (ttsUrlRef.current === url) {
          URL.revokeObjectURL(url);
          ttsUrlRef.current = null;
          ttsAudioRef.current = null;
        }
        ttsPlayingRef.current = false;
        drainTtsQueue();
      });
      audio.addEventListener("error", () => {
        if (ttsUrlRef.current === url) {
          URL.revokeObjectURL(url);
          ttsUrlRef.current = null;
          ttsAudioRef.current = null;
        }
        ttsPlayingRef.current = false;
        drainTtsQueue();
      });
      await audio.play();
    } catch (err) {
      console.warn("[claude-code-view] tts exception", err);
      ttsPlayingRef.current = false;
      drainTtsQueue();
    }
  }, []);

  const enqueueTts = useCallback(
    (text: string) => {
      ttsQueueRef.current.push(text);
      drainTtsQueue();
    },
    [drainTtsQueue]
  );

  // Load current status on mount
  useEffect(() => {
    window.electronAPI?.claudeCodeStatus?.().then((s) => {
      if (s?.cwd) setCwd(s.cwd);
      if (s?.sessionId) setSessionId(s.sessionId);
      if (s?.permissionMode) setPermissionMode(s.permissionMode as PermissionMode);
    });
  }, []);

  const handlePermissionChange = useCallback(async (mode: PermissionMode) => {
    setPermissionMode(mode);
    await window.electronAPI?.claudeCodeConfigure?.({ permissionMode: mode });
  }, []);

  // Subscribe to streaming events from main process
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("turn-start", () => {
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
        const sentence = payload?.text;
        if (sentence) enqueueTts(sentence);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("tool-use", (payload: any) => {
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
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, streaming: false } : m))
          );
        }
        if (payload?.sessionId) setSessionId(payload.sessionId);
        currentAssistantIdRef.current = null;
        setBusy(false);
      }) ?? (() => {})
    );

    unsubs.push(
      window.electronAPI?.onClaudeCodeEvent?.("error", (payload: any) => {
        const msg = payload?.message || "unknown error";
        setError(msg);
        setBusy(false);
        currentAssistantIdRef.current = null;
      }) ?? (() => {})
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [enqueueTts]);

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
        // Append (don't replace) so user can mix voice + typing
        setInput((prev) => (prev ? prev + " " + r.text : r.text));
      },
      onPartialTranscript: (t: string) => setPartialTranscript(t),
    });
    audioManagerRef.current = am;
    return () => {
      am.cleanup?.();
    };
  }, []);

  const handlePickCwd = useCallback(async () => {
    const r = await window.electronAPI?.claudeCodePickCwd?.();
    if (r?.success && "cwd" in r) {
      await window.electronAPI?.claudeCodeConfigure?.({ cwd: r.cwd });
      setCwd(r.cwd);
      setError("");
    }
  }, []);

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

  const handleReset = useCallback(async () => {
    stopTts();
    await window.electronAPI?.claudeCodeReset?.();
    setSessionId(null);
    setMessages([]);
    setError("");
    setBusy(false);
  }, [stopTts]);

  const handleCancel = useCallback(async () => {
    stopTts();
    await window.electronAPI?.claudeCodeCancel?.();
    setBusy(false);
    currentAssistantIdRef.current = null;
  }, [stopTts]);

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Claude Code 语音遥控</div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">
            {cwd ? `📁 ${cwd}` : "⚠ 尚未选择工作目录"}
            {sessionId && <span className="ml-2 opacity-60">· session {sessionId.slice(0, 8)}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={handlePickCwd}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border/50 hover:bg-foreground/5"
        >
          <FolderOpen size={12} /> 选目录
        </button>
        <select
          value={permissionMode}
          onChange={(e) => handlePermissionChange(e.target.value as PermissionMode)}
          title="权限模式"
          style={{ colorScheme: "dark light" }}
          className="text-xs text-foreground bg-background border border-border/50 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          {(Object.keys(PERMISSION_MODE_LABELS) as PermissionMode[]).map((m) => (
            <option
              key={m}
              value={m}
              className="bg-background text-foreground"
            >
              {PERMISSION_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleReset}
          disabled={busy}
          title="新会话"
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border/50 hover:bg-foreground/5 disabled:opacity-40"
        >
          <Trash2 size={12} /> 新会话
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground/60 py-8 text-center">
            说一句话或者直接输入，按 Send 发给 Claude Code。回复会自动朗读。
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
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error bar */}
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
  );
}
