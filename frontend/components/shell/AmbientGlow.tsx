"use client";

import { useEffect, useRef } from "react";
import type { ConversationState } from "@/types/api";
import { STATE_PARAMS } from "@/components/orb/AgentOrb";

/**
 * The room light. A fixed layer behind the page whose colour and strength follow the
 * agent: the same tint as the orb, brighter while a voice is heard. Eases between
 * states; with a live level it runs every frame, otherwise only until it settles.
 */
export function AmbientGlow({ state, levelRef }: { state: ConversationState; levelRef?: React.RefObject<number> }) {
  const el = useRef<HTMLDivElement>(null);
  const cur = useRef<[number, number, number, number] | null>(null);
  const wake = useRef<(() => void) | null>(null);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    wake.current?.();
  }, [state]);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let level = 0;

    const target = (): [number, number, number, number] => {
      const p = STATE_PARAMS[stateRef.current];
      const raw = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      level += (raw - level) * (raw > level ? 0.35 : 0.08);
      const a = 0.05 + p.glow * 0.45 + level * p.levelGain * 0.5;
      return [p.tint[0], p.tint[1], p.tint[2], a];
    };
    const apply = (v: [number, number, number, number]) => {
      node.style.setProperty("--glow-rgb", `${v[0] | 0} ${v[1] | 0} ${v[2] | 0}`);
      node.style.setProperty("--glow-a", v[3].toFixed(3));
    };

    const tick = () => {
      const t = target();
      const c = cur.current ?? t;
      const k = reduced ? 1 : 0.06;
      const next = c.map((x, i) => x + (t[i] - x) * (i === 3 && levelRef ? 0.25 : k)) as typeof c;
      cur.current = next;
      apply(next);
      const settled = next.every((x, i) => Math.abs(x - t[i]) < (i === 3 ? 0.002 : 0.5));
      raf = levelRef && !reduced ? requestAnimationFrame(tick) : settled ? 0 : requestAnimationFrame(tick);
    };
    wake.current = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      wake.current = null;
    };
  }, [levelRef]);

  return <div ref={el} className="ambient" aria-hidden />;
}
