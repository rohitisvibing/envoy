"""LLM provider interface. The objective engine depends only on this module."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

Role = Literal["extraction", "conversation", "simulator"]


@dataclass
class Message:
    role: Literal["system", "user", "assistant"]
    content: str

    def as_dict(self) -> dict:
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
