"""Notification channel adapters and translatable templates (ADR 005, 013).

Each sender returns (status, provider, message_id, error). Status is one of:
"sent", "skipped" (channel not configured, no consent, dry run) or raises to retry.
WhatsApp is DRY-RUN ONLY: it renders the approved-template payload and logs it; there
is no code path that calls Meta's API.
"""

from __future__ import annotations

import json
import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger("payani.notify")

# Templates are keyed for translation. Add "ta" / "hi" entries without code changes.
TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "departure_reminder": {"en": {
        "title": "{when}: {train} to {to_name}",
        "body": "{train_name} leaves {from_name} at {dep_time} on {dep_date}. Sandbox booking {pnr} (not a real ticket).",
    }},
    "departure_now": {"en": {
        "title": "Departing now: {train} from {from_name}",
        "body": "Scheduled departure {dep_time}. Times are from the timetable, not live data.",
    }},
    "arrival_alert": {"en": {
        "title": "Arriving soon at {to_name}",
        "body": "Scheduled arrival {arr_time}. Based on the timetable, not live tracking; please watch station announcements.",
    }},
    "contact_request": {"en": {
        "title": "A fellow traveller wants to share contact details",
        "body": "Nothing is shared unless you accept. Review the request in PAYANI Connect.",
    }},
    "cancellation_notice": {"en": {
        "title": "A traveller cancelled on {train}",
        "body": "Seats may or may not be released. Check availability on the official IRCTC site; PAYANI cannot guarantee a berth.",
    }},
}


def render(template: str, language: str, payload: dict) -> dict[str, str]:
    variants = TEMPLATES[template]
    t = variants.get(language) or variants["en"]
    return {k: v.format(**payload) for k, v in t.items()}


def send_email(to: str, subject: str, body: str):
    host = os.environ.get("SMTP_HOST")
    if not host:
        return "skipped", "smtp", None, "SMTP not configured"
    msg = EmailMessage()
    msg["From"] = os.environ.get("SMTP_FROM", "PAYANI <no-reply@example.com>")
    msg["To"], msg["Subject"] = to, subject
    msg.set_content(body + "\n\nYou can change reminder settings in PAYANI > Pulse.")
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "1025")), timeout=10) as s:
        if os.environ.get("SMTP_STARTTLS") == "true":
            s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        s.send_message(msg)
    return "sent", "smtp", None, None


class ExpiredSubscription(Exception):
    pass


def send_webpush(endpoint: str, p256dh: str, auth: str, title: str, body: str, link: str | None):
    private = os.environ.get("VAPID_PRIVATE_KEY")
    if not private:
        return "skipped", "webpush", None, "VAPID keys not configured"
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return "skipped", "webpush", None, "pywebpush not installed"
    try:
        webpush(subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                data=json.dumps({"title": title, "body": body, "url": link or "/app"}),
                vapid_private_key=private,
                vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")}, ttl=3600)
    except WebPushException as exc:
        if exc.response is not None and exc.response.status_code in (404, 410):
            raise ExpiredSubscription(endpoint) from exc
        raise
    return "sent", "webpush", None, None


def send_whatsapp_dry_run(user_id: str, template: str, language: str, payload: dict):
    """Dry run only (ADR 005). Logs the message that WOULD be sent with an approved template."""
    log.info("whatsapp dry-run", extra={"user": user_id, "template": template, "language": language,
                                        "variables": sorted(payload)})
    return "skipped", "whatsapp-dry-run", None, "Dry run: WhatsApp sending is disabled in v1"
