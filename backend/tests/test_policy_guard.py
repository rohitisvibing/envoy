import pytest

from app.models.conversation import Offer
from app.models.engine import TurnPlan
from app.models.mission import ApprovalKind
from app.services.policy_guard import Action, check_turn, extract_amounts


@pytest.mark.parametrize("text,expected", [
    ("₹32,000 per month", [32000]),
    ("Rs. 34000/-", [34000]),
    ("how about 31k", [31000]),
    ("thirty two thousand rupees", [32000]),
    ("1.5 lakh deposit", [150000]),
    ("₹1,50,000", [150000]),
    ("೩೨೦೦೦ ರೂಪಾಯಿ", [32000]),
    ("३३००० रुपये", [33000]),
])
def test_amount_parsing(text, expected):
    assert extract_amounts(text) == expected


def plan(text, **kw) -> TurnPlan:
    return TurnPlan(response_text=text, **kw)


def test_offer_above_limit_requires_negotiation_approval(rent_spec, profile):
    p = plan("Could we do ₹33,000?", offers_made=[Offer(by="agent", amount=33000,
                                                         quantity_name="monthly_rent", terms="")])
    r = check_turn(p, rent_spec, profile)
    assert r.action == Action.approval
    assert any(v.approval_kind == ApprovalKind.negotiation_authority for v in r.violations)


def test_offer_within_limit_is_allowed(rent_spec, profile):
    p = plan("Could we settle at ₹31,000?",
             offers_made=[Offer(by="agent", amount=31000, quantity_name="monthly_rent", terms="")])
    assert check_turn(p, rent_spec, profile).ok


def test_restating_counterparty_number_is_not_an_offer(rent_spec, profile):
    p = plan("I hear you on ₹35,000, but that's beyond what works. How about ₹30,000?")
    assert check_turn(p, rent_spec, profile, counterparty_amounts={35000}).ok


def test_unprompted_amount_above_limit_triggers_regeneration(rent_spec, profile):
    r = check_turn(plan("We could maybe stretch to ₹33,000."), rent_spec, profile)
    assert r.action == Action.regenerate


def test_authorised_amount_passes(rent_spec, profile):
    p = plan("Would ₹33,000 work?", offers_made=[Offer(by="agent", amount=33000, terms="")])
    assert check_turn(p, rent_spec, profile, authorised_amounts={33000}).ok


@pytest.mark.parametrize("text", ["Okay, we have a deal.", "I agree to ₹31,000.",
                                  "It's a deal then!", "I'll sign the agreement tomorrow."])
def test_commitments_need_final_approval(rent_spec, profile, text):
    r = check_turn(plan(text), rent_spec, profile)
    assert r.action == Action.approval
    assert any(v.approval_kind == ApprovalKind.final_commitment for v in r.violations)


def test_accepts_flag_needs_approval_even_without_phrase(rent_spec, profile):
    r = check_turn(plan("That works.", accepts_offer=True), rent_spec, profile)
    assert r.action == Action.approval


def test_commitment_allowed_after_preapproval(rent_spec, profile):
    r = check_turn(plan("Great, we have a deal."), rent_spec, profile,
                   final_commitment_preapproved=True)
    assert r.ok


def test_opening_requires_ai_disclosure(rent_spec, profile):
    assert check_turn(plan("Hello, I'm calling about the rent."), rent_spec, profile,
                      is_opening=True).action == Action.regenerate
    assert check_turn(plan("Hello, I'm an AI assistant calling for Ananya."), rent_spec, profile,
                      is_opening=True).ok
    assert check_turn(plan("ನಮಸ್ಕಾರ, ನಾನು ಅನನ್ಯ ಅವರ ಪರವಾಗಿ ಕರೆ ಮಾಡುತ್ತಿರುವ ಎಐ ಸಹಾಯಕ."),
                      rent_spec, profile, is_opening=True).ok
