"""Booking, payment and handoff providers.

SandboxBookingProvider and SandboxPaymentProvider never contact a railway or a bank.
Their references start with SBX- / SBXPAY- and every response says mode="sandbox".
Outcomes are deterministic so demos and tests are repeatable:
  - normal passengers: confirmed, with a synthetic coach/berth;
  - `simulate="waitlist"`: confirmed booking with waitlisted passengers;
  - `simulate="fail"`: the provider rejects the booking (payment is then refunded).
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode


@dataclass
class ProviderResult:
    ok: bool
    reference: str | None
    mode: str
    detail: str
    passengers: list[dict] | None = None


class BookingProvider(Protocol):
    name: str
    mode: str

    def confirm(self, booking_id: str, passengers: list[dict], travel_class: str, simulate: str | None) -> ProviderResult: ...

    def cancel(self, reference: str) -> ProviderResult: ...


class PaymentProvider(Protocol):
    name: str
    mode: str

    def charge(self, booking_id: str, amount_paise: int, simulate: str | None) -> ProviderResult: ...

    def refund(self, payment_reference: str, amount_paise: int) -> ProviderResult: ...


class SandboxBookingProvider:
    name = "payani-sandbox"
    mode = "sandbox"

    def confirm(self, booking_id, passengers, travel_class, simulate=None):
        if simulate == "fail":
            return ProviderResult(False, None, self.mode, "Sandbox provider rejected the booking (simulated).")
        digest = hashlib.sha256(booking_id.encode()).hexdigest()
        pnr = "SBX-" + str(int(digest[:12], 16))[-7:]
        coach_prefix = {"SL": "S", "3A": "B", "2A": "A", "1A": "H"}.get(travel_class, "D")
        out = []
        for i, p in enumerate(passengers):
            if simulate == "waitlist" and i % 2 == 1:
                out.append({**p, "status": "waitlisted", "coach": None, "berth": f"WL {i}"})
            else:
                out.append({**p, "status": "confirmed", "coach": f"{coach_prefix}{1 + int(digest[i % 8], 16) % 6}",
                            "berth": str(1 + (int(digest[8 + i % 8], 16) * 7 + i) % 72)})
        return ProviderResult(True, pnr, self.mode, "Confirmed by the sandbox provider. Not a real ticket.", out)

    def cancel(self, reference):
        return ProviderResult(True, reference, self.mode, "Cancelled in the sandbox. No real ticket existed.")


class SandboxPaymentProvider:
    name = "payani-sandbox-pay"
    mode = "sandbox"

    def charge(self, booking_id, amount_paise, simulate=None):
        ref = "SBXPAY-" + secrets.token_hex(6).upper()
        if simulate == "payment_fail":
            return ProviderResult(False, ref, self.mode, "Sandbox payment declined (simulated). No money moved.")
        return ProviderResult(True, ref, self.mode, "Sandbox payment approved. No money moved.")

    def refund(self, payment_reference, amount_paise):
        return ProviderResult(True, "SBXREF-" + secrets.token_hex(6).upper(), self.mode,
                              "Sandbox refund issued. No money moved.")


IRCTC_URL = "https://www.irctc.co.in/nget/train-search"


def _handoff_warning(data: dict) -> str:
    if data.get("confidence") == "scheduled":
        return (f"Train numbers and times come from a historical timetable ({data.get('source_name', data.get('source'))}, "
                f"published {data.get('as_of')}). They may have changed: check the current schedule on IRCTC.")
    return ("Train numbers in this preview are synthetic and will not exist on IRCTC. "
            "Use the stations and dates to find real trains there.")


def official_handoff(booking: dict) -> dict:
    """Everything a passenger needs to book the same trip on the official IRCTC site.
    PAYANI never logs in to IRCTC or submits anything there."""
    legs = booking["journey"]["legs"]
    return {
        "url": IRCTC_URL,
        "note": "Book on the official IRCTC website or app. PAYANI does not sign in or book for you.",
        "steps": [
            f"Search {leg['from_name']} ({leg['from']}) to {leg['to_name']} ({leg['to']}) "
            f"on {leg['departure'][:10]}, class {booking['travel_class']}."
            for leg in legs
        ],
        "passengers": [p["name"] for p in booking["passengers"]],
        "warning": _handoff_warning(booking["journey"].get("data") or {}),
        "share_text": urlencode({"from": legs[0]["from"], "to": legs[-1]["to"], "date": legs[0]["departure"][:10]}),
    }


booking_provider: BookingProvider = SandboxBookingProvider()
payment_provider: PaymentProvider = SandboxPaymentProvider()
