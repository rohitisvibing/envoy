import type { ApprovalKind, ConversationState, Disclosure, MissionStatus, Quantity } from "@/types/api";

export function money(value: number | null | undefined, unit = "INR"): string {
  if (value == null) return "—";
  if (unit === "INR" || unit === "₹") return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${value.toLocaleString("en-IN")} ${unit}`;
}

export function quantity(q: Quantity): string {
  return money(q.value, q.unit);
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  const days = Math.round(diff / 86400);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export const STATE_LABEL: Record<ConversationState, string> = {
  idle: "Idle",
  preparing: "Preparing",
  ready: "Ready to start",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  interrupted: "Interrupted",
  paused: "Paused",
  awaiting_approval: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  prepared: "Ready",
  active: "Live",
  completed: "Completed",
  failed: "Failed",
};

export const DISCLOSURE_LABEL: Record<Disclosure, string> = {
  always: "Always",
  relevant: "When relevant",
  approval: "Ask me",
  never: "Never",
};

export const APPROVAL_LABEL: Record<ApprovalKind, string> = {
  info_disclosure: "Share personal information",
  negotiation_authority: "Go beyond the agreed range",
  financial: "Financial commitment",
  final_commitment: "Accept final terms",
};
