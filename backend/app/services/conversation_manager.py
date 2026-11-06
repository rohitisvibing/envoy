"""Turn planning: one structured LLM call per agent turn, then the deterministic guard.

The LLM returns a TurnPlan (state delta + what to say + flags). The delta is merged into
NegotiationState without a further LLM call. The guard either allows the turn, asks the
model to regenerate once with feedback, or converts it into an approval request.
"""

import logging
from dataclasses import dataclass, field

from app.models.conversation import NegotiationState
from app.models.engine import ApprovalNeed, StateDelta, TurnPlan
from app.models.mission import ApprovalKind, MissionSpec, PreparationBrief
from app.models.principal import Disclosure, PrincipalProfile
from app.models.transcript import EventKind, Speaker, TranscriptEvent
from app.providers.llm.base import LLMProvider, Message

from . import prompts
from .context_manager import turn_context
from .policy_guard import Action, GuardResult, check_turn, counterparty_numbers

log = logging.getLogger(__name__)
MAX_LIST = 12


def _extend_unique(target: list, items: list, limit: int = MAX_LIST) -> None:
    for item in items:
        if item and item not in target:
            target.append(item)
    del target[:-limit]


def merge_delta(state: NegotiationState, delta: StateDelta, turn: int) -> NegotiationState:
    """Apply a model-proposed delta to the tracked negotiation state (pure function)."""
    s = state.model_copy(deep=True)
    if delta.phase:
        s.phase = delta.phase
    _extend_unique(s.established_facts, delta.new_facts)
    _extend_unique(s.counterparty_positions, delta.counterparty_positions)
    _extend_unique(s.objections, delta.objections)
    _extend_unique(s.agreements, delta.agreements)
    for offer in delta.offers_received:
        offer.by, offer.turn = "counterparty", turn
        if not any(o.amount == offer.amount and o.terms == offer.terms for o in s.offers_received):
            s.offers_received.append(offer)
    if delta.remaining_objectives is not None:
        s.remaining_objectives = delta.remaining_objectives[:MAX_LIST]
    if delta.next_action:
        s.next_action = delta.next_action
    if delta.summary:
        s.summary = delta.summary[:600]
    return s


@dataclass
class TurnInputs:
    spec: MissionSpec
    brief: PreparationBrief | None
    profile: PrincipalProfile
    negotiation: NegotiationState
    events: list[TranscriptEvent]
    instructions: list[str]
    approved_disclosures: dict[str, str] = field(default_factory=dict)
    authorised_amounts: set[float] = field(default_factory=set)
    directive: str | None = None
    is_opening: bool = False
    commitment_approved: bool = False


@dataclass
class TurnDecision:
    plan: TurnPlan
    guard: GuardResult
    approval: ApprovalNeed | None = None
    disclosure_key: str | None = None


def _approval_from(plan: TurnPlan, guard: GuardResult, profile: PrincipalProfile,
                   last_counterparty: str) -> tuple[ApprovalNeed | None, str | None]:
    # 1. Approval-gated disclosure the agent asked for.
    for key in plan.wants_disclosure:
        f = profile.field(key)
        if f and f.disclosure == Disclosure.approval and f.value:
            return ApprovalNeed(
                kind=ApprovalKind.info_disclosure, request=last_counterparty or "Asked for "
                + f.label, proposed=f"Share your {f.label.lower()}: {f.value}",
                reason=f"{f.label} is set to 'Ask me' in your profile."), key
    # 2. Guard-detected authority problems take precedence over the model's own framing.
    if guard.action == Action.approval:
        v = next(v for v in guard.violations if v.approval_kind)
        kind = v.approval_kind or ApprovalKind.final_commitment
        if plan.needs_approval and plan.needs_approval.kind == kind:
            return plan.needs_approval, None
        return ApprovalNeed(kind=kind, request=last_counterparty or "(no request)",
                            proposed=plan.response_text, reason=v.detail), None
    # 3. The model itself flagged that it needs authority.
    if plan.needs_approval:
        return plan.needs_approval, None
    return None, None


async def plan_turn(llm: LLMProvider, inputs: TurnInputs) -> TurnDecision:
    cp_texts = [e.text for e in inputs.events
                if e.speaker == Speaker.counterparty and e.kind == EventKind.speech]
    last_cp = cp_texts[-1] if cp_texts else ""
    directive = inputs.directive
    plan: TurnPlan | None = None
    guard: GuardResult | None = None
    for attempt in range(2):
        user = turn_context(
            spec=inputs.spec, brief=inputs.brief, profile=inputs.profile,
            negotiation=inputs.negotiation, events=inputs.events,
            active_instructions=inputs.instructions,
            approved_disclosures=inputs.approved_disclosures, extra_directive=directive)
        plan = await llm.complete_json(
            TurnPlan, [Message("system", prompts.AGENT_TURN), Message("user", user)],
            task="turn", role="conversation")
        guard = check_turn(
            plan, inputs.spec, inputs.profile,
            counterparty_amounts=counterparty_numbers(cp_texts),
            approved_disclosures=set(inputs.approved_disclosures),
            authorised_amounts=inputs.authorised_amounts,
            is_opening=inputs.is_opening,
            final_commitment_preapproved=inputs.commitment_approved)
        if guard.action != Action.regenerate:
            break
        log.info("guard asked for regeneration: %s", guard.feedback())
        directive = ((inputs.directive + "\n") if inputs.directive else "") + (
            "Your previous draft was rejected by the safety check: " + guard.feedback()
            + ". Rewrite it to comply.")
    assert plan is not None and guard is not None
    if guard.action == Action.regenerate:
        # Second draft still unsafe: never speak it. Fall back to a safe deferral.
        plan.response_text = ("I'll need to check that with the person I'm representing "
                              "before I can answer.")
        plan.offers_made, plan.accepts_offer = [], False
        guard = GuardResult(Action.allow, plan=plan)
    approval, key = _approval_from(plan, guard, inputs.profile, last_cp)
    return TurnDecision(plan=plan, guard=guard, approval=approval, disclosure_key=key)
