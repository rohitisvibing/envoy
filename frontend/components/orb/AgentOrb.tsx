"use client";

/**
 * AgentOrb: the agent's visual identity.
 *
 * A dotted sphere drawn on a 2D canvas, in the same visual language as the
 * `thinking-orbs` glyphs used elsewhere, but large, tinted and driven by real
 * audio levels. Every visual parameter comes from the conversation state; the
 * only continuous input is `levelRef` (0..1 RMS from the mic or playback
 * analyser). Nothing pulses randomly.
 */

import { useEffect, useRef } from "react";
import type { ConversationState } from "@/types/api";

type RGB = [number, number, number];

const C = {
  violet: [139, 124, 255] as RGB,
  ink: [244, 245, 247] as RGB,
  grey: [120, 128, 142] as RGB,
  success: [50, 201, 138] as RGB,
  warning: [233, 173, 85] as RGB,
  error: [240, 107, 112] as RGB,
  ice: [176, 196, 255] as RGB,
};

interface Params {
  spin: number; // radians / second around Y
  radius: number; // relative sphere radius
  breathe: number; // amplitude of slow radius breathing
  turbulence: number; // per-dot internal motion
  levelGain: number; // how strongly audio level displaces dots
  band: number; // brightness of the scanning latitude band (preparing)
  alpha: number; // overall dot opacity
  glow: number; // halo strength
  float: number; // vertical bob amplitude
  tint: RGB;
}

const STATE_PARAMS: Record<ConversationState, Params> = {
  idle: { spin: 0.12, radius: 0.92, breathe: 0.015, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.7, glow: 0.18, float: 0.02, tint: C.violet },
  ready: { spin: 0.14, radius: 0.94, breathe: 0.02, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.8, glow: 0.22, float: 0.02, tint: C.violet },
  preparing: { spin: 0.55, radius: 0.9, breathe: 0.035, turbulence: 0.02, levelGain: 0, band: 1, alpha: 0.85, glow: 0.3, float: 0.0, tint: C.violet },
  connecting: { spin: 0.45, radius: 0.9, breathe: 0.03, turbulence: 0.02, levelGain: 0, band: 0.7, alpha: 0.85, glow: 0.28, float: 0.0, tint: C.violet },
  listening: { spin: 0.18, radius: 0.95, breathe: 0.0, turbulence: 0.0, levelGain: 0.32, band: 0, alpha: 0.85, glow: 0.24, float: 0.0, tint: C.ice },
  thinking: { spin: 0.9, radius: 0.88, breathe: 0.02, turbulence: 0.09, levelGain: 0, band: 0.25, alpha: 0.9, glow: 0.34, float: 0.0, tint: C.violet },
  speaking: { spin: 0.3, radius: 0.96, breathe: 0.0, turbulence: 0.01, levelGain: 0.42, band: 0, alpha: 1, glow: 0.4, float: 0.0, tint: C.violet },
  interrupted: { spin: 0.18, radius: 0.95, breathe: 0.0, turbulence: 0.0, levelGain: 0.32, band: 0, alpha: 0.85, glow: 0.24, float: 0.0, tint: C.ice },
  paused: { spin: 0.02, radius: 0.86, breathe: 0.005, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.32, glow: 0.05, float: 0.0, tint: C.grey },
  awaiting_approval: { spin: 0.08, radius: 0.9, breathe: 0.03, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.85, glow: 0.3, float: 0.0, tint: C.warning },
  completed: { spin: 0.06, radius: 0.84, breathe: 0.01, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.8, glow: 0.22, float: 0.01, tint: C.success },
  failed: { spin: 0.03, radius: 0.84, breathe: 0.0, turbulence: 0.0, levelGain: 0, band: 0, alpha: 0.5, glow: 0.12, float: 0.0, tint: C.error },
};

const DOTS = 720;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface Dot {
  x: number;
  y: number;
  z: number;
  seed: number;
  lat: number;
}

function buildSphere(n: number): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN * i;
    dots.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, seed: (i * 9301 + 49297) % 233280 / 233280, lat: y });
  }
  return dots;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function blend(cur: Params, target: Params, t: number): Params {
  return {
    spin: lerp(cur.spin, target.spin, t),
    radius: lerp(cur.radius, target.radius, t),
    breathe: lerp(cur.breathe, target.breathe, t),
    turbulence: lerp(cur.turbulence, target.turbulence, t),
    levelGain: lerp(cur.levelGain, target.levelGain, t),
    band: lerp(cur.band, target.band, t),
    alpha: lerp(cur.alpha, target.alpha, t),
    glow: lerp(cur.glow, target.glow, t),
    float: lerp(cur.float, target.float, t),
    tint: [lerp(cur.tint[0], target.tint[0], t), lerp(cur.tint[1], target.tint[1], t), lerp(cur.tint[2], target.tint[2], t)],
  };
}

export interface AgentOrbProps {
  state: ConversationState;
  /** Live audio level 0..1, read every frame (mic while listening, playback while speaking). */
  levelRef?: React.RefObject<number>;
  className?: string;
  label?: string;
}

export function AgentOrb({ state, levelRef, className, label }: AgentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const paramsRef = useRef<Params>({ ...STATE_PARAMS[state] });
  const snapRef = useRef(false);
  const drawOnceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Interrupted speech must hand over to listening instantly, not ease.
    if (state === "interrupted" || (stateRef.current === "speaking" && state === "listening")) snapRef.current = true;
    stateRef.current = state;
    drawOnceRef.current?.();
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dots = buildSphere(DOTS);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let visible = true;
    let last = performance.now();
    let rot = 0;
    let time = 0;
    let level = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!running) draw(0);
    };

    function draw(dt: number) {
      if (!ctx) return;
      const target = STATE_PARAMS[stateRef.current];
      const k = snapRef.current ? 1 : 1 - Math.exp(-dt * 5);
      snapRef.current = false;
      const p = (paramsRef.current = dt === 0 ? { ...target } : blend(paramsRef.current, target, k));

      // Audio level: fast attack, slower release, so the orb follows syllables.
      const raw = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      level += (raw - level) * (raw > level ? 0.5 : 0.12);
      const lv = level * p.levelGain;

      time += dt;
      rot += dt * p.spin;
      const size = Math.min(width, height);
      const cx = width / 2;
      const cy = height / 2 + Math.sin(time * 0.8) * p.float * size;
      const breathe = 1 + Math.sin(time * 1.4) * p.breathe;
      const R = (size / 2) * 0.78 * p.radius * breathe * (1 + lv * 0.35);
      const [tr, tg, tb] = p.tint;

      ctx.clearRect(0, 0, width, height);

      // Halo: strength follows the state and, when speaking or listening, the voice.
      const glow = p.glow + lv * 0.5;
      const g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.55);
      g.addColorStop(0, `rgba(${tr | 0},${tg | 0},${tb | 0},${0.22 * glow})`);
      g.addColorStop(0.55, `rgba(${tr | 0},${tg | 0},${tb | 0},${0.08 * glow})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const tilt = 0.38;
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);
      const bandY = Math.sin(time * 1.6) * 0.95;
      const dotBase = Math.max(0.6, size / 300);

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        // rotate around Y then tilt around X
        let x = d.x * cosR - d.z * sinR;
        let z = d.x * sinR + d.z * cosR;
        let y = d.y * cosT - z * sinT;
        z = d.y * sinT + z * cosT;

        // radial displacement: audio waves travel across latitudes; thinking adds churn
        let disp = 0;
        if (lv > 0.001) disp += lv * 0.22 * (0.6 + 0.4 * Math.sin(d.lat * 9 - time * 7 + d.seed * 2));
        if (p.turbulence > 0.001) disp += p.turbulence * Math.sin(time * 3.1 + d.seed * 40) * Math.cos(time * 2.3 + d.lat * 6);
        const s = 1 + disp;
        x *= s;
        y *= s;
        z *= s;

        const depth = (z + 1.3) / 2.6; // 0 back .. 1 front
        const px = cx + x * R;
        const py = cy + y * R;
        const near = Math.max(0, Math.min(1, depth));
        let a = p.alpha * (0.12 + near * 0.88);
        if (p.band > 0.001) a += p.band * 0.55 * Math.exp(-((d.y - bandY) ** 2) / 0.012) * near;
        a = Math.min(1, a);
        const white = 0.15 + near * 0.35;
        const r = lerp(tr, 255, white) | 0;
        const gg = lerp(tg, 255, white) | 0;
        const b = lerp(tb, 255, white) | 0;
        ctx.fillStyle = `rgba(${r},${gg},${b},${a})`;
        ctx.beginPath();
        ctx.arc(px, py, dotBase * (0.45 + near * 1.05), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduced.matches || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // Reduced motion: render one representative frame per state change.
    drawOnceRef.current = () => {
      if (!running) draw(0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    const onMotion = () => (reduced.matches ? (stop(), draw(0)) : start());
    document.addEventListener("visibilitychange", onVis);
    reduced.addEventListener("change", onMotion);
    resize();
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", onMotion);
      drawOnceRef.current = null;
    };
  }, [levelRef]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label ?? `Agent is ${state.replace("_", " ")}`}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
