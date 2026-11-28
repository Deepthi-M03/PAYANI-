"""Reminders: scheduling, reconciliation, fan-out to channels, delivery with retries.

Flow: booking confirmed -> journey_reminders + notification_schedules (one live row per
reminder) -> worker promotes due schedules into notification_outbox (one row per enabled
channel, unique dedupe_key) -> worker delivers each outbox row, logging every attempt.
Times are stored in UTC; display and quiet hours use the user's time zone (IST default).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from payani.core.db import utcnow, uuid7
from payani.modules.identity.models import ConsentRecord, User
from payani.modules.pulse.models import (
    DeviceRegistration,
    InAppNotification,
    JourneyReminder,
    NotificationDeliveryLog,
    NotificationOutbox,
    NotificationPreference,
    NotificationSchedule,
)
from payani.providers import notify

log = logging.getLogger("payani.pulse")
CHANNELS = ("in_app", "email", "webpush", "whatsapp")
DEFAULT_OFFSETS = (1440, 360, 120, 60, 30, 0)
ALLOWED_OFFSETS = set(DEFAULT_OFFSETS)
CRITICAL_MINUTES = 120  # reminders this close to departure ignore quiet hours
MAX_ATTEMPTS = 5


# ------------------------------------------------------------------ preferences

def preferences(db: Session, user_id) -> dict[str, NotificationPreference]:
    rows = {p.channel: p for p in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user_id))}
    for ch in CHANNELS:
        if ch not in rows:  # defaults: in-app and email on, push needs a device, WhatsApp needs opt-in
            rows[ch] = NotificationPreference(id=uuid7(), user_id=user_id, channel=ch,
                                              enabled=ch in ("in_app", "email"), language="en")
            db.add(rows[ch])
    db.flush()
    return rows


def has_consent(db: Session, user_id, purpose: str) -> bool:
    latest = db.scalar(select(ConsentRecord).where(ConsentRecord.user_id == user_id, ConsentRecord.purpose == purpose)
                       .order_by(ConsentRecord.created_at.desc()).limit(1))
    return bool(latest and latest.granted)


def record_consent(db: Session, user_id, purpose: str, granted: bool, source: str = "settings") -> None:
    from payani.modules.identity.models import ConsentRecord as CR
    db.add(CR(id=uuid7(), user_id=user_id, purpose=purpose, granted=granted, policy_version="2026-11", source=source))


# ------------------------------------------------------------------ scheduling

def _reminder_time(booking, r: JourneyReminder) -> datetime:
    if r.kind == "arrival":
        return datetime.fromisoformat(booking.journey["arrival"]) - timedelta(minutes=r.offset_minutes)
    return booking.departure_at - timedelta(minutes=r.offset_minutes)


def schedule_booking_reminders(db: Session, booking, offsets=DEFAULT_OFFSETS, arrival_alert: bool = True) -> None:
    for off in DEFAULT_OFFSETS:
        _upsert_reminder(db, booking.id, "departure", off, off in offsets)
    _upsert_reminder(db, booking.id, "arrival", 30, arrival_alert)
    db.flush()
    reconcile(db, booking)


def _upsert_reminder(db: Session, booking_id, kind: str, offset: int, enabled: bool) -> None:
    stmt = insert(JourneyReminder).values(id=uuid7(), booking_id=booking_id, kind=kind, offset_minutes=offset,
                                          enabled=enabled)
    db.execute(stmt.on_conflict_do_update(constraint="uq_journey_reminders_booking_kind_offset",
                                          set_={"enabled": enabled}))


def reconcile(db: Session, booking) -> None:
    """Make schedules match reminders: cancel stale rows, create missing ones. Safe to rerun."""
    now = utcnow()
    reminders = db.scalars(select(JourneyReminder).where(JourneyReminder.booking_id == booking.id)).all()
    active = booking.status == "CONFIRMED"
    for r in reminders:
        live = db.scalar(select(NotificationSchedule).where(NotificationSchedule.reminder_id == r.id,
                                                             NotificationSchedule.status == "scheduled"))
        due = _reminder_time(booking, r)
        want = active and r.enabled and due > now - timedelta(minutes=5)
        if live and (not want or live.fire_at != due):
            live.status = "cancelled"
            db.flush()
            live = None
        if want and live is None:
            db.add(NotificationSchedule(id=uuid7(), reminder_id=r.id, user_id=booking.user_id, fire_at=due,
                                        status="scheduled"))
    db.flush()


def cancel_booking_reminders(db: Session, booking) -> None:
    ids = select(JourneyReminder.id).where(JourneyReminder.booking_id == booking.id)
    db.execute(update(NotificationSchedule).where(NotificationSchedule.reminder_id.in_(ids),
                                                  NotificationSchedule.status == "scheduled")
               .values(status="cancelled"))


# ------------------------------------------------------------------ fan-out

def _payload(booking, reminder: JourneyReminder, tz: str) -> tuple[str, dict]:
    z = ZoneInfo(tz)
    dep = booking.departure_at.astimezone(z)
    arr = datetime.fromisoformat(booking.journey["arrival"]).astimezone(z)
    first = booking.journey["legs"][0]
    if reminder.kind == "arrival":
        template = "arrival_alert"
    elif reminder.offset_minutes == 0:
        template = "departure_now"
    else:
        template = "departure_reminder"
    h, m = divmod(reminder.offset_minutes, 60)
    when = f"In {h} hour{'s' if h != 1 else ''}" if h and not m else f"In {reminder.offset_minutes} minutes"
    return template, {
        "when": when, "train": first["train_number"], "train_name": first["train_name"],
        "from_name": first.get("from_name", booking.from_code),
        "to_name": booking.journey["legs"][-1].get("to_name", booking.to_code),
        "dep_time": dep.strftime("%H:%M"), "dep_date": dep.strftime("%d %b %Y"), "arr_time": arr.strftime("%H:%M"),
        "pnr": booking.provider_ref or "", "link": f"/app/bookings/{booking.id}",
    }


def _quiet_delay(pref: NotificationPreference, at: datetime, tz: str) -> datetime:
    if pref.quiet_start is None or pref.quiet_end is None:
        return at
    local = at.astimezone(ZoneInfo(tz))
    minute = local.hour * 60 + local.minute
    s, e = pref.quiet_start, pref.quiet_end
    inside = (s <= minute < e) if s < e else (minute >= s or minute < e)
    if not inside:
        return at
    wait = (e - minute) % 1440
    return at + timedelta(minutes=wait)


def promote_due(db: Session, limit: int = 100) -> int:
    from payani.modules.book.models import Booking  # local import keeps modules decoupled
    rows = db.scalars(select(NotificationSchedule).where(NotificationSchedule.status == "scheduled",
                                                         NotificationSchedule.fire_at <= utcnow())
                      .order_by(NotificationSchedule.fire_at).limit(limit).with_for_update(skip_locked=True)).all()
    for s in rows:
        reminder = db.get(JourneyReminder, s.reminder_id)
        booking = db.get(Booking, reminder.booking_id)
        user = db.get(User, s.user_id)
        if booking.status != "CONFIRMED" or user is None:
            s.status = "skipped"
            continue
        prefs = preferences(db, user.id)
        template, payload = _payload(booking, reminder, user.timezone)
        critical = reminder.kind == "departure" and reminder.offset_minutes <= CRITICAL_MINUTES
        for ch, pref in prefs.items():
            if not pref.enabled:
                continue
            send_at = s.fire_at if critical else _quiet_delay(pref, s.fire_at, user.timezone)
            db.execute(insert(NotificationOutbox).values(
                id=uuid7(), user_id=user.id, schedule_id=s.id, channel=ch, template=template, language=pref.language,
                payload=payload, dedupe_key=f"{s.id}:{ch}", status="pending", next_attempt_at=send_at,
            ).on_conflict_do_nothing(index_elements=["dedupe_key"]))
        s.status = "enqueued"
    db.commit()
    return len(rows)


def notify_now(db: Session, user_id, template: str, payload: dict, dedupe_key: str, channels=("in_app",)) -> None:
    """Immediate notification (e.g. community cancellation notices)."""
    prefs = preferences(db, user_id)
    for ch in channels:
        if prefs[ch].enabled:
            db.execute(insert(NotificationOutbox).values(
                id=uuid7(), user_id=user_id, channel=ch, template=template, language=prefs[ch].language,
                payload=payload, dedupe_key=f"{dedupe_key}:{ch}", status="pending", next_attempt_at=utcnow(),
            ).on_conflict_do_nothing(index_elements=["dedupe_key"]))


# ------------------------------------------------------------------ delivery

def deliver_due(db: Session, limit: int = 50) -> int:
    rows = db.scalars(select(NotificationOutbox).where(NotificationOutbox.status == "pending",
                                                       NotificationOutbox.next_attempt_at <= utcnow())
                      .order_by(NotificationOutbox.next_attempt_at).limit(limit)
                      .with_for_update(skip_locked=True)).all()
    for o in rows:
        started = time.perf_counter()
        o.attempts += 1
        try:
            status, provider, msg_id, error = _send(db, o)
            o.status, o.last_error = status, error
        except Exception as exc:
            status, provider, msg_id, error = "failed", o.channel, None, str(exc)[:500]
            o.last_error = error
            if o.attempts >= MAX_ATTEMPTS:
                o.status = "dead"
            else:
                o.status, o.next_attempt_at = "pending", utcnow() + timedelta(minutes=2 ** o.attempts)
        db.add(NotificationDeliveryLog(id=uuid7(), outbox_id=o.id, provider=provider, status=status,
                                       provider_message_id=msg_id, error=error,
                                       latency_ms=int((time.perf_counter() - started) * 1000)))
    db.commit()
    return len(rows)


def _send(db: Session, o: NotificationOutbox):
    msg = notify.render(o.template, o.language, o.payload)
    if o.channel == "in_app":
        n = InAppNotification(id=uuid7(), user_id=o.user_id, title=msg["title"], body=msg["body"],
                              link=o.payload.get("link"))
        db.add(n)
        return "sent", "in_app", str(n.id), None
    if o.channel == "email":
        user = db.get(User, o.user_id)
        return notify.send_email(user.email, msg["title"], msg["body"])
    if o.channel == "webpush":
        devices = db.scalars(select(DeviceRegistration).where(DeviceRegistration.user_id == o.user_id,
                                                              DeviceRegistration.kind == "webpush",
                                                              DeviceRegistration.expired_at.is_(None))).all()
        if not devices:
            return "skipped", "webpush", None, "No active browser subscription"
        sent = False
        for d in devices:
            try:
                status, *_ = notify.send_webpush(d.endpoint, d.p256dh or "", d.auth or "", msg["title"], msg["body"],
                                                 o.payload.get("link"))
                sent = sent or status == "sent"
                if status == "skipped":
                    return status, "webpush", None, _[2]
            except notify.ExpiredSubscription:
                d.expired_at = utcnow()  # browser revoked it; stop using it
        return ("sent", "webpush", None, None) if sent else ("skipped", "webpush", None, "All subscriptions expired")
    if o.channel == "whatsapp":
        if not has_consent(db, o.user_id, "whatsapp"):
            return "skipped", "whatsapp-dry-run", None, "No WhatsApp opt-in"
        return notify.send_whatsapp_dry_run(str(o.user_id), o.template, o.language, o.payload)
    return "skipped", o.channel, None, "Unknown channel"
