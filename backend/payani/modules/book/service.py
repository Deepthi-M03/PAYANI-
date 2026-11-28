"""Journeys, groups and bookings."""

from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from payani.core.db import utcnow, uuid7
from payani.core.errors import AppError
from payani.domain import routing
from payani.domain.booking_state import Actor, TransitionError, allowed_events, next_state
from payani.domain.group_batching import Traveller, plan_batches
from payani.modules.book import catalog
from payani.modules.book.models import (
    Booking,
    BookingEvent,
    BookingPassenger,
    BookingPolicy,
    CancellationRequest,
    Group,
    GroupInvitation,
    GroupMember,
    IdempotencyKey,
    JourneySearch,
    Payment,
    Refund,
    RefundTracking,
)
from payani.providers.booking import booking_provider, payment_provider

NOT_FOUND = AppError(404, "not-found", "We couldn't find that.")

# Simulated fares (paise per km, plus a flat reservation component). Labelled Simulated
# everywhere; these are NOT Indian Railways fares.
FARE_PER_KM = {"SL": 45, "3A": 120, "2A": 175, "1A": 290}
FARE_BASE = {"SL": 2000, "3A": 4000, "2A": 5000, "1A": 6000}
AGE_BANDS = ("child_5_11", "teen_12_17", "adult_18_59", "senior_60_plus")
SERVICE_CHARGE_PAISE = 0  # ADR 007: no service charge in v1


# ------------------------------------------------------------------ journeys

def effective_max_transfers(db: Session, requested: int) -> int:
    """A national imported timetable is searched with at most one change, to keep search fast."""
    return min(requested, 1) if catalog.is_large(db) else requested


def search(db: Session, user_id, origin: str, dest: str, on: date, preference: str, max_transfers: int) -> list[dict]:
    names = catalog.station_names(db)
    for code in (origin, dest):
        if code not in names:
            raise AppError(422, "unknown-station", f"No train in the current timetable serves station code {code}.")
    if origin == dest:
        raise AppError(422, "same-station", "Origin and destination must be different.")
    started = time.perf_counter()
    max_transfers = effective_max_transfers(db, max_transfers)
    opts = routing.SearchOptions(max_transfers=max_transfers, preference=preference)
    trains = catalog.timetable(db)
    if catalog.is_large(db):
        trains = routing.candidate_trains(trains, origin, dest, max_transfers)
    data = catalog.provenance(db)
    results = [routing.journey_to_dict(j, on, names, data)
               for j in routing.search(trains, origin, dest, on, opts, names)]
    db.add(JourneySearch(id=uuid7(), user_id=user_id,
                         params={"from": origin, "to": dest, "date": on.isoformat(), "preference": preference,
                                 "max_transfers": max_transfers},
                         result_count=len(results), latency_ms=int((time.perf_counter() - started) * 1000)))
    db.commit()
    return results


def find_journey(db: Session, journey_id: str, on: date) -> dict:
    """Re-derive a journey from its id so clients cannot tamper with times or trains."""
    try:
        parts = [p.split(":") for p in journey_id.split("|")]
        sig = [(k, int(b), int(a)) for k, b, a in parts]
    except ValueError:
        raise AppError(422, "bad-journey", "That journey reference is not valid.") from None
    trains = {t.number: t for t in catalog.timetable(db)}
    legs = []
    for key, b, a in sig:
        number, _, offset = key.partition("@")
        t = trains.get(number)
        if t is None or not (0 <= b < a < len(t.stops)):
            raise AppError(422, "bad-journey", "That journey is no longer available.")
        legs.append(routing.Leg(routing.Instance(t, int(offset)), b, a))
    j = routing.Journey(legs)
    names = catalog.station_names(db)
    routing.explain([j], names)
    return routing.journey_to_dict(j, on, names, catalog.provenance(db))


def fare_for(journey: dict, travel_class: str, passengers: int) -> int:
    """Simulated sandbox fare. Needs a distance; imported timetables do not always have one."""
    km = journey["distance_km"]
    if km is None:
        raise AppError(422, "fare-unavailable",
                       "The source timetable has no distance for this journey, so the sandbox cannot price it.",
                       "Book this journey on the official IRCTC website instead.")
    per = FARE_BASE[travel_class] * len(journey["legs"]) + FARE_PER_KM[travel_class] * km
    return int(round(per, -2)) * passengers


# ------------------------------------------------------------------ groups

def _group_for(db: Session, group_id: uuid.UUID, user_id: uuid.UUID, owner_only=False) -> Group:
    g = db.get(Group, group_id)
    if g is None or g.deleted_at is not None:
        raise NOT_FOUND
    is_owner = g.owner_id == user_id
    is_member = any(m.user_id == user_id for m in g.members)
    if not (is_owner or (is_member and not owner_only)):
        raise NOT_FOUND  # do not reveal other people's groups
    return g


def create_group(db: Session, owner, name: str, from_code=None, to_code=None, journey_date=None) -> Group:
    g = Group(id=uuid7(), owner_id=owner.id, name=name, from_code=from_code, to_code=to_code, journey_date=journey_date)
    db.add(g)
    db.flush()
    db.add(GroupMember(id=uuid7(), group_id=g.id, user_id=owner.id, name=owner.display_name,
                       family=owner.display_name, is_minor=False, role="owner"))
    db.commit()
    db.refresh(g)
    return g


def add_member(db: Session, g: Group, name: str, family: str, is_minor: bool, berth_preference: str | None) -> GroupMember:
    if len(g.members) >= 60:
        raise AppError(422, "group-full", "A group can have at most 60 travellers.")
    m = GroupMember(id=uuid7(), group_id=g.id, name=name, family=family or name, is_minor=is_minor,
                    berth_preference=berth_preference)
    db.add(m)
    db.commit()
    db.refresh(g)
    return m


def remove_member(db: Session, g: Group, member_id: uuid.UUID) -> None:
    m = next((m for m in g.members if m.id == member_id), None)
    if m is None:
        raise NOT_FOUND
    if m.role == "owner":
        raise AppError(422, "owner-required", "The group organiser cannot be removed.")
    db.delete(m)
    db.commit()


def create_invitation(db: Session, g: Group, by) -> str:
    token = secrets.token_urlsafe(24)
    db.add(GroupInvitation(id=uuid7(), group_id=g.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                           created_by=by.id, expires_at=utcnow() + timedelta(days=7)))
    db.commit()
    return token


def accept_invitation(db: Session, token: str, user) -> Group:
    inv = db.scalar(select(GroupInvitation).where(
        GroupInvitation.token_hash == hashlib.sha256(token.encode()).hexdigest()).with_for_update())
    if inv is None or inv.accepted_at is not None or inv.expires_at < utcnow():
        raise AppError(410, "invitation-invalid", "This invitation has expired or was already used.")
    g = db.get(Group, inv.group_id)
    if g is None or g.deleted_at is not None:
        raise AppError(410, "invitation-invalid", "This group no longer exists.")
    if not any(m.user_id == user.id for m in g.members):
        db.add(GroupMember(id=uuid7(), group_id=g.id, user_id=user.id, name=user.display_name,
                           family=user.display_name, is_minor=False))
    inv.accepted_at, inv.accepted_by = utcnow(), user.id
    db.commit()
    db.refresh(g)
    return g


def policy(db: Session, quota: str) -> BookingPolicy:
    p = db.scalar(select(BookingPolicy).where(BookingPolicy.quota == quota))
    if p is None:
        raise AppError(422, "unknown-quota", "Unknown booking quota.")
    return p


def batch_plan(db: Session, g: Group, quota: str) -> dict:
    p = policy(db, quota)
    travellers = [Traveller(str(m.id), m.name, m.family, m.is_minor) for m in g.members]
    plan = plan_batches(travellers, p.max_passengers_per_pnr)
    return {
        "quota": p.quota, "cap": p.max_passengers_per_pnr,
        "cap_source": {"url": p.source_url, "verified_at": p.verified_at.isoformat(), "note": p.note},
        "batches": [[{"member_id": t.id, "name": t.name, "family": t.family, "is_minor": t.is_minor}
                     for t in b.travellers] for b in plan.batches],
        "families_split": plan.families_split, "warnings": plan.warnings, "explanation": plan.explanation,
    }


# ------------------------------------------------------------------ bookings

def _record(db: Session, b: Booking, event: str, actor: Actor, note: str | None = None) -> None:
    try:
        to = next_state(b.status, event, actor)
    except TransitionError as exc:
        raise AppError(409, "invalid-transition", "This action isn't possible for the booking right now.",
                       exc.reason) from None
    db.add(BookingEvent(id=uuid7(), booking_id=b.id, event=event, from_status=b.status, to_status=to,
                        actor=actor.value, note=note))
    b.status = to


def idempotent(db: Session, user_id, endpoint: str, key: str | None, body: dict, run):
    """Run `run()` once per (user, endpoint, key); replays return the stored response."""
    if not key:
        raise AppError(428, "idempotency-key-required", "Missing Idempotency-Key header.")
    if len(key) > 128:
        raise AppError(422, "bad-idempotency-key", "Idempotency-Key is too long.")
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
    prior = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user_id,
                                                   IdempotencyKey.endpoint == endpoint, IdempotencyKey.key == key))
    if prior:
        if prior.request_hash != digest:
            raise AppError(422, "idempotency-key-reused", "This Idempotency-Key was used for a different request.")
        return prior.response
    result = run()
    db.add(IdempotencyKey(id=uuid7(), user_id=user_id, endpoint=endpoint, key=key, request_hash=digest,
                          status_code=200, response=result))
    try:
        db.commit()
    except IntegrityError:  # a concurrent duplicate won the race; return its response
        db.rollback()
        prior = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user_id,
                                                       IdempotencyKey.endpoint == endpoint, IdempotencyKey.key == key))
        return prior.response
    return result


def create_booking(db: Session, user, journey_id: str, on: date, travel_class: str, quota: str,
                   passengers: list[dict], group_id: uuid.UUID | None = None, batch_index: int | None = None) -> Booking:
    p = policy(db, quota)
    if not 1 <= len(passengers) <= p.max_passengers_per_pnr:
        raise AppError(422, "too-many-passengers",
                       f"{p.label} quota allows at most {p.max_passengers_per_pnr} passengers per booking.",
                       "Use the group planner to split larger groups into several bookings.")
    if travel_class not in FARE_PER_KM:
        raise AppError(422, "unknown-class", "Unknown travel class.")
    if group_id:
        _group_for(db, group_id, user.id)
    journey = find_journey(db, journey_id, on)
    if any(not leg["classes"] for leg in journey["legs"]):
        raise AppError(422, "class-unknown",
                       "The source timetable does not list travel classes for this train, so the sandbox cannot book it.",
                       "Book this journey on the official IRCTC website instead.")
    if any(travel_class not in leg["classes"] for leg in journey["legs"]):
        raise AppError(422, "class-unavailable", f"Class {travel_class} is not offered on every train in this journey.")
    departure = datetime.fromisoformat(journey["departure"])
    if departure < utcnow():
        raise AppError(422, "departed", "This train has already left.")
    fare = fare_for(journey, travel_class, len(passengers))
    b = Booking(id=uuid7(), user_id=user.id, group_id=group_id, batch_index=batch_index,
                provider=booking_provider.name, provider_mode=booking_provider.mode, status="DRAFT",
                quota=quota, travel_class=travel_class, from_code=journey["legs"][0]["from"],
                to_code=journey["legs"][-1]["to"], journey_date=on, departure_at=departure, journey=journey,
                fare_paise=fare, service_charge_paise=SERVICE_CHARGE_PAISE, total_paise=fare + SERVICE_CHARGE_PAISE)
    db.add(b)
    db.flush()
    for px in passengers:
        if px["age_band"] not in AGE_BANDS:
            raise AppError(422, "bad-age-band", "Unknown age band.")
        db.add(BookingPassenger(id=uuid7(), booking_id=b.id, name=px["name"], age_band=px["age_band"],
                                is_minor=px["age_band"] in ("child_5_11", "teen_12_17"),
                                berth_preference=px.get("berth_preference"),
                                group_member_id=px.get("group_member_id")))
    if all(px["age_band"] in ("child_5_11", "teen_12_17") for px in passengers):
        raise AppError(422, "adult-required", "A booking needs at least one adult passenger.")
    _record(db, b, "select_journey", Actor.PASSENGER)
    db.commit()
    db.refresh(b)
    return b


def get_booking(db: Session, booking_id: uuid.UUID, user_id) -> Booking:
    b = db.get(Booking, booking_id)
    if b is None or b.user_id != user_id:
        raise NOT_FOUND
    return b


def pay_and_confirm(db: Session, b: Booking, simulate: str | None) -> Booking:
    """Sandbox flow: charge, submit to the provider, then confirm or fail (refunding)."""
    b = db.scalar(select(Booking).where(Booking.id == b.id).with_for_update())
    if b.status != "SEARCHED":
        raise AppError(409, "invalid-transition", "This booking has already been submitted.")
    charge = payment_provider.charge(str(b.id), b.total_paise, simulate)
    pay = Payment(id=uuid7(), booking_id=b.id, provider=payment_provider.name, provider_mode=payment_provider.mode,
                  provider_payment_id=charge.reference, amount_paise=b.total_paise,
                  status="succeeded" if charge.ok else "failed")
    db.add(pay)
    if not charge.ok:
        db.commit()
        raise AppError(402, "payment-declined", "The sandbox payment was declined.", charge.detail)
    _record(db, b, "submit", Actor.PASSENGER, charge.detail)
    pax = [{"id": str(p.id), "name": p.name} for p in b.passengers]
    result = booking_provider.confirm(str(b.id), pax, b.travel_class, simulate)
    if result.ok:
        b.provider_ref = result.reference
        by_id = {x["id"]: x for x in result.passengers or []}
        for p in b.passengers:
            r = by_id.get(str(p.id), {})
            p.status, p.coach, p.berth = r.get("status", "confirmed"), r.get("coach"), r.get("berth")
        _record(db, b, "provider_confirmed", Actor.PROVIDER, result.detail)
        from payani.modules.pulse.service import schedule_booking_reminders  # avoid import cycle
        schedule_booking_reminders(db, b)
    else:
        b.failure_reason = result.detail
        _record(db, b, "provider_failed", Actor.PROVIDER, result.detail)
        _refund(db, pay, "Automatic refund: the booking could not be confirmed.")
    db.commit()
    db.refresh(b)
    return b


def _refund(db: Session, pay: Payment, note: str) -> Refund:
    out = payment_provider.refund(pay.provider_payment_id, pay.amount_paise)
    r = Refund(id=uuid7(), payment_id=pay.id, amount_paise=pay.amount_paise, status="pending",
               provider_refund_id=out.reference)
    db.add(r)
    db.flush()
    db.add(RefundTracking(id=uuid7(), refund_id=r.id, status="initiated", note=note, source="provider"))
    from payani.modules.jobs.queue import enqueue  # durable completion job
    enqueue(db, "refund.complete", {"refund_id": str(r.id)}, run_at=utcnow() + timedelta(minutes=2),
            dedupe_key=f"refund.complete:{r.id}")
    return r


def cancel(db: Session, b: Booking, user, reason: str | None) -> Booking:
    b = db.scalar(select(Booking).where(Booking.id == b.id).with_for_update())
    _record(db, b, "request_cancellation", Actor.PASSENGER, reason)
    req = CancellationRequest(id=uuid7(), booking_id=b.id, requested_by=user.id, reason=reason, status="requested")
    db.add(req)
    db.flush()
    out = booking_provider.cancel(b.provider_ref or "")
    if not out.ok:  # pragma: no cover - sandbox always succeeds
        req.status = "rejected"
        _record(db, b, "provider_cancel_rejected", Actor.PROVIDER, out.detail)
        db.commit()
        return b
    req.status, req.official_reference = "completed", out.reference
    _record(db, b, "provider_cancelled", Actor.PROVIDER, out.detail)
    for p in b.passengers:
        p.status = "cancelled"
    pay = db.scalar(select(Payment).where(Payment.booking_id == b.id, Payment.status == "succeeded"))
    if pay is not None:
        _record(db, b, "refund_initiated", Actor.SYSTEM, "Sandbox refund of the full amount.")
        _refund(db, pay, "Refund started after cancellation.")
    from payani.modules.pulse.service import cancel_booking_reminders
    cancel_booking_reminders(db, b)
    from payani.modules.connect.service import announce_cancellation  # optional community notice
    announce_cancellation(db, b)
    db.commit()
    db.refresh(b)
    return b


def complete_refund(db: Session, refund_id: uuid.UUID) -> None:
    """Job handler: the sandbox provider reports the refund as settled."""
    r = db.get(Refund, refund_id)
    if r is None or r.status != "pending":
        return
    r.status = "succeeded"
    db.add(RefundTracking(id=uuid7(), refund_id=r.id, status="credited",
                          note="Sandbox refund settled. No money moved.", source="provider"))
    pay = db.get(Payment, r.payment_id)
    pay.status = "refunded"
    b = db.get(Booking, pay.booking_id)
    if b.status == "REFUND_PENDING":
        _record(db, b, "refund_completed", Actor.PROVIDER, "Sandbox refund settled.")
    db.commit()


def booking_view(db: Session, b: Booking) -> dict:
    payments = db.scalars(select(Payment).where(Payment.booking_id == b.id).order_by(Payment.created_at)).all()
    refunds = db.scalars(select(Refund).where(Refund.payment_id.in_([p.id for p in payments]))).all() if payments else []
    return {
        "id": str(b.id), "status": b.status, "provider": b.provider, "provider_mode": b.provider_mode,
        "pnr": b.provider_ref, "quota": b.quota, "travel_class": b.travel_class,
        "from": b.from_code, "to": b.to_code, "journey_date": b.journey_date.isoformat(),
        "departure_at": b.departure_at.isoformat(), "journey": b.journey, "group_id": str(b.group_id) if b.group_id else None,
        "fare_paise": b.fare_paise, "service_charge_paise": b.service_charge_paise, "total_paise": b.total_paise,
        "failure_reason": b.failure_reason, "created_at": b.created_at.isoformat(),
        "passengers": [{"id": str(p.id), "name": p.name, "age_band": p.age_band, "status": p.status,
                        "coach": p.coach, "berth": p.berth} for p in b.passengers],
        "events": [{"event": e.event, "from": e.from_status, "to": e.to_status, "actor": e.actor, "note": e.note,
                    "at": e.created_at.isoformat()} for e in b.events],
        "payments": [{"id": str(p.id), "reference": p.provider_payment_id, "amount_paise": p.amount_paise,
                      "status": p.status, "mode": p.provider_mode} for p in payments],
        "refunds": [{"id": str(r.id), "amount_paise": r.amount_paise, "status": r.status,
                     "timeline": [{"status": t.status, "note": t.note, "at": t.observed_at.isoformat()} for t in r.timeline]}
                    for r in refunds],
        "allowed_actions": allowed_events(b.status, Actor.PASSENGER),
        "data": {"confidence": "simulated", "note": "Sandbox booking. Not a real ticket."},
    }


def ics(b: Booking) -> str:
    """Calendar file with an alarm 2 hours before departure (iCalendar, RFC 5545)."""
    dep = b.departure_at
    arr = datetime.fromisoformat(b.journey["arrival"])
    fmt = "%Y%m%dT%H%M%SZ"

    def utc(d):
        return d.astimezone(UTC).strftime(fmt)

    legs = "\\n".join(f"{leg['train_number']} {leg['from']}-{leg['to']} dep {leg['departure'][11:16]}"
                      for leg in b.journey["legs"])
    return "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PAYANI//Journey//EN", "BEGIN:VEVENT",
        f"UID:{b.id}@payani", f"DTSTAMP:{utcnow().strftime(fmt)}", f"DTSTART:{utc(dep)}", f"DTEND:{utc(arr)}",
        f"SUMMARY:Train {b.from_code} to {b.to_code} (PAYANI sandbox {b.provider_ref or ''})",
        f"DESCRIPTION:Simulated sandbox booking - not a real ticket.\\n{legs}",
        "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Train departs in 2 hours", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", "",
    ])
