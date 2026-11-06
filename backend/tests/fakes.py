"""Scripted providers for deterministic engine tests."""

from collections import defaultdict

from app.core.errors import AppError
from app.providers.llm.base import LLMProvider, Message


class ScriptedLLM(LLMProvider):
    """Returns queued objects per task; records every prompt it sees."""

    name = "scripted"

    def __init__(self, script: dict[str, list] | None = None) -> None:
        self.script: dict[str, list] = defaultdict(list, script or {})
        self.calls: list[tuple[str, list[Message]]] = []

    def push(self, task: str, *items) -> None:
        self.script[task].extend(items)

    async def complete_json(self, schema, messages, *, task, role="conversation",
                            temperature=None, max_tokens=None):
        self.calls.append((task, messages))
        if not self.script[task]:
            raise AssertionError(f"no scripted response for {task}")
        item = self.script[task].pop(0)
        if isinstance(item, AppError):
            raise item
        return schema.model_validate(item if isinstance(item, dict) else item.model_dump())

    async def complete_text(self, messages, *, task, role="conversation", temperature=None,
                            max_tokens=None):
        return ""

    def last_prompt(self, task: str) -> str:
        return next(m[-1].content for t, m in reversed(self.calls) if t == task)
