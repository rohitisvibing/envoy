"""Registry of live sessions, keyed by conversation id (one per conversation)."""

import asyncio

from app.core.deps import Container
from app.core.errors import AppError, ErrorKind
from app.models.conversation import ConversationState
from app.models.principal import PrincipalProfile

from .session import LiveSession

_LIVE_STATES = {ConversationState.listening, ConversationState.thinking,
                ConversationState.speaking, ConversationState.interrupted,
                ConversationState.connecting}


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, LiveSession] = {}
        self._lock = asyncio.Lock()

    async def get(self, c: Container, conversation_id: str) -> LiveSession:
        async with self._lock:
            if conversation_id in self.sessions:
                return self.sessions[conversation_id]
            conv = await c.repo.get_conversation(conversation_id)
            if not conv:
                raise AppError(ErrorKind.not_found, "Conversation not found.")
            mission = await c.repo.get_mission(conv.mission_id)
            if not mission:
                raise AppError(ErrorKind.not_found, "Mission not found.")
            profile = await c.repo.get_profile(mission.principal_id) \
                or PrincipalProfile.blank(mission.principal_id)
            events = await c.repo.list_events(conv.id)
            approvals = await c.repo.list_approvals(conv.id)
            if conv.state in _LIVE_STATES:
                # The process restarted mid-conversation: hold until the principal resumes.
                conv.state = ConversationState.paused
            session = LiveSession(c, conv, mission, profile, events, approvals)
            self.sessions[conversation_id] = session
            return session

    def peek(self, conversation_id: str) -> LiveSession | None:
        return self.sessions.get(conversation_id)

    async def shutdown(self) -> None:
        for s in list(self.sessions.values()):
            await s.shutdown()
        self.sessions.clear()


manager = SessionManager()
