"""Write admin audit entries in the same transaction as the change they describe."""

from fastapi import Request
from sqlalchemy.orm import Session

from payani.core.db import uuid7
from payani.core.logging import redact
from payani.modules.admin.models import AdminAuditLog


def record(
    db: Session,
    *,
    request: Request | None,
    actor_id,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> AdminAuditLog:
    entry = AdminAuditLog(
        id=uuid7(),
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=redact(before) if before is not None else None,
        after=redact(after) if after is not None else None,
        ip=request.client.host if request and request.client else None,
        request_id=getattr(request.state, "request_id", None) if request else None,
    )
    db.add(entry)
    return entry
