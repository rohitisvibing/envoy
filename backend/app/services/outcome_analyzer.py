"""Outcome analyzer: structured report, with deterministic target-vs-achieved checks."""

import json

from app.models.conversation import NegotiationState
from app.models.mission import MissionSpec
from app.models.report import OutcomeReport, ReportDraft, TargetComparison
from app.models.transcript import TranscriptEvent
from app.providers.llm.base import LLMProvider, Message

from . import prompts
from .context_manager import transcript_context


def compare_targets(spec: MissionSpec, achieved: dict[str, float]) -> list[TargetComparison]:
    names = {q.name for q in spec.targets} | {q.name for q in spec.hard_limits}
    rows = []
    for name in sorted(names):
        target = next((q for q in spec.targets if q.name == name), None)
        limit = spec.limit(name)
        ref = target or limit
        value = achieved.get(name)
        met: bool | None = None
        if value is not None and ref is not None:
            direction = ref.direction
            bound = target.value if target else limit.value  # type: ignore[union-attr]
            met = value <= bound if direction == "max" else value >= bound
        rows.append(TargetComparison(
            name=name, label=ref.label if ref else name, unit=ref.unit if ref else "",
            target=target.value if target else None, limit=limit.value if limit else None,
            achieved=value, met=met))
    return rows


async def analyze(llm: LLMProvider, conversation_id: str, spec: MissionSpec,
                  negotiation: NegotiationState, events: list[TranscriptEvent]) -> OutcomeReport:
    user = (
        "MISSION:\n" + spec.model_dump_json(exclude_none=True)
        + "\n\nFINAL TRACKED STATE:\n" + negotiation.model_dump_json()
        + "\n\nFULL TRANSCRIPT:\n" + transcript_context(events, limit=400)
    )
    draft = await llm.complete_json(
        ReportDraft, [Message("system", prompts.OUTCOME), Message("user", user)],
        task="report", role="conversation", temperature=0.1,
    )
    comparisons = compare_targets(spec, draft.achieved_values)
    criteria_met = bool(draft.criteria) and all(c.met for c in draft.criteria)
    numeric_ok = all(c.met is not False for c in comparisons)
    # A target with no agreed value means the numeric objective wasn't achieved.
    numeric_known = all(c.achieved is not None for c in comparisons if c.target is not None)
    achieved = criteria_met and numeric_ok and numeric_known
    if achieved:
        rationale = "All success criteria are met by explicitly agreed terms."
    elif not draft.criteria:
        rationale = "No success criteria could be verified."
    else:
        unmet = [c.criterion for c in draft.criteria if not c.met]
        missing = [c.label for c in comparisons if c.target is not None and c.achieved is None]
        bits = []
        if unmet:
            bits.append("Unmet: " + "; ".join(unmet))
        if missing:
            bits.append("No agreed value for: " + ", ".join(missing))
        if not numeric_ok:
            bits.append("An agreed value misses its target")
        rationale = ". ".join(bits) or "Criteria not satisfied."
    return OutcomeReport(
        conversation_id=conversation_id,
        objective=spec.objective,
        final_outcome=draft.final_outcome,
        objective_achieved=achieved,
        achievement_rationale=rationale,
        criteria=draft.criteria,
        comparisons=comparisons,
        offers_made=negotiation.offers_made,
        offers_received=negotiation.offers_received,
        agreements=draft.agreements or negotiation.agreements,
        unresolved_issues=draft.unresolved_issues,
        commitments=draft.commitments or negotiation.commitments,
        excerpts=draft.excerpts,
        next_steps=draft.next_steps,
    )


def _dump(o) -> str:
    return json.dumps(o, ensure_ascii=False)
