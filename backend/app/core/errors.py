"""Typed provider/application errors that map to consistent HTTP and WebSocket payloads."""

from enum import StrEnum


class ErrorKind(StrEnum):
    missing_key = "missing_key"
    rate_limited = "rate_limited"
    quota_exhausted = "quota_exhausted"
    auth_failed = "auth_failed"
    upstream = "upstream"
    invalid_output = "invalid_output"
    unsupported_language = "unsupported_language"
    speech_failed = "speech_failed"
    not_found = "not_found"
    invalid_state = "invalid_state"


HTTP_STATUS = {
    ErrorKind.missing_key: 503,
    ErrorKind.rate_limited: 429,
    ErrorKind.quota_exhausted: 402,
    ErrorKind.auth_failed: 502,
    ErrorKind.upstream: 502,
    ErrorKind.invalid_output: 502,
    ErrorKind.unsupported_language: 422,
    ErrorKind.speech_failed: 502,
    ErrorKind.not_found: 404,
    ErrorKind.invalid_state: 409,
}


class AppError(Exception):
    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        *,
        provider: str | None = None,
        retryable: bool = False,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.provider = provider
        self.retryable = retryable
        self.retry_after = retry_after

    @property
    def status_code(self) -> int:
        return HTTP_STATUS.get(self.kind, 500)

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "message": self.message,
            "provider": self.provider,
            "retryable": self.retryable,
            "retry_after": self.retry_after,
        }


class ProviderError(AppError):
    """Raised by STT/TTS/LLM providers."""


def missing_key(provider: str, env_var: str) -> ProviderError:
    return ProviderError(
        ErrorKind.missing_key,
        f"{provider} is not configured. Set {env_var} in .env and restart the backend.",
        provider=provider,
    )


def from_http_status(provider: str, status: int, body: str = "", retry_after: float | None = None
                     ) -> ProviderError:
    snippet = body[:300]
    if status == 429:
        if "seat_budget" in body or "quota" in body:
            return ProviderError(ErrorKind.quota_exhausted,
                                 f"{provider} quota exhausted. Top up credits.", provider=provider)
        return ProviderError(ErrorKind.rate_limited, f"{provider} rate limit hit. Retry shortly.",
                             provider=provider, retryable=True, retry_after=retry_after or 2.0)
    if status == 402:
        return ProviderError(ErrorKind.quota_exhausted,
                             f"{provider} has no credits left. Top up and retry.", provider=provider)
    if status in (401, 403):
        return ProviderError(ErrorKind.auth_failed,
                             f"{provider} rejected the API key. Check it in .env.", provider=provider)
    if status >= 500:
        return ProviderError(ErrorKind.upstream, f"{provider} is unavailable ({status}).",
                             provider=provider, retryable=True)
    return ProviderError(ErrorKind.upstream, f"{provider} request failed ({status}): {snippet}",
                         provider=provider)
