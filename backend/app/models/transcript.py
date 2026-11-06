from datetime import datetime
from enum import StrEnum

from pydantic import Field

from .common import Schema, new_id, utcnow


class Speaker(StrEnum):
    agent = "agent"
    counterparty = "counterparty"
    user = "user"
    system = "system"


class EventKind(StrEnum):
    speech = "speech"
    instruction = "instruction"
    event = "event"
    approval = "approval"


class TranscriptEvent(Schema):
    id: str = Field(default_factory=new_id)
    conversation_id: str
    speaker: Speaker
    kind: EventKind = EventKind.speech
    text: str
    language: str | None = None
    is_final: bool = True
    source: str = Field(default="text", description="text | voice")
    meta: dict = Field(default_factory=dict)
    ts: datetime = Field(default_factory=utcnow)
