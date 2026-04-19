import { useEffect, useRef, useState } from "react";

interface BubbleState {
  userText?: string;
  assistantText?: string;
  isRecording?: boolean;
  isThinking?: boolean;
  done?: boolean;
}

/**
 * Floating, transparent conversational bubble for the wake-word flow.
 *
 * The agent window stays hidden in hands-free mode — this bubble is the only
 * surface that shows the user's command and the agent's reply. It auto-fades
 * out a few seconds after the turn completes.
 */
export default function VoiceBubbleOverlay() {
  const [state, setState] = useState<BubbleState>({});
  const [visible, setVisible] = useState(false);
  const fadeOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kill the global dark surface background from index.css.
  useEffect(() => {
    const prevHtml = document.documentElement.style.cssText;
    const prevBody = document.body.style.cssText;
    document.documentElement.style.background = "transparent";
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.background = "transparent";
    document.body.style.backgroundColor = "transparent";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.cssText = prevHtml;
      document.body.style.cssText = prevBody;
    };
  }, []);

  useEffect(() => {
    const offUpdate = window.electronAPI?.onVoiceBubbleUpdate?.((next) => {
      if (!next) return;
      setState((prev) => ({ ...prev, ...next }));
      setVisible(true);

      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }

      // Renderer-side auto-dismiss mirrors the main-side timer so the fade
      // starts even if the main hide event gets lost (it shouldn't, but belt
      // and suspenders — the bubble should never get stuck on screen).
      if (next.done) {
        fadeOutTimer.current = setTimeout(() => {
          setVisible(false);
          // Clear text after the fade so the next turn starts fresh.
          setTimeout(() => setState({}), 300);
        }, 4500);
      }
    });

    const offHide = window.electronAPI?.onVoiceBubbleHide?.(() => {
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
        fadeOutTimer.current = null;
      }
      setVisible(false);
      setTimeout(() => setState({}), 300);
    });

    return () => {
      offUpdate?.();
      offHide?.();
      if (fadeOutTimer.current) {
        clearTimeout(fadeOutTimer.current);
      }
    };
  }, []);

  const { userText, assistantText, isRecording, isThinking } = state;
  const hasUser = !!(userText && userText.trim());
  const hasAssistant = !!(assistantText && assistantText.trim());

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "8px",
        boxSizing: "border-box",
        background: "transparent",
        pointerEvents: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "stretch",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
          transition: "opacity 260ms ease-out, transform 260ms ease-out",
        }}
      >
        {hasUser && (
          <Bubble
            text={userText!}
            role="user"
            hint={isRecording ? "Listening…" : undefined}
          />
        )}
        {(hasAssistant || isThinking) && (
          <Bubble
            text={hasAssistant ? assistantText! : "…"}
            role="assistant"
            hint={!hasAssistant && isThinking ? "Thinking…" : undefined}
          />
        )}
      </div>
    </div>
  );
}

function Bubble({
  text,
  role,
  hint,
}: {
  text: string;
  role: "user" | "assistant";
  hint?: string;
}) {
  const isUser = role === "user";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "95%",
        padding: "10px 14px",
        borderRadius: 16,
        borderBottomRightRadius: isUser ? 4 : 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
        background: isUser
          ? "rgba(56, 132, 255, 0.92)"
          : "rgba(28, 28, 46, 0.88)",
        color: "#f4f6fb",
        fontSize: 14,
        lineHeight: 1.4,
        boxShadow:
          "0 12px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.06)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
      {hint && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            opacity: 0.65,
            letterSpacing: 0.2,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
