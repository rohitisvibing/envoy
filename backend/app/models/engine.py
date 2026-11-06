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


class TurnPlan(Schema):
    state_delta: StateDelta = Field(default_factory=StateDelta)
    response_text: str = Field(description="Exactly what the agent says next (1-3 sentences)")
    response_language: str = Field(default="English",
                                   description="Language of response_text, e.g. Kannada")
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
    end_conversation: bool = False
