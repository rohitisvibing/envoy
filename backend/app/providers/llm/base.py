"""LLM provider interface. The objective engine depends only on this module."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

Role = Literal["extraction", "conversation", "simulator", "live"]


@dataclass
class Message:
    role: Literal["system", "user", "assistant"]
    content: str
    # Stable prefix: providers that support prompt caching may cache everything up to and
    # including this message.
    cache: bool = False

    def as_dict(self, *, cache_control: bool = False) -> dict:
        if self.cache and cache_control:
            return {"role": self.role, "content": [
                {"type": "text", "text": self.content, "cache_control": {"type": "ephemeral"}}]}
        return {"role": self.role, "content": self.content}


class LLMProvider(ABC):
    name: str = "llm"
    is_demo: bool = False

    @abstractmethod
    async def complete_json(
        self,
        schema: type[T],
        messages: list[Message],
        *,
        task: str,
        role: Role = "conversation",
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> T:
        """Return a validated instance of `schema`. `task` names the call site (for logs/demo)."""

    @abstractmethod
    async def complete_text(
        self,
        messages: list[Message],
        *,
        task: str,
        role: Role = "conversation",
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str: ...
