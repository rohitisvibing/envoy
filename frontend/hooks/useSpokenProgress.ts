"use client";

import type { TranscriptEvent } from "@/types/api";

/** Server-side pacing for text-only lines (see backend LiveSession._play). */
export function readingSeconds(text: string): number {
  return Math.min(6, Math.max(1.2, text.length * 0.045));
}

export type ProgressFn = () => number;

/**
 * Build a 0..1 "how much of this line has been said" function for a live transcript line.
 *
 * Voiced lines follow the actual audio playback. If no audio shows up shortly (speech
 * failed, or text-only mode), the line reveals at the same reading pace the server waits for.
 * Interrupted lines freeze where they were cut off.
 */
export function makeProgress(
  event: TranscriptEvent,
  timing: { arrived: Map<string, number>; interrupted: Map<string, number> },
  audioProgress: (id: string, len: number) => number | null,
): ProgressFn | null {
  const arrived = timing.arrived.get(event.id);
  if (arrived == null) return null; // historical line (from a snapshot): show in full
  const len = event.text.length;
  const readPace = (from: number) => {
    const cut = timing.interrupted.get(event.id);
    const now = cut ?? performance.now();
    return Math.min(1, Math.max(0, (now - from) / 1000 / readingSeconds(event.text)));
  };
  if (event.source !== "voice") return () => readPace(arrived);
  const GRACE_MS = 1500;
  return () => {
    const p = audioProgress(event.id, len);
    if (p != null) return p;
    if (event.meta?.interrupted) return 0;
    if (performance.now() - arrived < GRACE_MS) return 0;
    return readPace(arrived + GRACE_MS);
  };
}
