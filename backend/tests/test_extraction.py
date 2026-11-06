from app.models.mission import ApprovalKind, ExtractRequest
from app.services import objective_engine

from .conftest import RENT_REQUEST
from .fakes import ScriptedLLM

BASE = {
    "title": "Rent negotiator", "objective": "Negotiate rent", "desired_outcome": "₹30,000",
    "targets": [{"name": "monthly_rent", "label": "Monthly rent", "value": 30000,
                 "direction": "max"}],
}


async def test_demo_extraction_finds_target_limit_and_languages(container, profile):
    r = await objective_engine.extract(container.llm, ExtractRequest(text=RENT_REQUEST), profile)
    assert r.spec.targets[0].value == 30000
    assert r.spec.hard_limits[0].value == 32000 and r.spec.hard_limits[0].direction == "max"
    assert "Kannada" in r.spec.communication.languages


async def test_final_commitment_approval_always_added(profile):
    llm = ScriptedLLM({"extract": [{"spec": BASE | {"hard_limits": [
        {"name": "monthly_rent", "label": "Monthly rent", "value": 32000, "direction": "max"}]}}]})
    r = await objective_engine.extract(llm, ExtractRequest(text=RENT_REQUEST), profile)
    assert any(a.kind == ApprovalKind.final_commitment for a in r.spec.approval_requirements)


async def test_missing_limit_is_flagged_not_invented(profile):
    llm = ScriptedLLM({"extract": [{"spec": BASE}]})
    r = await objective_engine.extract(llm, ExtractRequest(text="Get my rent down to 30k."),
                                       profile)
    assert r.spec.hard_limits == []
    assert any("hard limit" in m.lower() for m in r.missing_information)
    assert any(a.kind == ApprovalKind.negotiation_authority for a in r.spec.approval_requirements)


async def test_conflict_target_beyond_limit(profile):
    llm = ScriptedLLM({"extract": [{"spec": BASE | {
        "targets": [{"name": "monthly_rent", "label": "Monthly rent", "value": 33000,
                     "direction": "max"}],
        "hard_limits": [{"name": "monthly_rent", "label": "Monthly rent", "value": 32000,
                         "direction": "max"}]}}]})
    r = await objective_engine.extract(llm, ExtractRequest(text=RENT_REQUEST), profile)
    assert r.conflicts and "beyond" in r.conflicts[0]


async def test_explicit_settings_override_model(profile):
    llm = ScriptedLLM({"extract": [{"spec": BASE}]})
    r = await objective_engine.extract(
        llm, ExtractRequest(text=RENT_REQUEST, languages=["Hindi"], tone="warm"), profile)
    assert r.spec.communication.languages == ["Hindi"] and r.spec.communication.tone == "warm"


async def test_prompt_contains_no_restricted_profile_values(profile):
    llm = ScriptedLLM({"extract": [{"spec": BASE}]})
    await objective_engine.extract(llm, ExtractRequest(text=RENT_REQUEST), profile)
    assert "24 LPA" not in llm.last_prompt("extract")
