import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "./agent/AgentAvatar";

/**
 * Floating desktop orb — the "living agent" avatar.
 *
 * Runs in its own transparent, click-through always-on-top window. Listens for
 * `avatar-state-update` IPC from the agent window: { isRecording, isThinking,
 * level }. The level is written into a ref so the canvas animation reads it
 * every frame without re-rendering.
 */
export default function AvatarOverlayApp() {
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const levelRef = useRef(0);

  // Force html/body fully transparent. Global index.css applies a solid
  // surface background to body, which would paint a dark square behind the orb.
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
    const off = window.electronAPI?.onAvatarStateUpdate?.((state) => {
      if (!state) return;
      if (typeof state.isRecording === "boolean") setIsRecording(state.isRecording);
      if (typeof state.isThinking === "boolean") setIsThinking(state.isThinking);
      if (typeof state.isSpeaking === "boolean") setIsSpeaking(state.isSpeaking);
      if (typeof state.level === "number") levelRef.current = state.level;
    });
    return () => {
      off?.();
    };
  }, []);

  // Decay level back toward zero when nothing is driving it — keeps the orb
  // from freezing on a stale value after the agent window stops sending.
  // Recording pushes live mic levels; speaking pushes live TTS levels; skip
  // decay in both so the analyser ticks aren't fighting the decay.
  useEffect(() => {
    if (isRecording || isSpeaking) return;
    const id = setInterval(() => {
      levelRef.current *= 0.85;
      if (levelRef.current < 0.001) levelRef.current = 0;
    }, 100);
    return () => clearInterval(id);
  }, [isRecording, isSpeaking]);

  const active = isRecording || isThinking || isSpeaking;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        margin: 0,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
        // Drag anywhere on the orb window to move it around the desktop.
        WebkitAppRegion: "drag",
        cursor: "grab",
      } as React.CSSProperties}
    >
      <div
        style={{
          transition: "transform 400ms ease-out, opacity 400ms ease-out",
          opacity: active ? 1 : 0.9,
          transform: active ? "scale(1)" : "scale(0.88)",
          pointerEvents: "none",
        }}
      >
        <AgentAvatar
          isRecording={isRecording}
          isThinking={isThinking}
          isSpeaking={isSpeaking}
          levelRef={levelRef}
          size={76}
        />
      </div>
    </div>
  );
}
