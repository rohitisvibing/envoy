"""WebSocket endpoint: one socket per client per conversation.

Client -> server
  binary frames: mono PCM16 @16 kHz microphone audio (live mode)
  JSON: {"type": "start"|"pause"|"resume"|"interrupt"|"end"|"mute"|"unmute"|"takeover"
                 |"release"|"ping"}
        {"type": "intervene", "text", "urgent"?}  principal nudge (urgent cuts in now)
        {"type": "say", "text"}                  takeover: relay text in the agent's voice
        {"type": "counterparty_text", "text"}    live mode: type what the other party said
        {"type": "approval", "id", "decision", "alternative_text"}
        {"type": "playback_done", "turn_id"}
Server -> client
  snapshot, state, transcript.partial, transcript.final, transcript.update (meta patch),
  instruction.status {id, status: queued|applied|noted, applied_in}, audio, audio.end, audio.stop,
  negotiation_state, approval.request, approval.resolved, report.pending, report.ready,
  error, pong
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.core.deps import get_container
from app.core.errors import AppError
from app.models.conversation import ApprovalDecision

from .session_manager import manager

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/conversations/{conversation_id}")
async def conversation_socket(ws: WebSocket, conversation_id: str) -> None:
    await ws.accept()
    c = get_container()
    try:
        session = await manager.get(c, conversation_id)
    except AppError as e:
        await ws.send_json({"type": "error", "error": e.to_dict() | {"fatal": True}})
        await ws.close(code=4404)
        return

    send_lock = asyncio.Lock()

    async def sink(msg: dict) -> None:
        async with send_lock:
            await ws.send_json(msg)

    session.attach(sink)
    try:
        await sink(session.snapshot())  # a client that already left raises here
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (data := msg.get("bytes")) is not None:
                await session.on_audio(data)
                continue
            text = msg.get("text")
            if not text:
                continue
            try:
                payload = json.loads(text)
            except ValueError:
                continue
            await _dispatch(session, payload, sink)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket error")
    finally:
        session.detach(sink)


async def _dispatch(session, p: dict, sink) -> None:
    t = p.get("type")
    match t:
        case "ping":
            await sink({"type": "pong"})
        case "start":
            await session.start()
        case "pause":
            await session.pause()
        case "resume":
            await session.resume()
        case "interrupt":
            await session.interrupt()
        case "end":
            await session.finish("Session ended by you.")
        case "mute":
            await session.set_muted(True)
        case "unmute":
            await session.set_muted(False)
        case "takeover":
            await session.take_over()
        case "release":
            await session.release()
        case "intervene":
            await session.intervene(str(p.get("text", ""))[:2000], urgent=bool(p.get("urgent")))
        case "say":
            await session.principal_say(str(p.get("text", ""))[:2000])
        case "counterparty_text":
            await session.counterparty_said(str(p.get("text", ""))[:2000], p.get("language"),
                                            "text")
        case "approval":
            try:
                decision = ApprovalDecision(decision=p.get("decision"),
                                            alternative_text=p.get("alternative_text"))
            except ValidationError:
                await sink({"type": "error", "error": {"kind": "invalid_state",
                                                       "message": "Invalid approval decision."}})
                return
            await session.decide(str(p.get("id")), decision)
        case "playback_done":
            session.playback_done(str(p.get("turn_id")))
        case _:
            await sink({"type": "error", "error": {"kind": "invalid_state",
                                                   "message": f"Unknown message type: {t}"}})
