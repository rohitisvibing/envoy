"""Live nudges: typed principal instructions during a running conversation."""

import asyncio

import pytest

from app.models.conversation import ApprovalDecision, ApprovalStatus, ConversationMode
from app.models.conversation import ConversationState as S
from app.models.transcript import EventKind, Speaker
from app.services.context_manager import turn_context

from .fakes import ScriptedLLM
from .test_conversation_flow import PERSONA, settle, turn


def slow_speech(session, seconds=0.3):
    """Make each spoken line take real time, so nudges can arrive mid-line."""
    async def _play(event, speaker):
        await asyncio.sleep(seconds)
    session._play = _play  # type: ignore[method-assign]


def collect(session):
    sent: list[dict] = []

    async def sink(m):
        sent.append(m)

    session.attach(sink)
    return sent


def nudge_events(s):
    return [e for e in s.events if e.kind == EventKind.instruction]


async def test_style_nudge_while_listening_holds_and_is_noted(make_session):
    llm = ScriptedLLM({"turn": [{"hold": True, "response_text": ""}]})
    s = make_session(llm)
    sent = collect(s)
    await s.start()
    await settle(s)
    spoken_before = sum(1 for e in s.events if e.kind == EventKind.speech)
    await s.intervene("Be firmer from now on.")
    await settle(s)
    assert sum(1 for e in s.events if e.kind == EventKind.speech) == spoken_before
    assert nudge_events(s)[-1].meta["status"] == "noted"
    statuses = [m["status"] for m in sent if m["type"] == "instruction.status"]
    assert statuses == ["queued", "noted"]
    assert s.state == S.listening
    # It stays in force as a standing instruction on later turns.
    llm.push("turn", turn("₹30,000 is a fair rent."))
    await s.counterparty_said("What's your offer?", None, "text")
    await settle(s)
    prompt = llm.last_prompt("turn")
    assert "STANDING PRINCIPAL INSTRUCTIONS" in prompt and "Be firmer" in prompt
    assert "NEW FROM THE PRINCIPAL" not in prompt


async def test_hold_not_allowed_outside_nudge_turns(make_session):
    llm = ScriptedLLM({"turn": [{"hold": True, "response_text": ""}, turn("₹30,000, please.")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("Rent is ₹35,000.", None, "text")
    await settle(s)
    assert s.events[-1].text == "₹30,000, please."


async def test_nudge_while_agent_speaking_waits_for_the_line_to_finish(make_session):
    llm = ScriptedLLM({"turn": [turn("Could maintenance be included?")]})
    s = make_session(llm)
    slow_speech(s)
    await s.start()
    await asyncio.sleep(0.1)
    assert s.state == S.speaking
    await s.intervene("Ask about maintenance.")
    opening = next(e for e in s.events if e.speaker == Speaker.agent)
    assert nudge_events(s)[-1].meta["status"] == "queued"
    await settle(s, timeout=3)
    assert "interrupted" not in opening.meta  # the opening was not cut off
    line = s.events[-1]
    assert line.text == "Could maintenance be included?"
    nudge = nudge_events(s)[-1]
    assert line.meta["nudges"] == [nudge.id]
    assert nudge.meta["status"] == "applied" and nudge.meta["applied_in"] == line.id


async def test_nudge_does_not_cancel_simulated_counterparty(make_session):
    llm = ScriptedLLM({
        "persona": [PERSONA],
        "simulate": [{"text": "It's ₹35,000, final."}],
        "turn": [turn("Understood. Would ₹31,000 with maintenance work?")],
    })
    s = make_session(llm, mode=ConversationMode.simulated)
    slow_speech(s, 0.25)
    await s.start()
    # wait until the landlord is speaking
    for _ in range(100):
        await asyncio.sleep(0.01)
        if any(e.speaker == Speaker.counterparty for e in s.events):
            break
    landlord = next(e for e in s.events if e.speaker == Speaker.counterparty)
    await s.intervene("Ask about maintenance.")
    for _ in range(100):
        await asyncio.sleep(0.02)
        if nudge_events(s)[-1].meta.get("status") == "applied":
            break
    assert "interrupted" not in landlord.meta
    assert s.events[-1].meta.get("nudges") == [nudge_events(s)[-1].id]
    await s.shutdown()


async def test_urgent_nudge_cuts_in(make_session):
    llm = ScriptedLLM({"turn": [turn("Sorry, let me correct that: the deposit stays as is.")]})
    s = make_session(llm)
    slow_speech(s, 1.0)
    sent = collect(s)
    await s.start()
    await asyncio.sleep(0.1)
    assert s.state == S.speaking
    opening = next(e for e in s.events if e.speaker == Speaker.agent)
    await s.intervene("Stop, don't mention the deposit.", urgent=True)
    await settle(s, timeout=3)
    assert opening.meta.get("interrupted") is True
    assert any(m["type"] == "transcript.update" and m["id"] == opening.id for m in sent)
    assert s.events[-1].text.startswith("Sorry, let me correct")
    assert nudge_events(s)[-1].meta["status"] == "applied"


async def test_nudge_during_approval_waits_for_decision(make_session):
    llm = ScriptedLLM({"turn": [
        turn("₹31,000 works.", accepts_offer=True),
        turn("I'm sorry, ₹31,000 is still high. Could you include maintenance?"),
    ]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("₹31,000, final.", None, "text")
    await settle(s)
    assert s.state == S.awaiting_approval
    await s.intervene("Push for maintenance to be included.")
    await settle(s)
    assert s.state == S.awaiting_approval
    assert nudge_events(s)[-1].meta["status"] == "queued"
    (approval,) = s.approvals.values()
    await s.decide(approval.id, ApprovalDecision(decision=ApprovalStatus.rejected))
    await settle(s)
    prompt = llm.last_prompt("turn")
    assert "NEW FROM THE PRINCIPAL" in prompt and "maintenance" in prompt
    assert nudge_events(s)[-1].meta["status"] == "applied"


def test_context_sections_split_new_and_standing(rent_spec, profile):
    from app.models.conversation import NegotiationState

    text = turn_context(spec=rent_spec, brief=None, profile=profile,
                        negotiation=NegotiationState(), events=[],
                        new_instructions=["Ask about parking"],
                        standing_instructions=["Be firmer"])
    standing = text.index("STANDING PRINCIPAL INSTRUCTIONS")
    new = text.index("NEW FROM THE PRINCIPAL")
    assert standing < new
    assert "Be firmer" in text[standing:new] and "Ask about parking" in text[new:]


@pytest.mark.parametrize("text", ["Pause", "stop now.", "Wait a moment", "Let me take over"])
async def test_control_phrases_are_not_queued(make_session, text):
    s = make_session(ScriptedLLM())
    await s.start()
    await settle(s)
    await s.intervene(text)
    assert s.queued_nudges == []
    assert nudge_events(s)[-1].meta["status"] == "noted"
