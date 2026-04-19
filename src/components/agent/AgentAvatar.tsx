import { useEffect, useRef } from "react";

interface AgentAvatarProps {
  isRecording: boolean;
  isThinking?: boolean;
  isSpeaking?: boolean;
  levelRef: React.MutableRefObject<number>;
  size?: number;
}

/**
 * Living-orb avatar for the voice agent.
 *  - Dormant (idle): ONE static violet frame, no rAF.
 *  - Listening (recording): cyan core, expanding rings, audio-reactive halo.
 *  - Thinking (LLM generating): slow orbiting spark, warm amber tint.
 *  - Speaking (TTS playing): emerald/mint green, three petal lobes that
 *    pulse outward with the voice RMS — deliberately different from the
 *    recording ring pattern so the user can tell at a glance "this is the
 *    agent talking to me" vs "the agent is listening to me".
 *
 * Priority (first match wins): recording → speaking → thinking → idle.
 * The rAF loop only runs while active, so idle CPU/GPU usage is ~zero.
 */
export function AgentAvatar({
  isRecording,
  isThinking = false,
  isSpeaking = false,
  levelRef,
  size = 140,
}: AgentAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedLevelRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let rafId = 0;
    const startTime = performance.now();
    const active = isRecording || isThinking || isSpeaking;

    // Pick hue by priority. Listening > speaking > thinking > idle.
    const hue = isRecording ? 185 : isSpeaking ? 150 : isThinking ? 40 : 265;
    const sat = isRecording ? 95 : isSpeaking ? 85 : isThinking ? 90 : 75;

    const draw = (t: number) => {
      const raw = Math.max(0, Math.min(1, levelRef.current * 6));
      smoothedLevelRef.current += (raw - smoothedLevelRef.current) * 0.18;
      const level = smoothedLevelRef.current;

      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      // Outer aura. Active: breathes with time + level. Idle: fixed glow.
      const auraRadius = size * 0.48;
      const breatheSpeed = isRecording ? 4 : isSpeaking ? 5 : 2;
      const breathe = active
        ? 0.6 + 0.3 * Math.sin(t * breatheSpeed) + level * 0.6
        : 0.7;
      const auraGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraRadius);
      auraGrad.addColorStop(
        0,
        `hsla(${hue}, ${sat}%, 70%, ${Math.min(0.95, 0.55 + breathe * 0.4)})`
      );
      auraGrad.addColorStop(
        0.45,
        `hsla(${hue}, ${sat}%, 55%, ${0.25 + breathe * 0.2})`
      );
      auraGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 40%, 0)`);
      ctx.fillStyle = auraGrad;
      ctx.fillRect(0, 0, size, size);

      if (isRecording) {
        // Listening: three expanding concentric ripples, audio-reactive.
        const ringCount = 3;
        for (let i = 0; i < ringCount; i++) {
          const speed = 0.9;
          const phase = ((t * speed + i / ringCount) % 1 + 1) % 1;
          const r = size * (0.17 + phase * 0.32 + level * 0.12);
          const alpha = (1 - phase) * 0.7;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${alpha})`;
          ctx.lineWidth = 1.5 + level * 2.5;
          ctx.stroke();
        }
      } else if (isSpeaking) {
        // Speaking: three rotating petal lobes that bloom outward with the
        // voice RMS. Distinctly "emitting" rather than "listening" — the
        // lobes radiate from the core instead of expanding concentric waves.
        //
        // Geometry budget: baseR + reach + lobeRadius must stay ≤ 0.47 × size
        // (just inside the aura envelope) or the canvas square edge shows up
        // as straight clip lines when the voice gets loud.
        const lobeCount = 3;
        const rotation = t * 0.9;
        const clampedLevel = Math.min(1, level);
        const baseR = size * 0.14;
        const reach = size * (0.06 + clampedLevel * 0.1);
        const lobeRadius = size * (0.09 + clampedLevel * 0.06);
        for (let i = 0; i < lobeCount; i++) {
          const angle = rotation + (i * Math.PI * 2) / lobeCount;
          const lx = cx + Math.cos(angle) * baseR;
          const ly = cy + Math.sin(angle) * baseR;
          const rx = cx + Math.cos(angle) * (baseR + reach);
          const ry = cy + Math.sin(angle) * (baseR + reach);
          const lobeGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, lobeRadius);
          lobeGrad.addColorStop(0, `hsla(${hue}, ${sat}%, 82%, ${0.55 + clampedLevel * 0.4})`);
          lobeGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 55%, 0)`);
          ctx.fillStyle = lobeGrad;
          ctx.beginPath();
          ctx.arc(rx, ry, lobeRadius, 0, Math.PI * 2);
          ctx.fill();

          // Thin connector from core toward the lobe for a "beam" feel.
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(rx, ry);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 85%, ${0.25 + clampedLevel * 0.5})`;
          ctx.lineWidth = 1 + clampedLevel * 2;
          ctx.stroke();
        }

        // A single soft ripple at low alpha to add a heartbeat underneath.
        // Keep the max radius under the aura envelope too.
        const heartbeat = 0.5 + 0.5 * Math.sin(t * 3.2);
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.28 + heartbeat * 0.03 + clampedLevel * 0.04), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${0.2 + heartbeat * 0.15})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (isThinking) {
        // Thinking: gentle concentric rings, slower and softer than listening.
        const ringCount = 3;
        for (let i = 0; i < ringCount; i++) {
          const speed = 0.5;
          const phase = ((t * speed + i / ringCount) % 1 + 1) % 1;
          const r = size * (0.17 + phase * 0.32);
          const alpha = (1 - phase) * 0.45;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Orbiting spark keeps the "working on it" personality.
        const orbitR = size * 0.26;
        const ox = cx + Math.cos(t * 2.4) * orbitR;
        const oy = cy + Math.sin(t * 2.4) * orbitR;
        const sparkGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, size * 0.08);
        sparkGrad.addColorStop(0, `hsla(45, 100%, 85%, 1)`);
        sparkGrad.addColorStop(1, `hsla(40, 100%, 60%, 0)`);
        ctx.fillStyle = sparkGrad;
        ctx.beginPath();
        ctx.arc(ox, oy, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Idle: a single steady halo ring. No animation.
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, 0.28)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Core — bright heart of the orb. Pulses only when active.
      const baseCore = 0.11;
      const corePulse = isRecording
        ? 0.04 * Math.sin(t * 3) + level * 0.09
        : isSpeaking
          ? 0.03 * Math.sin(t * 4) + level * 0.1
          : active
            ? 0.02 * Math.sin(t * 1.5)
            : 0;
      const coreR = size * (baseCore + corePulse);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      const centerColor = isRecording
        ? `hsla(180, 100%, 97%, 1)`
        : isSpeaking
          ? `hsla(155, 100%, 94%, 1)`
          : isThinking
            ? `hsla(50, 100%, 90%, 1)`
            : `hsla(265, 70%, 85%, 0.9)`;
      coreGrad.addColorStop(0, centerColor);
      coreGrad.addColorStop(0.55, `hsla(${hue}, ${sat}%, 62%, 0.65)`);
      coreGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 48%, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    };

    if (active) {
      const tick = (now: number) => {
        draw((now - startTime) / 1000);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } else {
      // Idle: draw exactly one frame and let the canvas sit.
      smoothedLevelRef.current = 0;
      draw(0);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [size, isRecording, isThinking, isSpeaking, levelRef]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}
