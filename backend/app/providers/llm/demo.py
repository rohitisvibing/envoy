"""Demo LLM: deterministic heuristics so the product runs without an OpenRouter key.

Clearly labelled as demo mode in the UI. It is not a substitute for the real model; it
exists so the full flow (mission -> preparation -> negotiation -> approval -> report) can be
exercised offline.
"""

import re

from app.models.conversation import Offer
from app.models.engine import (
    ApprovalNeed,
    SimulatorPersona,
    SimulatorTurn,
    StateDelta,
    TurnPlan,
)
from app.models.mission import (
    ApprovalKind,
    ExtractionResult,
    MissionSpec,
    Objection,
    PreparationBrief,
    Quantity,
)
from app.models.report import CriterionResult, Excerpt, ReportDraft
from app.services.policy_guard import extract_amounts

from .base import LLMProvider, Message, T

_LANGS = ["Kannada", "Hindi", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali", "English"]


def _section(text: str, name: str) -> str:
    m = re.search(rf"{name}:\n(.*?)(?:\n\n[A-Z][A-Z ()\-]+:\n|\Z)", text, re.DOTALL)
    return m.group(1) if m else ""


class DemoLLM(LLMProvider):
    name = "demo"
    is_demo = True

    async def complete_text(self, messages, *, task, role="conversation", temperature=None,
                            max_tokens=None) -> str:
        return "Demo mode response."

    async def complete_json(self, schema: type[T], messages: list[Message], *, task: str,
                            role="conversation", temperature=None, max_tokens=None) -> T:
        user = messages[-1].content if messages else ""
        handler = getattr(self, f"_{task}", None)
        if handler is None:
            raise NotImplementedError(task)
        return schema.model_validate(handler(user, messages).model_dump())

    # ---- extraction ---------------------------------------------------------------------
    def _extract(self, user: str, _m) -> ExtractionResult:
        req = _section(user, "PRINCIPAL REQUEST") or user
        low = req.lower()
        amounts = extract_amounts(req)
        languages = [lang for lang in _LANGS if lang.lower() in low] or ["English"]
        if "English" not in languages:
            languages.append("English")
        counterparty = next((w for w in ["landlord", "broker", "customer support", "seller",
                                         "employer", "recruiter", "vendor"] if w in low),
                            "other party")
        targets, limits, missing, questions = [], [], [], []
        name = "monthly_rent" if "rent" in low else "price"
        label = "Monthly rent" if "rent" in low else "Price"
        to = re.search(r"to\s*(?:₹|rs\.?|inr)?\s*([\d,]+k?)", low)
        above = re.search(r"(?:above|more than|over|beyond)\s*(?:₹|rs\.?|inr)?\s*([\d,]+k?)", low)
        if to:
            targets.append(Quantity(name=name, label=label, value=extract_amounts(to.group(1))[0],
                                    direction="max"))
        elif amounts:
            targets.append(Quantity(name=name, label=label, value=min(amounts), direction="max"))
        if above:
            limits.append(Quantity(name=name, label=label,
                                   value=extract_amounts(above.group(1))[0], direction="max"))
        else:
            missing.append("Maximum acceptable amount")
            questions.append(f"What is the highest {label.lower()} you would accept?")
        tone = next((t for t in ["polite but firm", "polite and firm", "friendly", "assertive"]
                     if t in low), "polite and clear")
        title = "Rent negotiator" if "rent" in low else "Negotiator"
        spec = MissionSpec(
            title=title,
            objective=req.split(".")[0].strip()[:160],
            desired_outcome=(f"{label} of ₹{targets[0].value:,.0f}" if targets
                             else "Agreement on acceptable terms"),
            targets=targets, hard_limits=limits,
            context=[s.strip() for s in req.split(".")[1:3] if s.strip()],
            counterparty={"type": counterparty},
            communication={"languages": languages, "tone": tone},
            strategy=["Open by explaining the purpose and the principal's situation",
                      "Anchor near the target and justify it",
                      "Concede in small steps only when the other side moves",
                      "Explore non-price terms if price stalls"],
            constraints=[c.strip() for c in re.findall(r"(do not [^.]+)", req, re.IGNORECASE)],
            approval_requirements=[{"kind": "final_commitment",
                                    "condition": "Before accepting any final deal"}],
            success_criteria=[f"{label} agreed at or below ₹{targets[0].value:,.0f}"]
            if targets else ["Counterparty agrees to acceptable terms"],
        )
        if "month" in low and "agreement" in low:
            spec.context.append(next((s.strip() for s in req.split(".") if "agreement" in s), ""))
        return ExtractionResult(spec=spec, missing_information=missing,
                                clarifying_questions=questions)

    def _refine(self, user: str, m) -> ExtractionResult:
        result = self._extract(_section(user, "ORIGINAL REQUEST"), m)
        answers = _section(user, "ANSWERS")
        nums = extract_amounts(answers)
        if nums and result.spec.targets and not result.spec.hard_limits:
            t = result.spec.targets[0]
            result.spec.hard_limits.append(Quantity(name=t.name, label=t.label, value=max(nums),
                                                    direction="max"))
            result.missing_information, result.clarifying_questions = [], []
        return result

    # ---- preparation ---------------------------------------------------------------------
    def _prepare(self, user: str, _m) -> PreparationBrief:
        name = re.search(r"Shareable principal name: (.+)", user)
        who = name.group(1).strip() if name else "my principal"
        target = re.search(r'"targets": \[\{"name": "[^"]+", "label": "([^"]+)", "value": ([\d.]+)',
                           user)
        purpose = (f"to discuss the {target.group(1).lower()}" if target
                   else "about the matter we need to settle")
        return PreparationBrief(
            opening_statement=(f"Hello, I'm an AI assistant calling on behalf of {who}. "
                               f"I'm calling {purpose}. Is this a good time to talk?"),
            strategy_steps=["Confirm they have a few minutes", "Explain the request and reasons",
                            "Anchor at the target", "Trade small concessions for commitment"],
            anticipated_objections=[
                Objection(objection="Market rates have gone up",
                          response="Point to a long, reliable tenancy and a 12-month commitment"),
                Objection(objection="That's my final price",
                          response="Ask about non-price terms such as maintenance or deposit")],
            approval_triggers=["Any offer above the hard limit", "Accepting final terms"],
            disclosure_plan=["Share name freely", "Never share salary"],
            walk_away_conditions=["They refuse to go below the hard limit"])

    # ---- live turns ----------------------------------------------------------------------
    def _turn(self, user: str, _m) -> TurnPlan:
        transcript = _section(user, "RECENT TRANSCRIPT")
        lines = [ln for ln in transcript.splitlines() if ln.startswith("COUNTERPARTY")]
        last = lines[-1].split(":", 1)[1].strip() if lines else ""
        their = extract_amounts(last)
        target_m = re.search(r'"targets": \[\{"name": "([^"]+)", "label": "([^"]+)", "value": ([\d.]+)',
                             user)
        limit_m = re.search(r'"hard_limits": \[\{"name": "[^"]+", "label": "[^"]+", "value": ([\d.]+)',
                            user)
        qname = target_m.group(1) if target_m else None
        target = float(target_m.group(3)) if target_m else None
        limit = float(limit_m.group(1)) if limit_m else target
        made = re.findall(r'"by":\s*"agent",\s*"amount":\s*([\d.]+)', user)
        last_offer = float(made[-1]) if made else None
        instructions = _section(user, "PRINCIPAL INSTRUCTIONS \\(highest priority, most recent last\\)")
        directive = _section(user, "DIRECTIVE FOR THIS TURN")
        delta = StateDelta(phase="negotiating")
        if their:
            delta.offers_received = [Offer(by="counterparty", amount=max(their),
                                           quantity_name=qname, terms=last[:120])]
            delta.counterparty_positions = [last[:160]]

        if re.search(r'"agreements":\s*\["', user):
            return TurnPlan(state_delta=StateDelta(phase="closing"),
                            response_text="Wonderful, thank you. We'll send the agreement over "
                                          "in writing. Goodbye!",
                            objective_met=False, end_conversation=True)
        if "approved" in directive.lower() and "accept" in directive.lower():
            return TurnPlan(state_delta=StateDelta(phase="closing",
                                                   agreements=[directive[:160]]),
                            response_text="Thank you, that works for us. We'll confirm the "
                                          "paperwork shortly. Goodbye!",
                            objective_met=True, end_conversation=True)
        if instructions and "new instruction" in directive.lower():
            amt = extract_amounts(instructions.splitlines()[-1])
            ask = re.sub(r"^(ask|tell|say)\s+(him|her|them)?\s*(if|whether|to)?\s*", "",
                         instructions.splitlines()[-1].strip("- ").strip(), flags=re.IGNORECASE)
            text = (f"Would you consider ₹{amt[0]:,.0f} with maintenance included?"
                    if amt and "maintenance" in ask.lower()
                    else f"One more thing: could you {ask.rstrip('.?')}?")
            return TurnPlan(state_delta=delta, response_text=text,
                            offers_made=[Offer(by="agent", amount=amt[0] if amt else None,
                                               quantity_name=qname, terms=text)] if amt else [])
        if their and target and max(their) <= target:
            return TurnPlan(state_delta=delta, response_text="That sounds acceptable.",
                            accepts_offer=True, accepted_terms=last,
                            needs_approval=ApprovalNeed(
                                kind=ApprovalKind.final_commitment, request=last,
                                proposed=f"Accept ₹{max(their):,.0f}", reason="Meets the target"),
                            holding_line="Let me quickly confirm that, one moment.")
        if their and limit and max(their) <= limit:
            return TurnPlan(state_delta=delta,
                            response_text=f"₹{max(their):,.0f} could work. Shall we finalise?",
                            accepts_offer=True, accepted_terms=last,
                            needs_approval=ApprovalNeed(
                                kind=ApprovalKind.final_commitment, request=last,
                                proposed=f"Accept ₹{max(their):,.0f}",
                                reason="Within limit but above target"),
                            holding_line="Let me check that with them, one moment.")
        if target:
            step = (target if last_offer is None
                    else min(last_offer + (limit - target) / 3, limit or last_offer))
            text = (f"I understand. Given a 12-month commitment, could we settle at "
                    f"₹{step:,.0f} per month?")
            return TurnPlan(state_delta=delta, response_text=text,
                            offers_made=[Offer(by="agent", amount=step, quantity_name=qname,
                                               terms=text)])
        return TurnPlan(state_delta=delta, response_text="Could you tell me more about that?")

    # ---- simulator -----------------------------------------------------------------------
    def _persona(self, user: str, _m) -> SimulatorPersona:
        return SimulatorPersona(name="Mr. Rao", role="landlord",
                                personality="Courteous, careful with money, values reliability",
                                opening_position="Rent stays at ₹35,000",
                                reservation_terms="Will go to ₹32,000 for a 12-month lease",
                                concerns=["Rising maintenance costs"])

    def _simulate(self, user: str, _m) -> SimulatorTurn:
        transcript = _section(user, "CONVERSATION SO FAR")
        mine = [ln for ln in transcript.splitlines() if ln.startswith("YOU")]
        theirs = [ln for ln in transcript.splitlines() if ln.startswith("CALLER")]
        offers = extract_amounts(theirs[-1]) if theirs else []
        script = ["Yes, I have a few minutes. What is this about?",
                  "The rent is ₹35,000. Prices in this area have gone up.",
                  "I can come down to ₹34,000, that's already a discount.",
                  "Okay, ₹33,000 for 12 months. That's my final offer.",
                  "Fine, ₹32,000 including maintenance, for a 12-month agreement."]
        if theirs and "goodbye" in theirs[-1].lower():
            return SimulatorTurn(text="Okay, thank you. Goodbye.", end_conversation=True)
        if offers and min(offers) >= 32000 and len(mine) >= 2:
            return SimulatorTurn(text=f"Alright, ₹{min(offers):,.0f} works for me.")
        return SimulatorTurn(text=script[min(len(mine), len(script) - 1)])

    # ---- report --------------------------------------------------------------------------
    def _report(self, user: str, _m) -> ReportDraft:
        transcript = _section(user, "FULL TRANSCRIPT")
        lines = [ln for ln in transcript.splitlines() if ":" in ln]
        agreed = re.search(r'"agreements":\s*\["([^"]+)"', user)
        amounts = extract_amounts(agreed.group(1)) if agreed else []
        name_m = re.search(r'"targets":\s*\[\{"name":\s*"([^"]+)"', user)
        crit_m = re.search(r'"success_criteria":\s*\["([^"]+)"', user)
        target_m = re.search(r'"targets":\s*\[\{"name":\s*"[^"]+",\s*"label":\s*"[^"]+",\s*"value":\s*([\d.]+)',
                             user)
        achieved = {name_m.group(1): amounts[-1]} if (name_m and amounts) else {}
        met = bool(achieved and target_m and list(achieved.values())[0] <= float(target_m.group(1)))
        return ReportDraft(
            final_outcome=("Agreement reached: " + agreed.group(1)) if agreed
            else "No final agreement was reached.",
            criteria=[CriterionResult(criterion=crit_m.group(1) if crit_m else "Objective",
                                      met=met, evidence=agreed.group(1) if agreed else "None")],
            achieved_values=achieved,
            excerpts=[Excerpt(speaker=ln.split(":", 1)[0], text=ln.split(":", 1)[1].strip())
                      for ln in lines[-3:]],
            next_steps=["Get the agreed terms in writing"] if agreed
            else ["Decide whether to raise your limit or look at alternatives"])
