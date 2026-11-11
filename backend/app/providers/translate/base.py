"""Translation provider interface: renders a line in English for the principal."""

from abc import ABC, abstractmethod


class TranslationProvider(ABC):
    name: str = "translate"

    @abstractmethod
    async def to_english(self, text: str, source_language_code: str = "auto") -> str:
        """Return `text` in English. Raises AppError on failure."""
