// Hand-mirrored from backend/app/models. Keep in sync with the Pydantic schemas.

export type Disclosure = "always" | "relevant" | "approval" | "never";

export interface ProfileField {
  id: string;
  key: string;
  label: string;
  value: string | null;
  disclosure: Disclosure;
  is_custom: boolean;
}

export interface PrincipalProfile {
  id: string;
  preferred_languages: string[];
  communication_preferences: string | null;
  background: string | null;
  fields: ProfileField[];
}

export type ApprovalKind =
  | "info_disclosure"
  | "negotiation_authority"
  | "financial"
  | "final_commitment";

export interface Quantity {
  name: string;
  label: string;
  value: number;
  unit: string;
  direction: "max" | "min";
}

export interface MissionSpec {
  title: string;
  objective: string;
  desired_outcome: string;
  targets: Quantity[];
  hard_limits: Quantity[];
  minimum_requirements: string[];
  context: string[];
  counterparty: { type: string; name: string | null; preferred_language: string | null; notes: string | null };
  communication: {
    languages: string[];
    tone: string;
    personality: string | null;
    agent_name?: string | null;
    announce_ai?: boolean;
  };
  strategy: string[];
  constraints: string[];
  approval_requirements: { kind: ApprovalKind; condition: string }[];
  success_criteria: string[];
}

export interface ExtractionResult {
  spec: MissionSpec;
  missing_information: string[];
  ambiguities: string[];
  conflicts: string[];
  clarifying_questions: string[];
}

export interface PreparationBrief {
  opening_statement: string;
  opening_language: string;
  strategy_steps: string[];
  anticipated_objections: { objection: string; response: string }[];
  approval_triggers: string[];
  disclosure_plan: string[];
  walk_away_conditions: string[];
}

export type MissionStatus = "draft" | "approved" | "prepared" | "active" | "completed" | "failed";

export interface Mission {
  id: string;
  principal_id: string;
  status: MissionStatus;
  raw_input: string;
  agent_type: string;
  spec: MissionSpec;
  extraction: ExtractionResult | null;
  brief: PreparationBrief | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ConversationState =
  | "idle"
  | "preparing"
  | "ready"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface MissionSummary {
  id: string;
  title: string;
  objective: string;
  status: MissionStatus;
  agent_type: string;
  last_activity: string;
  conversation_id: string | null;
  conversation_state: ConversationState | null;
  objective_met: boolean | null;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  prompt_example: string;
}

export interface Offer {
  by: string;
  amount: number | null;
  quantity_name: string | null;
  terms: string;
  turn: number;
}

export interface NegotiationState {
  phase: string;
  established_facts: string[];
  counterparty_positions: string[];
  objections: string[];
  offers_received: Offer[];
  offers_made: Offer[];
  agreements: string[];
  commitments: string[];
  remaining_objectives: string[];
  next_action: string | null;
  approval_required: boolean;
  objective_met: boolean;
  summary: string;
}

export type ConversationMode = "simulated" | "live";

export interface Conversation {
  id: string;
  mission_id: string;
  mode: ConversationMode;
  state: ConversationState;
  negotiation: NegotiationState;
  voice_enabled: boolean;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export type Speaker = "agent" | "counterparty" | "user" | "system";
export type EventKind = "speech" | "instruction" | "event" | "approval";

export interface TranscriptEvent {
  id: string;
  conversation_id: string;
  speaker: Speaker;
  kind: EventKind;
  text: string;
  language: string | null;
  is_final: boolean;
  source: string;
  meta: Record<string, unknown>;
  ts: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "alternative";

export interface Approval {
  id: string;
  conversation_id: string;
  kind: ApprovalKind;
  request: string;
  proposed: string;
  reason: string;
  disclosure_key: string | null;
  status: ApprovalStatus;
  alternative_text: string | null;
  created_at: string;
  resolved_at: string | null;
  request_en?: string | null;
  proposed_en?: string | null;
}

export interface ConversationDetail {
  conversation: Conversation;
  mission: Mission;
  events: TranscriptEvent[];
  approvals: Approval[];
}

export interface TargetComparison {
  name: string;
  label: string;
  target: number | null;
  limit: number | null;
  achieved: number | null;
  unit: string;
  met: boolean | null;
}

export interface OutcomeReport {
  conversation_id: string;
  objective: string;
  final_outcome: string;
  objective_achieved: boolean;
  achievement_rationale: string;
  criteria: { criterion: string; met: boolean; evidence: string }[];
  comparisons: TargetComparison[];
  offers_made: Offer[];
  offers_received: Offer[];
  agreements: string[];
  unresolved_issues: string[];
  commitments: string[];
  excerpts: { speaker: string; text: string }[];
  next_steps: string[];
  created_at: string;
}

export interface Health {
  ok: boolean;
  demo_mode: boolean;
  llm: { provider: string; configured: boolean; model: string };
  speech: { provider: string; configured: boolean; tts_model: string; stt_model: string };
  database: { provider: string; configured: boolean };
}

export interface AppErrorPayload {
  kind: string;
  message: string;
  provider?: string | null;
  retryable?: boolean;
  retry_after?: number | null;
  fatal?: boolean;
}
