"""In-memory repository for tests and zero-setup runs."""

from app.models.conversation import Approval, Conversation
from app.models.mission import AgentTemplate, Mission
from app.models.principal import PrincipalProfile
from app.models.report import OutcomeReport
from app.models.transcript import TranscriptEvent

from .base import Repository
from .seed import DEFAULT_TEMPLATES, sample_profile


class MemoryRepository(Repository):
    name = "memory"

    def __init__(self, seed_principal_id: str | None = None) -> None:
        self.profiles: dict[str, PrincipalProfile] = {}
        if seed_principal_id:
            self.profiles[seed_principal_id] = sample_profile(seed_principal_id)
        self.missions: dict[str, Mission] = {}
        self.conversations: dict[str, Conversation] = {}
        self.events: dict[str, list[TranscriptEvent]] = {}
        self.approvals: dict[str, dict[str, Approval]] = {}
        self.reports: dict[str, OutcomeReport] = {}
        self.templates = list(DEFAULT_TEMPLATES)

    async def get_profile(self, principal_id):
        p = self.profiles.get(principal_id)
        return p.model_copy(deep=True) if p else None

    async def save_profile(self, profile):
        self.profiles[profile.id] = profile.model_copy(deep=True)
        return profile

    async def list_templates(self) -> list[AgentTemplate]:
        return self.templates

    async def save_mission(self, mission):
        self.missions[mission.id] = mission.model_copy(deep=True)
        return mission

    async def get_mission(self, mission_id):
        m = self.missions.get(mission_id)
        return m.model_copy(deep=True) if m else None

    async def list_missions(self, principal_id):
        return sorted((m for m in self.missions.values() if m.principal_id == principal_id),
                      key=lambda m: m.updated_at, reverse=True)

    async def delete_mission(self, mission_id):
        self.missions.pop(mission_id, None)

    async def save_conversation(self, conv):
        self.conversations[conv.id] = conv.model_copy(deep=True)
        return conv

    async def get_conversation(self, conversation_id):
        c = self.conversations.get(conversation_id)
        return c.model_copy(deep=True) if c else None

    async def list_conversations(self, mission_ids):
        ids = set(mission_ids)
        return [c for c in self.conversations.values() if c.mission_id in ids]

    async def add_event(self, event):
        self.events.setdefault(event.conversation_id, []).append(event)

    async def update_event_meta(self, event_id, meta):
        for events in self.events.values():
            for e in events:
                if e.id == event_id:
                    e.meta = dict(meta)
                    return

    async def list_events(self, conversation_id):
        return list(self.events.get(conversation_id, []))

    async def save_approval(self, approval):
        self.approvals.setdefault(approval.conversation_id, {})[approval.id] = approval

    async def list_approvals(self, conversation_id):
        return list(self.approvals.get(conversation_id, {}).values())

    async def save_report(self, report):
        self.reports[report.conversation_id] = report

    async def get_report(self, conversation_id):
        return self.reports.get(conversation_id)
