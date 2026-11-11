"""Builds compact, disclosure-filtered context for each LLM call.

Never-share fields are excluded entirely. Approval-gated fields are listed by name only,
until the principal approves a disclosure, which applies to a single turn.
"""

import json

from app.models.conversation import NegotiationState
from app.models.mission import MissionSpec, PreparationBrief
from app.models.principal import Disclosure, PrincipalProfile
from app.models.transcript import EventKind, Speaker, TranscriptEvent

HISTORY_TURNS = 14


def profile_context(profile: PrincipalProfile, approved: dict[str, str] | None = None) -> dict:
    approved = approved or {}
    share_always: dict[str, str] = {}
    share_relevant: dict[str, str] = {}
    gated: list[str] = []
    for f in profile.fields:
        if f.disclosure == Disclosure.never:
            continue
        if f.key in approved:
            share_always[f.label] = approved[f.key]
            continue
        if not f.value:
            continue
        if f.disclosure == Disclosure.always:
            share_always[f.label] = f.value
        elif f.disclosure == Disclosure.relevant:
            share_relevant[f.label] = f.value
        elif f.disclosure == Disclosure.approval:
            gated.append(f"{f.key} ({f.label})")
    ctx: dict = {
        "may_share": share_always,
        "share_only_if_directly_relevant": share_relevant,
        "requires_principal_approval_before_sharing": gated,
        "preferred_languages": profile.preferred_languages,
    }
    if profile.communication_preferences:
        ctx["communication_preferences"] = profile.communication_preferences
    if profile.background:
        ctx["background"] = profile.background
    return ctx


def mission_context(spec: MissionSpec) -> dict:
    return spec.model_dump(mode="json", exclude_none=True)


def _line(e: TranscriptEvent) -> str | None:
    if e.kind == EventKind.speech:
        who = {Speaker.agent: "AGENT", Speaker.counterparty: "COUNTERPARTY",
               Speaker.user: "PRINCIPAL (speaking directly)"}.get(e.speaker, e.speaker.upper())
        lang = f" [{e.language}]" if e.language else ""
        return f"{who}{lang}: {e.text}"
    if e.kind == EventKind.instruction:
        return f"(principal instruction to agent: {e.text})"
    if e.kind == EventKind.approval:
        return f"(approval: {e.text})"
    return None


def transcript_context(events: list[TranscriptEvent], limit: int = HISTORY_TURNS) -> str:
    lines = [ln for e in events if e.is_final and (ln := _line(e))]
    return "\n".join(lines[-limit:]) or "(nothing said yet)"


def principal_instructions(events: list[TranscriptEvent], since_index: int = 0) -> list[str]:
    return [e.text for e in events[since_index:]
            if e.kind == EventKind.instruction and e.speaker == Speaker.user]


def turn_context_parts(
    *,
    spec: MissionSpec,
    brief: PreparationBrief | None,
    profile: PrincipalProfile,
    negotiation: NegotiationState,
    events: list[TranscriptEvent],
    new_instructions: list[str],
    standing_instructions: list[str],
    approved_disclosures: dict[str, str] | None = None,
    extra_directive: str | None = None,
) -> tuple[str, str]:
    """The user message for one agent turn, as (stable prefix, what changes each turn).

    The prefix (mission, profile, strategy) is identical across turns, so providers can cache
    it; the rest is small.
    """
    static = [
        "MISSION:\n" + json.dumps(mission_context(spec), ensure_ascii=False),
        "PRINCIPAL PROFILE (disclosure-filtered):\n"
        + json.dumps(profile_context(profile, approved_disclosures), ensure_ascii=False),
    ]
    if brief:
        static.append("PREPARED STRATEGY:\n" + json.dumps(
            {"steps": brief.strategy_steps,
             "objections": [o.model_dump() for o in brief.anticipated_objections],
             "walk_away": brief.walk_away_conditions}, ensure_ascii=False))
    parts = ["CURRENT NEGOTIATION STATE:\n"
             + negotiation.model_dump_json(exclude={"approval_required"})]
    if standing_instructions:
        parts.append("STANDING PRINCIPAL INSTRUCTIONS (keep following these, most recent last):\n- "
                     + "\n- ".join(standing_instructions))
    if new_instructions:
        parts.append("NEW FROM THE PRINCIPAL SINCE YOUR LAST LINE (highest priority, act on "
                     "these now):\n- " + "\n- ".join(new_instructions))
    parts.append("RECENT TRANSCRIPT:\n" + transcript_context(events))
    if extra_directive:
        parts.append("DIRECTIVE FOR THIS TURN:\n" + extra_directive)
    parts.append("Produce your next line.")
    return "\n\n".join(static), "\n\n".join(parts)


def turn_context(**kw) -> str:
    """The whole turn context as one string (kept for callers and tests)."""
    static, dynamic = turn_context_parts(**kw)
    return static + "\n\n" + dynamic


def state_context(spec: MissionSpec, negotiation: NegotiationState,
                  events: list[TranscriptEvent]) -> str:
    """What the note-keeper needs: the quantities in play, current notes, latest exchange."""
    quantities = {"targets": [q.model_dump(mode="json") for q in spec.targets],
                  "hard_limits": [q.model_dump(mode="json") for q in spec.hard_limits]}
    return "\n\n".join([
        "MISSION:\n" + json.dumps({"objective": spec.objective, **quantities},
                                  ensure_ascii=False),
        "CURRENT NEGOTIATION STATE:\n"
        + negotiation.model_dump_json(exclude={"approval_required"}),
        "RECENT TRANSCRIPT:\n" + transcript_context(events, limit=6),
        "Return the StateDelta for the latest exchange.",
    ])
