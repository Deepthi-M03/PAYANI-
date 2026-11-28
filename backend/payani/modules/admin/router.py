"""Phase 2 admin endpoints: enough to prove RBAC and auditing end to end.
The full admin area arrives in Phase 7."""

import os
import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from payani.core.db import get_db, utcnow, uuid7
from payani.core.errors import AppError
from payani.modules.admin import audit
from payani.modules.admin.models import AdminAuditLog
from payani.modules.book import catalog
from payani.modules.book.models import Booking, JourneySearch, Payment, Refund
from payani.modules.connect.models import (
    AppSetting,
    CommunityPost,
    CommunityReport,
    ServiceChargeConfig,
)
from payani.modules.identity.deps import require
from payani.modules.identity.models import RefreshToken, Role, User, UserRole
from payani.modules.identity.permissions import SUPER_ADMIN
from payani.modules.identity.schemas import AdminUserOut, RoleAssignment
from payani.modules.pulse.models import Job, NotificationDeliveryLog, NotificationOutbox

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user_out(u: User) -> AdminUserOut:
    return AdminUserOut(
        id=u.id, email=u.email, display_name=u.display_name, status=u.status,
        roles=u.role_codes, created_at=u.created_at, last_login_at=u.last_login_at,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    limit: int = Query(50, ge=1, le=200),
    _: User = Depends(require("admin.access", "user.read_all")),
    db: Session = Depends(get_db),
):
    users = db.scalars(
        select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc()).limit(limit)
    ).all()
    return [_admin_user_out(u) for u in users]


@router.put("/users/{user_id}/roles", response_model=AdminUserOut)
def set_roles(
    user_id: uuid.UUID,
    body: RoleAssignment,
    request: Request,
    actor: User = Depends(require("role.grant")),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise AppError(404, "not-found", "User not found.")
    wanted = sorted(set(body.roles))
    roles = db.scalars(select(Role).where(Role.code.in_(wanted))).all()
    if len(roles) != len(wanted):
        raise AppError(422, "unknown-role", "One or more roles do not exist.")
    if target.id == actor.id and SUPER_ADMIN not in wanted:
        raise AppError(
            409, "self-demotion", "You cannot remove your own Super Administrator role.",
            "Ask another Super Administrator to do this, so the platform is never left without one.",
        )
    before = {"roles": target.role_codes}
    db.execute(delete(UserRole).where(UserRole.user_id == target.id))
    for role in roles:
        db.add(UserRole(user_id=target.id, role_id=role.id, granted_by=actor.id))
    audit.record(
        db, request=request, actor_id=actor.id, action="role.grant", entity_type="user",
        entity_id=str(target.id), before=before, after={"roles": wanted},
    )
    db.commit()
    db.expire(target)
    return _admin_user_out(db.get(User, user_id))


class AuditLogOut(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    before: dict | None
    after: dict | None
    request_id: str | None
    created_at: datetime


@router.get("/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    _: User = Depends(require("admin.access", "audit.read")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit)
    ).all()
    return [AuditLogOut.model_validate(r, from_attributes=True) for r in rows]


# ------------------------------------------------------------------ Phase 7: monitoring and configuration

def _counts(db: Session, col) -> dict:
    return {k: v for k, v in db.execute(select(col, func.count()).group_by(col)).all()}


@router.get("/overview")
def overview(_: User = Depends(require("admin.access", "analytics.read")), db: Session = Depends(get_db)):
    return {
        "users": db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None))),
        "bookings_by_status": _counts(db, Booking.status),
        "payments_by_status": _counts(db, Payment.status),
        "refunds_by_status": _counts(db, Refund.status),
        "outbox_by_status": _counts(db, NotificationOutbox.status),
        "jobs_by_status": _counts(db, Job.status),
        "open_reports": db.scalar(select(func.count()).select_from(CommunityReport).where(CommunityReport.status == "open")),
        "held_posts": db.scalar(select(func.count()).select_from(CommunityPost).where(CommunityPost.status == "held")),
        "catalog": catalog.freshness(db),
        "mode": "sandbox",
    }


@router.get("/bookings")
def admin_bookings(status: str | None = None, limit: int = Query(50, ge=1, le=200),
                   _: User = Depends(require("booking.read_all")), db: Session = Depends(get_db)):
    q = select(Booking, User.email).join(User, User.id == Booking.user_id).order_by(Booking.created_at.desc()).limit(limit)
    if status:
        q = q.where(Booking.status == status)
    return [{"id": str(b.id), "user": email, "status": b.status, "pnr": b.provider_ref,
             "route": f"{b.from_code}-{b.to_code}", "journey_date": b.journey_date.isoformat(),
             "passengers": len(b.passengers), "total_paise": b.total_paise, "mode": b.provider_mode,
             "created_at": b.created_at.isoformat()} for b, email in db.execute(q).all()]


@router.get("/payments")
def admin_payments(limit: int = Query(50, ge=1, le=200), _: User = Depends(require("booking.read_all")),
                   db: Session = Depends(get_db)):
    pays = db.scalars(select(Payment).order_by(Payment.created_at.desc()).limit(limit)).all()
    refunds = db.scalars(select(Refund).order_by(Refund.created_at.desc()).limit(limit)).all()
    return {
        "payments": [{"id": str(p.id), "booking_id": str(p.booking_id), "reference": p.provider_payment_id,
                      "amount_paise": p.amount_paise, "status": p.status, "mode": p.provider_mode,
                      "at": p.created_at.isoformat()} for p in pays],
        "refunds": [{"id": str(r.id), "payment_id": str(r.payment_id), "amount_paise": r.amount_paise,
                     "status": r.status, "at": r.created_at.isoformat()} for r in refunds],
    }


@router.get("/notifications")
def admin_notifications(limit: int = Query(50, ge=1, le=200), _: User = Depends(require("analytics.read")),
                        db: Session = Depends(get_db)):
    rows = db.scalars(select(NotificationOutbox).order_by(NotificationOutbox.created_at.desc()).limit(limit)).all()
    logs = db.scalars(select(NotificationDeliveryLog).order_by(NotificationDeliveryLog.created_at.desc()).limit(limit)).all()
    return {
        "outbox": [{"id": str(o.id), "channel": o.channel, "template": o.template, "status": o.status,
                    "attempts": o.attempts, "next_attempt_at": o.next_attempt_at.isoformat(),
                    "last_error": o.last_error} for o in rows],
        "deliveries": [{"outbox_id": str(d.outbox_id), "provider": d.provider, "status": d.status,
                        "error": d.error, "latency_ms": d.latency_ms, "at": d.created_at.isoformat()} for d in logs],
        "dead_jobs": [{"id": str(j.id), "kind": j.kind, "attempts": j.attempts, "error": j.last_error}
                      for j in db.scalars(select(Job).where(Job.status == "dead").limit(20))],
    }


@router.get("/providers")
def providers(_: User = Depends(require("admin.access")), db: Session = Depends(get_db)):
    fresh = catalog.freshness(db)
    return [
        {"capability": "Timetable", "provider": fresh.get("provider") or "none",
         "mode": "imported (scheduled)" if fresh.get("label") == "scheduled" else "sandbox", "status": fresh["status"]},
        {"capability": "Booking", "provider": "payani-sandbox", "mode": "sandbox", "status": "ok"},
        {"capability": "Payments", "provider": "payani-sandbox-pay", "mode": "sandbox", "status": "ok"},
        {"capability": "Train status", "provider": "schedule-only", "mode": "sandbox", "status": "ok"},
        {"capability": "Email", "provider": "smtp", "mode": "live" if os.environ.get("SMTP_HOST") else "off",
         "status": "configured" if os.environ.get("SMTP_HOST") else "not configured"},
        {"capability": "Web Push", "provider": "webpush", "mode": "live" if os.environ.get("VAPID_PUBLIC_KEY") else "off",
         "status": "configured" if os.environ.get("VAPID_PUBLIC_KEY") else "not configured"},
        {"capability": "WhatsApp", "provider": "whatsapp-business", "mode": "dry_run", "status": "dry run only (ADR 005)"},
    ]


@router.post("/providers/catalog/resync")
def resync(request: Request, actor: User = Depends(require("provider.manage")), db: Session = Depends(get_db)):
    rows = catalog.load_synthetic(db)
    audit.record(db, request=request, actor_id=actor.id, action="provider.resync", entity_type="provider",
                 entity_id="payani-synthetic", after={"rows": rows})
    db.commit()
    return catalog.freshness(db)


@router.get("/analytics")
def analytics(_: User = Depends(require("analytics.read")), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=30)
    day = func.date_trunc("day", JourneySearch.created_at)
    per_day = db.execute(select(day, func.count()).where(JourneySearch.created_at >= since).group_by(day).order_by(day)).all()
    route = JourneySearch.params["from"].astext + "-" + JourneySearch.params["to"].astext
    top = db.execute(select(route, func.count()).where(JourneySearch.created_at >= since).group_by(route)
                     .order_by(func.count().desc()).limit(8)).all()
    searches = sum(c for _, c in per_day)
    confirmed = db.scalar(select(func.count()).select_from(Booking).where(Booking.created_at >= since,
                                                                          Booking.status.in_(["CONFIRMED", "CANCELLATION_REQUESTED", "CANCELLED", "REFUND_PENDING", "REFUNDED"])))
    latency = db.scalar(select(func.percentile_cont(0.95).within_group(JourneySearch.latency_ms))
                        .where(JourneySearch.created_at >= since))
    return {"window_days": 30, "searches_per_day": [{"day": d.date().isoformat(), "count": c} for d, c in per_day],
            "top_routes": [{"route": r, "count": c} for r, c in top], "searches": searches,
            "confirmed_bookings": confirmed, "search_p95_ms": round(latency or 0),
            "note": "Sandbox activity only. No real bookings."}


@router.get("/moderation")
def moderation(_: User = Depends(require("moderation.manage")), db: Session = Depends(get_db)):
    held = db.scalars(select(CommunityPost).where(CommunityPost.status == "held").order_by(CommunityPost.created_at)).all()
    reports = db.scalars(select(CommunityReport).where(CommunityReport.status == "open").order_by(CommunityReport.created_at)).all()
    return {
        "held_posts": [{"id": str(p.id), "body": p.body, "reason": p.moderation_reason, "at": p.created_at.isoformat()} for p in held],
        "reports": [{"id": str(r.id), "post_id": str(r.post_id) if r.post_id else None, "reason": r.reason,
                     "details": r.details, "post_body": (db.get(CommunityPost, r.post_id).body if r.post_id else None),
                     "at": r.created_at.isoformat()} for r in reports],
    }


class PostAction(BaseModel):
    action: Literal["approve", "remove"]
    note: str | None = Field(None, max_length=300)


@router.post("/moderation/posts/{post_id}")
def moderate_post(post_id: uuid.UUID, body: PostAction, request: Request,
                  actor: User = Depends(require("moderation.manage")), db: Session = Depends(get_db)):
    p = db.get(CommunityPost, post_id)
    if p is None:
        raise AppError(404, "not-found", "Post not found.")
    before = {"status": p.status}
    p.status = "visible" if body.action == "approve" else "removed"
    p.moderation_reason = body.note or p.moderation_reason
    audit.record(db, request=request, actor_id=actor.id, action=f"moderation.{body.action}", entity_type="post",
                 entity_id=str(p.id), before=before, after={"status": p.status})
    db.commit()
    return {"id": str(p.id), "status": p.status}


class ReportAction(BaseModel):
    action: Literal["resolve", "dismiss"]
    remove_post: bool = False
    note: str | None = Field(None, max_length=300)


@router.post("/moderation/reports/{report_id}")
def handle_report(report_id: uuid.UUID, body: ReportAction, request: Request,
                  actor: User = Depends(require("moderation.manage")), db: Session = Depends(get_db)):
    r = db.get(CommunityReport, report_id)
    if r is None or r.status != "open":
        raise AppError(404, "not-found", "Open report not found.")
    r.status, r.resolved_by, r.resolution = ("resolved" if body.action == "resolve" else "dismissed"), actor.id, body.note
    if body.remove_post and r.post_id:
        db.get(CommunityPost, r.post_id).status = "removed"
    audit.record(db, request=request, actor_id=actor.id, action=f"report.{body.action}", entity_type="report",
                 entity_id=str(r.id), after={"status": r.status, "post_removed": body.remove_post})
    db.commit()
    return {"id": str(r.id), "status": r.status}


class UserStatus(BaseModel):
    status: Literal["active", "disabled"]


@router.put("/users/{user_id}/status", response_model=AdminUserOut)
def set_status(user_id: uuid.UUID, body: UserStatus, request: Request,
               actor: User = Depends(require("user.manage")), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise AppError(404, "not-found", "User not found.")
    if target.id == actor.id:
        raise AppError(409, "self-disable", "You cannot disable your own account.")
    if SUPER_ADMIN in target.role_codes and SUPER_ADMIN not in actor.role_codes:
        raise AppError(403, "forbidden", "Only a Super Administrator can change another Super Administrator.")
    before = {"status": target.status}
    target.status = body.status
    if body.status == "disabled":
        db.execute(update(RefreshToken).where(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=utcnow()))
    audit.record(db, request=request, actor_id=actor.id, action="user.status", entity_type="user",
                 entity_id=str(target.id), before=before, after={"status": body.status})
    db.commit()
    return _admin_user_out(target)


@router.get("/service-charges")
def service_charges(_: User = Depends(require("admin.access")), db: Session = Depends(get_db)):
    rows = db.scalars(select(ServiceChargeConfig).order_by(ServiceChargeConfig.effective_from.desc())).all()
    return [{"id": str(r.id), "kind": r.kind, "value": r.value, "effective_from": r.effective_from.isoformat(),
             "note": r.note} for r in rows]


class ChargeBody(BaseModel):
    kind: Literal["flat", "percent"]
    value: int = Field(ge=0, le=100_000)
    note: str = Field(min_length=3, max_length=300)


@router.post("/service-charges", status_code=201)
def set_service_charge(body: ChargeBody, request: Request, actor: User = Depends(require("service_charge.manage")),
                       db: Session = Depends(get_db)):
    """Recorded for a future release. v1 bookings always use 0 (ADR 007); a non-zero value
    is stored but not applied until a later release enables it."""
    row = ServiceChargeConfig(id=uuid7(), kind=body.kind, value=body.value, effective_from=utcnow(), created_by=actor.id, note=body.note)
    db.add(row)
    audit.record(db, request=request, actor_id=actor.id, action="service_charge.set", entity_type="service_charge",
                 after={"kind": body.kind, "value": body.value, "applied_in_v1": False})
    db.commit()
    return {"id": str(row.id), "applied_in_v1": False}


@router.get("/settings")
def settings(_: User = Depends(require("admin.access")), db: Session = Depends(get_db)):
    return {s.key: s.value for s in db.scalars(select(AppSetting))}


class SettingBody(BaseModel):
    value: bool | int | str | list[int]


EDITABLE = {"community_enabled": bool, "default_reminder_offsets": list}


@router.put("/settings/{key}")
def put_setting(key: str, body: SettingBody, request: Request,
                actor: User = Depends(require("system_settings.manage")), db: Session = Depends(get_db)):
    if key == "whatsapp_mode":
        raise AppError(422, "requires-approval", "WhatsApp stays in dry-run mode until the owner approves live messaging.")
    if key not in EDITABLE or not isinstance(body.value, EDITABLE[key]):
        raise AppError(422, "bad-setting", "Unknown setting or wrong value type.")
    s = db.get(AppSetting, key)
    before = {"value": s.value if s else None}
    if s is None:
        s = AppSetting(key=key, value=body.value)
        db.add(s)
    s.value, s.updated_by, s.updated_at = body.value, actor.id, utcnow()
    audit.record(db, request=request, actor_id=actor.id, action="setting.update", entity_type="setting",
                 entity_id=key, before=before, after={"value": body.value})
    db.commit()
    return {key: s.value}
