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
 *
 *  - Idle: ONE static violet frame, no rAF.
 *  - Listening (recording): BLUE core with sound waves contracting inward
 *    toward the center — "drawing the voice in".
 *  - Thinking: YELLOW core with satellite orbs orbiting the center at
 *    different radii — "working on it".
 *  - Speaking: GREEN core with sound waves expanding outward — "radiating
 *    the reply".
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

    // Hue/sat per state. Priority: recording > speaking > thinking > idle.
    const hue = isRecording ? 210 : isSpeaking ? 140 : isThinking ? 50 : 265;
    const sat = isRecording ? 95 : isSpeaking ? 85 : isThinking ? 95 : 75;

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
        // Listening: three rings that appear at the outer edge and CONTRACT
        // inward, fading out as they reach the core. Audio-reactive — louder
        // voice tightens the rings toward the center faster.
        const ringCount = 3;
        const rOuter = 0.49;
        const rInner = 0.15;
        for (let i = 0; i < ringCount; i++) {
          const speed = 0.9;
          const phase = ((t * speed + i / ringCount) % 1 + 1) % 1;
          // phase 0 = outer edge, phase 1 = center — contracting.
          const r = size * (rOuter - phase * (rOuter - rInner) - level * 0.05);
          // Alpha peaks mid-travel so rings fade in at the edge and out at the core.
          const alpha = Math.sin(phase * Math.PI) * (0.55 + level * 0.3);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${alpha})`;
          ctx.lineWidth = 1.5 + level * 2;
          ctx.stroke();
        }
      } else if (isSpeaking) {
        // Speaking: three rings that emerge from the core and EXPAND outward
        // — classic "radiating sound" pattern. Audio-reactive for TTS RMS.
        const ringCount = 3;
        const rInner = 0.15;
        const rOuter = 0.49;
        for (let i = 0; i < ringCount; i++) {
          const speed = 0.9;
          const phase = ((t * speed + i / ringCount) % 1 + 1) % 1;
          const r = size * (rInner + phase * (rOuter - rInner) + level * 0.05);
          const alpha = Math.sin(phase * Math.PI) * (0.55 + level * 0.3);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${alpha})`;
          ctx.lineWidth = 1.5 + level * 2;
          ctx.stroke();
        }
      } else if (isThinking) {
        // Thinking: classic Bohr-atom look. Three tilted elliptical orbitals
        // cross at the nucleus; one electron traces each orbit at a different
        // speed. The thin ellipses give the side-view "atom diagram" feel.
        const orbitA = size * 0.38; // semi-major axis
        const orbitB = size * 0.13; // semi-minor axis (the "tilt" illusion)
        const orbitals = [
          { rotation: 0, speed: 5.5, phase: 0 },
          { rotation: Math.PI / 3, speed: -4.2, phase: Math.PI * 0.7 },
          { rotation: (2 * Math.PI) / 3, speed: 3.3, phase: Math.PI * 1.4 },
        ];

        // Draw each orbital path first (so electrons render on top).
        for (const o of orbitals) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, orbitA, orbitB, o.rotation, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue}, ${sat}%, 75%, 0.22)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Then the electrons.
        for (const o of orbitals) {
          const angle = t * o.speed + o.phase;
          const px = orbitA * Math.cos(angle);
          const py = orbitB * Math.sin(angle);
          const cos = Math.cos(o.rotation);
          const sin = Math.sin(o.rotation);
          const ex = cx + px * cos - py * sin;
          const ey = cy + px * sin + py * cos;

          const electronGlow = size * 0.07;
          const electronGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, electronGlow);
          electronGrad.addColorStop(0, `hsla(${hue}, 100%, 88%, 1)`);
          electronGrad.addColorStop(0.45, `hsla(${hue}, ${sat}%, 65%, 0.7)`);
          electronGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 50%, 0)`);
          ctx.fillStyle = electronGrad;
          ctx.beginPath();
          ctx.arc(ex, ey, electronGlow, 0, Math.PI * 2);
          ctx.fill();
        }
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
        ? `hsla(210, 100%, 95%, 1)`
        : isSpeaking
          ? `hsla(140, 95%, 93%, 1)`
          : isThinking
            ? `hsla(50, 100%, 92%, 1)`
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
      smoothedLevelRef.current = 0;
      draw(0);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [size, isRecording, isThinking, isSpeaking, levelRef]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}
