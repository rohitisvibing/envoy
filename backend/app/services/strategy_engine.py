"""Strategy engine: prepares opening, tactics, objections and approval triggers."""

import json

from app.models.mission import MissionSpec, PreparationBrief
from app.models.principal import PrincipalProfile
from app.providers.llm.base import LLMProvider, Message

from . import prompts
from .context_manager import mission_context, profile_context
from .policy_guard import _AI_DISCLOSURE


async def prepare(llm: LLMProvider, spec: MissionSpec, profile: PrincipalProfile
                  ) -> PreparationBrief:
    user = (
        "MISSION:\n" + json.dumps(mission_context(spec), ensure_ascii=False)
        + "\n\nPRINCIPAL PROFILE (disclosure-filtered):\n"
        + json.dumps(profile_context(profile), ensure_ascii=False)
        + f"\n\nShareable principal name: {profile.display_name()}"
    )
    brief = await llm.complete_json(
        PreparationBrief, [Message("system", prompts.STRATEGY), Message("user", user)],
        task="prepare", role="conversation", temperature=0.3,
    )
    if not _AI_DISCLOSURE.search(brief.opening_statement):
        brief.opening_statement = (
            f"Hello, I'm an AI assistant calling on behalf of {profile.display_name()}. "
            + brief.opening_statement)
    return brief
