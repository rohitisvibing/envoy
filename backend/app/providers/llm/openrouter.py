"""OpenRouter LLM provider over its OpenAI-compatible chat completions API (server-side only)."""

import asyncio
import json
import logging
import re

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import ErrorKind, ProviderError, from_http_status, missing_key

from .base import LLMProvider, Message, Role, T

log = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
RETRY_STATUSES = {429, 500, 502, 503, 504}
LIVE_TASKS = {"turn", "simulate", "persona"}


def _parse_json(raw: str) -> dict:
    text = _FENCE.sub("", raw.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(text[start : end + 1])


class OpenRouterProvider(LLMProvider):
    name = "openrouter"

    def __init__(self, settings: Settings, max_retries: int = 2) -> None:
        self.settings = settings
        self.max_retries = max_retries
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if not self.settings.openrouter_api_key:
            raise missing_key("OpenRouter", "OPENROUTER_API_KEY")
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.settings.openrouter_base_url,
                timeout=self.settings.llm_timeout_s,
                headers={"Authorization": f"Bearer {self.settings.openrouter_api_key}",
                         "X-Title": "Envoy Voice Agents"},
            )
        return self._client

    async def _chat(self, messages: list[dict], *, role: Role, temperature, max_tokens,
                    response_format: dict | None, timeout: float | None = None) -> str:
        body: dict = {
            "model": self.settings.model_for(role),
            "messages": messages,
            "temperature": self.settings.llm_temperature if temperature is None else temperature,
            "max_tokens": max_tokens or self.settings.llm_max_tokens,
        }
        if response_format:
            body["response_format"] = response_format
        client = self._http()
        for attempt in range(self.max_retries + 1):
            try:
                r = await client.post("/chat/completions", json=body,
                                      timeout=timeout or self.settings.llm_timeout_s)
            except httpx.HTTPError as e:
                if attempt < self.max_retries:
                    log.warning("OpenRouter %s (attempt %d); retrying", type(e).__name__,
                                attempt + 1)
                    await asyncio.sleep(0.3 * 2**attempt)
                    continue
                raise ProviderError(ErrorKind.upstream, "Could not reach OpenRouter.",
                                    provider="OpenRouter", retryable=True) from e
            if r.status_code in RETRY_STATUSES and attempt < self.max_retries:
                wait = float(r.headers.get("retry-after") or 0.6 * 2**attempt)
                log.warning("OpenRouter %s (attempt %d); retrying in %.1fs", r.status_code,
                            attempt + 1, wait)
                await asyncio.sleep(wait)
                continue
            if r.status_code >= 400:
                ra = r.headers.get("retry-after")
                raise from_http_status("OpenRouter", r.status_code, r.text,
                                       float(ra) if ra else None)
            data = r.json()
            if "error" in data and not data.get("choices"):
                err = data["error"]
                raise from_http_status("OpenRouter", int(err.get("code") or 502),
                                       str(err.get("message", "")))
            choices = data.get("choices") or []
            if not choices:
                raise ProviderError(ErrorKind.upstream, "OpenRouter returned no choices.",
                                    provider="OpenRouter", retryable=True)
            return choices[0].get("message", {}).get("content") or ""
        raise ProviderError(ErrorKind.upstream, "OpenRouter request failed.",
                            provider="OpenRouter", retryable=True)

    async def complete_json(self, schema: type[T], messages: list[Message], *, task: str,
                            role: Role = "conversation", temperature=None, max_tokens=None) -> T:
        json_schema = schema.model_json_schema()
        msgs = [m.as_dict() for m in messages]
        msgs.append({
            "role": "system",
            "content": "Respond with a single JSON object matching this JSON Schema. "
                       "No prose, no markdown.\n" + json.dumps(json_schema),
        })
        fmt: dict = {"type": "json_schema",
                     "json_schema": {"name": schema.__name__, "schema": json_schema,
                                     "strict": False}}
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                raw = await self._chat(
                    msgs, role=role, temperature=temperature, max_tokens=max_tokens,
                    response_format=fmt,
                    timeout=self.settings.llm_timeout_live_s if task in LIVE_TASKS else None)
            except ProviderError as e:
                # Some models reject json_schema; fall back to json_object once.
                if fmt["type"] == "json_schema" and e.kind == ErrorKind.upstream \
                        and not e.retryable:
                    fmt = {"type": "json_object"}
                    continue
                raise
            try:
                return schema.model_validate(_parse_json(raw))
            except (ValueError, ValidationError) as e:
                last_err = e
                log.warning("LLM %s returned invalid JSON (attempt %d): %s", task, attempt + 1, e)
                if attempt >= 1:
                    break
                msgs.append({"role": "assistant", "content": raw[:4000]})
                msgs.append({"role": "user", "content":
                             f"That output was invalid: {str(e)[:800]}. Return corrected JSON only."})
        raise ProviderError(ErrorKind.invalid_output,
                            f"The model returned an invalid {schema.__name__} for {task}.",
                            provider="OpenRouter", retryable=True) from last_err

    async def complete_text(self, messages: list[Message], *, task: str,
                            role: Role = "conversation", temperature=None, max_tokens=None) -> str:
        return (await self._chat([m.as_dict() for m in messages], role=role,
                                 temperature=temperature, max_tokens=max_tokens,
                                 response_format=None)).strip()
