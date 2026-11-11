"""Sarvam Translate for live counterparty lines, with an LLM fallback."""

import logging

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ErrorKind, ProviderError, from_http_status, missing_key
from app.providers.languages import guess_code
from app.providers.llm.base import LLMProvider, Message

from .base import TranslationProvider

log = logging.getLogger(__name__)
MAX_CHARS = 1000


class SarvamTranslator(TranslationProvider):
    name = "sarvam"

    def __init__(self, settings: Settings, fallback: LLMProvider | None = None) -> None:
        self.s = settings
        self.fallback = fallback
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.s.sarvam_base_url, timeout=8)
        return self._client

    async def to_english(self, text: str, source_language_code: str = "auto") -> str:
        source = source_language_code
        if not source or source == "auto" or source == "en-IN":
            # Auto-detection fails on short or code-mixed lines; the script is a safer guide.
            source = guess_code(text) or "auto"
        try:
            return await self._sarvam(text, source)
        except AppError as e:
            if self.fallback is None or self.fallback.is_demo:
                raise
            log.warning("Sarvam translate failed (%s); using the LLM", e.message)
            out = await self.fallback.complete_text(
                [Message("system", "Translate the user's text into natural English. Output "
                                   "only the translation."),
                 Message("user", text)],
                task="translate", role="live", temperature=0, max_tokens=400)
            return out.strip()

    async def _sarvam(self, text: str, source: str) -> str:
        if not self.s.sarvam_api_key:
            raise missing_key("Sarvam", "SARVAM_API_KEY")
        body = {"input": text[:MAX_CHARS], "source_language_code": source or "auto",
                "target_language_code": "en-IN", "model": self.s.sarvam_translate_model}
        try:
            r = await self._http().post("/translate", json=body,
                                        headers={"api-subscription-key": self.s.sarvam_api_key})
        except httpx.HTTPError as e:
            raise ProviderError(ErrorKind.upstream, "Could not reach Sarvam Translate.",
                                provider="Sarvam", retryable=True) from e
        if r.status_code >= 400:
            raise from_http_status("Sarvam", r.status_code, r.text)
        out = (r.json().get("translated_text") or "").strip()
        if not out:
            raise ProviderError(ErrorKind.upstream, "Sarvam returned no translation.",
                                provider="Sarvam")
        return out
