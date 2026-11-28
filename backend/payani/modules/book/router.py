"""PAYANI BOOK and INTELLIGENCE endpoints."""

import functools
import threading
import uuid
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from payani.core import maps
from payani.core.db import get_db
from payani.core.errors import AppError
from payani.domain import catalog_synth, forecasting
from payani.modules.book import catalog, service
from payani.modules.book.models import Booking, BookingPolicy, Group, GroupMember, Payment, Refund
from payani.modules.identity.deps import current_user, optional_user
from payani.modules.identity.models import User
from payani.providers.booking import official_handoff

router = APIRouter(tags=["book"])

Code = Field(min_length=2, max_length=8, pattern=r"^[A-Z]+$")


# ------------------------------------------------------------------ catalogue

def _station_out(s: dict) -> dict:
    return {"code": s["code"], "name": s["name"], "state": s.get("state"), "lat": s.get("lat"), "lon": s.get("lon"),
            "google_maps_url": maps.place_url(s["name"], s.get("lat"), s.get("lon"))}


def _search_stations(directory: dict[str, dict], visits: dict[str, int], q: str, limit: int = 8) -> list[dict]:
    q = q.strip().lower()
    if not q:
        return []
    scored = []
    for code, st in directory.items():
        name = (st["name"] or "").lower()
        if code.lower() == q:
            rank = 0
        elif code.lower().startswith(q):
            rank = 1
        elif name.startswith(q):
            rank = 2
        elif q in name:
            rank = 3
        else:
            continue
        scored.append((rank, -visits.get(code, 0), code))
    return [directory[c] for _, _, c in sorted(scored)[:limit]]


@router.get("/stations")
def stations(q: str = Query("", max_length=40), db: Session = Depends(get_db)):
    """Stations served by the active timetable, matched by code or name."""
    return [_station_out(s) for s in _search_stations(catalog.stations(db), catalog.station_visits(db), q)]


@functools.lru_cache(maxsize=1)
def _network_links() -> list[list[str]]:
    """Pairs of consecutive stops served by the synthetic timetable (a schematic network)."""
    pairs = set()
    for t in catalog_synth.generate_trains():
        for a, b in zip(t.stops, t.stops[1:], strict=False):
            pairs.add(tuple(sorted((a.station, b.station))))
    return [list(p) for p in sorted(pairs)]


MAP_STATION_LIMIT = 160


@router.get("/stations/map")
def station_map(include: str = Query("", max_length=400), db: Session = Depends(get_db)):
    """Stations to draw on the map, with positions. For the synthetic catalogue: every station
    plus schematic links. For an imported national timetable: the busiest stations that have a
    position, plus any codes passed in `include` (the stations of the journey on screen), and
    no network links. Positions come from the source and are approximate."""
    directory = catalog.stations(db)
    active = catalog.active_import(db)
    if active is None:
        return {
            "stations": [_station_out(s) for s in directory.values() if s["lat"] is not None],
            "links": _network_links(),
            "position_note": "Approximate station positions (about 1 km), hand-compiled.",
            "links_note": "Schematic links between stations served by the synthetic timetable; not track geometry.",
            "source": catalog_synth.SOURCE,
            "missing_positions": [],
        }
    visits = catalog.station_visits(db)
    wanted = [c.strip().upper() for c in include.split(",") if c.strip()][:40]
    placed = [s for s in directory.values() if s["lat"] is not None and s["lon"] is not None]
    busiest = sorted(placed, key=lambda s: -visits.get(s["code"], 0))[:MAP_STATION_LIMIT]
    chosen = {s["code"]: s for s in busiest}
    for code in wanted:
        st = directory.get(code)
        if st and st["lat"] is not None:
            chosen[code] = st
    return {
        "stations": [_station_out(s) for s in chosen.values()],
        "links": [],
        "position_note": f"Approximate position from {active.source_name}.",
        "links_note": None,
        "source": active.source_key,
        "missing_positions": [c for c in wanted if c in directory and directory[c]["lat"] is None],
    }


@router.get("/catalog/freshness")
def freshness(db: Session = Depends(get_db)):
    return catalog.freshness(db)


@router.get("/booking-policies")
def policies(db: Session = Depends(get_db)):
    return [{"quota": p.quota, "label": p.label, "max_passengers_per_pnr": p.max_passengers_per_pnr,
             "source_url": p.source_url, "verified_at": p.verified_at.isoformat(), "note": p.note}
            for p in db.scalars(select(BookingPolicy).order_by(BookingPolicy.quota))]


class SearchBody(BaseModel):
    from_code: str = Code
    to_code: str = Code
    date: date
    preference: Literal["balanced", "fastest", "fewest_changes", "earliest_arrival"] = "balanced"
    max_transfers: int = Field(2, ge=0, le=2)


@router.post("/journeys/search")
def search(body: SearchBody, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    today = date.today()
    if not today - timedelta(days=1) <= body.date <= today + timedelta(days=120):
        raise AppError(422, "date-out-of-range", "Choose a date from today up to 120 days ahead.")
    results = service.search(db, user.id if user else None, body.from_code, body.to_code, body.date,
                             body.preference, body.max_transfers)
    used = service.effective_max_transfers(db, body.max_transfers)
    note = ("Searched direct trains and journeys with one change: the national timetable is too large "
            "to search two changes quickly.") if used < body.max_transfers else None
    return {"results": results, "freshness": catalog.freshness(db),
            "search": {"max_transfers": used, "requested_max_transfers": body.max_transfers, "note": note}}


@router.get("/journeys/{journey_id}")
def journey(journey_id: str, on: date = Query(alias="date"), db: Session = Depends(get_db)):
    return service.find_journey(db, journey_id, on)


# ------------------------------------------------------------------ groups

class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    from_code: str | None = Field(None, max_length=8)
    to_code: str | None = Field(None, max_length=8)
    journey_date: date | None = None


class MemberBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    family: str = Field("", max_length=80)
    is_minor: bool = False
    berth_preference: Literal["lower", "middle", "upper", "side_lower", "side_upper"] | None = None


def group_view(g: Group, user_id) -> dict:
    return {
        "id": str(g.id), "name": g.name, "from": g.from_code, "to": g.to_code,
        "journey_date": g.journey_date.isoformat() if g.journey_date else None,
        "is_owner": g.owner_id == user_id,
        "members": [{"id": str(m.id), "name": m.name, "family": m.family, "is_minor": m.is_minor,
                     "berth_preference": m.berth_preference, "role": m.role, "linked_account": m.user_id is not None}
                    for m in g.members],
    }


@router.post("/groups", status_code=201)
def create_group(body: GroupBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return group_view(service.create_group(db, user, body.name, body.from_code, body.to_code, body.journey_date), user.id)


@router.get("/groups")
def list_groups(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    groups = db.scalars(select(Group).where(Group.deleted_at.is_(None), Group.id.in_(ids)).order_by(Group.created_at.desc()))
    return [group_view(g, user.id) for g in groups]


@router.get("/groups/{group_id}")
def get_group(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return group_view(service._group_for(db, group_id, user.id), user.id)


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = service._group_for(db, group_id, user.id, owner_only=True)
    from payani.core.db import utcnow
    g.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/groups/{group_id}/members", status_code=201)
def add_member(group_id: uuid.UUID, body: MemberBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = service._group_for(db, group_id, user.id, owner_only=True)
    service.add_member(db, g, body.name, body.family, body.is_minor, body.berth_preference)
    return group_view(db.get(Group, group_id), user.id)


@router.delete("/groups/{group_id}/members/{member_id}")
def remove_member(group_id: uuid.UUID, member_id: uuid.UUID, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    g = service._group_for(db, group_id, user.id, owner_only=True)
    service.remove_member(db, g, member_id)
    db.expire_all()
    return group_view(db.get(Group, group_id), user.id)


@router.post("/groups/{group_id}/invitations", status_code=201)
def invite(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = service._group_for(db, group_id, user.id, owner_only=True)
    token = service.create_invitation(db, g, user)
    return {"token": token, "path": f"/app/invite/{token}", "expires_in_days": 7}


@router.post("/invitations/{token}/accept")
def accept(token: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return group_view(service.accept_invitation(db, token, user), user.id)


@router.get("/groups/{group_id}/batch-plan")
def batch_plan(group_id: uuid.UUID, quota: str = "GN", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.batch_plan(db, service._group_for(db, group_id, user.id), quota)


# ------------------------------------------------------------------ bookings

class PassengerBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    age_band: Literal["child_5_11", "teen_12_17", "adult_18_59", "senior_60_plus"]
    berth_preference: Literal["lower", "middle", "upper", "side_lower", "side_upper"] | None = None
    group_member_id: uuid.UUID | None = None


class BookingBody(BaseModel):
    journey_id: str = Field(min_length=3, max_length=400)
    date: date
    travel_class: Literal["SL", "3A", "2A", "1A"]
    quota: Literal["GN", "TQ"] = "GN"
    passengers: list[PassengerBody] = Field(min_length=1, max_length=12)
    group_id: uuid.UUID | None = None
    batch_index: int | None = Field(None, ge=0, le=20)


class PayBody(BaseModel):
    simulate: Literal["fail", "waitlist", "payment_fail"] | None = None


@router.post("/bookings", status_code=201)
def create_booking(body: BookingBody, idempotency_key: str | None = Header(None),
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    def run():
        b = service.create_booking(db, user, body.journey_id, body.date, body.travel_class, body.quota,
                                   [p.model_dump() for p in body.passengers], body.group_id, body.batch_index)
        return service.booking_view(db, b)
    return service.idempotent(db, user.id, "bookings.create", idempotency_key, body.model_dump(mode="json"), run)


@router.get("/bookings")
def list_bookings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Booking).where(Booking.user_id == user.id).order_by(Booking.departure_at.desc()))
    return [service.booking_view(db, b) for b in rows]


@router.get("/bookings/{booking_id}")
def get_booking(booking_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.booking_view(db, service.get_booking(db, booking_id, user.id))


@router.post("/bookings/{booking_id}/pay")
def pay(booking_id: uuid.UUID, body: PayBody, idempotency_key: str | None = Header(None),
        user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = service.get_booking(db, booking_id, user.id)
    return service.idempotent(db, user.id, f"bookings.pay:{booking_id}", idempotency_key, body.model_dump(),
                              lambda: service.booking_view(db, service.pay_and_confirm(db, b, body.simulate)))


class CancelBody(BaseModel):
    reason: str | None = Field(None, max_length=300)


@router.post("/bookings/{booking_id}/cancel")
def cancel(booking_id: uuid.UUID, body: CancelBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = service.get_booking(db, booking_id, user.id)
    return service.booking_view(db, service.cancel(db, b, user, body.reason))


@router.get("/bookings/{booking_id}/handoff")
def handoff(booking_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return official_handoff(service.booking_view(db, service.get_booking(db, booking_id, user.id)))


@router.get("/bookings/{booking_id}/calendar.ics")
def calendar(booking_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = service.get_booking(db, booking_id, user.id)
    return Response(service.ics(b), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="payani-{b.id}.ics"'})


@router.get("/refunds")
def refunds(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Refund, Booking).join(Payment, Refund.payment_id == Payment.id)
                      .join(Booking, Payment.booking_id == Booking.id)
                      .where(Booking.user_id == user.id).order_by(Refund.created_at.desc())).all()
    return [{"id": str(r.id), "booking_id": str(b.id), "pnr": b.provider_ref, "route": f"{b.from_code}-{b.to_code}",
             "amount_paise": r.amount_paise, "status": r.status, "mode": "sandbox",
             "timeline": [{"status": t.status, "note": t.note, "at": t.observed_at.isoformat()} for t in r.timeline]}
            for r, b in rows]


# ------------------------------------------------------------------ intelligence

_model: dict = {"m": None}
_model_lock = threading.Lock()


def _forecaster() -> forecasting.TrainedModel:
    with _model_lock:
        if _model["m"] is None:
            _model["m"] = forecasting.train(forecasting.generate())
        return _model["m"]


def warm_forecaster() -> None:
    """Train the forecast model once, in the background, so the first forecast request after
    a (re)start is fast instead of waiting for training. The model lives in memory only, so
    this runs on every process start. A failure is logged and the request path still trains
    on demand."""
    import logging

    try:
        _forecaster()
        logging.getLogger("payani.forecast").info("forecast model ready")
    except Exception:  # noqa: BLE001 - never let warm-up take the API down
        logging.getLogger("payani.forecast").exception("forecast warm-up failed")


@router.get("/intelligence/routes")
def forecast_routes():
    names = catalog_synth.STATION_BY_CODE
    return [{"route": f"{o}-{d}", "from": names[o].name, "to": names[d].name} for o, d, _ in forecasting.ROUTES]


@router.get("/intelligence/forecast")
def forecast(route: str, on: date = Query(alias="date"), user: User = Depends(current_user)):
    model = _forecaster()
    try:
        return forecasting.forecast(model, route, on)
    except KeyError:
        raise AppError(404, "unknown-route", "No forecast is available for that route.") from None
    except ValueError as exc:
        raise AppError(422, "out-of-range", str(exc)) from None


@router.get("/intelligence/model-card")
def model_card(user: User = Depends(current_user)):
    return _forecaster().card
