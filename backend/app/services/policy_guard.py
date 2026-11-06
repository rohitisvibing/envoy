"""Deterministic safety layer applied to every agent turn before it is spoken.

The LLM proposes; this module disposes. It checks hard numeric limits, restricted
personal information, unauthorised commitments and AI self-disclosure without
relying on the model's own judgement.
"""

import re
from dataclasses import dataclass, field
from enum import StrEnum

from app.models.engine import TurnPlan
from app.models.mission import ApprovalKind, MissionSpec, Quantity
from app.models.principal import Disclosure, PrincipalProfile

# --- amount parsing --------------------------------------------------------------------

_INDIC_DIGITS = str.maketrans(
    "०१२३४५६७८९೦೧೨೩೪೫೬೭೮೯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯০১২৩৪৫৬৭৮৯",
    "0123456789" * 5,
)
_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}
_SCALES = {"hundred": 100, "thousand": 1_000, "k": 1_000, "lakh": 100_000, "lakhs": 100_000,
           "lac": 100_000, "crore": 10_000_000, "crores": 10_000_000}

_NUM_RE = re.compile(
    r"(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*"
    r"(k\b|thousand\b|lakhs?\b|lac\b|crores?\b|hundred\b)?",
    re.IGNORECASE,
)
_WORDS_RE = re.compile(
    r"\b((?:(?:" + "|".join(_UNITS) + r"|hundred|thousand|lakhs?|crores?|and)[\s-]+)*"
    r"(?:" + "|".join(_UNITS) + r"|hundred|thousand|lakhs?|crores?))\b",
    re.IGNORECASE,
)


def _words_to_number(phrase: str) -> float | None:
    total, current, seen = 0, 0, False
    for tok in re.split(r"[\s-]+", phrase.lower()):
        if tok == "and" or not tok:
            continue
        if tok in _UNITS:
            current += _UNITS[tok]
            seen = True
        elif tok in _SCALES:
            scale = _SCALES[tok]
            current = max(current, 1) * scale
            if scale >= 1000:
                total += current
                current = 0
            seen = True
    return float(total + current) if seen else None


_PHONE_RE = re.compile(r"\+?\d[\d\s-]{8,}\d")


def _looks_like_phone(m: re.Match) -> bool:
    digits = re.sub(r"\D", "", m.group(0))
    return len(digits) >= 10 and not re.search(r"\d,\d", m.group(0))


def extract_amounts(text: str) -> list[float]:
    """Find monetary/numeric amounts in free text (digits, Indic digits, 32k, 1.5 lakh, words)."""
    norm = text.translate(_INDIC_DIGITS)
    norm = _PHONE_RE.sub(lambda m: " " if _looks_like_phone(m) else m.group(0), norm)
    found: list[float] = []
    for m in _NUM_RE.finditer(norm):
        raw, scale = m.group(1).replace(",", ""), (m.group(2) or "").lower()
        try:
            value = float(raw)
        except ValueError:
            continue
        if scale:
            value *= _SCALES.get(scale, 1)
        found.append(value)
    for m in _WORDS_RE.finditer(norm):
        if not any(tok in _UNITS for tok in re.split(r"[\s-]+", m.group(1).lower())):
            continue  # a bare scale word ("lakh") belongs to a preceding digit match
        value = _words_to_number(m.group(1))
        if value is not None and value >= 100:
            found.append(value)
    return found


# --- guard -----------------------------------------------------------------------------

class Action(StrEnum):
    allow = "allow"
    regenerate = "regenerate"
    approval = "approval"


@dataclass
class Violation:
    code: str
    detail: str
    approval_kind: ApprovalKind | None = None


@dataclass
class GuardResult:
    action: Action
    violations: list[Violation] = field(default_factory=list)
    plan: TurnPlan | None = None

    @property
    def ok(self) -> bool:
        return self.action == Action.allow

    def feedback(self) -> str:
        return "; ".join(f"{v.code}: {v.detail}" for v in self.violations)


_COMMIT_PATTERNS = re.compile(
    r"\b(i|we)\s+(?:will\s+|can\s+)?(?:agree|accept|confirm|sign|commit)\b|\bdeal\s*(?:done|is done)?[.!]"
    r"|\bit'?s a deal\b|\bwe have a deal\b|\bi'?ll sign\b|\bconsider it done\b",
    re.IGNORECASE,
)
_AI_DISCLOSURE = re.compile(
    r"\b(ai|a\.i\.|artificial intelligence|assistant|virtual agent|automated agent)\b"
    r"|ಎಐ|ಕೃತಕ ಬುದ್ಧಿಮತ್ತೆ|एआई|कृत्रिम|ஏஐ|செயற்கை|ఏఐ|కృత్రిమ",
    re.IGNORECASE,
)


def _breaches(q: Quantity, value: float) -> bool:
    return value > q.value if q.direction == "max" else value < q.value


def _plausible_for(q: Quantity, value: float) -> bool:
    """Only compare amounts that are in the same order of magnitude as the limit."""
    return q.value / 5 <= value <= q.value * 5


def _normalise(s: str) -> str:
    return re.sub(r"[\s\-().,+]", "", s.lower())


def check_turn(
    plan: TurnPlan,
    spec: MissionSpec,
    profile: PrincipalProfile,
    *,
    counterparty_amounts: set[float] | None = None,
    approved_disclosures: set[str] | None = None,
    authorised_amounts: set[float] | None = None,
    is_opening: bool = False,
    final_commitment_preapproved: bool = False,
) -> GuardResult:
    """Validate a proposed agent turn. Returns the action to take and any violations."""
    counterparty_amounts = counterparty_amounts or set()
    approved_disclosures = approved_disclosures or set()
    authorised_amounts = authorised_amounts or set()
    violations: list[Violation] = []
    text = plan.response_text

    # 1. Hard numeric limits, on structured offers and on any amount in the spoken text.
    for q in spec.hard_limits:
        for offer in plan.offers_made:
            if offer.amount is None or offer.amount in authorised_amounts:
                continue
            if (offer.quantity_name in (None, q.name)) and _plausible_for(q, offer.amount) \
                    and _breaches(q, offer.amount):
                violations.append(Violation(
                    "limit_exceeded",
                    f"Offer of {offer.amount:g} breaks the {q.direction} {q.label} of {q.value:g}",
                    ApprovalKind.negotiation_authority))
        for amount in extract_amounts(text):
            if amount in counterparty_amounts or amount in authorised_amounts:
                continue  # restating the other side's number is not an offer
            if _plausible_for(q, amount) and _breaches(q, amount):
                violations.append(Violation(
                    "limit_in_text",
                    f"Response mentions {amount:g}, beyond the {q.direction} {q.label} "
                    f"({q.value:g}). Do not offer or reveal values past the limit.",
                    ApprovalKind.negotiation_authority))

    # 2. Restricted personal information.
    for f in profile.fields:
        if not f.value or len(f.value.strip()) < 3:
            continue
        restricted = f.disclosure == Disclosure.never or (
            f.disclosure == Disclosure.approval and f.key not in approved_disclosures)
        if restricted and _normalise(f.value) in _normalise(text):
            violations.append(Violation(
                "restricted_disclosure",
                f"Response reveals '{f.label}', which is not cleared for sharing."))

    # 3. Commitments: accepting a deal always needs the principal's final approval.
    commits = plan.accepts_offer or bool(_COMMIT_PATTERNS.search(text))
    if commits and not final_commitment_preapproved:
        violations.append(Violation(
            "unapproved_commitment",
            "Accepting terms or making a commitment requires the principal's approval.",
            ApprovalKind.final_commitment))

    # 4. Transparency: the opening line must identify the agent as an AI.
    if is_opening and not _AI_DISCLOSURE.search(text):
        violations.append(Violation("missing_ai_disclosure",
                                    "Opening must state that you are an AI agent."))

    if not violations:
        return GuardResult(Action.allow, plan=plan)
    # Text-only problems are fixable by rewriting; authority problems need the principal.
    needs_authority = any(v.code in ("limit_exceeded", "unapproved_commitment")
                          for v in violations)
    if not needs_authority:
        return GuardResult(Action.regenerate, violations, plan)
    return GuardResult(Action.approval, violations, plan)


def counterparty_numbers(texts: list[str]) -> set[float]:
    out: set[float] = set()
    for t in texts:
        out.update(extract_amounts(t))
    return out
