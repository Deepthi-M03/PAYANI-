"""PostgreSQL-backed durable job queue (ADR 001). No Redis required.

Jobs are rows; workers claim them with SELECT ... FOR UPDATE SKIP LOCKED, so several
workers can run safely. A dedupe_key makes enqueueing idempotent.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from payani.core.db import utcnow, uuid7
from payani.modules.pulse.models import Job

log = logging.getLogger("payani.jobs")
HANDLERS: dict[str, Callable[[Session, dict], None]] = {}


def handler(kind: str):
    def wrap(fn):
        HANDLERS[kind] = fn
        return fn
    return wrap


def enqueue(db: Session, kind: str, payload: dict, run_at: datetime | None = None,
            dedupe_key: str | None = None, max_attempts: int = 5) -> None:
    stmt = insert(Job).values(id=uuid7(), kind=kind, payload=payload, run_at=run_at or utcnow(), status="pending",
                              dedupe_key=dedupe_key, max_attempts=max_attempts)
    db.execute(stmt.on_conflict_do_nothing(index_elements=["dedupe_key"]))


def run_due(db: Session, limit: int = 20) -> int:
    jobs = db.scalars(select(Job).where(Job.status == "pending", Job.run_at <= utcnow())
                      .order_by(Job.run_at).limit(limit).with_for_update(skip_locked=True)).all()
    for job in jobs:
        job.status, job.locked_at, job.attempts = "running", utcnow(), job.attempts + 1
    db.commit()
    for job in jobs:
        fn = HANDLERS.get(job.kind)
        try:
            if fn is None:
                raise RuntimeError(f"No handler for job kind {job.kind}")
            fn(db, job.payload)
            job = db.get(Job, job.id)
            job.status = "done"
        except Exception as exc:  # retried with backoff, then dead-lettered
            db.rollback()
            job = db.get(Job, job.id)
            job.last_error = str(exc)[:500]
            if job.attempts >= job.max_attempts:
                job.status = "dead"
                log.error("Job dead-lettered", extra={"job": str(job.id), "kind": job.kind})
            else:
                job.status, job.run_at = "pending", utcnow() + timedelta(minutes=2 ** job.attempts)
        db.commit()
    return len(jobs)
