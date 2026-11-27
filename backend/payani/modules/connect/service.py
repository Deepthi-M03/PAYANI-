"""PAYANI CONNECT: opt-in journey communities built for lawful coordination.

Guardrails (blueprint section 9): no resale or transfer marketplace, no payments between
users, phone numbers never shown, contact details shared only when both people agree.
Posts that look like resale or contain phone numbers / UPI IDs are held for moderation.
"""

from __future__ import annotations

import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from payani.core.db import utcnow, uuid7
from payani.core.errors import AppError
from payani.modules.connect.models import (
    CommunityMember,
    CommunityPost,
    CommunityReport,
    ContactShareRequest,
    TravelCommunity,
    UserBlock,
)

RESALE = re.compile(
    r"\b(sell(ing)?|resell|for sale|buy(ing)? (my|a|your) (ticket|berth|seat)|transfer (my|the) (ticket|pnr)|"
    r"confirmed ticket available|pay (me|via)|price|rs\.?\s?\d+|extra (money|charge))\b|₹\s?\d+",
    re.IGNORECASE)
CONTACT = re.compile(r"((\+?91[\s-]?)?[6-9]\d{9})|([\w.\-]{2,}@(upi|ok\w+|ybl|paytm|ibl|axl))|(\bupi\b)",
                     re.IGNORECASE)
NOT_FOUND = AppError(404, "not-found", "We couldn't find that.")


PHONE_DIGITS = re.compile(r"(?:91)?[6-9]\d{9}")


def screen(body: str) -> tuple[str, str | None]:
    compact = re.sub(r"[\s\-().+]", "", body)  # catches "98765 43210", "+91-98765-43210"
    if CONTACT.search(body) or PHONE_DIGITS.search(compact):
        return "held", "Contains a phone number or payment ID. Use consented contact sharing instead."
    if RESALE.search(body):
        return "held", "Looks like ticket resale or payment, which PAYANI does not allow."
    return "visible", None


def eligible_trains(db: Session, user_id) -> list[tuple[str, str]]:
    """Communities are only for trains on the user's own confirmed bookings."""
    from payani.modules.book.models import Booking
    out = set()
    for b in db.scalars(select(Booking).where(Booking.user_id == user_id, Booking.status == "CONFIRMED")):
        for leg in b.journey["legs"]:
            out.add((leg["train_number"], leg["train_origin_date"]))
    return sorted(out)


def join(db: Session, user, train_number: str, journey_date, alias: str, notify_cancellations: bool) -> TravelCommunity:
    from payani.modules.pulse.service import has_consent
    if not has_consent(db, user.id, "community_discovery"):
        raise AppError(422, "consent-required", "Turn on community participation in Settings first.")
    if (train_number, journey_date.isoformat()) not in eligible_trains(db, user.id):
        raise AppError(403, "not-travelling", "You can join a train's community only with a confirmed booking on it.")
    c = db.scalar(select(TravelCommunity).where(TravelCommunity.train_number == train_number,
                                                TravelCommunity.journey_date == journey_date))
    if c is None:
        c = TravelCommunity(id=uuid7(), train_number=train_number, journey_date=journey_date,
                            title=f"Train {train_number} on {journey_date:%d %b %Y}")
        db.add(c)
        db.flush()
    m = db.scalar(select(CommunityMember).where(CommunityMember.community_id == c.id,
                                                CommunityMember.user_id == user.id))
    if m is None:
        db.add(CommunityMember(id=uuid7(), community_id=c.id, user_id=user.id, alias=alias,
                               notify_cancellations=notify_cancellations))
    else:
        m.alias, m.notify_cancellations = alias, notify_cancellations
    db.commit()
    return c


def membership(db: Session, community_id, user_id) -> CommunityMember:
    m = db.scalar(select(CommunityMember).where(CommunityMember.community_id == community_id,
                                                CommunityMember.user_id == user_id))
    if m is None:
        raise NOT_FOUND
    return m


def blocked_ids(db: Session, user_id) -> set:
    rows = db.scalars(select(UserBlock).where(or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id)))
    return {r.blocked_id if r.blocker_id == user_id else r.blocker_id for r in rows}


def posts(db: Session, community_id, user_id) -> list[dict]:
    membership(db, community_id, user_id)
    hidden = blocked_ids(db, user_id)
    aliases = {m.user_id: m.alias for m in db.scalars(select(CommunityMember)
                                                      .where(CommunityMember.community_id == community_id))}
    rows = db.scalars(select(CommunityPost).where(CommunityPost.community_id == community_id)
                      .order_by(CommunityPost.created_at.desc()).limit(100)).all()
    out = []
    for p in rows:
        mine = p.author_id == user_id
        if p.author_id in hidden or p.status == "removed" or (p.status == "held" and not mine):
            continue
        out.append({"id": str(p.id), "kind": p.kind, "body": p.body, "status": p.status, "mine": mine,
                    "author": "PAYANI" if p.kind == "system" else aliases.get(p.author_id, "Former member"),
                    "author_id": str(p.author_id) if p.author_id and not mine else None,
                    "moderation_reason": p.moderation_reason if mine else None, "at": p.created_at.isoformat()})
    return out


def create_post(db: Session, community_id, user, body: str, kind: str) -> CommunityPost:
    membership(db, community_id, user.id)
    status, reason = screen(body)
    p = CommunityPost(id=uuid7(), community_id=community_id, author_id=user.id, kind=kind, body=body.strip(),
                      status=status, moderation_reason=reason)
    db.add(p)
    db.commit()
    return p


def report(db: Session, reporter, reason: str, details: str | None, post_id=None, user_id=None) -> CommunityReport:
    if post_id:
        p = db.get(CommunityPost, post_id)
        if p is None:
            raise NOT_FOUND
        membership(db, p.community_id, reporter.id)
        user_id = p.author_id
    r = CommunityReport(id=uuid7(), post_id=post_id, reported_user_id=user_id, reporter_id=reporter.id,
                        reason=reason, details=details, status="open")
    db.add(r)
    db.commit()
    return r


def block(db: Session, blocker, blocked_id) -> None:
    if blocked_id == blocker.id:
        raise AppError(422, "self-block", "You cannot block yourself.")
    if not db.scalar(select(UserBlock).where(UserBlock.blocker_id == blocker.id, UserBlock.blocked_id == blocked_id)):
        db.add(UserBlock(id=uuid7(), blocker_id=blocker.id, blocked_id=blocked_id))
        db.commit()


def request_contact(db: Session, requester, recipient_id, community_id) -> ContactShareRequest:
    from payani.modules.pulse.service import has_consent, notify_now
    membership(db, community_id, requester.id)
    membership(db, community_id, recipient_id)
    if recipient_id in blocked_ids(db, requester.id):
        raise NOT_FOUND
    if not has_consent(db, requester.id, "contact_share"):
        raise AppError(422, "consent-required", "Turn on contact sharing in Settings first.")
    existing = db.scalar(select(ContactShareRequest).where(ContactShareRequest.requester_id == requester.id,
                                                           ContactShareRequest.recipient_id == recipient_id,
                                                           ContactShareRequest.status == "pending"))
    if existing:
        return existing
    r = ContactShareRequest(id=uuid7(), requester_id=requester.id, recipient_id=recipient_id,
                            community_id=community_id, status="pending")
    db.add(r)
    db.flush()
    notify_now(db, recipient_id, "contact_request", {"link": "/app/connect"}, f"contact:{r.id}")
    db.commit()
    return r


def respond_contact(db: Session, user, request_id, accept: bool) -> ContactShareRequest:
    from payani.modules.pulse.service import has_consent
    r = db.get(ContactShareRequest, request_id)
    if r is None or r.recipient_id != user.id or r.status != "pending":
        raise NOT_FOUND
    if accept and not has_consent(db, user.id, "contact_share"):
        raise AppError(422, "consent-required", "Turn on contact sharing in Settings first.")
    r.status, r.responded_at = ("accepted" if accept else "declined"), utcnow()
    db.commit()
    return r


def announce_cancellation(db: Session, booking) -> None:
    """Post a neutral notice and tell members who asked. Never promises a berth."""
    from payani.modules.pulse.service import notify_now
    for leg in booking.journey["legs"]:
        c = db.scalar(select(TravelCommunity).where(TravelCommunity.train_number == leg["train_number"],
                                                    TravelCommunity.journey_date == leg["train_origin_date"]))
        if c is None:
            continue
        db.add(CommunityPost(id=uuid7(), community_id=c.id, author_id=None, kind="system", status="visible",
                             body="A traveller on this train cancelled. Seats may or may not be released; "
                                  "check official availability. PAYANI cannot guarantee a berth."))
        for m in db.scalars(select(CommunityMember).where(CommunityMember.community_id == c.id,
                                                          CommunityMember.notify_cancellations.is_(True),
                                                          CommunityMember.user_id != booking.user_id)):
            notify_now(db, m.user_id, "cancellation_notice", {"train": leg["train_number"], "link": "/app/connect"},
                       f"cancel:{booking.id}:{m.user_id}:{leg['train_number']}")
