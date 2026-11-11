"""Latency work: the line goes first, notes follow; practice mode thinks ahead."""

import asyncio

from app.models.conversation import ConversationMode
from app.models.engine import StateDelta
from app.models.mission import ExtractRequest
from app.models.transcript import EventKind, Speaker
from app.providers.translate.base import TranslationProvider
from app.services import strategy_engine
from app.services.objective_engine import extract

from .fakes import ScriptedLLM
from .test_conversation_flow import PERSONA, settle, turn


class SlowNotes(ScriptedLLM):
    """State updates take a while, like a real model call."""

    def __init__(self, script, delay=0.3):
        super().__init__(script)
        self.delay = delay
        self.order: list[str] = []

    async def complete_json(self, schema, messages, *, task, **kw):
        if task == "state":
            await asyncio.sleep(self.delay)
            self.order.append("state")
        result = await super().complete_json(schema, messages, task=task, **kw)
        if task == "turn":
            self.order.append("turn")
        return result


async def test_line_is_spoken_before_the_notes_update(make_session):
    delta = StateDelta(offers_received=[{"by": "counterparty", "amount": 35000,
                                         "quantity_name": "monthly_rent", "terms": "₹35,000"}])
    llm = SlowNotes({"turn": [turn("Could we talk about ₹30,000?", state_delta=delta)]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("Rent is ₹35,000.", None, "text")
    await settle(s)
    # The agent's line is out, while the notes are still being written.
    assert s.events[-1].speaker == Speaker.agent
    assert not s.negotiation.offers_received
    await asyncio.sleep(0.4)
    assert [o.amount for o in s.negotiation.offers_received] == [35000]


async def test_next_line_waits_for_pending_notes(make_session):
    llm = SlowNotes({"turn": [turn("₹30,000?"), turn("₹30,500 then?")]}, delay=0.25)
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("Rent is ₹35,000.", None, "text")
    await settle(s)
    await s.counterparty_said("No, ₹34,000.", None, "text")
    await settle(s, timeout=3)
    # Second turn was planned only after the first turn's notes landed.
    assert llm.order[:3] == ["turn", "state", "turn"]


def _practice(make_session, llm):
    s = make_session(llm, mode=ConversationMode.simulated)
    s.speculate = True
    return s


async def test_practice_mode_prepares_the_next_lines_ahead(make_session):
    llm = ScriptedLLM({"persona": [PERSONA],
                       "simulate": [{"text": "The rent is ₹35,000."},
                                    {"text": "Okay, goodbye.", "end_conversation": True}],
                       "turn": [turn("Could we do ₹30,000?"),
                                turn("Thank you, goodbye.", end_conversation=True)]})
    s = _practice(make_session, llm)
    await s.start()
    for _ in range(300):
        await asyncio.sleep(0.01)
        if s.state.value == "completed":
            break
    speech = [e.text for e in s.events if e.kind == EventKind.speech]
    assert speech[:3] == [s.mission.brief.opening_statement, "The rent is ₹35,000.",
                          "Could we do ₹30,000?"]
    # The agent's reply was planned from the landlord's line before it was "heard".
    first_turn = next(m for t, m in llm.calls if t == "turn")
    assert "The rent is ₹35,000." in "\n".join(x.content for x in first_turn)


async def test_a_nudge_discards_the_reply_prepared_in_advance(make_session):
    llm = ScriptedLLM({"persona": [PERSONA],
                       "simulate": [{"text": "The rent is ₹35,000."}],
                       "turn": [turn("Could we do ₹30,000?"),
                                turn("Is maintenance included in that?")]})
    s = _practice(make_session, llm)

    async def _play(event, speaker, audio=None):  # the landlord's line takes a moment
        await asyncio.sleep(0.3 if speaker == Speaker.counterparty else 0)
    s._play = _play  # type: ignore[method-assign]
    await s.start()
    for _ in range(200):
        await asyncio.sleep(0.01)
        if any(e.speaker == Speaker.counterparty for e in s.events):
            break
    await asyncio.sleep(0.05)  # the speculative reply has been planned by now
    await s.intervene("Ask whether maintenance is included.")
    for _ in range(200):
        await asyncio.sleep(0.01)
        if s.events[-1].speaker == Speaker.agent and "maintenance" in s.events[-1].text:
            break
    agent_lines = [e.text for e in s.events if e.speaker == Speaker.agent]
    assert "Could we do ₹30,000?" not in agent_lines
    assert agent_lines[-1] == "Is maintenance included in that?"
    assert "Ask whether maintenance" in llm.last_prompt("turn")


class FakeTranslator(TranslationProvider):
    def __init__(self, fail=False):
        self.fail = fail
        self.seen: list[str] = []

    async def to_english(self, text, source_language_code="auto"):
        self.seen.append(source_language_code)
        if self.fail:
            raise RuntimeError("translate down")
        return "The rent is 35,000."


async def test_live_lines_get_an_english_rendering(make_session):
    llm = ScriptedLLM({"turn": [turn("ಸರಿ, ₹30,000 ಆಗುತ್ತದೆಯೇ?", response_language="Kannada",
                                     response_text_en="Okay, would ₹30,000 work?")]})
    s = make_session(llm)
    s.c.translator = FakeTranslator()
    sent: list[dict] = []

    async def sink(m):
        sent.append(m)
    s.attach(sink)
    await s.start()
    await settle(s)
    await s.counterparty_said("ಬಾಡಿಗೆ ₹35,000.", "Kannada", "voice")
    await settle(s)
    await asyncio.sleep(0.05)
    them = next(e for e in s.events if e.speaker == Speaker.counterparty)
    agent = s.events[-1]
    assert them.meta["en"] == "The rent is 35,000." and s.c.translator.seen == ["kn-IN"]
    assert agent.meta["en"] == "Okay, would ₹30,000 work?"
    assert any(m["type"] == "transcript.update" and m["id"] == them.id for m in sent)


async def test_translation_failure_never_stops_the_call(make_session):
    llm = ScriptedLLM({"turn": [turn("₹30,000?")]})
    s = make_session(llm)
    s.c.translator = FakeTranslator(fail=True)
    await s.start()
    await settle(s)
    await s.counterparty_said("ಬಾಡಿಗೆ ₹35,000.", "Kannada", "voice")
    await settle(s)
    assert s.events[-1].text == "₹30,000?" and "en" not in s.events[-2].meta


async def test_agent_name_from_the_request_reaches_the_opening(container, profile):
    req = ExtractRequest(text="Call yourself Maya. Negotiate my rent from ₹35,000 to ₹30,000, "
                              "never above ₹32,000.")
    result = await extract(container.llm, req, profile)
    assert result.spec.communication.agent_name == "Maya"
    brief = await strategy_engine.prepare(container.llm, result.spec, profile)
    assert "this is Maya" in brief.opening_statement and "AI" not in brief.opening_statement


async def test_old_openings_that_announce_ai_are_rewritten(make_session):
    llm = ScriptedLLM({"turn": [turn("Hi, this is an assistant calling for Ananya.")]})
    s = make_session(llm)
    s.mission.brief.opening_statement = "Hello, I'm an AI assistant calling for Ananya."
    await s.start()
    await settle(s)
    assert s.events[-1].text == "Hi, this is an assistant calling for Ananya."
