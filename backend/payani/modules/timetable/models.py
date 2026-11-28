"""Timetable import history. Mirrors alembic/versions/0004_timetable_import.py."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Index,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from payani.core.db import Base, uuid7

IMPORT_STATES = ("validating", "rejected", "failed", "active", "superseded", "unchanged", "withdrawn")


class TimetableImport(Base):
    """One import attempt, kept forever as provenance and history. At most one is `active`:
    its trains are the catalogue that journey search uses."""

    __tablename__ = "timetable_imports"
    __table_args__ = (
        CheckConstraint(f"status IN {IMPORT_STATES!r}", name="status"),
        Index("uq_timetable_imports_one_active", "status", unique=True,
              postgresql_where=text("status = 'active'")),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    source_key: Mapped[str] = mapped_column(String(48), nullable=False)
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    licence: Mapped[str] = mapped_column(Text, nullable=False)
    licence_url: Mapped[str | None] = mapped_column(Text)
    published_on: Mapped[date] = mapped_column(Date, nullable=False)
    published_note: Mapped[str | None] = mapped_column(Text)
    retrieved_on: Mapped[date | None] = mapped_column(Date)
    official: Mapped[bool] = mapped_column(Boolean, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    counts: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    report: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error: Mapped[str | None] = mapped_column(Text)
    # Plain id, not a foreign key: import history must outlive user accounts, and a FK to
    # users would let `TRUNCATE users CASCADE` wipe the catalogue through trains.dataset_id.
    imported_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False,
                                                 index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
