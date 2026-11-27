"""Background worker: reminders, outbox delivery and jobs. Run with

    python -m payani.worker.main

or set RUN_WORKER_IN_API=true to run the same loop in a thread inside the API process
(useful on free hosting with a single service).
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid

from sqlalchemy.orm import Session

from payani.core.db import get_sessionmaker
from payani.core.logging import configure_logging
from payani.modules.jobs import queue
from payani.modules.pulse import service as pulse

log = logging.getLogger("payani.worker")


@queue.handler("refund.complete")
def _refund_complete(db: Session, payload: dict) -> None:
    from payani.modules.book.service import complete_refund
    complete_refund(db, uuid.UUID(payload["refund_id"]))


def run_once(db: Session) -> dict:
    return {
        "promoted": pulse.promote_due(db),
        "delivered": pulse.deliver_due(db),
        "jobs": queue.run_due(db),
    }


def loop(stop: threading.Event, interval: float = 15.0) -> None:
    while not stop.is_set():
        db = get_sessionmaker()()
        try:
            stats = run_once(db)
            if any(stats.values()):
                log.info("worker pass", extra=stats)
        except Exception:
            log.exception("worker pass failed")
            db.rollback()
        finally:
            db.close()
        stop.wait(interval)


def start_in_thread() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=loop, args=(stop,), name="payani-worker", daemon=True).start()
    return stop


if __name__ == "__main__":
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))
    log.info("PAYANI worker started")
    event = threading.Event()
    try:
        loop(event, float(os.environ.get("WORKER_INTERVAL_SECONDS", "15")))
    except KeyboardInterrupt:
        event.set()
        time.sleep(0.1)
