"""Counterparty channels: the seam where telephony will plug in later.

The session never needs to know who is on the other end. A channel decides what happens
after the agent finishes speaking and how counterparty speech arrives.

- SimulatedChannel: an LLM persona replies (practice mode, no telephony).
- BrowserMicChannel: a real person speaks into the browser microphone (live mode).
- A future TelephonyChannel would bridge PSTN audio into the same STT/TTS pipeline.
"""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from app.models.engine import SimulatorPersona
from app.services import simulator

if TYPE_CHECKING:
    from .session import LiveSession


class CounterpartyChannel(ABC):
    kind: str
    uses_microphone: bool = False

    @abstractmethod
    async def prepare(self, session: "LiveSession") -> None: ...

    @abstractmethod
    async def after_agent_turn(self, session: "LiveSession") -> None:
        """Called when the agent has finished speaking and expects a reply."""


class SimulatedChannel(CounterpartyChannel):
    kind = "simulated"

    def __init__(self) -> None:
        self.persona: SimulatorPersona | None = None

    async def prepare(self, session: "LiveSession") -> None:
        if self.persona is None:
            self.persona = await simulator.create_persona(session.llm, session.mission.spec)

    async def after_agent_turn(self, session: "LiveSession") -> None:
        session.schedule(session.run_simulator_turn(), kind="simulator")


class BrowserMicChannel(CounterpartyChannel):
    kind = "live"
    uses_microphone = True

    async def prepare(self, session: "LiveSession") -> None:
        return None

    async def after_agent_turn(self, session: "LiveSession") -> None:
        await session.set_state_listening()
