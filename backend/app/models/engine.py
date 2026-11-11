"""Schemas exchanged with the LLM by the objective engine (structured outputs)."""

from pydantic import Field

from .common import Schema
from .conversation import Offer
from .mission import ApprovalKind


class StateDelta(Schema):
    phase: str | None = Field(default=None, description="opening|discovery|negotiating|closing")
    new_facts: list[str] = Field(default_factory=list,
                                 description="New facts established in the latest exchange")
    counterparty_positions: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    offers_received: list[Offer] = Field(
        default_factory=list, description="Offers the counterparty made in their latest turn")
    agreements: list[str] = Field(default_factory=list,
                                  description="Points both sides explicitly agreed on")
    remaining_objectives: list[str] | None = Field(
        default=None, description="Full replacement list of what is still to achieve")
    next_action: str | None = None
    summary: str | None = Field(default=None,
                                description="Updated 1-3 sentence running summary")


class ApprovalNeed(Schema):
    kind: ApprovalKind
    request: str = Field(description="What the counterparty is asking for")
    proposed: str = Field(description="The exact reply/commitment the agent wants to make")
    reason: str
    request_en: str | None = Field(default=None, description="English of request, if not English")
    proposed_en: str | None = Field(default=None,
                                    description="English of proposed, if not English")


class TurnSay(Schema):
    """The critical path of a turn: what to say now and the flags the safety check needs.

    response_text comes first so the line is decided before anything else. How the
    negotiation moved is tracked separately (StateDelta) while the line is being spoken.
    """

    response_text: str = Field(default="", description="Exactly what the agent says next (1-3 sentences)")
    response_language: str = Field(default="English",
                                   description="Language of response_text, e.g. Kannada")
    response_text_en: str | None = Field(
        default=None, description="English translation of response_text; null if it is English")
    offers_made: list[Offer] = Field(default_factory=list,
                                     description="Any offer/counter-offer in response_text")
    accepts_offer: bool = Field(default=False,
                                description="True if response_text accepts a deal or terms")
    accepted_terms: str | None = None
    needs_approval: ApprovalNeed | None = None
    holding_line: str | None = Field(
        default=None, description="If approval is needed: a short line to say while waiting")
    wants_disclosure: list[str] = Field(
        default_factory=list, description="Keys of approval-gated profile fields you need")
    objective_met: bool = False
    end_conversation: bool = Field(default=False,
                                   description="True if response_text is a closing goodbye")
    hold: bool = Field(
        default=False,
        description="Only when acting on a new principal instruction with nothing worth saying "
                    "right now; response_text empty. Allowed only if the DIRECTIVE permits it.")


class TurnPlan(TurnSay):
    """A full turn as the session handles it: the line plus how the negotiation moved."""

    state_delta: StateDelta = Field(default_factory=StateDelta)


class SimulatorPersona(Schema):
    name: str
    role: str
    personality: str
    opening_position: str
    reservation_terms: str = Field(description="Private: the most they will concede")
    concerns: list[str] = Field(default_factory=list)
    language: str = "English"


class SimulatorTurn(Schema):
    text: str
    language: str = "English"
    text_en: str | None = Field(default=None,
                                description="English translation of text; null if it is English")
    end_conversation: bool = False
