from app.models.conversation import NegotiationState
from app.models.engine import TurnPlan
from app.services.context_manager import profile_context, turn_context
from app.services.policy_guard import Action, check_turn


def test_never_fields_are_excluded_entirely(profile):
    ctx = profile_context(profile)
    dumped = str(ctx)
    assert "24 LPA" not in dumped and "Salary" not in dumped


def test_approval_fields_listed_by_name_only(profile):
    ctx = profile_context(profile)
    assert "98450 12345" not in str(ctx)
    assert any("phone" in k for k in ctx["requires_principal_approval_before_sharing"])


def test_policies_route_to_correct_buckets(profile):
    ctx = profile_context(profile)
    assert ctx["may_share"] == {"Full name": "Ananya Iyer"}
    assert ctx["share_only_if_directly_relevant"] == {"Occupation": "Architect"}


def test_missing_values_are_not_presented(profile):
    ctx = profile_context(profile)
    assert "Company" not in str(ctx)


def test_approved_disclosure_is_included_for_that_turn(profile):
    ctx = profile_context(profile, approved={"phone": "98450 12345"})
    assert ctx["may_share"]["Phone number"] == "98450 12345"


def test_turn_context_never_contains_restricted_values(profile, rent_spec):
    text = turn_context(spec=rent_spec, brief=None, profile=profile,
                        negotiation=NegotiationState(), events=[], new_instructions=[],
                        standing_instructions=[])
    assert "24 LPA" not in text and "98450" not in text


def test_guard_blocks_restricted_values(profile, rent_spec):
    r = check_turn(TurnPlan(response_text="Her salary is 24 LPA so she can afford it."),
                   rent_spec, profile)
    assert r.action == Action.regenerate
    r = check_turn(TurnPlan(response_text="Call her on 9845012345."), rent_spec, profile)
    assert r.action == Action.regenerate
    r = check_turn(TurnPlan(response_text="Call her on 98450 12345."), rent_spec, profile,
                   approved_disclosures={"phone"})
    assert r.ok
