"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { ConversationState, MissionStatus } from "@/types/api";

const STATE_TO_ORB: Record<ConversationState, { state: OrbState; paused?: boolean; color?: string }> = {
  idle: { state: "breathing", paused: true },
  ready: { state: "breathing" },
  preparing: { state: "connecting", color: "#9db0ff" },
  connecting: { state: "connecting", color: "#9db0ff" },
  listening: { state: "listening", color: "#f3a88a" },
  thinking: { state: "working", color: "#9db0ff" },
  speaking: { state: "composing", color: "#9db0ff" },
  interrupted: { state: "listening", color: "#f3a88a" },
  paused: { state: "breathing", paused: true },
  awaiting_approval: { state: "breathing", color: "#f2c25a" },
  completed: { state: "solving", paused: true, color: "#7ed7ae" },
  failed: { state: "breathing", paused: true, color: "#f07c86" },
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
