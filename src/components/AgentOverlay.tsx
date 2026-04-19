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

// Two-tone wake chime — pleasant ascending Ding-Ding via Web Audio oscillator.
// Runs without bundled assets; ~200ms total.
let _chimeCtx: AudioContext | null = null;
function playWakeChime() {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!_chimeCtx || _chimeCtx.state === "closed") {
      _chimeCtx = new Ctx();
    }
    const ctx = _chimeCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const tones: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 784, start: 0, dur: 0.1 },   // G5
      { freq: 1047, start: 0.08, dur: 0.18 }, // C6
    ];
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.freq;
      const t0 = now + tone.start;
      const t1 = t0 + tone.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  } catch {
    // never block on sound failure
  }
}

export default function AgentOverlay() {
  const { t } = useTranslation();
  const [partialTranscript, setPartialTranscript] = useState("");
  // Voice-hotkey flow: transcription arrives here, gets shown briefly in the
  // input box, then auto-submitted (Enter). Gives the user visual confirmation
  // of what was heard before it lands in the chat.
  const [pendingSubmitText, setPendingSubmitText] = useState<string | null>(null);
  const audioManagerRef = useRef<InstanceType<typeof AudioManager> | null>(null);
  const agentStateRef = useRef<string>("idle");
  // Mic recording state sourced from AudioManager (agentState doesn't expose it).
  const isRecordingRef = useRef<boolean>(false);
  // Mirrored state so AgentAvatar re-renders when recording flips.
  const [isRecording, setIsRecording] = useState(false);
  // Hands-free (wake-word) mode: agent window stays hidden and the turn is
  // surfaced only in the transparent voice bubble overlay. Flag flips true on
  // a wake-word start and stays true until the next manual interaction.
  const isHandsFreeRef = useRef<boolean>(false);
  // Track the current hands-free turn's user text so streaming assistant
  // chunks can be pushed alongside it.
  const bubbleUserTextRef = useRef<string>("");

  const persistence = useChatPersistence();
  const { messages, setMessages, handleNewChat: persistenceNewChat } = persistence;

  // TTS playback — cancel any previous speech when a new one starts.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const ttsAnalyserCleanupRef = useRef<null | (() => void)>(null);
  // "Speaking" = TTS audio currently playing. Drives orb animation and keeps
  // the bubble alive until playback ends.
  const isSpeakingRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
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
    ttsAnalyserCleanupRef.current?.();
    ttsAnalyserCleanupRef.current = null;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    window.electronAPI?.updateAvatarState?.({ level: 0 });
  }, []);

  const speakAssistant = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        const enabled = localStorage.getItem(TTS_ENABLED_KEY);
        if (enabled === "false") return false;

        const cleaned = sanitizeForTts(text || "");
        if (!cleaned) return false;

        const provider = (localStorage.getItem(TTS_PROVIDER_KEY) as "edge" | "elevenlabs" | null) || "edge";
        const opts: Record<string, unknown> = { provider };
        if (provider === "elevenlabs") {
          const vId = localStorage.getItem(TTS_ELEVEN_VOICE_KEY);
          const key = localStorage.getItem(TTS_ELEVEN_KEY_KEY);
          if (!vId || !key) {
            console.warn("[xiaozhi-tts] elevenlabs not configured — skip");
            return false;
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
          return false;
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

        // Hook the audio element into Web Audio so we can read RMS while it
        // plays and drive the orb with the assistant's voice. We still connect
        // the source to ctx.destination so playback is audible.
        const Ctx =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
            .AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        let analyserCtx: AudioContext | null = null;
        let levelTimer: ReturnType<typeof setInterval> | null = null;
        let analyserCleanup: (() => void) | null = null;
        if (Ctx) {
          try {
            analyserCtx = new Ctx();
            const source = analyserCtx.createMediaElementSource(audio);
            const analyser = analyserCtx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            source.connect(analyserCtx.destination);
            const data = new Uint8Array(analyser.fftSize);
            levelTimer = setInterval(() => {
              analyser.getByteTimeDomainData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
              }
              const rms = Math.sqrt(sum / data.length);
              window.electronAPI?.updateAvatarState?.({ level: rms });
            }, 80);
            analyserCleanup = () => {
              if (levelTimer) clearInterval(levelTimer);
              try {
                analyserCtx?.close();
              } catch {
                /* ignore */
              }
              window.electronAPI?.updateAvatarState?.({ level: 0 });
            };
            ttsAnalyserCleanupRef.current = analyserCleanup;
          } catch (err) {
            console.warn("[xiaozhi-tts] analyser setup failed", err);
          }
        }

        const finalize = () => {
          // If stopTts already replaced the audio element, bail so we don't
          // double-cleanup a newer playback.
          if (ttsAudioRef.current !== audio) return;
          if (ttsUrlRef.current === url) {
            URL.revokeObjectURL(url);
            ttsUrlRef.current = null;
          }
          ttsAudioRef.current = null;
          if (ttsAnalyserCleanupRef.current === analyserCleanup) {
            analyserCleanup?.();
            ttsAnalyserCleanupRef.current = null;
          }
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          // Hands-free: close the bubble now that the assistant has finished
          // speaking. The renderer applies its own fade-out timer.
          if (isHandsFreeRef.current) {
            window.electronAPI?.updateVoiceBubble?.({
              userText: bubbleUserTextRef.current,
              assistantText: text,
              isRecording: false,
              isThinking: false,
              done: true,
            });
            isHandsFreeRef.current = false;
          }
        };

        audio.addEventListener("ended", finalize);
        audio.addEventListener("error", () => {
          console.warn("[xiaozhi-tts] audio element error");
          finalize();
        });

        try {
          await audio.play();
        } catch (err) {
          console.warn("[xiaozhi-tts] play() rejected", err);
          finalize();
          return false;
        }
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        return true;
      } catch (err) {
        console.warn("[xiaozhi-tts] unexpected error", err);
        return false;
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
      const handsFree = isHandsFreeRef.current;
      // Hands-free: pin the final assistant text into the bubble but keep it
      // open (done: false). TTS holds the bubble visible while it plays; the
      // TTS `ended` handler flips `done: true` when playback finishes.
      if (handsFree) {
        window.electronAPI?.updateVoiceBubble?.({
          userText: bubbleUserTextRef.current,
          assistantText: content,
          isRecording: false,
          isThinking: false,
          done: false,
        });
      }
      // Kick off playback. If TTS doesn't start (disabled or error), close the
      // bubble now so it can fade out — otherwise the `ended` handler does it.
      void speakAssistant(content).then((played) => {
        if (!played && handsFree && isHandsFreeRef.current) {
          window.electronAPI?.updateVoiceBubble?.({
            userText: bubbleUserTextRef.current,
            assistantText: content,
            isRecording: false,
            isThinking: false,
            done: true,
          });
          isHandsFreeRef.current = false;
        }
      });
    },
  });

  const { agentState } = streaming;

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  // Broadcast isRecording / isThinking / isSpeaking state to the floating orb
  // window. Level is pushed separately from the mic monitor tick (recording)
  // or the TTS analyser tick (speaking) at ~12Hz.
  useEffect(() => {
    const isThinking = agentState === "thinking" || agentState === "streaming";
    window.electronAPI?.updateAvatarState?.({ isRecording, isThinking, isSpeaking });
  }, [isRecording, agentState, isSpeaking]);

  // Stream assistant partials into the voice bubble while in hands-free mode.
  // onStreamComplete handles the `done` signal; here we only relay in-flight
  // chunks so the user sees the reply building up in real time.
  useEffect(() => {
    if (!isHandsFreeRef.current) return;
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (!last.isStreaming) return;
    const content = typeof last.content === "string" ? last.content : "";
    window.electronAPI?.updateVoiceBubble?.({
      userText: bubbleUserTextRef.current,
      assistantText: content,
      isRecording: false,
      isThinking: true,
      done: false,
    });
  }, [messages]);

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

      // Hands-free: surface the user's command in the bubble while the model
      // thinks. Streaming partials will overwrite assistantText below.
      if (isHandsFreeRef.current) {
        bubbleUserTextRef.current = text;
        window.electronAPI?.updateVoiceBubble?.({
          userText: text,
          assistantText: "",
          isRecording: false,
          isThinking: true,
          done: false,
        });
      }

      await persistence.saveUserMessage(text);

      if (persistence.conversationId && messages.length === 0) {
        const title = text.slice(0, 50) + (text.length > 50 ? "..." : "");
        window.electronAPI?.updateAgentConversationTitle?.(persistence.conversationId, title);
      }

      await streaming.sendToAI(text, [...messages, userMsg]);
    },
    [t, messages, setMessages, persistence, streaming]
  );

  // Keep callbacks fresh in refs so we can init AudioManager ONCE. Recreating it
  // every render (as before) orphans in-flight recordings — cleanup() nulls
  // onTranscriptionComplete, so the transcript never makes it back to React.
  const onTranscriptionCompleteRef = useRef(handleTranscriptionComplete);
  const addSystemMessageRef = useRef(addSystemMessage);
  useEffect(() => {
    onTranscriptionCompleteRef.current = handleTranscriptionComplete;
  }, [handleTranscriptionComplete]);
  useEffect(() => {
    addSystemMessageRef.current = addSystemMessage;
  }, [addSystemMessage]);

  useEffect(() => {
    const am = new AudioManager();
    am.setSkipReasoning(true);
    am.setContext("agent");
    am.setCallbacks({
      onStateChange: (s: { isRecording?: boolean }) => {
        const next = !!s?.isRecording;
        isRecordingRef.current = next;
        setIsRecording(next);
      },
      onError: (error: { message?: string }) => {
        const msg = error?.message || (typeof error === "string" ? error : "Transcription failed");
        addSystemMessageRef.current(`${t("agentMode.chat.errorPrefix")}: ${msg}`);
      },
      onTranscriptionComplete: (result: { text: string }) => {
        const text = result?.text?.trim() || "";
        if (!text) return;
        // Route through the input box for visible feedback, then auto-submit.
        // ChatInput's useEffect picks up pendingSubmitText and fires submit,
        // which calls onTextSubmit (handleTranscriptionComplete) below.
        setPendingSubmitText(text);
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
  }, []);

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

  // Mic level + optional VAD auto-stop. Opens a parallel stream, tracks RMS in
  // levelRef (the avatar reads this every frame), and — when autoStop=true —
  // stops recording after ~1.2s trailing silence once speech has been heard.
  // Hard cap at 15s so we never leave the mic open indefinitely.
  const levelRef = useRef(0);
  const micMonitorCleanupRef = useRef<null | (() => void)>(null);
  const stopMicMonitor = useCallback(() => {
    micMonitorCleanupRef.current?.();
    micMonitorCleanupRef.current = null;
    levelRef.current = 0;
  }, []);
  const startMicMonitor = useCallback(
    async ({ autoStop }: { autoStop: boolean }) => {
      stopMicMonitor();
      let stream: MediaStream | null = null;
      let ctx: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const SPEECH_RMS = 0.04;
        const TRAILING_MS = 1200;
        const MAX_MS = 15000;
        let heardSpeech = false;
        let lastSpeechAt = Date.now();

        const cleanup = () => {
          if (timer) clearInterval(timer);
          if (maxTimer) clearTimeout(maxTimer);
          try {
            stream?.getTracks().forEach((t) => t.stop());
          } catch {
            /* ignore */
          }
          try {
            ctx?.close();
          } catch {
            /* ignore */
          }
          levelRef.current = 0;
          window.electronAPI?.updateAvatarState?.({ level: 0 });
        };

        const triggerStop = () => {
          if (isRecordingRef.current) {
            audioManagerRef.current?.stopRecording();
          }
          cleanup();
          if (micMonitorCleanupRef.current === cleanup) micMonitorCleanupRef.current = null;
        };

        timer = setInterval(() => {
          if (!analyser) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          levelRef.current = rms;
          // Push level to the floating orb window.
          window.electronAPI?.updateAvatarState?.({ level: rms });
          if (autoStop) {
            const now = Date.now();
            if (rms > SPEECH_RMS) {
              heardSpeech = true;
              lastSpeechAt = now;
            } else if (heardSpeech && now - lastSpeechAt > TRAILING_MS) {
              triggerStop();
            }
          }
        }, 80);

        if (autoStop) {
          maxTimer = setTimeout(triggerStop, MAX_MS);
        }
        micMonitorCleanupRef.current = cleanup;
      } catch (err) {
        console.warn("[mic-monitor] setup failed", err);
        try {
          stream?.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        try {
          ctx?.close();
        } catch {
          /* ignore */
        }
      }
    },
    [stopMicMonitor]
  );

  const showListeningBubble = () => {
    bubbleUserTextRef.current = "";
    window.electronAPI?.updateVoiceBubble?.({
      userText: "",
      assistantText: "",
      isRecording: true,
      isThinking: false,
      done: false,
    });
  };

  useEffect(() => {
    const unsubStart = window.electronAPI?.onAgentStartRecording?.(() => {
      isHandsFreeRef.current = false;
      audioManagerRef.current?.startRecording();
      void startMicMonitor({ autoStop: false });
    });

    const unsubStartHandsFree = window.electronAPI?.onAgentStartRecordingHandsFree?.(() => {
      playWakeChime();
      isHandsFreeRef.current = true;
      showListeningBubble();
      audioManagerRef.current?.startRecording();
      void startMicMonitor({ autoStop: true });
    });

    const unsubStop = window.electronAPI?.onAgentStopRecording?.(() => {
      stopMicMonitor();
      audioManagerRef.current?.stopRecording();
    });

    const unsubToggle = window.electronAPI?.onAgentToggleRecording?.(() => {
      // Use real mic state, not agentState (which only tracks AI pipeline phases
      // like thinking/streaming — "listening" is never set anywhere).
      if (isRecordingRef.current) {
        stopMicMonitor();
        audioManagerRef.current?.stopRecording();
      } else if (agentStateRef.current === "idle") {
        isHandsFreeRef.current = false;
        audioManagerRef.current?.startRecording();
        void startMicMonitor({ autoStop: false });
      }
    });

    const unsubToggleHandsFree = window.electronAPI?.onAgentToggleRecordingHandsFree?.(() => {
      if (isRecordingRef.current) {
        // Already recording (e.g. wake-word re-fired mid-capture) — stop.
        stopMicMonitor();
        audioManagerRef.current?.stopRecording();
      } else if (agentStateRef.current === "idle") {
        playWakeChime();
        isHandsFreeRef.current = true;
        showListeningBubble();
        audioManagerRef.current?.startRecording();
        void startMicMonitor({ autoStop: true });
      }
    });

    return () => {
      unsubStart?.();
      unsubStartHandsFree?.();
      unsubStop?.();
      unsubToggle?.();
      unsubToggleHandsFree?.();
      stopMicMonitor();
    };
  }, [startMicMonitor, stopMicMonitor]);

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
          pendingSubmitText={pendingSubmitText}
          onPendingSubmitConsumed={() => setPendingSubmitText(null)}
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
