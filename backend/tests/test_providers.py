import base64

import httpx
import pytest
import respx

from app.core.config import Settings
from app.core.errors import ErrorKind, ProviderError
from app.models.engine import SimulatorTurn
from app.providers.llm.base import Message
from app.providers.llm.openrouter import OpenRouterProvider
from app.providers.tts.base import Voice
from app.providers.tts.sarvam import SarvamTTS, strip_wav


def s(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


async def test_openrouter_missing_key():
    with pytest.raises(ProviderError) as e:
        await OpenRouterProvider(s()).complete_json(SimulatorTurn, [Message("user", "hi")],
                                                    task="t")
    assert e.value.kind == ErrorKind.missing_key and "OPENROUTER_API_KEY" in e.value.message


def _chat(content: str) -> dict:
    return {"id": "x", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": content}}]}


@respx.mock
async def test_openrouter_rate_limit_maps_to_typed_error():
    respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=httpx.Response(429, json={"error": {"message": "slow down"}},
                                    headers={"retry-after": "3"}))
    p = OpenRouterProvider(s(openrouter_api_key="k"), max_retries=0)
    with pytest.raises(ProviderError) as e:
        await p.complete_json(SimulatorTurn, [Message("user", "hi")], task="t")
    assert e.value.kind == ErrorKind.rate_limited and e.value.retryable


@respx.mock
async def test_openrouter_invalid_json_is_retried_once():
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(side_effect=[
        httpx.Response(200, json=_chat("not json")),
        httpx.Response(200, json=_chat('```json\n{"text": "Hello"}\n```')),
    ])
    p = OpenRouterProvider(s(openrouter_api_key="k"))
    out = await p.complete_json(SimulatorTurn, [Message("user", "hi")], task="t")
    assert out.text == "Hello" and route.call_count == 2


@respx.mock
async def test_openrouter_5xx_is_upstream_error():
    respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=httpx.Response(503, json={"error": {"message": "down"}}))
    p = OpenRouterProvider(s(openrouter_api_key="k"), max_retries=0)
    with pytest.raises(ProviderError) as e:
        await p.complete_json(SimulatorTurn, [Message("user", "hi")], task="t")
    assert e.value.kind == ErrorKind.upstream


def _wav(pcm: bytes) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(pcm)
    return buf.getvalue()


def test_strip_wav():
    pcm = b"\x01\x02" * 100
    assert strip_wav(_wav(pcm)) == pcm
    assert strip_wav(pcm) == pcm


@respx.mock
async def test_tts_falls_back_to_rest_when_stream_fails(monkeypatch):
    pcm = b"\x00\x01" * 50
    respx.post("https://api.sarvam.ai/text-to-speech").mock(return_value=httpx.Response(
        200, json={"audios": [base64.b64encode(_wav(pcm)).decode()]}))
    tts = SarvamTTS(s(sarvam_api_key="k", sarvam_ws_url="ws://127.0.0.1:9"))
    chunks = [c async for c in tts.synthesize("Hello", Voice("priya", "en-IN"))]
    assert b"".join(chunks) == pcm


async def test_tts_missing_key_and_unsupported_language():
    tts = SarvamTTS(s())
    with pytest.raises(ProviderError) as e:
        [c async for c in tts.synthesize("hi", Voice("priya", "en-IN"))]
    assert e.value.kind == ErrorKind.missing_key
    tts = SarvamTTS(s(sarvam_api_key="k"))
    with pytest.raises(ProviderError) as e:
        [c async for c in tts.synthesize("hi", Voice("priya", "fr-FR"))]
    assert e.value.kind == ErrorKind.unsupported_language


@respx.mock
async def test_tts_quota_error_is_not_retried():
    respx.post("https://api.sarvam.ai/text-to-speech").mock(
        return_value=httpx.Response(402, json={"error": {"code": "insufficient_quota_error"}}))
    tts = SarvamTTS(s(sarvam_api_key="k", sarvam_ws_url="ws://127.0.0.1:9"))
    with pytest.raises(ProviderError) as e:
        [c async for c in tts.synthesize("hi", Voice("priya", "en-IN"))]
    assert e.value.kind == ErrorKind.quota_exhausted


@respx.mock
async def test_openrouter_hung_request_times_out_and_retries():
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(side_effect=[
        httpx.ReadTimeout("hung"),
        httpx.Response(200, json=_chat('{"text": "Hi"}')),
    ])
    p = OpenRouterProvider(s(openrouter_api_key="k", llm_timeout_live_s=0.5))
    out = await p.complete_json(SimulatorTurn, [Message("user", "hi")], task="turn")
    assert out.text == "Hi" and route.call_count == 2
    assert route.calls[0].request.extensions["timeout"]["read"] == 0.5


@respx.mock
async def test_live_calls_switch_reasoning_off_and_cache_the_prefix():
    import json as _json
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=httpx.Response(200, json=_chat('{"text": "Hi"}')))
    p = OpenRouterProvider(s(openrouter_api_key="k"))
    await p.complete_json(SimulatorTurn, [Message("system", "rules", cache=True),
                                          Message("user", "hi")], task="turn", role="live")
    body = _json.loads(route.calls[0].request.content)
    assert body["model"] == "anthropic/claude-haiku-5.5"
    assert body["reasoning"] == {"enabled": False}
    assert body["messages"][0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert body["messages"][1]["content"] == "hi"


@respx.mock
async def test_reasoning_switch_is_dropped_if_the_model_rejects_it():
    import json as _json
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(side_effect=[
        httpx.Response(400, json={"error": {"message": "reasoning is not supported"}}),
        httpx.Response(200, json=_chat('{"text": "Hi"}')),
    ])
    p = OpenRouterProvider(s(openrouter_api_key="k"))
    out = await p.complete_json(SimulatorTurn, [Message("user", "hi")], task="turn", role="live")
    assert out.text == "Hi"
    assert "reasoning" not in _json.loads(route.calls[1].request.content)


async def test_prerendered_audio_plays_while_still_rendering():
    import asyncio

    from app.realtime.audio_buffer import AudioBuffer
    gate = asyncio.Event()

    async def tts():
        yield b"a"
        await gate.wait()
        yield b"b"

    buf = AudioBuffer(tts())
    got = []

    async def read():
        async for c in buf:
            got.append(c)

    reader = asyncio.create_task(read())
    await asyncio.sleep(0.01)
    assert got == [b"a"]  # first chunk is out before rendering finished
    gate.set()
    await reader
    assert got == [b"a", b"b"]


async def test_prerender_failure_is_raised_to_the_reader_for_fallback():
    from app.realtime.audio_buffer import AudioBuffer

    async def tts():
        raise ProviderError(ErrorKind.speech_failed, "down")
        yield b""  # pragma: no cover

    buf = AudioBuffer(tts())
    with pytest.raises(ProviderError):
        async for _ in buf:
            pass


def test_language_is_guessed_from_the_script():
    from app.providers.languages import guess_code
    assert guess_code("ಬಾಡಿಗೆ ₹35,000") == "kn-IN"
    assert guess_code("किराया ₹35,000 है") == "hi-IN"
    assert guess_code("Rent is ₹35,000") is None


@respx.mock
async def test_translation_passes_an_explicit_language_when_tag_is_missing():
    import json as _json

    from app.providers.translate.sarvam import SarvamTranslator
    route = respx.post("https://api.sarvam.ai/translate").mock(
        return_value=httpx.Response(200, json={"translated_text": "The rent"}))
    out = await SarvamTranslator(s(sarvam_api_key="k")).to_english("ಬಾಡಿಗೆ", "auto")
    assert out == "The rent"
    assert _json.loads(route.calls[0].request.content)["source_language_code"] == "kn-IN"
