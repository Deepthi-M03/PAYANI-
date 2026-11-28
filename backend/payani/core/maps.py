"""Google Maps handoff links (Maps URLs, documented at
https://developers.google.com/maps/documentation/urls/get-started).

These are plain links that open Google Maps in a new tab. They need no API key, make no
API call from PAYANI and cost nothing. PAYANI's own map stays MapLibre + OpenFreeMap.
"""

from __future__ import annotations

from urllib.parse import urlencode

BASE = "https://www.google.com/maps"


def _place(name: str | None, lat: float | None, lon: float | None) -> str:
    if lat is not None and lon is not None:
        return f"{lat:.5f},{lon:.5f}"
    if name:
        text = name.strip()
        return text if "station" in text.lower() else f"{text} railway station"
    raise ValueError("A place needs a name or coordinates.")


def place_url(name: str | None, lat: float | None = None, lon: float | None = None) -> str:
    """Search link for a station: coordinates when known, otherwise '<name> railway station'."""
    return f"{BASE}/search/?{urlencode({'api': 1, 'query': _place(name, lat, lon)})}"


def directions_url(origin: tuple[str | None, float | None, float | None],
                   destination: tuple[str | None, float | None, float | None],
                   travelmode: str = "transit") -> str:
    """Directions link between two places. Google decides the route; PAYANI only passes the ends."""
    if travelmode not in ("driving", "walking", "bicycling", "transit"):
        raise ValueError("Unsupported travel mode.")
    return f"{BASE}/dir/?" + urlencode({"api": 1, "origin": _place(*origin), "destination": _place(*destination),
                                        "travelmode": travelmode})
