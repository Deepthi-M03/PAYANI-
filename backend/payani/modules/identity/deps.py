"""Authentication and authorisation dependencies.

Usage:  @router.get(..., dependencies=[Depends(require("user.read_all"))])
Permission checks always reload the user from the database, so revoking a role takes
effect on the next request rather than when the access token expires.
"""

import uuid

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from payani.core.db import get_db
from payani.core.errors import AppError
from payani.core.security import TokenError, decode_access_token
from payani.modules.identity.models import User

_bearer = HTTPBearer(auto_error=False)

NOT_SIGNED_IN = AppError(401, "unauthorized", "Please sign in to continue.")
FORBIDDEN = AppError(403, "forbidden", "You do not have permission to do this.")


def current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise NOT_SIGNED_IN
    try:
        claims = decode_access_token(creds.credentials)
        user_id = uuid.UUID(claims["sub"])
    except (TokenError, ValueError):
        raise NOT_SIGNED_IN from None
    user = db.get(User, user_id)
    if user is None or user.status != "active" or user.deleted_at is not None:
        raise NOT_SIGNED_IN
    request.state.user_id = user.id
    return user


def optional_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Like current_user, but anonymous requests get None instead of 401."""
    if creds is None:
        return None
    return current_user(request, creds, db)


def require(*permissions: str):
    """Dependency factory: the current user must hold every listed permission."""

    def checker(user: User = Depends(current_user)) -> User:
        if not set(permissions) <= user.permission_codes:
            raise FORBIDDEN
        return user

    return checker
