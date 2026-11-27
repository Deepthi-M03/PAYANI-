"""RFC 9457 problem-details error responses.

Every error leaves the API as `application/problem+json` with a stable `type`, a human
`title`, and the request id so a user-reported problem can be traced in the logs.
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("payani.errors")

PROBLEM_JSON = "application/problem+json"


class AppError(Exception):
    """Domain error with a stable machine-readable code."""

    def __init__(self, status: int, code: str, title: str, detail: str | None = None):
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail


def _problem(request: Request, status: int, code: str, title: str, detail=None, extra=None):
    body = {
        "type": f"urn:payani:problem:{code}",
        "code": code,
        "title": title,
        "status": status,
        "instance": request.url.path,
        "request_id": getattr(request.state, "request_id", None),
    }
    if detail:
        body["detail"] = detail
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON)


def problem_response(request: Request, exc: AppError) -> JSONResponse:
    """Build the response for an AppError directly, when a route must add headers or
    cookies to the error (an exception handler would start from a fresh response)."""
    return _problem(request, exc.status, exc.code, exc.title, exc.detail)


def _message(msg: str) -> str:
    # Pydantic prefixes custom validator messages with "Value error, "; users don't need it.
    return msg.removeprefix("Value error, ")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        return _problem(request, exc.status, exc.code, exc.title, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [
            {"field": ".".join(str(p) for p in e["loc"][1:]), "message": _message(e["msg"])}
            for e in exc.errors()
        ]
        return _problem(
            request, 422, "validation-error", "Some fields need attention.", extra={"errors": errors}
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: HTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not-found", 405: "method-not-allowed"}
        return _problem(
            request, exc.status_code, code.get(exc.status_code, "http-error"), str(exc.detail)
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error", extra={"path": request.url.path})
        return _problem(request, 500, "internal-error", "Something went wrong on our side.")
