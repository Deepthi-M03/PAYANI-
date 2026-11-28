"""PAYANI PULSE endpoints: preferences, consent, devices, inbox, reminders, train status."""

import os
import uuid
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from payani.core.db import get_db, utcnow, uuid7
from payani.core.errors import AppError
from payani.core.security import constant_time_equals
from payani.modules.book import catalog
from payani.modules.book import service as book
from payani.modules.identity.deps import current_user
from payani.modules.identity.models import User
from payani.modules.pulse import service
from payani.modules.pulse.models import (
    DeviceRegistration,
    InAppNotification,
    JourneyReminder,
    NotificationSchedule,
)

router = APIRouter(tags=["pulse"])


class PrefBody(BaseModel):
    channel: Literal["in_app", "email", "webpush", "whatsapp"]
    enabled: bool
    language: Literal["en", "ta", "hi"] = "en"
    quiet_start: int | None = Field(None, ge=0, le=1439)
    quiet_end: int | None = Field(None, ge=0, le=1439)


def _pref_view(db, user_id):
    prefs = service.preferences(db, user_id)
    db.commit()
    return {
        "channels": [{"channel": p.channel, "enabled": p.enabled, "language": p.language,
                      "quiet_start": p.quiet_start, "quiet_end": p.quiet_end} for p in prefs.values()],
        "whatsapp_consent": service.has_consent(db, user_id, "whatsapp"),
        "whatsapp_mode": "dry_run",
        "push_configured": bool(os.environ.get("VAPID_PUBLIC_KEY")),
        "email_configured": bool(os.environ.get("SMTP_HOST")),
    }


@router.get("/notification-preferences")
def get_prefs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _pref_view(db, user.id)


@router.put("/notification-preferences")
def put_prefs(body: list[PrefBody], user: User = Depends(current_user), db: Session = Depends(get_db)):
    prefs = service.preferences(db, user.id)
    for b in body:
        if (b.quiet_start is None) != (b.quiet_end is None):
            raise AppError(422, "quiet-hours", "Set both the start and end of quiet hours, or neither.")
        if b.channel == "whatsapp" and b.enabled and not service.has_consent(db, user.id, "whatsapp"):
            raise AppError(422, "consent-required", "Opt in to WhatsApp messages first.")
        p = prefs[b.channel]
        p.enabled, p.language, p.quiet_start, p.quiet_end = b.enabled, b.language, b.quiet_start, b.quiet_end
    db.commit()
    return _pref_view(db, user.id)


class ConsentBody(BaseModel):
    purpose: Literal["whatsapp", "community_discovery", "contact_share"]
    granted: bool


@router.post("/consents")
def consent(body: ConsentBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.record_consent(db, user.id, body.purpose, body.granted)
    if body.purpose == "whatsapp" and not body.granted:
        service.preferences(db, user.id)["whatsapp"].enabled = False  # withdrawal stops sending at once
    db.commit()
    return {"purpose": body.purpose, "granted": service.has_consent(db, user.id, body.purpose)}


@router.get("/push/public-key")
def push_key():
    key = os.environ.get("VAPID_PUBLIC_KEY")
    return {"configured": bool(key), "public_key": key}


class DeviceBody(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000, pattern=r"^https://")
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


@router.post("/devices/webpush", status_code=201)
def add_device(body: DeviceBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.scalar(select(DeviceRegistration).where(DeviceRegistration.endpoint == body.endpoint))
    if d is None:
        d = DeviceRegistration(id=uuid7(), user_id=user.id, kind="webpush", endpoint=body.endpoint)
        db.add(d)
    d.user_id, d.p256dh, d.auth, d.expired_at, d.last_seen_at = user.id, body.p256dh, body.auth, None, utcnow()
    service.preferences(db, user.id)["webpush"].enabled = True
    db.commit()
    return {"id": str(d.id)}


@router.get("/notifications")
def inbox(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(InAppNotification).where(InAppNotification.user_id == user.id)
                      .order_by(InAppNotification.created_at.desc()).limit(50)).all()
    unread = db.scalar(select(func.count()).select_from(InAppNotification)
                       .where(InAppNotification.user_id == user.id, InAppNotification.read_at.is_(None)))
    return {"unread": unread, "items": [{"id": str(n.id), "title": n.title, "body": n.body, "link": n.link,
                                         "read": n.read_at is not None, "at": n.created_at.isoformat()} for n in rows]}


@router.post("/notifications/read-all", status_code=204)
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(InAppNotification).where(InAppNotification.user_id == user.id,
                                               InAppNotification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return Response(status_code=204)


@router.post("/notifications/{nid}/read", status_code=204)
def read_one(nid: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(InAppNotification).where(InAppNotification.id == nid, InAppNotification.user_id == user.id)
               .values(read_at=utcnow()))
    db.commit()
    return Response(status_code=204)


def _reminders_view(db: Session, b) -> dict:
    rows = db.scalars(select(JourneyReminder).where(JourneyReminder.booking_id == b.id)
                      .order_by(JourneyReminder.kind, JourneyReminder.offset_minutes.desc())).all()
    out = []
    for r in rows:
        s = db.scalar(select(NotificationSchedule).where(NotificationSchedule.reminder_id == r.id)
                      .order_by(NotificationSchedule.created_at.desc()).limit(1))
        out.append({"kind": r.kind, "offset_minutes": r.offset_minutes, "enabled": r.enabled,
                    "fire_at": s.fire_at.isoformat() if s else None, "status": s.status if s else "none"})
    return {"booking_id": str(b.id), "reminders": out,
            "note": "Browser and email reminders are best effort. They are not guaranteed alarms; "
                    "add the calendar file for an alarm on your device."}


@router.get("/bookings/{booking_id}/reminders")
def get_reminders(booking_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _reminders_view(db, book.get_booking(db, booking_id, user.id))


class ReminderBody(BaseModel):
    offsets: list[int] = Field(max_length=6)
    arrival_alert: bool = True


@router.put("/bookings/{booking_id}/reminders")
def put_reminders(booking_id: uuid.UUID, body: ReminderBody, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    b = book.get_booking(db, booking_id, user.id)
    if not set(body.offsets) <= service.ALLOWED_OFFSETS:
        raise AppError(422, "bad-offset", "Choose from 24 h, 6 h, 2 h, 1 h, 30 min or departure time.")
    if b.status != "CONFIRMED":
        raise AppError(409, "not-confirmed", "Reminders can only be set for confirmed bookings.")
    service.schedule_booking_reminders(db, b, tuple(body.offsets), body.arrival_alert)
    db.commit()
    return _reminders_view(db, b)


@router.get("/trains/{number}/status")
def train_status(number: str, on: date = Query(alias="date"), db: Session = Depends(get_db)):
    """Schedule-only provider. 'Estimated position' assumes the train runs on time; there is
    no live data source in v1, so nothing here is labelled verified."""
    t = next((t for t in catalog.timetable(db) if t.number == number), None)
    if t is None:
        raise AppError(404, "not-found", "Train not found.")
    names = catalog.station_names(db)
    if not t.runs_on(on.weekday()):
        raise AppError(404, "not-running", "This train does not start on that date.")
    z = ZoneInfo("Asia/Kolkata")
    start = datetime.combine(on, datetime.min.time(), tzinfo=z)
    now = utcnow()
    stops, position = [], None
    for i, s in enumerate(t.stops):
        arr = start + timedelta(minutes=s.arr) if s.arr is not None else None
        dep = start + timedelta(minutes=s.dep) if s.dep is not None else None
        passed = (dep or arr) <= now
        stops.append({"seq": i, "code": s.station, "name": names.get(s.station, s.station),
                      "scheduled_arrival": arr.isoformat() if arr else None,
                      "scheduled_departure": dep.isoformat() if dep else None, "distance_km": s.distance_km,
                      "passed_if_on_time": passed})
        if passed:
            position = {"after": s.station, "next": t.stops[i + 1].station if i + 1 < len(t.stops) else None}
    first_dep = start + timedelta(minutes=t.stops[0].dep)
    last_arr = start + timedelta(minutes=t.stops[-1].arr)
    phase = "not_started" if now < first_dep else "completed" if now >= last_arr else "running"
    return {
        "train": {"number": t.number, "name": t.name}, "date": on.isoformat(), "stops": stops,
        "schedule": {**catalog.provenance(db), "running_days_known": t.days_known},
        "estimated": {"confidence": "estimated", "phase": phase, "position": position if phase == "running" else None,
                      "note": "Assumes the train is on time. Not live tracking."},
        "live": {"confidence": "verified", "available": False,
                 "note": "No authorised live train-status provider is connected in v1."},
    }


@router.post("/internal/tick")
def tick(x_worker_token: str | None = Header(None), db: Session = Depends(get_db)):
    """Lets a free external scheduler wake the API and run one worker pass (see docs/deployment.md)."""
    expected = os.environ.get("WORKER_TICK_TOKEN")
    if not expected or not constant_time_equals(x_worker_token, expected):
        raise AppError(403, "forbidden", "Not allowed.")
    from payani.worker.main import run_once
    return run_once(db)
