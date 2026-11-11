"""Text-to-speech provider interface. Output is always mono PCM16 little-endian."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class Voice:
    speaker: str
    language_code: str
    pace: float = 1.0


class TTSProvider(ABC):
    name: str = "tts"
    sample_rate: int = 22050

    @abstractmethod
    def synthesize(self, text: str, voice: Voice) -> AsyncIterator[bytes]:
        """Yield PCM16 chunks. Cancel by closing the iterator / cancelling the task."""

    def supports(self, language_code: str) -> bool:
        return True

    def warm(self) -> None:
        """Optionally prepare a connection so the next line starts sooner."""
