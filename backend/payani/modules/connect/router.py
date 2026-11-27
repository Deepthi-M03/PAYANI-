"""PAYANI CONNECT endpoints."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from payani.core.db import get_db
from payani.modules.connect import service
from payani.modules.connect.models import CommunityMember, ContactShareRequest, TravelCommunity
from payani.modules.identity.deps import current_user
from payani.modules.identity.models import User
from payani.modules.pulse.service import has_consent

router = APIRouter(prefix="/connect", tags=["connect"])


@router.get("/overview")
def overview(user: User = Depends(current_user), db: Session = Depends(get_db)):
    joined = db.execute(select(TravelCommunity, CommunityMember).join(
        CommunityMember, CommunityMember.community_id == TravelCommunity.id).where(CommunityMember.user_id == user.id)
        .order_by(TravelCommunity.journey_date)).all()
    joined_keys = {(c.train_number, c.journey_date.isoformat()) for c, _ in joined}
    return {
        "consents": {p: has_consent(db, user.id, p) for p in ("community_discovery", "contact_share")},
        "joined": [{"id": str(c.id), "title": c.title, "train_number": c.train_number,
                    "journey_date": c.journey_date.isoformat(), "alias": m.alias,
                    "notify_cancellations": m.notify_cancellations} for c, m in joined],
        "eligible": [{"train_number": t, "journey_date": d} for t, d in service.eligible_trains(db, user.id)
                     if (t, d) not in joined_keys],
    }


class JoinBody(BaseModel):
    train_number: str = Field(pattern=r"^\d{5}$")
    journey_date: date
    alias: str = Field(min_length=2, max_length=40)
    notify_cancellations: bool = False


@router.post("/communities", status_code=201)
def join(body: JoinBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = service.join(db, user, body.train_number, body.journey_date, body.alias, body.notify_cancellations)
    return {"id": str(c.id), "title": c.title}


@router.delete("/communities/{community_id}/membership", status_code=204)
def leave(community_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(service.membership(db, community_id, user.id))
    db.commit()
    return Response(status_code=204)


@router.get("/communities/{community_id}/posts")
def list_posts(community_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.posts(db, community_id, user.id)


class PostBody(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    kind: Literal["post", "tip"] = "post"


@router.post("/communities/{community_id}/posts", status_code=201)
def create_post(community_id: uuid.UUID, body: PostBody, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    p = service.create_post(db, community_id, user, body.body, body.kind)
    return {"id": str(p.id), "status": p.status, "moderation_reason": p.moderation_reason}


class ReportBody(BaseModel):
    post_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    reason: Literal["resale", "harassment", "spam", "personal_info", "other"]
    details: str | None = Field(None, max_length=500)


@router.post("/reports", status_code=201)
def report(body: ReportBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = service.report(db, user, body.reason, body.details, body.post_id, body.user_id)
    return {"id": str(r.id), "status": r.status}


@router.post("/blocks/{user_id}", status_code=204)
def block(user_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.block(db, user, user_id)
    return Response(status_code=204)


class ContactBody(BaseModel):
    recipient_id: uuid.UUID
    community_id: uuid.UUID


@router.post("/contact-requests", status_code=201)
def request_contact(body: ContactBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = service.request_contact(db, user, body.recipient_id, body.community_id)
    return {"id": str(r.id), "status": r.status}


@router.get("/contact-requests")
def contact_requests(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ContactShareRequest).where(or_(ContactShareRequest.requester_id == user.id,
                                                            ContactShareRequest.recipient_id == user.id))
                      .order_by(ContactShareRequest.created_at.desc())).all()
    out = []
    for r in rows:
        other_id = r.recipient_id if r.requester_id == user.id else r.requester_id
        alias = db.scalar(select(CommunityMember.alias).where(CommunityMember.community_id == r.community_id,
                                                              CommunityMember.user_id == other_id)) or "Traveller"
        other = db.get(User, other_id) if r.status == "accepted" else None
        out.append({"id": str(r.id), "direction": "outgoing" if r.requester_id == user.id else "incoming",
                    "status": r.status, "other_alias": alias,
                    "shared_email": other.email if other else None})  # only after both agreed
    return out


class RespondBody(BaseModel):
    accept: bool


@router.post("/contact-requests/{request_id}/respond")
def respond(request_id: uuid.UUID, body: RespondBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = service.respond_contact(db, user, request_id, body.accept)
    return {"id": str(r.id), "status": r.status}
