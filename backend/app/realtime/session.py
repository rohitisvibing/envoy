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
from app.services.conversation_manager import TurnInputs, merge_delta, plan_turn
from app.services.policy_guard import extract_amounts

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

    async def speak(self, speaker: Speaker, text: str, language: str | None) -> TranscriptEvent:
        event = TranscriptEvent(conversation_id=self.conv.id, speaker=speaker, text=text,
                                language=language, source="voice" if self.voice_enabled
                                else "text")
        await self.add_event(event)
        await self.set_state(S.speaking if speaker in (Speaker.agent, Speaker.user)
                             else S.listening)
        self.speaking_turn = event.id
        try:
            await self._play(event, speaker)
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

    async def _play(self, event: TranscriptEvent, speaker: Speaker) -> None:
        reading_time = min(6.0, max(1.2, len(event.text) * 0.045)) if self.pace_text else 0
        if not (self.voice_enabled and self.sinks):
            await asyncio.sleep(reading_time if self.sinks else 0)
            return
        voice = self._voice_for(speaker, event.language)
        tts = self.c.tts
        done = asyncio.Event()
        self.playback[event.id] = done
        total, seq, first_at = 0, 0, None
        try:
            async for pcm in tts.synthesize(event.text, voice):
                if first_at is None:
                    first_at = time.monotonic()
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

    def playback_done(self, turn_id: str) -> None:
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
        await self.channel.prepare(self)
        self.mission.status = MissionStatus.active
        self._bg_task(self._save_mission())
        await self.system("Session started" + (" with a simulated counterparty"
                                              if self.conv.mode == ConversationMode.simulated
                                              else ". Listening through your microphone"))
        brief = self.mission.brief
        if brief:
            plan = TurnPlan(response_text=brief.opening_statement,
                            response_language=brief.opening_language)
            self.turn_no += 1
            await self.speak_agent_plan(plan)
        else:
            await self.run_agent_turn(directive="Open the conversation.", is_opening=True)

    async def _save_mission(self) -> None:
        with contextlib.suppress(Exception):
            self.mission.updated_at = utcnow()
            await self.c.repo.save_mission(self.mission)

    async def finish(self, reason: str, *, failed: bool = False) -> None:
        if self.state in (S.completed, S.failed):
            return
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

    async def run_agent_turn(self, directive: str | None = None, is_opening: bool = False,
                             allow_hold: bool = False) -> None:
        self.respond_after_speech = None
        self._turn_args = (directive, allow_hold)
        nudges = list(self.queued_nudges)
        await self.set_state(S.thinking)
        decision = await plan_turn(self.llm, self._inputs(directive, is_opening, allow_hold))
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
            self._bg_task(self._save_approval(approval))
            await self.speak(Speaker.agent, approval_manager.holding_line(plan),
                             plan.response_language)
            await self.add_event(TranscriptEvent(
                conversation_id=self.conv.id, speaker=Speaker.system, kind=EventKind.approval,
                text=decision.approval.reason or "Your approval is needed.",
                meta={"approval_id": approval.id}))
            await self.set_state(S.awaiting_approval)
            await self.emit({"type": "approval.request",
                             "approval": approval.model_dump(mode="json")})
            await self.emit_negotiation()
            return
        await self.speak_agent_plan(plan, nudges)

    async def speak_agent_plan(self, plan: TurnPlan, nudges: list[str] | None = None) -> None:
        for offer in plan.offers_made:
            offer.by, offer.turn = "agent", self.turn_no
            self.negotiation.offers_made.append(offer)
        if plan.objective_met:
            self.negotiation.objective_met = True
        await self.emit_negotiation()
        spoken = await self.speak(Speaker.agent, plan.response_text, plan.response_language)
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
        await channel.prepare(self)
        await self.set_state(S.listening)
        turn = await simulator.next_turn(self.llm, channel.persona, self.events)  # type: ignore[arg-type]
        event = await self.speak(Speaker.counterparty, turn.text, turn.language)
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
        await self.add_event(TranscriptEvent(
            conversation_id=self.conv.id, speaker=Speaker.counterparty, text=text.strip(),
            language=language, source=source,
            meta={"utterance_id": utterance_id} if utterance_id else {}))
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
        await self._cancel_task()
        await self._close_stt()
