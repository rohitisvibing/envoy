"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { ConversationState, MissionStatus } from "@/types/api";

const STATE_TO_ORB: Record<ConversationState, { state: OrbState; paused?: boolean; color?: string }> = {
  idle: { state: "breathing", paused: true },
  ready: { state: "breathing" },
  preparing: { state: "connecting", color: "#8b7cff" },
  connecting: { state: "connecting", color: "#8b7cff" },
  listening: { state: "listening", color: "#b0c4ff" },
  thinking: { state: "working", color: "#8b7cff" },
  speaking: { state: "composing", color: "#8b7cff" },
  interrupted: { state: "listening", color: "#b0c4ff" },
  paused: { state: "breathing", paused: true },
  awaiting_approval: { state: "breathing", color: "#e9ad55" },
  completed: { state: "solving", paused: true, color: "#32c98a" },
  failed: { state: "breathing", paused: true, color: "#f06b70" },
};

/** Small animated glyph for lists and transcript rows (thinking-orbs, MIT). */
export function StatusGlyph({
  state,
  size = 20,
  label,
}: {
  state: ConversationState;
  size?: 20 | 32 | 64;
  label?: string;
}) {
  const cfg = STATE_TO_ORB[state];
  return (
    <ThinkingOrb
      state={cfg.state}
      size={size}
      theme="dark"
      paused={cfg.paused}
      color={cfg.color}
      aria-label={label ?? state.replace("_", " ")}
    />
  );
}

export function missionGlyphState(status: MissionStatus, conv: ConversationState | null): ConversationState {
  if (status === "active" && conv) return conv === "ready" ? "paused" : conv;
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "prepared") return "ready";
  return "idle";
}
