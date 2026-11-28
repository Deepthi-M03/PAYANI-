"""PAYANI BOOK tables. Mirrors alembic/versions/0002_book.py (CI runs `alembic check`)."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from payani.core.db import Base, TimestampMixin, uuid7

_now = {"server_default": func.now(), "nullable": False}


class Station(Base):
    __tablename__ = "stations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    code: Mapped[str] = mapped_column(String(8), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Float)  # imported stations may have no position
    lon: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(48), nullable=False)
    zone: Mapped[str | None] = mapped_column(String(16))


class TrainRow(Base):
    __tablename__ = "trains"
    __table_args__ = (
        CheckConstraint("running_days BETWEEN 1 AND 127", name="running_days"),
        UniqueConstraint("source", "number", name="uq_trains_source_number"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    number: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    running_days: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    classes: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(48), nullable=False)
    snapshot: Mapped[date] = mapped_column(Date, nullable=False)
    # Set for trains from an imported dataset; NULL for the synthetic catalogue.
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("timetable_imports.id"), index=True)
    running_days_known: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    distance_basis: Mapped[str] = mapped_column(String(16), nullable=False, server_default="source")
    stops: Mapped[list["TrainStop"]] = relationship(order_by="TrainStop.seq", lazy="selectin")


class TrainStop(Base):
    __tablename__ = "train_stops"
    __table_args__ = (
        UniqueConstraint("train_id", "seq", name="uq_train_stops_train_seq"),
        CheckConstraint("arr_min IS NOT NULL OR dep_min IS NOT NULL", name="times"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    train_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trains.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    station_code: Mapped[str] = mapped_column(ForeignKey("stations.code"), nullable=False, index=True)
    arr_min: Mapped[int | None] = mapped_column(Integer)
    dep_min: Mapped[int | None] = mapped_column(Integer)
    distance_km: Mapped[int | None] = mapped_column(Integer)  # NULL when the source has no distance


class ProviderSyncRun(Base):
    __tablename__ = "provider_sync_runs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    provider: Mapped[str] = mapped_column(String(48), nullable=False)
    dataset: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    rows: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    licence: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BookingPolicy(Base):
    __tablename__ = "booking_policies"
    __table_args__ = (CheckConstraint("max_passengers_per_pnr BETWEEN 1 AND 12", name="cap"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    quota: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    max_passengers_per_pnr: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    verified_at: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)


class Group(TimestampMixin, Base):
    __tablename__ = "groups"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    from_code: Mapped[str | None] = mapped_column(String(8))
    to_code: Mapped[str | None] = mapped_column(String(8))
    journey_date: Mapped[date | None] = mapped_column(Date)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    members: Mapped[list["GroupMember"]] = relationship(order_by="GroupMember.created_at", lazy="selectin")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="role"),
        Index("uq_group_members_group_user", "group_id", "user_id", unique=True,
              postgresql_where=text("user_id IS NOT NULL")),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    family: Mapped[str] = mapped_column(String(80), nullable=False)
    is_minor: Mapped[bool] = mapped_column(Boolean, nullable=False)
    berth_preference: Mapped[str | None] = mapped_column(String(16))
    role: Mapped[str] = mapped_column(String(8), nullable=False, server_default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class GroupInvitation(Base):
    __tablename__ = "group_invitations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class JourneySearch(Base):
    __tablename__ = "journey_searches"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, **_now)


BOOKING_STATES = ("DRAFT", "SEARCHED", "PENDING_CONFIRMATION", "CONFIRMED", "FAILED",
                  "CANCELLATION_REQUESTED", "CANCELLED", "REFUND_PENDING", "REFUNDED")


class Booking(TimestampMixin, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint(f"status IN {BOOKING_STATES!r}", name="status"),
        CheckConstraint("provider_mode IN ('sandbox', 'live')", name="provider_mode"),
        CheckConstraint("fare_paise >= 0 AND service_charge_paise >= 0 AND total_paise = fare_paise + service_charge_paise",
                        name="amounts"),
        Index("ix_bookings_user_journey", "user_id", "journey_date"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"))
    batch_index: Mapped[int | None] = mapped_column(SmallInteger)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_mode: Mapped[str] = mapped_column(String(8), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(32), unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    quota: Mapped[str] = mapped_column(String(16), nullable=False)
    travel_class: Mapped[str] = mapped_column(String(4), nullable=False)
    from_code: Mapped[str] = mapped_column(String(8), nullable=False)
    to_code: Mapped[str] = mapped_column(String(8), nullable=False)
    journey_date: Mapped[date] = mapped_column(Date, nullable=False)
    departure_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    journey: Mapped[dict] = mapped_column(JSONB, nullable=False)
    fare_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    service_charge_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    total_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    passengers: Mapped[list["BookingPassenger"]] = relationship(lazy="selectin", order_by="BookingPassenger.name")
    events: Mapped[list["BookingEvent"]] = relationship(lazy="selectin", order_by="BookingEvent.created_at")


class BookingPassenger(Base):
    __tablename__ = "booking_passengers"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'confirmed', 'waitlisted', 'cancelled')", name="status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    group_member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("group_members.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    age_band: Mapped[str] = mapped_column(String(16), nullable=False)
    is_minor: Mapped[bool] = mapped_column(Boolean, nullable=False)
    berth_preference: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    coach: Mapped[str | None] = mapped_column(String(8))
    berth: Mapped[str | None] = mapped_column(String(8))


class BookingEvent(Base):
    __tablename__ = "booking_events"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(48), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("provider", "provider_payment_id", name="uq_payments_provider_payment"),
        CheckConstraint("status IN ('created', 'succeeded', 'failed', 'refunded')", name="status"),
        CheckConstraint("amount_paise >= 0", name="amount"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_mode: Mapped[str] = mapped_column(String(8), nullable=False)
    provider_payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="INR")
    status: Mapped[str] = mapped_column(String(16), nullable=False)


class Refund(TimestampMixin, Base):
    __tablename__ = "refunds"
    __table_args__ = (CheckConstraint("status IN ('pending', 'succeeded', 'failed')", name="status"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id", ondelete="CASCADE"), nullable=False, index=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_refund_id: Mapped[str | None] = mapped_column(String(64))
    timeline: Mapped[list["RefundTracking"]] = relationship(lazy="selectin", order_by="RefundTracking.observed_at")


class RefundTracking(Base):
    __tablename__ = "refund_tracking"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    refund_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("refunds.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)


class CancellationRequest(TimestampMixin, Base):
    __tablename__ = "cancellation_requests"
    __table_args__ = (
        CheckConstraint("status IN ('requested', 'completed', 'rejected')", name="status"),
        Index("uq_cancellation_requests_open", "booking_id", unique=True,
              postgresql_where=text("status = 'requested'")),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    official_reference: Mapped[str | None] = mapped_column(String(64))


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "endpoint", "key", name="uq_idempotency_keys_scope"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    response: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), **_now)
