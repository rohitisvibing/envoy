"""LiveSession: one conversation's runtime state, shared by text and voice.

Everything a client can do (speak, type an instruction, approve, pause, take over) goes
through this object, so there is exactly one context per conversation: one transcript,
one negotiation state, one approval queue and one state machine.
"""

import asyncio
import base64
import contextlib
import logging
import re
import time
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

from app.core.deps import Container
from app.core.errors import AppError, ErrorKind
from app.models.common import utcnow
from app.models.conversation import (
    Approval,
    ApprovalDecision,
    ApprovalStatus,
    Conversation,
    ConversationMode,
    ConversationState,
    can_transition,
)
from app.models.engine import TurnPlan
from app.models.mission import Mission, MissionStatus
from app.models.principal import PrincipalProfile
from app.models.transcript import EventKind, Speaker, TranscriptEvent
from app.providers.languages import to_code, to_name
from app.providers.stt.base import STTStream
from app.providers.tts.base import Voice
from app.services import approval_manager, outcome_analyzer, simulator
from app.services.conversation_manager import (
    TurnInputs,
    merge_delta,
    plan_turn,
    update_state,
)
from app.services.policy_guard import extract_amounts

from .audio_buffer import AudioBuffer
from .counterparty import BrowserMicChannel, CounterpartyChannel, SimulatedChannel

log = logging.getLogger(__name__)
S = ConversationState
Sink = Callable[[dict], Awaitable[None]]

NUDGE_DIRECTIVE = (
    "The principal just sent a new instruction (see NEW FROM THE PRINCIPAL). If it asks you to "
    "say or ask something, do it now in one natural line without mentioning the instruction. "
    "If it is only guidance and there is nothing worth saying right now, holding is allowed: "
    "set hold=true and leave response_text empty.")
TAKEOVER_RE = re.compile(r"\b(take over|let me (talk|speak|handle))\b", re.IGNORECASE)
# Only a bare command pauses ("pause", "stop now", "wait a moment"); "Stop, don't mention X"
# is a nudge.
PAUSE_RE = re.compile(
    r"^\s*(pause|stop|hold on|wait)(\s+(please|now|a (sec|second|moment|minute)|"
    r"for a (sec|second|moment|minute)))?\s*[.!]*\s*$", re.IGNORECASE)
MAX_INSTRUCTIONS = 8
_SAYS_AI = re.compile(r"\b(ai|a\.i\.|artificial intelligence)\b|ಎಐ|एआई|ஏஐ|ఏఐ", re.IGNORECASE)


class LiveSession:
    def __init__(self, c: Container, conv: Conversation, mission: Mission,
                 profile: PrincipalProfile, events: list[TranscriptEvent],
                 approvals: list[Approval]) -> None:
        self.c = c
        self.llm = c.llm
        self.conv = conv
        self.mission = mission
        self.profile = profile
        self.events = events
        self.approvals: dict[str, Approval] = {a.id: a for a in approvals}
        self.pending_plans: dict[str, TurnPlan] = {}
        self.negotiation = conv.negotiation
        self.state: ConversationState = conv.state
        self.channel: CounterpartyChannel = (
            SimulatedChannel() if conv.mode == ConversationMode.simulated else BrowserMicChannel())
        # (event id or None, text). Nudges stay "queued" until a spoken line has used them.
        self.instructions: list[tuple[str | None, str]] = [
            (e.id, e.text) for e in events if e.kind == EventKind.instruction]
        self.queued_nudges: list[str] = [
            e.id for e in events
            if e.kind == EventKind.instruction and e.meta.get("status") == "queued"]
        self._turn_args: tuple[str | None, bool] = (None, False)
        self.approved_disclosures: dict[str, str] = {}
        self.authorised_amounts: set[float] = set()
        self.commitment_approved = bool(self.negotiation.commitments)
        self.turn_no = sum(1 for e in events if e.speaker == Speaker.agent)
        self.paused = conv.state == S.paused
        self.takeover_active = False
        self.muted = False
        # After the current line finishes: None, "nudge" (may hold) or "reply" (must answer).
        self.respond_after_speech: str | None = None
        self.sinks: set[Sink] = set()
        self.task: asyncio.Task | None = None
        self.task_kind: str | None = None
        self.playback: dict[str, asyncio.Event] = {}
        self.stt: STTStream | None = None
        self.stt_task: asyncio.Task | None = None
        self.stt_retry_at = 0.0
        self.speaking_turn: str | None = None
        self.report_task: asyncio.Task | None = None
        self._persist_lock = asyncio.Lock()
        self._bg: set[asyncio.Task] = set()
        self.voice_enabled = conv.voice_enabled and c.voice_available
        self.pace_text = c.settings.text_pacing  # in text-only mode, pause roughly as long as reading takes
        # Negotiation notes are updated off the critical path, while a line is being spoken.
        self._state_task: asyncio.Task | None = None
        # Practice mode: the other side's next line (and the agent's answer to it) are worked
        # out while the current line plays. Anything that changes the conversation drops them.
        self.speculate = c.settings.speculate and conv.mode == ConversationMode.simulated
        self._spec_sim: asyncio.Task | None = None
        self._spec_agent: asyncio.Task | None = None
        self._prerender: AudioBuffer | None = None
        self._heard_at: float | None = None  # when the latest line finished playing

    # ---- plumbing ------------------------------------------------------------------------
    @property
    def spec(self):
        return self.mission.spec

    def attach(self, sink: Sink) -> None:
        self.sinks.add(sink)

    def detach(self, sink: Sink) -> None:
        self.sinks.discard(sink)

    async def emit(self, msg: dict) -> None:
        dead = []
        for sink in list(self.sinks):
            try:
                await sink(msg)
            except Exception:  # noqa: BLE001 - a broken socket must not break the session
                dead.append(sink)
        for d in dead:
            self.sinks.discard(d)

    def _bg_task(self, coro: Coroutine) -> None:
        t = asyncio.create_task(coro)
        self._bg.add(t)
        t.add_done_callback(self._bg.discard)

    async def _persist(self) -> None:
        async with self._persist_lock:
            self.conv.state = self.state
            self.conv.negotiation = self.negotiation
            self.conv.updated_at = utcnow()
            try:
                await self.c.repo.save_conversation(self.conv)
            except Exception as e:  # noqa: BLE001
                log.warning("persist conversation failed: %s", e)

    async def set_state(self, new: ConversationState) -> None:
        if new == self.state:
            return
        if not can_transition(self.state, new):
            log.warning("unexpected transition %s -> %s", self.state, new)
        self.state = new
        await self.emit(self.state_msg())
        self._bg_task(self._persist())

    async def set_state_listening(self) -> None:
        if self.takeover_active or self.paused:
            await self.set_state(S.paused)
        else:
            await self.set_state(S.listening)

    def state_msg(self) -> dict:
        return {"type": "state", "state": self.state.value, "paused": self.paused,
                "takeover": self.takeover_active, "muted": self.muted,
                "voice": self.voice_enabled, "demo": self.c.demo}

    async def add_event(self, event: TranscriptEvent) -> TranscriptEvent:
        self.events.append(event)
        await self.emit({"type": "transcript.final", "event": event.model_dump(mode="json")})
        self._bg_task(self._save_event(event))
        return event

    async def _save_event(self, event: TranscriptEvent) -> None:
        try:
            await self.c.repo.add_event(event)
        except Exception as e:  # noqa: BLE001
            log.warning("persist event failed: %s", e)

    async def _save_event_meta(self, event: TranscriptEvent) -> None:
        """Best effort: event rows are append-only; re-insert is skipped on conflict."""
        save = getattr(self.c.repo, "update_event_meta", None)
        if save:
            try:
                await save(event.id, event.meta)
            except Exception as e:  # noqa: BLE001
                log.warning("persist event meta failed: %s", e)

    async def _nudge_status(self, ids: list[str], status: str, applied_in: str | None = None
                            ) -> None:
        for e in self.events:
            if e.id in ids:
                e.meta["status"] = status
                if applied_in:
                    e.meta["applied_in"] = applied_in
                await self.emit({"type": "instruction.status", "id": e.id, "status": status,
                                 "applied_in": applied_in})
                self._bg_task(self._save_event_meta(e))
        self.queued_nudges = [i for i in self.queued_nudges if i not in ids]

    async def system(self, text: str, **meta) -> None:
        await self.add_event(TranscriptEvent(conversation_id=self.conv.id, speaker=Speaker.system,
                                             kind=EventKind.event, text=text, meta=meta))

    async def emit_negotiation(self) -> None:
        await self.emit({"type": "negotiation_state",
                         "negotiation": self.negotiation.model_dump(mode="json")})
        self._bg_task(self._persist())

    async def error(self, err: AppError | str, *, fatal: bool = False) -> None:
        payload = err.to_dict() if isinstance(err, AppError) else {
            "kind": "upstream", "message": err, "retryable": False}
        payload["fatal"] = fatal
        await self.emit({"type": "error", "error": payload})

    def schedule(self, coro: Coroutine, kind: str) -> None:
        current = asyncio.current_task()
        if self.task and not self.task.done() and self.task is not current:
            self.task.cancel()
        self.task_kind = kind
        self.task = asyncio.create_task(self._run_guarded(coro, kind))

    async def _run_guarded(self, coro: Coroutine, kind: str) -> None:
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except AppError as e:
            log.warning("%s task failed: %s", kind, e.message)
            await self.error(e)
            await self.system(f"{e.message}", error=e.kind.value)
            if self.state not in (S.completed, S.failed):
                if e.kind in (ErrorKind.missing_key, ErrorKind.auth_failed,
                              ErrorKind.quota_exhausted):
                    self.paused = True
                    await self.set_state(S.paused)
                else:
                    await self.set_state_listening()
        except Exception as e:
            log.exception("%s task crashed", kind)
            await self.error(f"Unexpected error: {e}")
            if self.state not in (S.completed, S.failed):
                self.paused = True
                await self.set_state(S.paused)

    async def _cancel_task(self) -> None:
        if self.task and not self.task.done() and self.task is not asyncio.current_task():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
        self.task = None

    def snapshot(self) -> dict:
        return {
            "type": "snapshot",
            "conversation": self.conv.model_dump(mode="json")
            | {"state": self.state.value, "negotiation": self.negotiation.model_dump(mode="json")},
            "mission": {"id": self.mission.id, "title": self.spec.title,
                        "spec": self.spec.model_dump(mode="json")},
            "events": [e.model_dump(mode="json") for e in self.events],
            "approvals": [a.model_dump(mode="json") for a in self.approvals.values()],
            **{k: v for k, v in self.state_msg().items() if k != "type"},
            "state": self.state.value,
        }

    # ---- speech output -------------------------------------------------------------------
    def _voice_for(self, speaker: Speaker, language: str | None) -> Voice:
        s = self.c.settings
        name = (s.sarvam_tts_counterparty_speaker if speaker == Speaker.counterparty
                else s.sarvam_tts_agent_speaker)
        return Voice(speaker=name, language_code=to_code(language))

    async def speak(self, speaker: Speaker, text: str, language: str | None, *,
                    event: TranscriptEvent | None = None, audio: AudioBuffer | None = None,
                    en: str | None = None,
                    on_added: Callable[[], None] | None = None) -> TranscriptEvent:
        """Say a line: add it to the transcript, then play it (or pre-rendered `audio`)."""
        if event is None:
            event = TranscriptEvent(conversation_id=self.conv.id, speaker=speaker, text=text,
                                    language=language, source="voice" if self.voice_enabled
                                    else "text")
        if en and en.strip() and en.strip() != event.text.strip():
            event.meta["en"] = en.strip()
        await self.add_event(event)
        if event.kind == EventKind.speech and self._needs_english(event):
            self._bg_task(self._translate(event))
        if on_added:
            on_added()
        await self.set_state(S.speaking if speaker in (Speaker.agent, Speaker.user)
                             else S.listening)
        self.speaking_turn = event.id
        try:
            await self._play(event, speaker, audio)
        except asyncio.CancelledError:
            event.meta["interrupted"] = True
            await self.emit({"type": "audio.stop", "turn_id": event.id})
            await self.emit({"type": "transcript.update", "id": event.id, "meta": event.meta})
            self._bg_task(self._save_event_meta(event))
            raise
        finally:
            self.speaking_turn = None
            self.playback.pop(event.id, None)
        return event

    async def _play(self, event: TranscriptEvent, speaker: Speaker,
                    audio: AudioBuffer | None = None) -> None:
        reading_time = min(6.0, max(1.2, len(event.text) * 0.045)) if self.pace_text else 0
        if not (self.voice_enabled and self.sinks):
            await asyncio.sleep(reading_time if self.sinks else 0)
            return
        voice = self._voice_for(speaker, event.language)
        tts = self.c.tts
        done = asyncio.Event()
        self.playback[event.id] = done
        total, seq, first_at = 0, 0, None
        started = time.monotonic()

        async def chunks():
            if audio is not None:
                try:
                    async for pcm in audio:
                        yield pcm
                    return
                except Exception as e:  # noqa: BLE001 - render it live instead
                    log.warning("pre-rendered audio unusable (%s); rendering now", e)
            async for pcm in tts.synthesize(event.text, voice):
                yield pcm

        try:
            async for pcm in chunks():
                if first_at is None:
                    first_at = time.monotonic()
                    self._log_gap(speaker, (first_at - started) * 1000,
                                  prerendered=audio is not None)
                total += len(pcm)
                await self.emit({"type": "audio", "turn_id": event.id, "speaker": speaker.value,
                                 "seq": seq, "sample_rate": tts.sample_rate,
                                 "data": base64.b64encode(pcm).decode()})
                seq += 1
        except AppError as e:
            await self.error(e)
            if e.kind == ErrorKind.unsupported_language:
                await self.system(f"{e.message} Showing text only for this line.")
            await asyncio.sleep(reading_time)
            return
        await self.emit({"type": "audio.end", "turn_id": event.id})
        duration = total / 2 / tts.sample_rate
        elapsed = time.monotonic() - (first_at or time.monotonic())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(done.wait(), timeout=max(0.5, duration - elapsed) + 4)

    def _log_gap(self, speaker: Speaker, tts_ms: float, *, prerendered: bool) -> None:
        """Latency: time to first audio, and the silence since the previous line ended."""
        gap = (time.monotonic() - self._heard_at) * 1000 if self._heard_at else None
        log.info("latency %s: tts_first_audio=%.0fms%s%s", speaker.value, tts_ms,
                 " (pre-rendered)" if prerendered else "",
                 f" gap_since_previous_line={gap:.0f}ms" if gap is not None else "")

    def playback_done(self, turn_id: str) -> None:
        self._heard_at = time.monotonic()
        ev = self.playback.get(turn_id)
        if ev:
            ev.set()

    # ---- lifecycle -----------------------------------------------------------------------
    async def start(self) -> None:
        if self.state in (S.completed,):
            return
        if self.events:  # already started: treat as resume
            await self.resume()
            return
        await self.set_state(S.connecting)
        self.schedule(self._open(), kind="agent")

    async def _open(self) -> None:
        if self.voice_enabled:
            self.c.tts.warm()
        await self.channel.prepare(self)
        self.mission.status = MissionStatus.active
        self._bg_task(self._save_mission())
        await self.system("Session started" + (" with a simulated counterparty"
                                              if self.conv.mode == ConversationMode.simulated
                                              else ". Listening through your microphone"))
        brief = self.mission.brief
        # Openings prepared before AI announcements became optional still say it: re-open.
        stale = brief is not None and not self.spec.communication.announce_ai \
            and _SAYS_AI.search(brief.opening_statement) is not None
        if brief and not stale:
            plan = TurnPlan(response_text=brief.opening_statement,
                            response_language=brief.opening_language)
            self.turn_no += 1
            await self.speak_agent_plan(plan)
        else:
            await self.run_agent_turn(
                directive="Open the conversation: introduce yourself (by your name, if you have "
                          "one) as calling on the principal's behalf, then state the purpose.",
                is_opening=True)

    async def _save_mission(self) -> None:
        with contextlib.suppress(Exception):
            self.mission.updated_at = utcnow()
            await self.c.repo.save_mission(self.mission)

    async def finish(self, reason: str, *, failed: bool = False) -> None:
        if self.state in (S.completed, S.failed):
            return
        self._drop_speculation()
        await self._cancel_task()
        await self._close_stt()
        self.paused = False
        await self.set_state(S.failed if failed else S.completed)
        self.conv.ended_at = utcnow()
        await self.system(reason)
        await self._persist()
        self.mission.status = MissionStatus.failed if failed else MissionStatus.completed
        await self._save_mission()
        self.report_task = asyncio.create_task(self._generate_report())

    async def _generate_report(self) -> None:
        await self.emit({"type": "report.pending"})
        try:
            report = await outcome_analyzer.analyze(self.llm, self.conv.id, self.spec,
                                                    self.negotiation, self.events)
            await self.c.repo.save_report(report)
            await self.emit({"type": "report.ready", "report": report.model_dump(mode="json")})
        except AppError as e:
            await self.error(e)
        except Exception as e:
            log.exception("report failed")
            await self.error(f"Could not generate the outcome report: {e}")

    # ---- agent turns ---------------------------------------------------------------------
    def _inputs(self, directive: str | None, is_opening: bool = False,
                allow_hold: bool = False) -> TurnInputs:
        return TurnInputs(spec=self.spec, brief=self.mission.brief, profile=self.profile,
                          negotiation=self.negotiation, events=self.events,
                          new_instructions=[t for i, t in self.instructions
                                            if i in self.queued_nudges],
                          standing_instructions=[t for i, t in self.instructions
                                                 if i not in self.queued_nudges
                                                 ][-MAX_INSTRUCTIONS:],
                          approved_disclosures=dict(self.approved_disclosures),
                          authorised_amounts=set(self.authorised_amounts), directive=directive,
                          is_opening=is_opening, commitment_approved=self.commitment_approved,
                          allow_hold=allow_hold)

    # ---- off the critical path: notes, speculation, translation ---------------------------
    def _start_state_update(self, agent_line: str | None = None,
                            language: str | None = None) -> None:
        """Update the negotiation notes for the latest exchange while the line is spoken."""
        events = list(self.events)
        if agent_line:
            events.append(TranscriptEvent(conversation_id=self.conv.id, speaker=Speaker.agent,
                                          text=agent_line, language=language))
        turn, prev = self.turn_no, self._state_task

        async def run() -> None:
            if prev and not prev.done():
                await asyncio.wait({prev})
            t0 = time.monotonic()
            try:
                delta = await update_state(self.llm, self.spec, self.negotiation, events)
            except Exception as e:  # noqa: BLE001 - notes are best effort
                log.warning("state update failed: %s", e)
                return
            log.info("latency state_update=%.0fms", (time.monotonic() - t0) * 1000)
            self.negotiation = merge_delta(self.negotiation, delta, turn)
            await self.emit_negotiation()

        self._state_task = asyncio.create_task(run())

    async def _state_ready(self, timeout: float = 12.0) -> None:
        """The next line is planned on up-to-date notes: wait for a pending update."""
        t = self._state_task
        if t and not t.done():
            await asyncio.wait({t}, timeout=timeout)

    def _drop_speculation(self, *, agent_only: bool = False) -> None:
        for name in ("_spec_agent",) if agent_only else ("_spec_agent", "_spec_sim"):
            t = getattr(self, name)
            if t and not t.done():
                t.cancel()
            setattr(self, name, None)
        if not agent_only and self._prerender is not None:
            self._prerender.cancel()
            self._prerender = None

    async def _take(self, name: str) -> Any | None:
        """Claim a speculative result, if one is still valid."""
        t = getattr(self, name)
        setattr(self, name, None)
        if t is None:
            return None
        await asyncio.wait({t})
        if t.cancelled():
            return None
        if t.exception() is not None:
            log.warning("speculative %s failed: %s", name, t.exception())
            return None
        return t.result()

    def _speculate_sim(self) -> None:
        """The agent's line is in the transcript: start the other side's reply right away."""
        channel = self.channel
        if not (self.speculate and isinstance(channel, SimulatedChannel) and channel.persona):
            return
        self._drop_speculation()
        self._spec_sim = asyncio.create_task(
            self._precompute_sim(channel.persona, list(self.events)))

    async def _precompute_sim(self, persona, events: list[TranscriptEvent]):
        t0 = time.monotonic()
        turn = await simulator.next_turn(self.llm, persona, events)
        log.info("latency simulate=%.0fms (while the agent speaks)",
                 (time.monotonic() - t0) * 1000)
        event = TranscriptEvent(conversation_id=self.conv.id, speaker=Speaker.counterparty,
                                text=turn.text, language=turn.language,
                                source="voice" if self.voice_enabled else "text")
        audio: AudioBuffer | None = None
        if self.voice_enabled and self.sinks:
            # Rendering starts now and playback can begin before it finishes.
            voice = self._voice_for(Speaker.counterparty, turn.language)
            audio = AudioBuffer(self.c.tts.synthesize(turn.text, voice))
            self._prerender = audio
        if not turn.end_conversation:
            # And the agent's answer to it, so it can speak as soon as they finish.
            if self._spec_agent and not self._spec_agent.done():
                self._spec_agent.cancel()
            self._spec_agent = asyncio.create_task(self._precompute_agent(events + [event]))
        return turn, event, audio

    async def _precompute_agent(self, events: list[TranscriptEvent]):
        await self._state_ready()
        inputs = self._inputs(None)
        inputs.events = events
        nudges = list(self.queued_nudges)
        t0 = time.monotonic()
        decision = await plan_turn(self.llm, inputs)
        log.info("latency say=%.0fms (while they speak)", (time.monotonic() - t0) * 1000)
        return decision, nudges, [e.id for e in events]

    @staticmethod
    def _needs_english(event: TranscriptEvent) -> bool:
        if event.meta.get("en"):
            return False
        lang = (event.language or "").strip().lower()
        if lang:
            return not lang.startswith("en")
        return any(ord(ch) > 0x2FF and ch.isalpha() for ch in event.text)

    async def _translate(self, event: TranscriptEvent) -> None:
        """Give the principal an English rendering of a line (never blocks the call)."""
        translator = self.c.translator
        if translator is None:
            return
        try:
            en = await translator.to_english(event.text, to_code(event.language, "auto")
                                             if event.language else "auto")
        except Exception as e:  # noqa: BLE001 - a missing translation must not stop the call
            log.warning("translation failed: %s", e)
            return
        if not en or en.strip() == event.text.strip():
            return
        event.meta["en"] = en.strip()
        await self.emit({"type": "transcript.update", "id": event.id, "meta": event.meta})
        self._bg_task(self._save_event_meta(event))

    async def run_agent_turn(self, directive: str | None = None, is_opening: bool = False,
                             allow_hold: bool = False) -> None:
        self.respond_after_speech = None
        self._turn_args = (directive, allow_hold)
        plain = directive is None and not is_opening and not allow_hold
        pre = await self._take("_spec_agent") if plain else None
        if pre and pre[2] == [e.id for e in self.events] and pre[1] == list(self.queued_nudges):
            decision, nudges = pre[0], pre[1]
            await self.set_state(S.thinking)
        else:
            nudges = list(self.queued_nudges)
            await self.set_state(S.thinking)
            await self._state_ready()
            t0 = time.monotonic()
            decision = await plan_turn(self.llm, self._inputs(directive, is_opening, allow_hold))
            log.info("latency say=%.0fms", (time.monotonic() - t0) * 1000)
        plan = decision.plan
        if plan.hold:
            self.negotiation = merge_delta(self.negotiation, plan.state_delta, self.turn_no)
            await self.emit_negotiation()
            await self._nudge_status(nudges, "noted")
            if self.paused or self.takeover_active:
                await self.set_state(S.paused)
            else:
                await self.channel.after_agent_turn(self)
            return
        self.turn_no += 1
        self.negotiation = merge_delta(self.negotiation, plan.state_delta, self.turn_no)
        self.approved_disclosures.clear()  # disclosures are approved for a single turn
        await self.emit_negotiation()
        if decision.approval:
            approval = approval_manager.create(self.conv.id, decision.approval,
                                               decision.disclosure_key)
            self.approvals[approval.id] = approval
            self.pending_plans[approval.id] = plan
            self.negotiation.approval_required = True
            if approval.proposed_en is None and approval.proposed == plan.response_text:
                approval.proposed_en = plan.response_text_en
            if approval.request_en is None:
                last_cp = next((e for e in reversed(self.events)
                                if e.speaker == Speaker.counterparty), None)
                if last_cp and last_cp.text == approval.request:
                    approval.request_en = last_cp.meta.get("en")
            self._bg_task(self._save_approval(approval))
            self._drop_speculation()
            hold_line = approval_manager.holding_line(plan)
            self._start_state_update(hold_line, plan.response_language)
            await self.speak(Speaker.agent, hold_line, plan.response_language,
                             en=None if plan.response_language == "English"
                             else approval_manager.HOLDING_LINES["English"])
            await self.add_event(TranscriptEvent(
                conversation_id=self.conv.id, speaker=Speaker.system, kind=EventKind.approval,
                text=decision.approval.reason or "Your approval is needed.",
                meta={"approval_id": approval.id}))
            await self.set_state(S.awaiting_approval)
            await self.emit({"type": "approval.request",
                             "approval": approval.model_dump(mode="json")})
            await self.emit_negotiation()
            return
        if not is_opening:
            self._start_state_update(plan.response_text, plan.response_language)
        await self.speak_agent_plan(plan, nudges)

    async def speak_agent_plan(self, plan: TurnPlan, nudges: list[str] | None = None) -> None:
        for offer in plan.offers_made:
            offer.by, offer.turn = "agent", self.turn_no
            self.negotiation.offers_made.append(offer)
        if plan.objective_met:
            self.negotiation.objective_met = True
        await self.emit_negotiation()
        spoken = await self.speak(
            Speaker.agent, plan.response_text, plan.response_language, en=plan.response_text_en,
            on_added=None if plan.end_conversation else self._speculate_sim)
        if nudges:
            spoken.meta["nudges"] = nudges
            await self.emit({"type": "transcript.update", "id": spoken.id, "meta": spoken.meta})
            await self._nudge_status(nudges, "applied", applied_in=spoken.id)
        if plan.end_conversation:
            await self.finish("The agent closed the conversation.")
            return
        if self._counterparty_left():
            await self.finish("The counterparty ended the conversation.")
            return
        follow_up = self.respond_after_speech
        if follow_up and not (self.paused or self.takeover_active):
            if follow_up == "reply":
                await self.run_agent_turn()
            else:
                await self.run_agent_turn(directive=NUDGE_DIRECTIVE, allow_hold=True)
            return
        if self.paused or self.takeover_active:
            await self.set_state(S.paused)
            return
        await self.channel.after_agent_turn(self)

    def _counterparty_left(self) -> bool:
        last = next((e for e in reversed(self.events) if e.speaker == Speaker.counterparty), None)
        return bool(last and last.meta.get("end_conversation"))

    async def _save_approval(self, approval: Approval) -> None:
        try:
            await self.c.repo.save_approval(approval)
        except Exception as e:  # noqa: BLE001
            log.warning("persist approval failed: %s", e)

    # ---- counterparty input --------------------------------------------------------------
    async def run_simulator_turn(self) -> None:
        channel = self.channel
        assert isinstance(channel, SimulatedChannel)
        pre = await self._take("_spec_sim")
        await channel.prepare(self)
        await self.set_state(S.listening)
        event, audio = None, None
        if pre:
            turn, event, audio = pre
            self._prerender = None  # now it's the line being played, not a guess
        else:
            t0 = time.monotonic()
            turn = await simulator.next_turn(self.llm, channel.persona, self.events)  # type: ignore[arg-type]
            log.info("latency simulate=%.0fms", (time.monotonic() - t0) * 1000)
        event = await self.speak(Speaker.counterparty, turn.text, turn.language, event=event,
                                 audio=audio, en=turn.text_en)
        if turn.end_conversation:
            event.meta["end_conversation"] = True
        await self.handle_counterparty_turn(
            directive="The counterparty is ending the conversation. Close politely and set "
                      "end_conversation=true." if turn.end_conversation else None)

    async def handle_counterparty_turn(self, directive: str | None = None) -> None:
        """The counterparty finished an utterance; respond unless something holds the agent."""
        if self.paused or self.takeover_active:
            await self.set_state(S.paused)
            return
        if self.state == S.awaiting_approval or any(
                a.status == ApprovalStatus.pending for a in self.approvals.values()):
            await self.set_state(S.awaiting_approval)
            return
        await self.run_agent_turn(directive=directive)

    async def counterparty_said(self, text: str, language: str | None, source: str,
                                utterance_id: str | None = None) -> None:
        """Live mode: a final transcript (voice) or typed counterparty line arrived."""
        if self.state in (S.completed, S.failed) or not text.strip():
            return
        self._heard_at = time.monotonic()
        self._drop_speculation()
        event = await self.add_event(TranscriptEvent(
            conversation_id=self.conv.id, speaker=Speaker.counterparty, text=text.strip(),
            language=language, source=source,
            meta={"utterance_id": utterance_id} if utterance_id else {}))
        if self._needs_english(event):
            self._bg_task(self._translate(event))
        if self.task_kind == "agent" and self.task and not self.task.done() \
                and self.state == S.speaking:
            self.respond_after_speech = "reply"  # answer once the current line finishes
            return
        self.schedule(self.handle_counterparty_turn(), kind="agent")

    # ---- principal controls --------------------------------------------------------------
    async def intervene(self, text: str, urgent: bool = False) -> None:
        """A typed nudge from the principal while the conversation runs.

        Normal nudges never cut anyone off: they apply to the agent's next line (and the
        agent may act on them straight away if it is idle). Urgent nudges stop whatever is
        being said or composed and make the agent act now.
        """
        text = text.strip()
        if not text or self.state in (S.completed, S.failed):
            return
        self._drop_speculation(agent_only=not urgent)
        event = await self.add_event(TranscriptEvent(
            conversation_id=self.conv.id, speaker=Speaker.user, kind=EventKind.instruction,
            text=text, meta={"status": "queued", "urgent": urgent}))
        if TAKEOVER_RE.search(text):
            await self._nudge_status([event.id], "noted")
            await self.take_over()
            return
        if PAUSE_RE.search(text):
            await self._nudge_status([event.id], "noted")
            await self.pause()
            return
        self.instructions.append((event.id, text))
        self.queued_nudges.append(event.id)
        self.authorised_amounts |= set(extract_amounts(text))
        await self.emit({"type": "instruction.status", "id": event.id, "status": "queued",
                         "applied_in": None})
        if self.paused or self.takeover_active or self.state == S.awaiting_approval:
            return  # applied on the first turn after resuming / deciding
        running = self.task is not None and not self.task.done()
        if urgent:
            await self._cancel_task()
            self.schedule(self.run_agent_turn(directive=NUDGE_DIRECTIVE, allow_hold=True),
                          kind="agent")
            return
        if self.state == S.thinking and self.task_kind == "agent" and running:
            directive, allow_hold = self._turn_args
            self.schedule(self.run_agent_turn(directive=directive, allow_hold=allow_hold),
                          kind="agent")  # replan so the line about to be said includes it
            return
        if self.task_kind == "simulator" and running:
            return  # the agent's reply to the other side will apply it
        if self.state in (S.speaking, S.connecting) and running:
            self.respond_after_speech = self.respond_after_speech or "nudge"
            return
        self.schedule(self.run_agent_turn(directive=NUDGE_DIRECTIVE, allow_hold=True),
                      kind="agent")

    async def pause(self) -> None:
        if self.paused or self.state in (S.completed, S.failed, S.ready, S.connecting):
            return
        self.paused = True
        self._drop_speculation()
        if self.state != S.awaiting_approval:
            await self._cancel_task()
        await self.set_state(S.paused)
        await self.system("Agent paused")

    async def resume(self) -> None:
        if self.state in (S.completed, S.failed):
            return
        was_paused = self.paused
        self.paused = False
        if was_paused:
            await self.system("Agent resumed")
        await self._continue()

    async def _continue(self) -> None:
        if self.takeover_active:
            await self.set_state(S.paused)
            return
        if any(a.status == ApprovalStatus.pending for a in self.approvals.values()):
            await self.set_state(S.awaiting_approval)
            return
        speech = [e for e in self.events if e.kind == EventKind.speech]
        last = speech[-1] if speech else None
        if last is None:
            await self.set_state(S.connecting)
            self.schedule(self._open(), kind="agent")
        elif last.speaker == Speaker.counterparty:
            self.schedule(self.run_agent_turn(), kind="agent")
        elif self.queued_nudges:
            self.schedule(self.run_agent_turn(directive=NUDGE_DIRECTIVE, allow_hold=True),
                          kind="agent")
        elif self.conv.mode == ConversationMode.simulated:
            self.schedule(self.run_simulator_turn(), kind="simulator")
        else:
            await self.set_state(S.listening)

    async def interrupt(self, *, barge_in: bool = False) -> None:
        if self.state != S.speaking:
            return
        self._drop_speculation()
        await self._cancel_task()
        await self.set_state(S.interrupted)
        await self.system("Agent interrupted" + (" by the other party" if barge_in else ""))
        await self.set_state(S.listening)
        if not barge_in and self.conv.mode == ConversationMode.simulated and not self.paused:
            self.schedule(self.run_simulator_turn(), kind="simulator")

    async def take_over(self) -> None:
        if self.takeover_active or self.state in (S.completed, S.failed):
            return
        self.takeover_active = True
        self._drop_speculation()
        await self._cancel_task()
        await self.set_state(S.paused)
        await self.system("You took over. Messages you type are spoken to the other party.")

    async def release(self) -> None:
        if not self.takeover_active:
            return
        self.takeover_active = False
        self.paused = False
        await self.system("The agent is back in control")
        await self._continue()

    async def principal_say(self, text: str) -> None:
        """Takeover mode: the principal's typed words are relayed with the agent's voice."""
        if not self.takeover_active or not text.strip():
            return
        language = next((e.language for e in reversed(self.events)
                         if e.speaker == Speaker.counterparty and e.language), None)
        self.schedule(self._relay(text.strip(), language), kind="agent")

    async def _relay(self, text: str, language: str | None) -> None:
        await self.speak(Speaker.user, text, language or self.spec.communication.languages[0])
        await self.set_state(S.paused)
        if self.conv.mode == ConversationMode.simulated:
            self.schedule(self.run_simulator_turn(), kind="simulator")

    async def decide(self, approval_id: str, decision: ApprovalDecision) -> None:
        approval = self.approvals.get(approval_id)
        if not approval or approval.status != ApprovalStatus.pending:
            return
        plan = self.pending_plans.pop(approval_id, None)
        self._drop_speculation()
        res = approval_manager.resolve(approval, decision, plan)
        self._bg_task(self._save_approval(approval))
        label = {"approved": "Approved", "rejected": "Rejected",
                 "alternative": "Replaced with your reply"}[decision.decision.value]
        await self.add_event(TranscriptEvent(
            conversation_id=self.conv.id, speaker=Speaker.user, kind=EventKind.approval,
            text=f"{label}: {decision.alternative_text or approval.proposed}",
            meta={"approval_id": approval.id, "decision": decision.decision.value}))
        await self.emit({"type": "approval.resolved", "approval": approval.model_dump(mode="json")})
        self.negotiation.approval_required = any(
            a.status == ApprovalStatus.pending for a in self.approvals.values())
        if res.instruction:
            self.instructions.append((None, res.instruction))
            self.authorised_amounts |= set(extract_amounts(res.instruction))
        if res.disclose_key:
            f = self.profile.field(res.disclose_key)
            if f and f.value:
                self.approved_disclosures[f.key] = f.value
        if res.authorise_amounts and plan:
            self.authorised_amounts |= {o.amount for o in plan.offers_made if o.amount}
            self.authorised_amounts |= set(extract_amounts(plan.response_text))
        if res.commitment:
            self.commitment_approved = True
            self.negotiation.commitments.append(res.commitment)
            if res.commitment not in self.negotiation.agreements:
                self.negotiation.agreements.append(res.commitment)
        await self.emit_negotiation()
        if self.paused or self.takeover_active:
            await self.set_state(S.paused)
            return
        if res.speak_proposed and plan:
            self.schedule(self.speak_agent_plan(plan), kind="agent")
        else:
            self.schedule(self.run_agent_turn(directive=res.directive), kind="agent")

    async def set_muted(self, muted: bool) -> None:
        self.muted = muted
        await self.emit(self.state_msg())

    # ---- microphone / STT (live mode) ------------------------------------------------------
    async def on_audio(self, pcm: bytes) -> None:
        if (not self.channel.uses_microphone or self.muted
                or self.state in (S.completed, S.failed, S.ready, S.connecting)):
            return
        if self.stt is None:
            if time.monotonic() < self.stt_retry_at:
                return
            try:
                lang = self.spec.counterparty.preferred_language
                self.stt = await self.c.stt.open_stream(to_code(lang, "auto") if lang else "auto")
            except AppError as e:
                self.stt_retry_at = time.monotonic() + 5
                await self.error(e)
                return
            self.stt_task = asyncio.create_task(self._stt_loop(self.stt))
        await self.stt.send_pcm(pcm)

    async def _stt_loop(self, stream: STTStream) -> None:
        partial_ids: dict[Any, str] = {}
        try:
            async for ev in stream.events():
                uid = partial_ids.setdefault(ev.utterance, f"utt-{time.time_ns()}")
                if ev.type == "partial" and ev.text.strip():
                    if self.state == S.speaking and self.task_kind == "agent":
                        await self.interrupt(barge_in=True)
                    await self.emit({"type": "transcript.partial", "utterance_id": uid,
                                     "speaker": "counterparty", "text": ev.text})
                elif ev.type == "final":
                    partial_ids.pop(ev.utterance, None)
                    await self.counterparty_said(ev.text, to_name(ev.language_code), "voice", uid)
                elif ev.type == "error":
                    await self.error(AppError(ErrorKind.speech_failed, ev.error or "STT error",
                                              provider="Sarvam", retryable=True))
                    if ev.fatal:
                        break
        finally:
            if self.stt is stream:
                self.stt = None
                self.stt_retry_at = time.monotonic() + 1.5

    async def _close_stt(self) -> None:
        if self.stt:
            await self.stt.close()
            self.stt = None
        if self.stt_task:
            self.stt_task.cancel()
            self.stt_task = None

    async def shutdown(self) -> None:
        self._drop_speculation()
        await self._cancel_task()
        await self._close_stt()
