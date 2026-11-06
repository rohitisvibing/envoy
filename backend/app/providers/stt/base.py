"""Speech-to-text provider interface (streaming + one-shot)."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

EventType = Literal["speech_start", "speech_end", "partial", "final", "error"]


@dataclass
class STTEvent:
    type: EventType
    text: str = ""
    language_code: str | None = None
    utterance: int | None = None
    error: str | None = None
    fatal: bool = False


class STTStream(ABC):
    @abstractmethod
    async def send_pcm(self, pcm16: bytes) -> None:
        """Send mono PCM16 @16 kHz."""

    @abstractmethod
    def events(self) -> AsyncIterator[STTEvent]: ...

    @abstractmethod
    async def close(self) -> None: ...


class STTProvider(ABC):
    name: str = "stt"
    sample_rate: int = 16000

    @abstractmethod
    async def open_stream(self, language_code: str = "auto") -> STTStream: ...

    @abstractmethod
    async def transcribe(self, audio: bytes, filename: str = "audio.wav",
                         language_code: str = "unknown") -> STTEvent: ...
