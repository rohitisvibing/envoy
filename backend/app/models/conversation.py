"""Conversation state machine and the structured negotiation state the engine maintains."""

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from .common import Schema, new_id, utcnow
from .mission import ApprovalKind


class ConversationState(StrEnum):
    idle = "idle"
    preparing = "preparing"
    ready = "ready"
    connecting = "connecting"
    listening = "listening"
    thinking = "thinking"
    speaking = "speaking"
    interrupted = "interrupted"
    paused = "paused"
    awaiting_approval = "awaiting_approval"
    completed = "completed"
    failed = "failed"


S = ConversationState
_LIVE = {S.listening, S.thinking, S.speaking, S.interrupted}

TRANSITIONS: dict[ConversationState, set[ConversationState]] = {
    S.idle: {S.preparing, S.ready, S.failed},
    S.preparing: {S.ready, S.failed},
    S.ready: {S.connecting, S.failed, S.completed},
    S.connecting: {S.speaking, S.thinking, S.listening, S.failed, S.completed},
    S.listening: {S.thinking, S.speaking, S.interrupted, S.paused, S.awaiting_approval,
                  S.completed, S.failed},
    S.thinking: {S.speaking, S.listening, S.paused, S.awaiting_approval, S.completed, S.failed},
    S.speaking: {S.listening, S.thinking, S.interrupted, S.paused, S.awaiting_approval,
                 S.completed, S.failed},
    S.interrupted: {S.listening, S.thinking, S.paused, S.completed, S.failed},
    S.paused: {S.listening, S.thinking, S.speaking, S.awaiting_approval, S.completed, S.failed},
    S.awaiting_approval: {S.thinking, S.speaking, S.listening, S.paused, S.completed, S.failed},
    S.completed: set(),
    S.failed: {S.connecting},
}


class InvalidTransition(Exception):
    pass


def can_transition(src: ConversationState, dst: ConversationState) -> bool:
    return src == dst or dst in TRANSITIONS[src]


def is_live(state: ConversationState) -> bool:
    return state in _LIVE


class ConversationMode(StrEnum):
    simulated = "simulated"   # LLM role-plays the counterparty
    live = "live"             # a real person speaks through the browser microphone


class Offer(Schema):
    by: str = Field(description="agent or counterparty")
    amount: float | None = None
    quantity_name: str | None = Field(default=None, description="Which target/limit it refers to")
    terms: str
    turn: int = 0


class NegotiationState(Schema):
    phase: str = "opening"
    established_facts: list[str] = Field(default_factory=list)
    counterparty_positions: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    offers_received: list[Offer] = Field(default_factory=list)
    offers_made: list[Offer] = Field(default_factory=list)
    agreements: list[str] = Field(default_factory=list)
    commitments: list[str] = Field(default_factory=list)
    remaining_objectives: list[str] = Field(default_factory=list)
    next_action: str | None = None
    approval_required: bool = False
    objective_met: bool = False
    summary: str = ""


class ApprovalStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    alternative = "alternative"


class Approval(Schema):
    id: str = Field(default_factory=new_id)
    conversation_id: str
    kind: ApprovalKind
    request: str = Field(description="What the counterparty asked for / situation")
    proposed: str = Field(description="What the agent proposes to say or commit to")
    reason: str = ""
    disclosure_key: str | None = None
    status: ApprovalStatus = ApprovalStatus.pending
    alternative_text: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    resolved_at: datetime | None = None


class ApprovalDecision(Schema):
    decision: ApprovalStatus
    alternative_text: str | None = None


class Conversation(Schema):
    id: str = Field(default_factory=new_id)
    mission_id: str
    mode: ConversationMode = ConversationMode.simulated
    state: ConversationState = ConversationState.ready
    negotiation: NegotiationState = Field(default_factory=NegotiationState)
    voice_enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = None


class CreateConversation(Schema):
    mission_id: str
    mode: ConversationMode = ConversationMode.simulated
    voice_enabled: bool = True
