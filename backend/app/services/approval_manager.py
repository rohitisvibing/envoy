"""Approval workflow: create requests, resolve them, and translate decisions into directives."""

from dataclasses import dataclass

from app.models.common import utcnow
from app.models.conversation import Approval, ApprovalDecision, ApprovalStatus
from app.models.engine import ApprovalNeed, TurnPlan
from app.models.mission import ApprovalKind

HOLDING_LINES = {
    "Kannada": "ಒಂದು ನಿಮಿಷ, ನಾನು ಇದನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳುತ್ತೇನೆ.",
    "Hindi": "एक मिनट, मैं इसकी पुष्टि कर लेता हूँ।",
    "Tamil": "ஒரு நிமிடம், நான் இதை உறுதி செய்கிறேன்.",
    "Telugu": "ఒక్క నిమిషం, నేను దీన్ని నిర్ధారించుకుంటాను.",
    "English": "One moment please, let me confirm that.",
}


def holding_line(plan: TurnPlan) -> str:
    if plan.holding_line:
        return plan.holding_line
    return HOLDING_LINES.get(plan.response_language, HOLDING_LINES["English"])


def create(conversation_id: str, need: ApprovalNeed, disclosure_key: str | None) -> Approval:
    return Approval(conversation_id=conversation_id, kind=need.kind, request=need.request,
                    proposed=need.proposed, reason=need.reason, disclosure_key=disclosure_key)


@dataclass
class Resolution:
    """What the session should do next after the principal decides."""

    speak_proposed: bool = False          # say the held response verbatim
    directive: str | None = None          # or plan a fresh turn with this directive
    instruction: str | None = None        # a new principal instruction to record
    disclose_key: str | None = None       # one-turn disclosure
    authorise_amounts: bool = False       # amounts in the held plan become authorised
    commitment: str | None = None         # a commitment to record in state


def resolve(approval: Approval, decision: ApprovalDecision, plan: TurnPlan | None) -> Resolution:
    approval.status = decision.decision
    approval.alternative_text = decision.alternative_text
    approval.resolved_at = utcnow()
    if decision.decision == ApprovalStatus.approved:
        if approval.kind == ApprovalKind.info_disclosure:
            return Resolution(disclose_key=approval.disclosure_key,
                              directive="The principal approved sharing the requested "
                                        "information. Answer the counterparty's question now.")
        res = Resolution(speak_proposed=plan is not None, authorise_amounts=True)
        if approval.kind in (ApprovalKind.final_commitment, ApprovalKind.financial):
            res.commitment = (plan.accepted_terms if plan and plan.accepted_terms
                              else approval.proposed)
        if plan is None:
            res.directive = f"The principal approved: {approval.proposed}. Proceed with it."
        return res
    if decision.decision == ApprovalStatus.rejected:
        return Resolution(directive=(
            f"The principal REJECTED this: \"{approval.proposed}\". Do not do it or imply it. "
            "Politely continue toward the objective within your limits."))
    alt = (decision.alternative_text or "").strip()
    return Resolution(instruction=alt, directive=(
        f"The principal wants you to respond this way instead: \"{alt}\". Say that now, "
        "in the conversation's language."))
