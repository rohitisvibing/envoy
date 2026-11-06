"""Objective engine: natural-language request -> validated MissionSpec."""

import json

from app.models.mission import (
    ApprovalKind,
    ApprovalRequirement,
    ExtractionResult,
    ExtractRequest,
    MissionSpec,
)
from app.models.principal import PrincipalProfile
from app.providers.llm.base import LLMProvider, Message

from . import prompts
from .context_manager import profile_context


def _post_validate(result: ExtractionResult, req: ExtractRequest | None = None) -> ExtractionResult:
    """Deterministic checks the model can't be trusted with."""
    spec = result.spec
    if req:
        if req.counterparty_type:
            spec.counterparty.type = req.counterparty_type
        if req.languages:
            spec.communication.languages = req.languages
        if req.tone:
            spec.communication.tone = req.tone

    # A target that sits on the wrong side of its own hard limit is a conflict.
    for t in spec.targets:
        lim = spec.limit(t.name)
        if lim and ((lim.direction == "max" and t.value > lim.value)
                    or (lim.direction == "min" and t.value < lim.value)):
            msg = (f"{t.label} target ({t.value:g}) is beyond the {lim.direction} limit "
                   f"({lim.value:g}).")
            if msg not in result.conflicts:
                result.conflicts.append(msg)

    # Final commitments always need the principal.
    if not any(a.kind == ApprovalKind.final_commitment for a in spec.approval_requirements):
        spec.approval_requirements.append(ApprovalRequirement(
            kind=ApprovalKind.final_commitment,
            condition="Before accepting any final deal or binding agreement"))

    # Without a hard limit, the agent has no negotiating authority beyond the target.
    if spec.targets and not spec.hard_limits:
        note = "No hard limit given; the agent will ask before conceding past the target."
        if note not in result.missing_information:
            result.missing_information.append(note)
        if not any(a.kind == ApprovalKind.negotiation_authority
                   for a in spec.approval_requirements):
            spec.approval_requirements.append(ApprovalRequirement(
                kind=ApprovalKind.negotiation_authority,
                condition="Before offering anything worse than the target"))
    result.clarifying_questions = result.clarifying_questions[:4]
    return result


async def extract(llm: LLMProvider, req: ExtractRequest, profile: PrincipalProfile
                  ) -> ExtractionResult:
    hints = {k: v for k, v in {
        "counterparty_type": req.counterparty_type,
        "languages": req.languages,
        "tone": req.tone,
    }.items() if v}
    user = (
        "PRINCIPAL REQUEST:\n" + req.text
        + ("\n\nEXPLICIT SETTINGS FROM THE PRINCIPAL:\n" + json.dumps(hints, ensure_ascii=False)
           if hints else "")
        + "\n\nPRINCIPAL PROFILE (for context only, do not copy into the mission):\n"
        + json.dumps(profile_context(profile), ensure_ascii=False)
    )
    result = await llm.complete_json(
        ExtractionResult,
        [Message("system", prompts.EXTRACTION), Message("user", user)],
        task="extract", role="extraction", temperature=0.1,
    )
    return _post_validate(result, req)


async def refine(llm: LLMProvider, spec: MissionSpec, raw_input: str,
                 answers: dict[str, str]) -> ExtractionResult:
    user = (
        "ORIGINAL REQUEST:\n" + raw_input
        + "\n\nCURRENT SPEC:\n" + spec.model_dump_json()
        + "\n\nANSWERS:\n" + "\n".join(f"Q: {q}\nA: {a}" for q, a in answers.items())
    )
    result = await llm.complete_json(
        ExtractionResult,
        [Message("system", prompts.EXTRACTION + "\n\n" + prompts.REFINE), Message("user", user)],
        task="refine", role="extraction", temperature=0.1,
    )
    return _post_validate(result)
