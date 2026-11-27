"""Structured JSON logging with request ids and a redaction filter.

The redaction filter is a safety net, not the primary control: code must never log
secrets in the first place.
"""

import json
import logging
import re
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_SENSITIVE_KEYS = re.compile(
    r"(password|passwd|secret|token|authorization|cookie|card|cvv|otp)", re.IGNORECASE
)
_INLINE_PATTERNS = [
    (re.compile(r"Bearer\s+[A-Za-z0-9\-_.]+"), "Bearer [REDACTED]"),
    (re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)"), "[REDACTED_PHONE]"),
    (re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"), "[REDACTED_NUMBER]"),
]


def redact(value):
    if isinstance(value, dict):
        return {
            k: "[REDACTED]" if _SENSITIVE_KEYS.search(str(k)) else redact(v)
            for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact(v) for v in value]
    if isinstance(value, str):
        for pattern, repl in _INLINE_PATTERNS:
            value = pattern.sub(repl, value)
        return value
    return value


class JsonFormatter(logging.Formatter):
    _RESERVED = set(vars(logging.makeLogRecord({})).keys()) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
            "request_id": request_id_var.get(),
        }
        extras = {k: v for k, v in vars(record).items() if k not in self._RESERVED}
        if extras:
            payload["extra"] = redact(extras)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Accepts a well-formed X-Request-ID or creates one; echoes it on the response."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if re.fullmatch(r"[A-Za-z0-9\-]{8,64}", incoming) else uuid.uuid4().hex
        request.state.request_id = rid
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        return response
