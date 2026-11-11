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
        self._last_delta: dict | None = None

    def push(self, task: str, *items) -> None:
        self.script[task].extend(items)

    async def complete_json(self, schema, messages, *, task, role="conversation",
                            temperature=None, max_tokens=None):
        self.calls.append((task, messages))
        if task == "state" and not self.script[task]:
            # Notes run off the critical path; by default replay the scripted turn's delta.
            return schema.model_validate(self._last_delta or {})
        if not self.script[task]:
            raise AssertionError(f"no scripted response for {task}")
        item = self.script[task].pop(0)
        if task == "turn" and not isinstance(item, AppError):
            data = item if isinstance(item, dict) else item.model_dump()
            self._last_delta = data.get("state_delta")
        if isinstance(item, AppError):
            raise item
        return schema.model_validate(item if isinstance(item, dict) else item.model_dump())

    async def complete_text(self, messages, *, task, role="conversation", temperature=None,
                            max_tokens=None):
        return ""

    def last_prompt(self, task: str) -> str:
        # The turn prompt is split into a cached prefix and the part that changes.
        msgs = next(m for t, m in reversed(self.calls) if t == task)
        return "\n\n".join(m.content for m in msgs if m.role == "user")
