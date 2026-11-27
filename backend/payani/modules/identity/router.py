"""Auth and current-user endpoints.

Refresh tokens live in an httpOnly cookie scoped to /api/v1/auth. Because that cookie is
sent automatically, /refresh and /logout also require a double-submit CSRF token: the
value of the readable `payani_csrf` cookie echoed in the X-CSRF-Token header.
"""

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from payani.core import security
from payani.core.config import get_settings
from payani.core.db import get_db
from payani.core.errors import AppError, problem_response
from payani.core.rate_limit import limiter
from payani.modules.identity import service
from payani.modules.identity.deps import current_user, require
from payani.modules.identity.models import User
from payani.modules.identity.schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)

router = APIRouter(tags=["auth"])

AUTH_COOKIE_PATH = "/api/v1/auth"


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_session_cookies(response: Response, refresh_token: str) -> None:
    s = get_settings()
    max_age = s.refresh_token_ttl_days * 86400
    response.set_cookie(
        s.refresh_cookie_name, refresh_token, max_age=max_age, httponly=True,
        secure=s.cookie_secure, samesite="strict", path=AUTH_COOKIE_PATH,
    )
    response.set_cookie(
        s.csrf_cookie_name, security.new_csrf_token(), max_age=max_age, httponly=False,
        secure=s.cookie_secure, samesite="strict", path="/",
    )


def _clear_session_cookies(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.refresh_cookie_name, path=AUTH_COOKIE_PATH)
    response.delete_cookie(s.csrf_cookie_name, path="/")


def _check_csrf(request: Request) -> None:
    s = get_settings()
    if not security.constant_time_equals(
        request.cookies.get(s.csrf_cookie_name), request.headers.get("x-csrf-token")
    ):
        raise AppError(403, "csrf-failed", "Security check failed. Please reload and try again.")


def _token_response(session: service.IssuedSession) -> TokenResponse:
    return TokenResponse(
        access_token=session.access_token,
        expires_in=session.expires_in,
        user=service.to_user_out(session.user),
    )


@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    limiter.check(f"register:{_client_ip(request)}", get_settings().rate_limit_register_per_minute)
    user = service.register(db, body.email, body.password, body.display_name)
    session, _ = service.issue_session(
        db, user, user_agent=request.headers.get("user-agent"), ip=_client_ip(request)
    )
    db.commit()
    _set_session_cookies(response, session.refresh_token)
    return _token_response(session)


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    limit = get_settings().rate_limit_login_per_minute
    limiter.check(f"login-ip:{_client_ip(request)}", limit)
    limiter.check(f"login-email:{body.email.lower()}", limit)
    session = service.login(
        db, body.email, body.password,
        user_agent=request.headers.get("user-agent"), ip=_client_ip(request),
    )
    _set_session_cookies(response, session.refresh_token)
    return _token_response(session)


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    _check_csrf(request)
    try:
        session = service.rotate(
            db,
            request.cookies.get(get_settings().refresh_cookie_name),
            user_agent=request.headers.get("user-agent"),
            ip=_client_ip(request),
        )
    except AppError as exc:
        # Return (not raise) so the dead cookies are cleared on the error response itself.
        failed = problem_response(request, exc)
        _clear_session_cookies(failed)
        return failed
    _set_session_cookies(response, session.refresh_token)
    return _token_response(session)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _check_csrf(request)
    service.logout(db, request.cookies.get(get_settings().refresh_cookie_name))
    _clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(require("profile.read_own"))):
    return service.to_user_out(user)


__all__ = ["router", "current_user"]
