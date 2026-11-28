"""Import a timetable dataset into the catalogue.

Order of work, so a bad file can never damage the catalogue in use:
1. Record the attempt (status `validating`) and commit it, so history survives any failure.
2. Parse and validate entirely in memory (`payani.domain.timetable_import`). Nothing in the
   catalogue changes. A file that fails validation is recorded as `rejected`.
3. Replace the imported trains in ONE transaction: upsert stations, delete the previously
   imported trains, insert the new ones, mark the previous import `superseded` and this one
   `active`. Any error rolls the whole step back and the attempt is recorded as `failed`.

Re-importing the file that is already active changes nothing (status `unchanged`).
The synthetic catalogue is never deleted; it is used again if the import is withdrawn.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from payani.core.db import utcnow, uuid7
from payani.core.errors import AppError
from payani.domain import timetable_import as ti
from payani.modules.book import catalog
from payani.modules.book.models import Station, TrainRow, TrainStop
from payani.modules.timetable.models import TimetableImport

log = logging.getLogger("payani.timetable")
BATCH = 5000


@dataclass
class ImportRequest:
    source_key: str
    files: dict[str, bytes]
    file_name: str
    published_on: date | None = None
    licence: str | None = None
    licence_confirmed: bool = False
    retrieved_on: date | None = None
    actor_id: object | None = None


def _metadata(req: ImportRequest) -> tuple[ti.SourceProfile, str, date]:
    profile = ti.SOURCES.get(req.source_key)
    if profile is None:
        raise AppError(422, "unknown-source", f"Unknown dataset source {req.source_key!r}.",
                       f"Choose one of: {', '.join(ti.SOURCES)}.")
    licence = (req.licence or "").strip() or profile.licence
    published = req.published_on or profile.published_on
    if not licence:
        raise AppError(422, "licence-required", "Enter the licence shown on the source's download page.",
                       "PAYANI imports only data whose reuse licence you have checked.")
    if published is None:
        raise AppError(422, "published-date-required", "Enter the dataset's publication date.",
                       "Use the 'published' or 'as on' date from the source page; never today's date.")
    if not req.licence_confirmed:
        raise AppError(422, "licence-not-confirmed", "Confirm that you checked the dataset's licence.")
    if published > date.today():
        raise AppError(422, "published-date-future", "The publication date cannot be in the future.")
    return profile, licence, published


def run_import(db: Session, req: ImportRequest) -> TimetableImport:
    profile, licence, published = _metadata(req)
    digest = ti.bundle_digest(req.files)
    rec = TimetableImport(
        id=uuid7(), source_key=profile.key, source_name=profile.name, source_url=profile.url, licence=licence,
        licence_url=profile.licence_url, published_on=published, published_note=profile.published_note,
        retrieved_on=req.retrieved_on, official=profile.official, file_name=req.file_name[:200], file_sha256=digest,
        status="validating", counts={}, report={}, imported_by=req.actor_id,
    )
    db.add(rec)
    db.commit()
    rec_id = rec.id

    active = catalog.active_import(db)
    if active is not None and active.file_sha256 == digest and active.source_key == profile.key:
        rec.status, rec.counts, rec.finished_at = "unchanged", dict(active.counts or {}), utcnow()
        rec.report = {"note": "This file is already the active timetable. Nothing was changed."}
        db.commit()
        return rec

    try:
        parsed = ti.parse(profile.key, req.files)
    except ti.DatasetError as exc:
        return _finish(db, rec, "rejected", error=str(exc))
    ok, reason = ti.accepted(parsed)
    rec.counts, rec.report = parsed.counts(), parsed.report.to_dict()
    if not ok:
        return _finish(db, rec, "rejected", error=reason)
    db.commit()

    try:
        _activate(db, rec, parsed, active)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - any failure must leave the old catalogue intact
        db.rollback()
        log.exception("timetable import %s failed; previous catalogue kept", rec_id)
        rec = db.get(TimetableImport, rec_id)
        return _finish(db, rec, "failed", error=f"Database step failed ({exc.__class__.__name__}). "
                                                  "The previous timetable is still in use.")
    finally:
        catalog.invalidate()
    db.refresh(rec)
    return rec


def _finish(db: Session, rec: TimetableImport, status: str, error: str | None) -> TimetableImport:
    rec.status, rec.error, rec.finished_at = status, error, utcnow()
    db.commit()
    return rec


def _activate(db: Session, rec: TimetableImport, parsed: ti.ParsedDataset, previous: TimetableImport | None) -> None:
    _upsert_stations(db, parsed, rec.source_key)
    db.execute(delete(TrainRow).where(TrainRow.dataset_id.is_not(None)))
    _insert_trains(db, rec, parsed)
    now = utcnow()
    if previous is not None:
        previous.status, previous.superseded_at = "superseded", now
        db.flush()  # free the single 'active' slot before taking it
    rec.status, rec.activated_at, rec.finished_at = "active", now, now


def _upsert_stations(db: Session, parsed: ti.ParsedDataset, source_key: str) -> None:
    used = {s.station for t in parsed.trains for s in t.stops}
    existing = {s.code: s for s in db.scalars(select(Station).where(Station.code.in_(used)))} if used else {}
    new_rows = []
    for code in sorted(used):
        src = parsed.stations[code]
        row = existing.get(code)
        if row is None:
            new_rows.append({"id": uuid7(), "code": code, "name": src.name, "state": src.state, "zone": src.zone,
                             "lat": src.lat, "lon": src.lon, "source": source_key[:48]})
        elif (row.lat is None or row.lon is None) and src.lat is not None:
            row.lat, row.lon = src.lat, src.lon  # fill a missing position; never overwrite one
    for i in range(0, len(new_rows), BATCH):
        db.execute(insert(Station), new_rows[i:i + BATCH])
    db.flush()


def _insert_trains(db: Session, rec: TimetableImport, parsed: ti.ParsedDataset) -> None:
    trains, stops = [], []
    for t in parsed.trains:
        tid = uuid7()
        trains.append({"id": tid, "number": t.number, "name": t.name, "kind": t.kind[:24],
                       "running_days": t.running_days, "classes": ",".join(t.classes)[:64],
                       "source": rec.source_key[:48], "snapshot": rec.published_on, "dataset_id": rec.id,
                       "running_days_known": t.running_days_known, "distance_basis": t.distance_basis})
        stops.extend({"id": uuid7(), "train_id": tid, "seq": i, "station_code": s.station, "arr_min": s.arr,
                      "dep_min": s.dep, "distance_km": s.distance_km} for i, s in enumerate(t.stops))
    for i in range(0, len(trains), BATCH):
        db.execute(insert(TrainRow), trains[i:i + BATCH])
    _insert_stops(db, stops)


def _insert_stops(db: Session, stops: list[dict]) -> None:
    for i in range(0, len(stops), BATCH):
        db.execute(insert(TrainStop), stops[i:i + BATCH])


def withdraw_active(db: Session) -> TimetableImport | None:
    """Stop using the imported timetable: search returns to the synthetic (Simulated) catalogue."""
    active = catalog.active_import(db)
    if active is None:
        return None
    db.execute(delete(TrainRow).where(TrainRow.dataset_id.is_not(None)))
    active.status, active.superseded_at = "withdrawn", utcnow()
    db.commit()
    catalog.invalidate()
    return active


def to_dict(r: TimetableImport, with_report: bool = False) -> dict:
    label = ti.freshness_label(r.published_on, date.today())
    out = {
        "id": str(r.id), "status": r.status, "source_key": r.source_key, "source_name": r.source_name,
        "source_url": r.source_url, "licence": r.licence, "licence_url": r.licence_url, "official": r.official,
        "published_on": r.published_on.isoformat(), "published_note": r.published_note,
        "retrieved_on": r.retrieved_on.isoformat() if r.retrieved_on else None, "file_name": r.file_name,
        "file_sha256": r.file_sha256, "counts": r.counts or {}, "error": r.error,
        "errors": (r.report or {}).get("errors", 0), "warnings": (r.report or {}).get("warnings", 0),
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "activated_at": r.activated_at.isoformat() if r.activated_at else None,
        "freshness": label["freshness"], "outdated": label["outdated"], "warning": label["warning"],
    }
    if with_report:
        out["report"] = r.report or {}
    return out
