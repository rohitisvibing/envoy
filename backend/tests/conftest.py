import pytest

from app.core.config import Settings
from app.core.deps import Container, set_container
from app.models.mission import MissionSpec, PreparationBrief, Quantity
from app.models.principal import Disclosure, PrincipalProfile, ProfileField
from app.providers.llm.demo import DemoLLM
from app.providers.stt.sarvam import SarvamSTT
from app.providers.tts.sarvam import SarvamTTS
from app.repositories.memory import MemoryRepository

RENT_REQUEST = (
    "Negotiate my apartment rent from ₹35,000 to ₹30,000. The landlord is asking for ₹35,000. "
    "I want a 12-month agreement. Be polite but firm. Speak in Kannada if the landlord prefers "
    "Kannada. Do not agree to anything above ₹32,000 without asking me.")


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, openrouter_api_key="", sarvam_api_key="", supabase_url="",
                    demo_mode=True, text_pacing=False)


@pytest.fixture
def container(settings):
    c = Container(settings=settings, llm=DemoLLM(), stt=SarvamSTT(settings),
                  tts=SarvamTTS(settings), repo=MemoryRepository())
    set_container(c)
    return c


@pytest.fixture
def profile() -> PrincipalProfile:
    return PrincipalProfile(id="p1", fields=[
        ProfileField(key="full_name", label="Full name", value="Ananya Iyer",
                     disclosure=Disclosure.always),
        ProfileField(key="occupation", label="Occupation", value="Architect",
                     disclosure=Disclosure.relevant),
        ProfileField(key="phone", label="Phone number", value="98450 12345",
                     disclosure=Disclosure.approval),
        ProfileField(key="salary", label="Salary", value="24 LPA", disclosure=Disclosure.never),
        ProfileField(key="company", label="Company", value=None, disclosure=Disclosure.relevant),
    ])


@pytest.fixture
def rent_spec() -> MissionSpec:
    return MissionSpec(
        title="Rent negotiator", objective="Negotiate monthly rent",
        desired_outcome="₹30,000 monthly rent",
        targets=[Quantity(name="monthly_rent", label="Monthly rent", value=30000,
                          direction="max")],
        hard_limits=[Quantity(name="monthly_rent", label="Monthly rent", value=32000,
                              direction="max")],
        counterparty={"type": "landlord"},
        communication={"languages": ["Kannada", "English"], "tone": "polite but firm"},
        success_criteria=["Monthly rent agreed at or below ₹30,000"],
    )


@pytest.fixture
def brief() -> PreparationBrief:
    return PreparationBrief(opening_statement="Hello, I'm an AI assistant calling on behalf of "
                                              "Ananya about the rent.")
