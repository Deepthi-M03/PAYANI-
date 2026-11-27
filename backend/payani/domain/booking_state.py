"""Booking state machine. Transitions are a whitelist; anything else is refused.

Who may trigger an event matters: a passenger can ask to cancel, but only the booking
provider can confirm a booking or a cancellation. This is what stops the UI (or an
attacker) from marking a booking CONFIRMED by clicking a button.
"""

from __future__ import annotations

from enum import StrEnum


class State(StrEnum):
    DRAFT = "DRAFT"
    SEARCHED = "SEARCHED"
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
    CONFIRMED = "CONFIRMED"
    FAILED = "FAILED"
    CANCELLATION_REQUESTED = "CANCELLATION_REQUESTED"
    CANCELLED = "CANCELLED"
    REFUND_PENDING = "REFUND_PENDING"
    REFUNDED = "REFUNDED"


class Actor(StrEnum):
    PASSENGER = "passenger"
    PROVIDER = "provider"
    SYSTEM = "system"


# (from_state, event) -> (to_state, allowed actors)
TRANSITIONS: dict[tuple[State, str], tuple[State, frozenset[Actor]]] = {
    (State.DRAFT, "select_journey"): (State.SEARCHED, frozenset({Actor.PASSENGER})),
    (State.SEARCHED, "select_journey"): (State.SEARCHED, frozenset({Actor.PASSENGER})),
    (State.SEARCHED, "submit"): (State.PENDING_CONFIRMATION, frozenset({Actor.PASSENGER})),
    (State.PENDING_CONFIRMATION, "provider_confirmed"): (State.CONFIRMED, frozenset({Actor.PROVIDER})),
    (State.PENDING_CONFIRMATION, "provider_failed"): (State.FAILED, frozenset({Actor.PROVIDER, Actor.SYSTEM})),
    (State.CONFIRMED, "request_cancellation"): (State.CANCELLATION_REQUESTED, frozenset({Actor.PASSENGER})),
    (State.CANCELLATION_REQUESTED, "provider_cancelled"): (State.CANCELLED, frozenset({Actor.PROVIDER})),
    (State.CANCELLATION_REQUESTED, "provider_cancel_rejected"): (State.CONFIRMED, frozenset({Actor.PROVIDER})),
    (State.CANCELLED, "refund_initiated"): (State.REFUND_PENDING, frozenset({Actor.PROVIDER, Actor.SYSTEM})),
    (State.REFUND_PENDING, "refund_completed"): (State.REFUNDED, frozenset({Actor.PROVIDER})),
}

TERMINAL = frozenset({State.FAILED, State.REFUNDED})


class TransitionError(Exception):
    def __init__(self, state: State, event: str, reason: str):
        super().__init__(f"Cannot {event} a booking in state {state}: {reason}")
        self.state, self.event, self.reason = state, event, reason


def next_state(state: State | str, event: str, actor: Actor | str) -> State:
    state, actor = State(state), Actor(actor)
    rule = TRANSITIONS.get((state, event))
    if rule is None:
        raise TransitionError(state, event, "not allowed from this state")
    to, actors = rule
    if actor not in actors:
        raise TransitionError(state, event, f"only {', '.join(sorted(a.value for a in actors))} may do this")
    return to


def allowed_events(state: State | str, actor: Actor | str) -> list[str]:
    state, actor = State(state), Actor(actor)
    return sorted(e for (s, e), (_, actors) in TRANSITIONS.items() if s == state and actor in actors)
