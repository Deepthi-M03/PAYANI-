"""Jobs and PULSE tables. Mirrors alembic/versions/0003_pulse_connect_admin.py."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from payani.core.db import Base, TimestampMixin, uuid7

_now = {"server_default": func.now(), "nullable": False}


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'running', 'done', 'failed', 'dead', 'cancelled')", name="status"),
        Index("ix_jobs_due", "status", "run_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    max_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="5")
    last_error: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationPreference(TimestampMixin, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "channel", name="uq_notification_preferences_user_channel"),
        CheckConstraint("channel IN ('in_app', 'email', 'webpush', 'whatsapp')", name="channel"),
        CheckConstraint("(quiet_start IS NULL AND quiet_end IS NULL) OR (quiet_start BETWEEN 0 AND 1439 AND "
                        "quiet_end BETWEEN 0 AND 1439)", name="quiet"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False, server_default="en")
    quiet_start: Mapped[int | None] = mapped_column(SmallInteger)
    quiet_end: Mapped[int | None] = mapped_column(SmallInteger)


class JourneyReminder(Base):
    __tablename__ = "journey_reminders"
    __table_args__ = (
        UniqueConstraint("booking_id", "kind", "offset_minutes", name="uq_journey_reminders_booking_kind_offset"),
        CheckConstraint("kind IN ('departure', 'arrival')", name="kind"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)


class NotificationSchedule(Base):
    __tablename__ = "notification_schedules"
    __table_args__ = (
        CheckConstraint("status IN ('scheduled', 'enqueued', 'cancelled', 'skipped')", name="status"),
        Index("ix_notification_schedules_due", "status", "fire_at"),
        Index("uq_notification_schedules_live", "reminder_id", unique=True,
              postgresql_where=text("status = 'scheduled'")),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    reminder_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("journey_reminders.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    fire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class NotificationOutbox(TimestampMixin, Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'skipped', 'failed', 'dead')", name="status"),
        Index("ix_notification_outbox_due", "status", "next_attempt_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notification_schedules.id", ondelete="SET NULL"))
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    template: Mapped[str] = mapped_column(String(48), nullable=False)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)


class NotificationDeliveryLog(Base):
    __tablename__ = "notification_delivery_logs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    outbox_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("notification_outbox.id", ondelete="CASCADE"),
                                                 nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class DeviceRegistration(Base):
    __tablename__ = "device_registrations"
    __table_args__ = (CheckConstraint("kind IN ('webpush', 'android')", name="kind"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str | None] = mapped_column(Text)
    auth: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class InAppNotification(Base):
    __tablename__ = "in_app_notifications"
    __table_args__ = (Index("ix_in_app_notifications_user_read", "user_id", "read_at"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(String(200))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)
