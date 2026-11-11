"""Sarvam Bulbul TTS: streaming WebSocket with REST fallback."""

import asyncio
import base64
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator

import httpx
import websockets
from websockets.asyncio.client import ClientConnection, connect
from websockets.protocol import State

from app.core.config import Settings
from app.core.errors import ErrorKind, ProviderError, from_http_status, missing_key
from app.providers.languages import TTS_SUPPORTED

from .base import TTSProvider, Voice

log = logging.getLogger(__name__)
MAX_CHARS = 2000
SPARE_MAX_AGE_S = 40  # a pre-opened socket older than this may have been closed upstream


def strip_wav(data: bytes) -> bytes:
    """Return raw PCM from a WAV payload (pass-through if no RIFF header)."""
    if data[:4] != b"RIFF":
        return data
    i = 12
    while i + 8 <= len(data):
        cid, size = data[i:i + 4], int.from_bytes(data[i + 4:i + 8], "little")
        if cid == b"data":
            return data[i + 8:i + 8 + size] if size else data[i + 8:]
        i += 8 + size
    return data[44:]


class SarvamTTS(TTSProvider):
    name = "sarvam"

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.sample_rate = settings.sarvam_tts_sample_rate
        self._spare: asyncio.Task[ClientConnection] | None = None
        self._spare_at = 0.0

    def _key(self) -> str:
        if not self.s.sarvam_api_key:
            raise missing_key("Sarvam", "SARVAM_API_KEY")
        return self.s.sarvam_api_key

    def supports(self, language_code: str) -> bool:
        return language_code in TTS_SUPPORTED

    def _check(self, voice: Voice) -> None:
        if not self.supports(voice.language_code):
            raise ProviderError(ErrorKind.unsupported_language,
                                f"Speech output isn't available for {voice.language_code}.",
                                provider="Sarvam")

    async def synthesize(self, text: str, voice: Voice) -> AsyncIterator[bytes]:
        self._check(voice)
        key = self._key()
        text = text[:MAX_CHARS]
        produced = False
        try:
            async for chunk in self._stream_ws(text, voice, key):
                produced = True
                yield chunk
            if produced:
                return
        except ProviderError as e:
            if produced or e.kind in (ErrorKind.quota_exhausted, ErrorKind.auth_failed,
                                      ErrorKind.unsupported_language):
                raise
            log.warning("Sarvam TTS stream failed (%s); falling back to REST", e.message)
        except (OSError, websockets.WebSocketException) as e:
            if produced:
                raise ProviderError(ErrorKind.speech_failed, "Speech stream dropped.",
                                    provider="Sarvam", retryable=True) from e
            log.warning("Sarvam TTS WS error %r; falling back to REST", e)
        yield await self._rest(text, voice, key)

    # ---- connection warm-up: the next line starts without a WebSocket handshake ----------
    async def _open(self, key: str) -> ClientConnection:
        url = f"{self.s.sarvam_ws_url}/text-to-speech/ws?model={self.s.sarvam_tts_model}" \
              "&send_completion_event=true"
        return await connect(url, additional_headers={"api-subscription-key": key},
                             open_timeout=8, max_size=None)

    def warm(self) -> None:
        """Open a connection ahead of time for the next line (no-op without a key)."""
        if not self.s.sarvam_api_key:
            return
        if self._spare and (not self._spare.done() or (
                not self._spare.cancelled() and self._spare.exception() is None
                and time.monotonic() - self._spare_at < SPARE_MAX_AGE_S)):
            return
        self._discard(self._spare)
        self._spare = asyncio.create_task(self._open(self.s.sarvam_api_key))
        self._spare_at = time.monotonic()

    @staticmethod
    def _discard(task: asyncio.Task | None) -> None:
        if task is None:
            return
        if not task.done():
            task.cancel()
        elif not task.cancelled() and task.exception() is None:
            asyncio.create_task(task.result().close())

    async def _take(self, key: str) -> ClientConnection:
        spare, self._spare = self._spare, None
        ws: ClientConnection | None = None
        if spare is not None and time.monotonic() - self._spare_at < SPARE_MAX_AGE_S:
            with contextlib.suppress(Exception):
                ws = await spare
            if ws is not None and ws.state is not State.OPEN:
                ws = None
        else:
            self._discard(spare)
        if ws is None:
            ws = await self._open(key)
        self.warm()
        return ws

    async def _stream_ws(self, text: str, voice: Voice, key: str) -> AsyncIterator[bytes]:
        ws = await self._take(key)
        try:
            await ws.send(json.dumps({"type": "config", "data": {
                "speaker": voice.speaker,
                "target_language_code": voice.language_code,
                "language_code": voice.language_code,
                "pace": voice.pace,
                "speech_sample_rate": self.sample_rate,
                "output_audio_codec": "linear16",
                "min_buffer_size": 30,
                "max_chunk_length": 200,
            }}))
            await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
            await ws.send(json.dumps({"type": "flush"}))
            first = True
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
                msg = json.loads(raw)
                mtype = msg.get("type")
                if mtype == "audio":
                    pcm = base64.b64decode(msg["data"]["audio"])
                    yield strip_wav(pcm) if first else pcm
                    first = False
                elif mtype == "event" and msg.get("data", {}).get("event_type") == "final":
                    return
                elif mtype == "error":
                    data = msg.get("data", {})
                    code = int(data.get("code") or 500) if str(data.get("code", "")).isdigit() \
                        else 500
                    raise from_http_status("Sarvam", code, data.get("message", ""))
        finally:
            with contextlib.suppress(Exception):
                await ws.close()

    async def _rest(self, text: str, voice: Voice, key: str) -> bytes:
        body = {
            "text": text,
            "target_language_code": voice.language_code,
            "speaker": voice.speaker,
            "model": self.s.sarvam_tts_model,
            "pace": voice.pace,
            "speech_sample_rate": self.sample_rate,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(f"{self.s.sarvam_base_url}/text-to-speech", json=body,
                                      headers={"api-subscription-key": key})
            except httpx.HTTPError as e:
                raise ProviderError(ErrorKind.speech_failed, "Could not reach Sarvam TTS.",
                                    provider="Sarvam", retryable=True) from e
        if r.status_code >= 400:
            raise from_http_status("Sarvam", r.status_code, r.text,
                                   float(r.headers.get("retry-after", 0)) or None)
        audios = r.json().get("audios") or []
        if not audios:
            raise ProviderError(ErrorKind.speech_failed, "Sarvam returned no audio.",
                                provider="Sarvam")
        return b"".join(strip_wav(base64.b64decode(a)) for a in audios)
