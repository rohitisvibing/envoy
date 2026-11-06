"""Sarvam Saaras STT: realtime WebSocket (VAD endpointing) and REST transcription."""

import asyncio
import base64
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from urllib.parse import urlencode

import httpx
import websockets
from websockets.asyncio.client import ClientConnection, connect

from app.core.config import Settings
from app.core.errors import ErrorKind, ProviderError, from_http_status, missing_key

from .base import STTEvent, STTProvider, STTStream

log = logging.getLogger(__name__)


class SarvamSTTStream(STTStream):
    def __init__(self, ws: ClientConnection) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[STTEvent | None] = asyncio.Queue()
        self._reader = asyncio.create_task(self._read())
        self._pinger = asyncio.create_task(self._ping())
        self.closed = False

    async def _ping(self) -> None:
        with contextlib.suppress(Exception):
            while True:
                await asyncio.sleep(15)
                await self.ws.send(json.dumps({"event": "ping"}))

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                ev = msg.get("event") or msg.get("type")
                data = msg.get("data") if isinstance(msg.get("data"), dict) else msg
                if ev == "vad.speech_start":
                    await self.queue.put(STTEvent("speech_start", utterance=data.get("utterance_idx")))
                elif ev == "vad.speech_end":
                    await self.queue.put(STTEvent("speech_end", utterance=data.get("utterance_idx")))
                elif ev == "transcript.partial":
                    await self.queue.put(STTEvent("partial", text=data.get("text", ""),
                                                  utterance=data.get("utterance_idx")))
                elif ev == "transcript.final":
                    await self.queue.put(STTEvent(
                        "final", text=data.get("text", ""), utterance=data.get("utterance_idx"),
                        language_code=data.get("language") or data.get("language_code")))
                elif ev == "error":
                    await self.queue.put(STTEvent("error", error=data.get("message", "STT error"),
                                                  fatal=bool(data.get("is_fatal"))))
        except websockets.ConnectionClosed as e:
            if not self.closed:
                reason = "rate limited" if e.rcvd and e.rcvd.code == 1003 else "connection closed"
                await self.queue.put(STTEvent("error", error=f"Speech recognition {reason}.",
                                              fatal=True))
        finally:
            await self.queue.put(None)

    async def send_pcm(self, pcm16: bytes) -> None:
        if self.closed:
            return
        try:
            await self.ws.send(json.dumps({"event": "audio_input",
                                           "audio": base64.b64encode(pcm16).decode()}))
        except websockets.ConnectionClosed:
            self.closed = True

    async def events(self) -> AsyncIterator[STTEvent]:
        while (ev := await self.queue.get()) is not None:
            yield ev

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self._pinger.cancel()
        with contextlib.suppress(Exception):
            await self.ws.send(json.dumps({"event": "end"}))
        with contextlib.suppress(Exception):
            await self.ws.close()


class SarvamSTT(STTProvider):
    name = "sarvam"

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def _key(self) -> str:
        if not self.s.sarvam_api_key:
            raise missing_key("Sarvam", "SARVAM_API_KEY")
        return self.s.sarvam_api_key

    async def open_stream(self, language_code: str = "auto") -> STTStream:
        params = {
            "language_code": language_code or "auto",
            "model": self.s.sarvam_stt_model,
            "endpointing": "vad",
            "encoding": "linear16",
            "sample_rate": self.sample_rate,
            "mode": "transcribe",
        }
        url = f"{self.s.sarvam_ws_url}/speech-to-text-realtime/ws?{urlencode(params)}"
        try:
            ws = await connect(url, additional_headers={"api-subscription-key": self._key()},
                               open_timeout=8, max_size=None)
        except websockets.InvalidStatus as e:
            raise from_http_status("Sarvam", e.response.status_code,
                                   e.response.body.decode(errors="ignore") if e.response.body
                                   else "") from e
        except (OSError, websockets.WebSocketException, TimeoutError) as e:
            raise ProviderError(ErrorKind.speech_failed, "Could not connect to Sarvam STT.",
                                provider="Sarvam", retryable=True) from e
        return SarvamSTTStream(ws)

    async def transcribe(self, audio: bytes, filename: str = "audio.wav",
                         language_code: str = "unknown") -> STTEvent:
        async with httpx.AsyncClient(timeout=40) as client:
            try:
                r = await client.post(
                    f"{self.s.sarvam_base_url}/speech-to-text",
                    headers={"api-subscription-key": self._key()},
                    files={"file": (filename, audio)},
                    data={"model": self.s.sarvam_stt_rest_model, "mode": "codemix",
                          "language_code": language_code},
                )
            except httpx.HTTPError as e:
                raise ProviderError(ErrorKind.speech_failed, "Could not reach Sarvam STT.",
                                    provider="Sarvam", retryable=True) from e
        if r.status_code >= 400:
            raise from_http_status("Sarvam", r.status_code, r.text)
        body = r.json()
        return STTEvent("final", text=body.get("transcript", ""),
                        language_code=body.get("language_code"))
