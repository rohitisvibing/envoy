import pytest

from app.models.conversation import TRANSITIONS, can_transition
from app.models.conversation import ConversationState as S

ALLOWED = [
    (S.idle, S.preparing), (S.preparing, S.ready), (S.ready, S.connecting),
    (S.connecting, S.speaking), (S.speaking, S.listening), (S.listening, S.thinking),
    (S.thinking, S.speaking), (S.speaking, S.interrupted), (S.interrupted, S.listening),
    (S.thinking, S.awaiting_approval), (S.awaiting_approval, S.speaking),
    (S.listening, S.paused), (S.paused, S.thinking), (S.speaking, S.completed),
    (S.thinking, S.failed),
]
FORBIDDEN = [
    (S.completed, S.listening), (S.completed, S.speaking), (S.idle, S.speaking),
    (S.ready, S.speaking), (S.preparing, S.listening), (S.interrupted, S.speaking),
    (S.failed, S.speaking),
]


@pytest.mark.parametrize("src,dst", ALLOWED)
def test_allowed(src, dst):
    assert can_transition(src, dst)


@pytest.mark.parametrize("src,dst", FORBIDDEN)
def test_forbidden(src, dst):
    assert not can_transition(src, dst)


def test_every_state_has_a_rule():
    assert set(TRANSITIONS) == set(S)


def test_completed_is_terminal():
    assert TRANSITIONS[S.completed] == set()
