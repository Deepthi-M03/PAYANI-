import math
import random

import pytest

from payani.domain.booking_state import Actor, State, TransitionError, allowed_events, next_state
from payani.domain.group_batching import Traveller, plan_batches


def group(spec: dict[str, tuple[int, int]]) -> list[Traveller]:
    """spec: family -> (adults, minors)"""
    out = []
    for fam, (adults, minors) in spec.items():
        out += [Traveller(f"{fam}-a{i}", f"Adult {i}", fam) for i in range(adults)]
        out += [Traveller(f"{fam}-m{i}", f"Child {i}", fam, is_minor=True) for i in range(minors)]
    return out


def test_minimum_number_of_bookings_always():
    rng = random.Random(1)
    for _ in range(200):
        spec = {f"f{i}": (rng.randint(1, 4), rng.randint(0, 3)) for i in range(rng.randint(1, 7))}
        people = group(spec)
        cap = rng.choice([4, 6])
        plan = plan_batches(people, cap)
        assert len(plan.batches) == math.ceil(len(people) / cap)
        assert all(b.size <= cap for b in plan.batches)
        placed = [t.id for b in plan.batches for t in b.travellers]
        assert sorted(placed) == sorted(t.id for t in people)


def test_families_kept_whole_when_possible():
    # 3 + 3 + 2 + 2 + 2 = 12 with cap 6 -> 2 bookings, packable as (3+3) and (2+2+2)
    plan = plan_batches(group({"A": (3, 0), "B": (2, 1), "C": (2, 0), "D": (1, 1), "E": (2, 0)}), 6)
    assert len(plan.batches) == 2
    assert plan.families_split == []


def test_split_unavoidable_is_reported_and_minimal():
    plan = plan_batches(group({"Big": (5, 3)}), 6)  # 8 people, one family, cap 6
    assert len(plan.batches) == 2
    assert plan.families_split == ["Big"]


def test_each_split_piece_with_a_minor_gets_an_adult():
    plan = plan_batches(group({"Big": (2, 5)}), 4)  # 7 people -> 2 bookings
    for b in plan.batches:
        if any(t.is_minor for t in b.travellers):
            assert any(not t.is_minor for t in b.travellers)
    assert plan.warnings == []


def test_warning_when_minor_cannot_be_accompanied():
    plan = plan_batches(group({"Kids": (1, 6)}), 4)  # 1 adult, 2 bookings
    assert plan.warnings


def test_explanation_never_promises_adjacent_seats():
    plan = plan_batches(group({"A": (2, 0)}), 6)
    assert any("cannot guarantee adjacent seats" in line for line in plan.explanation)


def test_invalid_input_rejected():
    with pytest.raises(ValueError):
        plan_batches(group({"A": (1, 0)}), 0)
    dup = [Traveller("x", "X", "f"), Traveller("x", "Y", "f")]
    with pytest.raises(ValueError):
        plan_batches(dup, 4)


def test_happy_path_lifecycle():
    s = State.DRAFT
    for event, actor in [("select_journey", "passenger"), ("submit", "passenger"),
                         ("provider_confirmed", "provider"), ("request_cancellation", "passenger"),
                         ("provider_cancelled", "provider"), ("refund_initiated", "system"),
                         ("refund_completed", "provider")]:
        s = next_state(s, event, actor)
    assert s == State.REFUNDED


def test_passenger_cannot_confirm_a_booking():
    with pytest.raises(TransitionError, match="only provider"):
        next_state(State.PENDING_CONFIRMATION, "provider_confirmed", Actor.PASSENGER)


def test_illegal_jumps_refused():
    for state, event in [(State.DRAFT, "provider_confirmed"), (State.CONFIRMED, "refund_completed"),
                         (State.FAILED, "submit"), (State.REFUNDED, "request_cancellation")]:
        with pytest.raises(TransitionError):
            next_state(state, event, Actor.PROVIDER)


def test_allowed_events_drive_the_ui():
    assert allowed_events(State.CONFIRMED, Actor.PASSENGER) == ["request_cancellation"]
    assert allowed_events(State.FAILED, Actor.PASSENGER) == []
