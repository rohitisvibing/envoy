from fastapi import APIRouter

from app.core.deps import get_container
from app.core.errors import AppError, ErrorKind
from app.models.common import Schema
from app.models.conversation import Approval, Conversation, ConversationState, CreateConversation
from app.models.mission import Mission, MissionStatus
from app.models.report import OutcomeReport
from app.models.transcript import TranscriptEvent
from app.realtime.session_manager import manager

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class ConversationDetail(Schema):
    conversation: Conversation
    mission: Mission
    events: list[TranscriptEvent]
    approvals: list[Approval]


@router.post("", response_model=Conversation)
async def create(body: CreateConversation) -> Conversation:
    c = get_container()
    m = await c.repo.get_mission(body.mission_id)
    if not m:
        raise AppError(ErrorKind.not_found, "Mission not found.")
    if m.status not in (MissionStatus.prepared, MissionStatus.active, MissionStatus.completed):
        raise AppError(ErrorKind.invalid_state, "Prepare the agent before starting.")
    conv = Conversation(mission_id=m.id, mode=body.mode, state=ConversationState.ready,
                        voice_enabled=body.voice_enabled and c.voice_available)
    return await c.repo.save_conversation(conv)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def detail(conversation_id: str) -> ConversationDetail:
    c = get_container()
    live = manager.peek(conversation_id)
    conv = live.conv if live else await c.repo.get_conversation(conversation_id)
    if not conv:
        raise AppError(ErrorKind.not_found, "Conversation not found.")
    mission = await c.repo.get_mission(conv.mission_id)
    if not mission:
        raise AppError(ErrorKind.not_found, "Mission not found.")
    events = live.events if live else await c.repo.list_events(conversation_id)
    approvals = list(live.approvals.values()) if live else await c.repo.list_approvals(
        conversation_id)
    return ConversationDetail(conversation=conv, mission=mission, events=events,
                              approvals=approvals)


@router.get("/{conversation_id}/report", response_model=OutcomeReport)
async def report(conversation_id: str) -> OutcomeReport:
    c = get_container()
    r = await c.repo.get_report(conversation_id)
    if r:
        return r
    live = manager.peek(conversation_id)
    if live and live.report_task and not live.report_task.done():
        raise AppError(ErrorKind.invalid_state, "The report is still being written.",
                       retryable=True)
    raise AppError(ErrorKind.not_found, "No report yet. End the conversation to create one.")
