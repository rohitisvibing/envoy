from datetime import datetime

from pydantic import Field

from .common import Schema, utcnow
from .conversation import Offer


class TargetComparison(Schema):
    name: str
    label: str
    target: float | None = None
    limit: float | None = None
    achieved: float | None = None
    unit: str = "INR"
    met: bool | None = None


class Excerpt(Schema):
    speaker: str
    text: str


class CriterionResult(Schema):
    criterion: str
    met: bool
    evidence: str


class OutcomeReport(Schema):
    conversation_id: str
    objective: str
    final_outcome: str
    objective_achieved: bool
    achievement_rationale: str
    criteria: list[CriterionResult] = Field(default_factory=list)
    comparisons: list[TargetComparison] = Field(default_factory=list)
    offers_made: list[Offer] = Field(default_factory=list)
    offers_received: list[Offer] = Field(default_factory=list)
    agreements: list[str] = Field(default_factory=list)
    unresolved_issues: list[str] = Field(default_factory=list)
    commitments: list[str] = Field(default_factory=list)
    excerpts: list[Excerpt] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)


class ReportDraft(Schema):
    """What the LLM produces; deterministic fields are filled in by the analyzer."""

    final_outcome: str
    criteria: list[CriterionResult] = Field(default_factory=list)
    achieved_values: dict[str, float] = Field(
        default_factory=dict, description="quantity name -> final agreed value, only if agreed")
    agreements: list[str] = Field(default_factory=list)
    unresolved_issues: list[str] = Field(default_factory=list)
    commitments: list[str] = Field(default_factory=list)
    excerpts: list[Excerpt] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
