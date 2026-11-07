"""Engine-level conversation tests with a scripted LLM (no network, no audio)."""

import asyncio

from app.models.conversation import (
    ApprovalDecision,
    ApprovalStatus,
    ConversationMode,
)
from app.models.conversation import (
    ConversationState as S,
)
from app.models.transcript import EventKind, Speaker
from app.realtime.session import LiveSession

from .fakes import ScriptedLLM

PERSONA = {"name": "Mr. Rao", "role": "landlord", "personality": "firm",
           "opening_position": "₹35,000", "reservation_terms": "₹32,000"}


def turn(text, **kw):
    return {"response_text": text, "response_language": "English", **kw}


async def settle(session: LiveSession, timeout: float = 2.0):
    """Wait until the session's current task finishes."""
    for _ in range(int(timeout / 0.01)):
        await asyncio.sleep(0.01)
        if session.task is None or session.task.done():
            await asyncio.sleep(0.01)
            if session.task is None or session.task.done():
                return
    raise AssertionError(f"session did not settle; state={session.state}")


async def test_opening_then_text_and_voice_share_one_context(make_session):
    llm = ScriptedLLM({"turn": [turn("₹30,000 would be fair for a 12-month lease."),
                                turn("I understand. Could you meet me at ₹30,500?")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    assert s.events[-1].speaker == Speaker.agent and "AI assistant" in s.events[-1].text
    assert s.state == S.listening

    await s.counterparty_said("Rent is ₹35,000.", "English", "voice")   # via STT
    await settle(s)
    await s.counterparty_said("Okay, ₹34,000 then.", "English", "text")  # typed
    await settle(s)
    prompt = llm.last_prompt("turn")
    assert "₹35,000" in prompt and "₹34,000" in prompt  # both inputs in the same context
    assert {e.source for e in s.events if e.speaker == Speaker.counterparty} == {"voice", "text"}


async def test_intervention_takes_priority_and_triggers_a_turn(make_session):
    llm = ScriptedLLM({"turn": [turn("Could maintenance be included at ₹32,000?")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("₹34,000 is my final offer.", None, "text")
    # don't let the agent answer yet: pause, intervene, resume
    await s.pause()
    await s.intervene("Ask if he can include maintenance at ₹32,000.")
    assert s.events[-1].kind == EventKind.instruction
    await s.resume()
    await settle(s)
    prompt = llm.last_prompt("turn")
    assert "NEW FROM THE PRINCIPAL" in prompt and "maintenance" in prompt
    assert s.events[-1].text.startswith("Could maintenance")


async def test_intervention_while_listening_acts_immediately(make_session):
    llm = ScriptedLLM({"turn": [turn("Also, could the deposit be lowered?")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.intervene("Ask for a lower security deposit.")
    await settle(s)
    assert s.events[-1].speaker == Speaker.agent and "deposit" in s.events[-1].text


async def test_limit_breach_pauses_for_approval_then_resumes(make_session):
    llm = ScriptedLLM({"turn": [
        turn("Could we meet at ₹33,000?",
             offers_made=[{"by": "agent", "amount": 33000, "quantity_name": "monthly_rent",
                           "terms": "33k"}]),
    ]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("I won't go below ₹34,000.", None, "text")
    await settle(s)
    assert s.state == S.awaiting_approval
    (approval,) = s.approvals.values()
    assert approval.kind.value == "negotiation_authority"
    assert s.events[-1].kind == EventKind.approval
    # The offer must not have been spoken.
    assert not any("33,000" in e.text for e in s.events if e.speaker == Speaker.agent)

    # Counterparty speaks while we wait: agent holds.
    await s.counterparty_said("Hello?", None, "text")
    await settle(s)
    assert s.state == S.awaiting_approval

    await s.decide(approval.id, ApprovalDecision(decision=ApprovalStatus.approved))
    await settle(s)
    assert approval.status == ApprovalStatus.approved
    assert any("₹33,000" in e.text for e in s.events if e.speaker == Speaker.agent)
    assert 33000 in s.authorised_amounts


async def test_rejected_approval_replans_with_directive(make_session):
    llm = ScriptedLLM({"turn": [turn("Deal at ₹31,000.", accepts_offer=True),
                                turn("I'm afraid ₹31,000 doesn't work. Could you do ₹30,000?")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("₹31,000, final.", None, "text")
    await settle(s)
    (approval,) = s.approvals.values()
    assert approval.kind.value == "final_commitment"
    await s.decide(approval.id, ApprovalDecision(decision=ApprovalStatus.rejected))
    await settle(s)
    assert "REJECTED" in llm.last_prompt("turn")
    assert s.events[-1].text.startswith("I'm afraid")


async def test_approved_commitment_recorded_and_completes(make_session):
    llm = ScriptedLLM({
        "turn": [turn("₹30,000 for 12 months works for us.", accepts_offer=True,
                      accepted_terms="₹30,000/month, 12-month lease")],
        "report": [{"final_outcome": "Agreed ₹30,000", "achieved_values": {"monthly_rent": 30000},
                    "criteria": [{"criterion": "Rent ≤ ₹30,000", "met": True,
                                  "evidence": "agreed"}]}],
    })
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("Fine, ₹30,000 for 12 months.", None, "text")
    await settle(s)
    (approval,) = s.approvals.values()
    await s.decide(approval.id, ApprovalDecision(decision=ApprovalStatus.approved))
    await settle(s)
    assert s.negotiation.commitments == ["₹30,000/month, 12-month lease"]
    await s.finish("done")
    await s.report_task
    report = await s.c.repo.get_report(s.conv.id)
    assert report.objective_achieved and report.comparisons[0].met


async def test_report_not_successful_without_agreed_value(make_session):
    llm = ScriptedLLM({"report": [{"final_outcome": "Friendly chat, no deal",
                                   "criteria": [{"criterion": "Rent ≤ ₹30,000", "met": True,
                                                 "evidence": "they were nice"}]}]})
    s = make_session(llm)
    await s.finish("ended")
    await s.report_task
    report = await s.c.repo.get_report(s.conv.id)
    assert not report.objective_achieved
    assert "No agreed value" in report.achievement_rationale


async def test_restricted_disclosure_regenerates_then_falls_back(make_session):
    llm = ScriptedLLM({"turn": [turn("Her salary is 24 LPA."), turn("She earns 24 LPA.")]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("How much does she earn?", None, "text")
    await settle(s)
    spoken = [e.text for e in s.events if e.speaker == Speaker.agent]
    assert not any("24 LPA" in t for t in spoken)
    assert "check that with the person" in spoken[-1]


async def test_disclosure_request_goes_through_approval(make_session):
    llm = ScriptedLLM({"turn": [
        turn("Let me check on that.", wants_disclosure=["phone"]),
        turn("Sure, her number is 98450 12345."),
    ]})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.counterparty_said("Can I get her phone number?", None, "text")
    await settle(s)
    (approval,) = s.approvals.values()
    assert approval.kind.value == "info_disclosure" and approval.disclosure_key == "phone"
    await s.decide(approval.id, ApprovalDecision(decision=ApprovalStatus.approved))
    await settle(s)
    assert "98450 12345" in llm.last_prompt("turn")
    assert s.events[-1].text.endswith("98450 12345.")
    assert s.approved_disclosures == {}  # one turn only


async def test_simulated_mode_runs_counterparty(make_session):
    llm = ScriptedLLM({
        "persona": [PERSONA],
        "simulate": [{"text": "It's ₹35,000.", "language": "English"},
                     {"text": "Bye.", "end_conversation": True}],
        "turn": [turn("Could we do ₹30,000?"), turn("Thank you, goodbye.", end_conversation=True)],
        "report": [{"final_outcome": "No deal"}],
    })
    s = make_session(llm, mode=ConversationMode.simulated)
    await s.start()
    for _ in range(6):
        await settle(s)
    speakers = [e.speaker for e in s.events if e.kind == EventKind.speech]
    assert speakers[:3] == [Speaker.agent, Speaker.counterparty, Speaker.agent]
    assert s.state == S.completed


async def test_takeover_relays_and_suspends_agent(make_session):
    llm = ScriptedLLM({"turn": []})
    s = make_session(llm)
    await s.start()
    await settle(s)
    await s.intervene("Pause and let me take over.")
    assert s.takeover_active and s.state == S.paused
    await s.principal_say("Hi, this is Ananya herself.")
    await settle(s)
    await s.counterparty_said("Oh hello!", None, "text")
    await settle(s)
    assert s.state == S.paused  # agent did not answer (no scripted turn needed)
    assert any(e.speaker == Speaker.user and e.kind == EventKind.speech for e in s.events)


async def test_provider_failure_surfaces_error_and_recovers(make_session):
    from app.core.errors import AppError, ErrorKind

    llm = ScriptedLLM({"turn": [AppError(ErrorKind.rate_limited, "OpenRouter rate limit hit.",
                                         retryable=True), turn("Sorry, could you repeat?")]})
    s = make_session(llm)
    sent = []

    async def sink(m):
        sent.append(m)

    s.attach(sink)
    await s.start()
    await settle(s)
    await s.counterparty_said("Hello?", None, "text")
    await settle(s)
    assert any(m["type"] == "error" and m["error"]["kind"] == "rate_limited" for m in sent)
    assert s.state == S.listening
    await s.counterparty_said("Hello??", None, "text")
    await settle(s)
    assert s.events[-1].text == "Sorry, could you repeat?"


async def test_missing_key_pauses_session(make_session):
    from app.core.errors import missing_key

    s = make_session(ScriptedLLM({"turn": [missing_key("OpenRouter", "OPENROUTER_API_KEY")]}))
    await s.start()
    await settle(s)
    await s.counterparty_said("Hi", None, "text")
    await settle(s)
    assert s.state == S.paused
    assert "OPENROUTER_API_KEY" in s.events[-1].text
