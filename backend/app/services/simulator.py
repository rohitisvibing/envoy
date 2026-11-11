"""Simulated counterparty for practice runs before real telephony exists.

The simulator never sees the agent's mission limits; only the role, public context and
the transcript.
"""

import json

from app.models.engine import SimulatorPersona, SimulatorTurn
from app.models.mission import MissionSpec
from app.models.transcript import TranscriptEvent
from app.providers.llm.base import LLMProvider, Message

from . import prompts
from .context_manager import transcript_context


def _public_brief(spec: MissionSpec) -> dict:
    return {
        "your_role": spec.counterparty.type,
        "your_name": spec.counterparty.name,
        "preferred_language": spec.counterparty.preferred_language,
        "situation_from_their_side": spec.context,
        "what_the_caller_wants": spec.objective,
        "languages_in_play": spec.communication.languages,
    }


async def create_persona(llm: LLMProvider, spec: MissionSpec) -> SimulatorPersona:
    return await llm.complete_json(
        SimulatorPersona,
        [Message("system", prompts.SIMULATOR_PERSONA),
         Message("user", json.dumps(_public_brief(spec), ensure_ascii=False))],
        task="persona", role="simulator", temperature=0.8,
    )


async def next_turn(llm: LLMProvider, persona: SimulatorPersona,
                    events: list[TranscriptEvent]) -> SimulatorTurn:
    transcript = transcript_context(events).replace("AGENT", "CALLER (AI agent)") \
        .replace("COUNTERPARTY", "YOU")
    return await llm.complete_json(
        SimulatorTurn,
        [Message("system", prompts.SIMULATOR_TURN),
         Message("user", "YOUR CHARACTER:\n" + persona.model_dump_json()
                 + "\n\nCONVERSATION SO FAR:\n" + transcript + "\n\nYour next reply.")],
        task="simulate", role="simulator", temperature=0.7, max_tokens=900,
    )
