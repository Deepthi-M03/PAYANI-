"""Liveness and readiness probes."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from payani.core.db import get_db

router = APIRouter(prefix="/health", tags=["ops"])


@router.get("/live")
def live():
    return {"status": "ok"}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    """Ready only when the database answers and migrations have been applied."""
    try:
        version = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        return JSONResponse({"status": "unavailable", "database": "unreachable"}, status_code=503)
    if not version:
        return JSONResponse({"status": "unavailable", "migrations": "none"}, status_code=503)
    return {"status": "ok", "migration": version}
