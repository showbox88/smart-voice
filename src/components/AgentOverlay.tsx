import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import { AgentTitleBar } from "./agent/AgentTitleBar";
import { AgentChat } from "./agent/AgentChat";
import { AgentInput } from "./agent/AgentInput";
import AudioManager from "../helpers/audioManager";
import { useChatPersistence } from "./chat/useChatPersistence";
import { useChatStreaming } from "./chat/useChatStreaming";
import type { Message } from "./chat/types";

const MIN_HEIGHT = 200;
const MIN_WIDTH = 360;

// ──────────────────────────────────────────────────────────────────────
// XiaoZhi TTS playback helper
// Speaks the assistant's final reply via Edge Read Aloud (cloud).
// Controlled by localStorage key "xiaozhi.tts.enabled" (default: true).
// ──────────────────────────────────────────────────────────────────────
const TTS_ENABLED_KEY = "xiaozhi.tts.enabled";
const TTS_PROVIDER_KEY = "xiaozhi.tts.provider"; // "edge" | "elevenlabs"
const TTS_VOICE_KEY = "xiaozhi.tts.voice"; // Edge voice ShortName
const TTS_ELEVEN_VOICE_KEY = "xiaozhi.tts.elevenlabs.voiceId";
const TTS_ELEVEN_KEY_KEY = "xiaozhi.tts.elevenlabs.apiKey";

/**
 * Strip markdown-ish syntax that sounds weird when read aloud:
 * **bold**, *italic*, `code`, ``` fences ```, [link](url), list bullets,
 * headings, and HTML-style tags.
 */
function sanitizeForTts(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1") // links / images
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // bold/italic
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, "") // numbered lists
    .replace(/<[^>]+>/g, " ") // html tags
    .replace(/\s+/g, " ")
    .trim();
}

export default function AgentOverlay() {
  const { t } = useTranslation();
  const [partialTranscript, setPartialTranscript] = useState("");
  const audioManagerRef = useRef<InstanceType<typeof AudioManager> | null>(null);
  const agentStateRef = useRef<string>("idle");

  const persistence = useChatPersistence();
  const { messages, setMessages, handleNewChat: persistenceNewChat } = persistence;

  // TTS playback — cancel any previous speech when a new one starts.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const stopTts = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
  }, []);

  const speakAssistant = useCallback(
    async (text: string) => {
      try {
        const enabled = localStorage.getItem(TTS_ENABLED_KEY);
        if (enabled === "false") return;

        const cleaned = sanitizeForTts(text || "");
        if (!cleaned) return;

        const provider = (localStorage.getItem(TTS_PROVIDER_KEY) as "edge" | "elevenlabs" | null) || "edge";
        const opts: Record<string, unknown> = { provider };
        if (provider === "elevenlabs") {
          const vId = localStorage.getItem(TTS_ELEVEN_VOICE_KEY);
          const key = localStorage.getItem(TTS_ELEVEN_KEY_KEY);
          if (!vId || !key) {
            console.warn("[xiaozhi-tts] elevenlabs not configured — skip");
            return;
          }
          opts.voice = vId;
          opts.elevenLabsApiKey = key;
        } else {
          const v = localStorage.getItem(TTS_VOICE_KEY);
          if (v) opts.voice = v;
        }

        const res = await window.electronAPI?.ttsSynthesize?.(cleaned, opts);
        if (!res || !res.success) {
          console.warn("[xiaozhi-tts] synth failed", res);
          return;
        }

        // Cancel any in-flight playback first.
        stopTts();

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
        });
        audio.addEventListener("error", () => {
          console.warn("[xiaozhi-tts] audio element error");
          if (ttsUrlRef.current === url) {
            URL.revokeObjectURL(url);
            ttsUrlRef.current = null;
            ttsAudioRef.current = null;
          }
        });
        await audio.play().catch((err) => {
          console.warn("[xiaozhi-tts] play() rejected", err);
        });
      } catch (err) {
        console.warn("[xiaozhi-tts] unexpected error", err);
      }
    },
    [stopTts]
  );

  useEffect(() => stopTts, [stopTts]);

  const streaming = useChatStreaming({
    messages,
    setMessages,
    onStreamComplete: (_assistantId, content, toolCalls) => {
      persistence.saveAssistantMessage(content, toolCalls);
      // Fire-and-forget; no need to block message persistence.
      void speakAssistant(content);
    },
  });

  const { agentState } = streaming;

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  const addSystemMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant" as const, content, isStreaming: false },
      ]);
    },
    [setMessages]
  );

  const handleTranscriptionComplete = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      if (!persistence.conversationId) {
        await persistence.createConversation(t("agentMode.titleBar.newChat"));
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        isStreaming: false,
      };
      setMessages((prev) => [...prev, userMsg]);

      await persistence.saveUserMessage(text);

      if (persistence.conversationId && messages.length === 0) {
        const title = text.slice(0, 50) + (text.length > 50 ? "..." : "");
        window.electronAPI?.updateAgentConversationTitle?.(persistence.conversationId, title);
      }

      await streaming.sendToAI(text, [...messages, userMsg]);
    },
    [t, messages, setMessages, persistence, streaming]
  );

  useEffect(() => {
    const am = new AudioManager();
    am.setSkipReasoning(true);
    am.setContext("agent");
    am.setCallbacks({
      onStateChange: () => {},
      onError: (error: { message?: string }) => {
        const msg = error?.message || (typeof error === "string" ? error : "Transcription failed");
        addSystemMessage(`${t("agentMode.chat.errorPrefix")}: ${msg}`);
      },
      onTranscriptionComplete: (result: { text: string }) => {
        handleTranscriptionComplete(result.text);
      },
      onPartialTranscript: (text: string) => {
        setPartialTranscript(text);
      },
      onStreamingCommit: undefined,
    });
    audioManagerRef.current = am;
    return () => {
      am.cleanup?.();
      window.removeEventListener("api-key-changed", (am as any)._onApiKeyChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSystemMessage, handleTranscriptionComplete]);

  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    const startY = e.screenY;

    window.electronAPI?.getAgentWindowBounds?.().then((bounds) => {
      if (!bounds) return;
      const startBounds = { ...bounds };

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.screenX - startX;
        const dy = ev.screenY - startY;
        let { x, y, width, height } = startBounds;

        if (direction.includes("e")) width += dx;
        if (direction.includes("w")) {
          x += dx;
          width -= dx;
        }
        if (direction.includes("s")) height += dy;
        if (direction.includes("n")) {
          y += dy;
          height -= dy;
        }

        width = Math.max(MIN_WIDTH, width);
        height = Math.max(MIN_HEIGHT, height);

        window.electronAPI?.setAgentWindowBounds?.(x, y, width, height);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.electronAPI?.hideAgentOverlay?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const unsubStart = window.electronAPI?.onAgentStartRecording?.(() => {
      audioManagerRef.current?.startRecording();
    });

    const unsubStop = window.electronAPI?.onAgentStopRecording?.(() => {
      audioManagerRef.current?.stopRecording();
    });

    const unsubToggle = window.electronAPI?.onAgentToggleRecording?.(() => {
      const state = agentStateRef.current;
      if (state === "listening") {
        audioManagerRef.current?.stopRecording();
      } else if (state === "idle") {
        audioManagerRef.current?.startRecording();
      }
    });

    return () => {
      unsubStart?.();
      unsubStop?.();
      unsubToggle?.();
    };
  }, []);

  const handleNewChat = useCallback(() => {
    persistenceNewChat();
    setPartialTranscript("");
    streaming.cancelStream();
  }, [persistenceNewChat, streaming]);

  const handleClose = useCallback(() => {
    window.electronAPI?.hideAgentOverlay?.();
  }, []);

  return (
    <div className="agent-overlay-window w-screen h-screen bg-transparent relative">
      <div
        className={cn(
          "flex flex-col w-full h-full",
          "bg-surface-0",
          "border border-border/50 rounded-lg",
          "shadow-[var(--shadow-elevated)]",
          "overflow-hidden"
        )}
      >
        <AgentTitleBar onNewChat={handleNewChat} onClose={handleClose} />
        <AgentChat messages={messages} />
        <AgentInput
          agentState={agentState}
          partialTranscript={partialTranscript}
          onTextSubmit={handleTranscriptionComplete}
          onCancel={streaming.cancelStream}
        />
      </div>

      {/* Resize handles -- edges */}
      <div
        className="absolute top-0 left-2 right-2 h-[5px] cursor-n-resize"
        onMouseDown={(e) => handleResizeStart(e, "n")}
      />
      <div
        className="absolute bottom-0 left-2 right-2 h-[5px] cursor-s-resize"
        onMouseDown={(e) => handleResizeStart(e, "s")}
      />
      <div
        className="absolute left-0 top-2 bottom-2 w-[5px] cursor-w-resize"
        onMouseDown={(e) => handleResizeStart(e, "w")}
      />
      <div
        className="absolute right-0 top-2 bottom-2 w-[5px] cursor-e-resize"
        onMouseDown={(e) => handleResizeStart(e, "e")}
      />

      {/* Resize handles -- corners */}
      <div
        className="absolute top-0 left-0 w-[10px] h-[10px] cursor-nw-resize"
        onMouseDown={(e) => handleResizeStart(e, "nw")}
      />
      <div
        className="absolute top-0 right-0 w-[10px] h-[10px] cursor-ne-resize"
        onMouseDown={(e) => handleResizeStart(e, "ne")}
      />
      <div
        className="absolute bottom-0 left-0 w-[10px] h-[10px] cursor-sw-resize"
        onMouseDown={(e) => handleResizeStart(e, "sw")}
      />
      <div
        className="absolute bottom-0 right-0 w-[10px] h-[10px] cursor-se-resize"
        onMouseDown={(e) => handleResizeStart(e, "se")}
      />
    </div>
  );
}
