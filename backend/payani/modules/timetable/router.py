"""Timetable dataset endpoints.

Public: `GET /timetable/status` (what the search results are based on).
Admin: list and inspect imports (`admin.access`), import and withdraw (`provider.manage`).
Every change is written to the admin audit log.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from payani.core.db import get_db
from payani.core.errors import AppError
from payani.domain import timetable_import as ti
from payani.modules.admin import audit
from payani.modules.book import catalog
from payani.modules.identity.deps import require
from payani.modules.identity.models import User
from payani.modules.timetable import service
from payani.modules.timetable.models import TimetableImport

router = APIRouter(tags=["timetable"])

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@router.get("/timetable/status")
def status(db: Session = Depends(get_db)):
    return catalog.freshness(db)


@router.get("/admin/timetable/sources")
def sources(_: User = Depends(require("admin.access"))):
    return [{"key": p.key, "name": p.name, "url": p.url, "format": p.format, "official": p.official,
             "licence": p.licence, "licence_url": p.licence_url,
             "published_on": p.published_on.isoformat() if p.published_on else None,
             "published_note": p.published_note, "files": list(p.files),
             "needs_metadata": p.licence is None or p.published_on is None} for p in ti.SOURCES.values()]


@router.get("/admin/timetable/imports")
def list_imports(limit: int = Query(30, ge=1, le=100), _: User = Depends(require("admin.access")),
                 db: Session = Depends(get_db)):
    rows = db.scalars(select(TimetableImport).order_by(TimetableImport.started_at.desc()).limit(limit)).all()
    return {"current": catalog.freshness(db), "imports": [service.to_dict(r) for r in rows]}


@router.get("/admin/timetable/imports/{import_id}")
def get_import(import_id: uuid.UUID, _: User = Depends(require("admin.access")), db: Session = Depends(get_db)):
    r = db.get(TimetableImport, import_id)
    if r is None:
        raise AppError(404, "not-found", "Import not found.")
    return service.to_dict(r, with_report=True)


@router.post("/admin/timetable/imports", status_code=201)
async def create_import(
    request: Request,
    source: str = Query(..., max_length=48),
    file_name: str = Query("upload", max_length=200),
    published_on: date | None = Query(None),
    licence: str | None = Query(None, max_length=300),
    licence_confirmed: bool = Query(False),
    retrieved_on: date | None = Query(None),
    actor: User = Depends(require("admin.access", "provider.manage")),
    db: Session = Depends(get_db),
):
    """Upload the dataset as the raw request body: a .csv for data.gov.in, or a .zip holding
    stations.json, trains.json and schedules.json for DataMeet. For very large files, the
    command line import (docs/timetable-data.md) avoids upload limits on hosting platforms."""
    declared = int(request.headers.get("content-length") or 0)
    if declared > MAX_UPLOAD_BYTES:
        raise AppError(413, "too-large", "The file is larger than 200 MB.", "Use the command line import instead.")
    body = await request.body()
    if not body:
        raise AppError(422, "empty-upload", "The upload is empty.")
    if len(body) > MAX_UPLOAD_BYTES:
        raise AppError(413, "too-large", "The file is larger than 200 MB.", "Use the command line import instead.")
    try:
        files = ti.read_zip(body) if body[:2] == b"PK" else {file_name if "." in file_name else f"{file_name}.csv": body}
    except ti.DatasetError as exc:
        raise AppError(422, "unreadable-upload", str(exc)) from None
    req = service.ImportRequest(source_key=source, files=files, file_name=file_name, published_on=published_on,
                                licence=licence, licence_confirmed=licence_confirmed, retrieved_on=retrieved_on,
                                actor_id=actor.id)
    rec = await _run(db, req)
    audit.record(db, request=request, actor_id=actor.id, action="timetable.import", entity_type="timetable_import",
                 entity_id=str(rec.id), after={"status": rec.status, "source": rec.source_key,
                                               "counts": rec.counts, "error": rec.error})
    db.commit()
    return service.to_dict(rec, with_report=True)


async def _run(db: Session, req: service.ImportRequest):
    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(service.run_import, db, req)


@router.post("/admin/timetable/withdraw")
def withdraw(request: Request, actor: User = Depends(require("admin.access", "provider.manage")),
             db: Session = Depends(get_db)):
    rec = service.withdraw_active(db)
    if rec is None:
        raise AppError(409, "nothing-active", "No imported timetable is active.")
    audit.record(db, request=request, actor_id=actor.id, action="timetable.withdraw", entity_type="timetable_import",
                 entity_id=str(rec.id), after={"status": rec.status})
    db.commit()
    return catalog.freshness(db)
