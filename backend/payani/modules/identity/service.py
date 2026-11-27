"""Account and session logic. Routers stay thin; everything testable lives here."""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from payani.core import security
from payani.core.config import get_settings
from payani.core.db import utcnow, uuid7
from payani.core.errors import AppError
from payani.modules.identity.models import (
    PassengerProfile,
    RefreshToken,
    Role,
    User,
    UserRole,
)
from payani.modules.identity.permissions import PASSENGER
from payani.modules.identity.schemas import UserOut

INVALID_CREDENTIALS = AppError(
    401, "invalid-credentials", "Email or password is incorrect."
)
SESSION_EXPIRED = AppError(401, "session-expired", "Your session has ended. Please sign in again.")


@dataclass
class IssuedSession:
    access_token: str
    expires_in: int
    refresh_token: str
    user: User


def to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        locale=user.locale,
        timezone=user.timezone,
        email_verified=user.email_verified_at is not None,
        roles=user.role_codes,
        permissions=sorted(user.permission_codes),
        created_at=user.created_at,
    )


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(
        select(User).where(func.lower(User.email) == email.lower(), User.deleted_at.is_(None))
    )


def register(db: Session, email: str, password: str, display_name: str) -> User:
    local_part = email.split("@")[0].lower()
    if len(local_part) >= 4 and local_part in password.lower():
        raise AppError(422, "weak-password", "Password must not contain your email name.")
    role = db.scalar(select(Role).where(Role.code == PASSENGER))
    if role is None:  # pragma: no cover - migrations seed this
        raise AppError(500, "roles-missing", "Roles are not configured.")
    user = User(
        id=uuid7(),
        email=email.strip(),
        password_hash=security.hash_password(password),
        display_name=display_name,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(
            409, "email-taken", "An account with this email already exists.",
            "Try signing in instead, or reset your password.",
        ) from None
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.add(PassengerProfile(id=uuid7(), user_id=user.id))
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = get_user_by_email(db, email)
    ok = security.verify_password(user.password_hash if user else None, password)
    if not user or not ok:
        raise INVALID_CREDENTIALS
    if user.status != "active":
        raise AppError(403, "account-disabled", "This account is disabled.")
    if security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
    user.last_login_at = utcnow()
    return user


def issue_session(
    db: Session,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[IssuedSession, RefreshToken]:
    settings = get_settings()
    raw = security.new_refresh_token()
    record = RefreshToken(
        id=uuid7(),
        user_id=user.id,
        token_hash=security.hash_token(raw),
        family_id=family_id or uuid7(),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_ttl_days),
        user_agent=(user_agent or "")[:256] or None,
        ip=ip,
    )
    db.add(record)
    access, expires_in = security.create_access_token(user.id, user.role_codes)
    return IssuedSession(access, expires_in, raw, user), record


def login(db: Session, email: str, password: str, user_agent=None, ip=None) -> IssuedSession:
    user = authenticate(db, email, password)
    session, _ = issue_session(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return session


def rotate(db: Session, raw_refresh: str | None, user_agent=None, ip=None) -> IssuedSession:
    """Exchange a refresh token for a new pair. Reusing a rotated token revokes the family:
    that only happens if a token was stolen and used twice."""
    if not raw_refresh:
        raise SESSION_EXPIRED
    token = db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == security.hash_token(raw_refresh))
        .with_for_update()
    )
    if token is None:
        raise SESSION_EXPIRED
    now = utcnow()
    if token.revoked_at is not None:
        revoke_family(db, token.family_id)
        db.commit()
        raise SESSION_EXPIRED
    if token.expires_at <= now:
        raise SESSION_EXPIRED
    user = db.get(User, token.user_id)
    if user is None or user.status != "active" or user.deleted_at is not None:
        revoke_family(db, token.family_id)
        db.commit()
        raise SESSION_EXPIRED
    session, new_record = issue_session(
        db, user, family_id=token.family_id, user_agent=user_agent, ip=ip
    )
    db.flush()
    token.revoked_at = now
    token.replaced_by_id = new_record.id
    db.commit()
    return session


def revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def logout(db: Session, raw_refresh: str | None) -> None:
    if not raw_refresh:
        return
    token = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw_refresh))
    )
    if token is not None:
        revoke_family(db, token.family_id)
        db.commit()
