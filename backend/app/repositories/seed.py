from app.models.mission import AgentTemplate
from app.models.principal import Disclosure, PrincipalProfile, ProfileField


def sample_profile(principal_id: str) -> PrincipalProfile:
    """Same sample principal as supabase/seed.sql, for zero-setup runs."""
    rows = [
        ("full_name", "Full name", "Ananya Iyer", Disclosure.always),
        ("preferred_name", "Preferred name", "Ananya", Disclosure.always),
        ("occupation", "Occupation", "Software engineer", Disclosure.relevant),
        ("company", "Company", None, Disclosure.relevant),
        ("city", "Current city", "Bengaluru", Disclosure.relevant),
        ("phone", "Phone number", None, Disclosure.approval),
        ("email", "Email", None, Disclosure.approval),
        ("salary", "Salary", None, Disclosure.never),
    ]
    return PrincipalProfile(
        id=principal_id, preferred_languages=["English", "Kannada"],
        communication_preferences="Prefers concise, respectful conversations.",
        background="Has rented the current apartment in Indiranagar for two years and always "
                   "paid on time.",
        fields=[ProfileField(key=k, label=lbl, value=v, disclosure=d) for k, lbl, v, d in rows])


DEFAULT_TEMPLATES = [
    AgentTemplate(
        id="5c1d6a1e-0000-4000-8000-000000000001",
        name="Rent negotiator",
        description="Negotiate monthly rent, deposit or lease terms with a landlord.",
        agent_type="Negotiator",
        prompt_example=(
            "Negotiate my apartment rent from ₹35,000 to ₹30,000. The landlord is asking for "
            "₹35,000. I want a 12-month agreement. Be polite but firm. Speak in Kannada if the "
            "landlord prefers Kannada. Do not agree to anything above ₹32,000 without asking me."),
    ),
    AgentTemplate(
        id="5c1d6a1e-0000-4000-8000-000000000002",
        name="Subscription cancellation",
        description="Cancel a service and ask for a refund of unused days.",
        agent_type="Customer support",
        prompt_example=(
            "Call my broadband provider's support line and cancel my plan from the end of this "
            "month. Ask for a refund for unused days. Don't accept a retention offer unless it "
            "brings the bill under ₹500 a month, and check with me first."),
    ),
    AgentTemplate(
        id="5c1d6a1e-0000-4000-8000-000000000003",
        name="Appointment booking",
        description="Book or reschedule an appointment within your availability.",
        agent_type="Scheduler",
        prompt_example=(
            "Book a dental cleaning for me next week, weekday evenings after 6pm only. Speak "
            "Hindi or English. Don't share my phone number unless they insist, ask me first."),
    ),
]
