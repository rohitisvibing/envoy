"""Mission specification: the structured objective an agent executes."""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field

from .common import Schema, new_id, utcnow


class ApprovalKind(StrEnum):
    info_disclosure = "info_disclosure"            # sharing restricted personal information
    negotiation_authority = "negotiation_authority"  # going beyond the agreed negotiation range
    financial = "financial"                        # any financial commitment
    final_commitment = "final_commitment"          # accepting a final deal / binding agreement


class Quantity(Schema):
    """A numeric target or limit the policy guard can check deterministically."""

    name: str = Field(description="snake_case name, e.g. monthly_rent")
    label: str = Field(description="Human label, e.g. Monthly rent")
    value: float
    unit: str = Field(default="INR", description="Currency code or unit, e.g. INR, months")
    direction: Literal["max", "min"] = Field(
        description="max: must not exceed (we pay). min: must not go below (we receive)."
    )


class Counterparty(Schema):
    type: str = Field(default="other party", description="e.g. landlord, customer support")
    name: str | None = None
    preferred_language: str | None = None
    notes: str | None = None


class Communication(Schema):
    languages: list[str] = Field(default_factory=lambda: ["English"])
    tone: str = "polite and clear"
    personality: str | None = None
    agent_name: str | None = Field(
        default=None, description="Name the agent introduces itself with, if the person gave one")
    announce_ai: bool = Field(
        default=False, description="Say up front that the caller is an AI assistant")


class ApprovalRequirement(Schema):
    kind: ApprovalKind
    condition: str


class MissionSpec(Schema):
    title: str
    objective: str
    desired_outcome: str
    targets: list[Quantity] = Field(default_factory=list,
                                    description="Ideal values the agent aims for")
    hard_limits: list[Quantity] = Field(default_factory=list,
                                        description="Values the agent must never cross")
    minimum_requirements: list[str] = Field(default_factory=list)
    context: list[str] = Field(default_factory=list)
    counterparty: Counterparty = Field(default_factory=Counterparty)
    communication: Communication = Field(default_factory=Communication)
    strategy: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    approval_requirements: list[ApprovalRequirement] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)

    def limit(self, name: str) -> Quantity | None:
        return next((q for q in self.hard_limits if q.name == name), None)


class ExtractionResult(Schema):
    spec: MissionSpec
    missing_information: list[str] = Field(default_factory=list)
    ambiguities: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)


class MissionStatus(StrEnum):
    draft = "draft"
    approved = "approved"
    prepared = "prepared"
    active = "active"
    completed = "completed"
    failed = "failed"


class Objection(Schema):
    objection: str
    response: str


class PreparationBrief(Schema):
    opening_statement: str
    opening_language: str = "English"
    strategy_steps: list[str] = Field(default_factory=list)
    anticipated_objections: list[Objection] = Field(default_factory=list)
    approval_triggers: list[str] = Field(default_factory=list)
    disclosure_plan: list[str] = Field(default_factory=list)
    walk_away_conditions: list[str] = Field(default_factory=list)


class Mission(Schema):
    id: str = Field(default_factory=new_id)
    principal_id: str
    status: MissionStatus = MissionStatus.draft
    raw_input: str
    agent_type: str = "Negotiator"
    spec: MissionSpec
    extraction: ExtractionResult | None = None
    brief: PreparationBrief | None = None
    template_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class ExtractRequest(Schema):
    text: str = Field(min_length=8, max_length=6000)
    counterparty_type: str | None = None
    languages: list[str] | None = None
    tone: str | None = None
    template_id: str | None = None


class RefineRequest(Schema):
    answers: dict[str, str]


class AgentTemplate(Schema):
    id: str = Field(default_factory=new_id)
    name: str
    description: str
    agent_type: str
    prompt_example: str
