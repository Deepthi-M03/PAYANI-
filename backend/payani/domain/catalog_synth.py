"""Synthetic railway catalogue (ADR 002: synthetic data is the default).

Stations: real Indian Railways station codes and names, which are public facts, with
coordinates rounded to two decimals (approximate, hand-compiled). Trains: entirely
synthetic. Numbers are in the 90000-90999 range and names start with "PAYANI Sim", so
they can never be mistaken for a real service. Every record carries
`source = "payani-synthetic-v1"` and is shown with the Simulated badge.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

SOURCE = "payani-synthetic-v1"
SNAPSHOT = "2026-11-26"


@dataclass(frozen=True)
class Station:
    code: str
    name: str
    state: str
    lat: float
    lon: float


@dataclass(frozen=True)
class Stop:
    station: str
    arr: int | None  # minutes after the train's origin-day midnight; None at origin
    dep: int | None  # None at destination
    distance_km: int


@dataclass
class Train:
    number: str
    name: str
    kind: str
    running_days: int  # bitmask, Monday = bit 0 ... Sunday = bit 6, of the origin day
    classes: tuple[str, ...]
    stops: list[Stop] = field(default_factory=list)

    def runs_on(self, weekday: int) -> bool:
        return bool(self.running_days >> weekday & 1)


STATIONS: list[Station] = [
    Station("MAS", "Chennai Central", "Tamil Nadu", 13.08, 80.28),
    Station("SBC", "KSR Bengaluru City", "Karnataka", 12.98, 77.57),
    Station("MYS", "Mysuru Junction", "Karnataka", 12.32, 76.65),
    Station("CBE", "Coimbatore Junction", "Tamil Nadu", 11.00, 76.97),
    Station("ERS", "Ernakulam Junction", "Kerala", 9.97, 76.29),
    Station("TVC", "Thiruvananthapuram Central", "Kerala", 8.49, 76.95),
    Station("MDU", "Madurai Junction", "Tamil Nadu", 9.92, 78.11),
    Station("TPJ", "Tiruchchirappalli Junction", "Tamil Nadu", 10.80, 78.68),
    Station("MAQ", "Mangaluru Central", "Karnataka", 12.86, 74.84),
    Station("MAO", "Madgaon Junction", "Goa", 15.27, 73.97),
    Station("PUNE", "Pune Junction", "Maharashtra", 18.53, 73.87),
    Station("CSMT", "Mumbai CSMT", "Maharashtra", 18.94, 72.84),
    Station("ST", "Surat", "Gujarat", 21.21, 72.84),
    Station("BRC", "Vadodara Junction", "Gujarat", 22.31, 73.18),
    Station("ADI", "Ahmedabad Junction", "Gujarat", 23.03, 72.60),
    Station("KOTA", "Kota Junction", "Rajasthan", 25.21, 75.86),
    Station("JP", "Jaipur Junction", "Rajasthan", 26.92, 75.79),
    Station("NDLS", "New Delhi", "Delhi", 28.64, 77.22),
    Station("AGC", "Agra Cantt", "Uttar Pradesh", 27.16, 77.99),
    Station("JHS", "Jhansi Junction", "Uttar Pradesh", 25.45, 78.57),
    Station("BPL", "Bhopal Junction", "Madhya Pradesh", 23.27, 77.41),
    Station("ET", "Itarsi Junction", "Madhya Pradesh", 22.61, 77.76),
    Station("NGP", "Nagpur Junction", "Maharashtra", 21.15, 79.09),
    Station("SC", "Secunderabad Junction", "Telangana", 17.43, 78.50),
    Station("BZA", "Vijayawada Junction", "Andhra Pradesh", 16.52, 80.62),
    Station("VSKP", "Visakhapatnam Junction", "Andhra Pradesh", 17.72, 83.29),
    Station("BBS", "Bhubaneswar", "Odisha", 20.27, 85.84),
    Station("HWH", "Howrah Junction", "West Bengal", 22.58, 88.34),
    Station("RNC", "Ranchi Junction", "Jharkhand", 23.35, 85.32),
    Station("PNBE", "Patna Junction", "Bihar", 25.60, 85.14),
    Station("BSB", "Varanasi Junction", "Uttar Pradesh", 25.33, 82.99),
    Station("PRYJ", "Prayagraj Junction", "Uttar Pradesh", 25.44, 81.83),
    Station("CNB", "Kanpur Central", "Uttar Pradesh", 26.45, 80.35),
    Station("LKO", "Lucknow Charbagh", "Uttar Pradesh", 26.83, 80.92),
    Station("GHY", "Guwahati", "Assam", 26.18, 91.75),
]
STATION_BY_CODE = {s.code: s for s in STATIONS}

# Synthetic corridors (ordered station codes) loosely following real geography.
CORRIDORS: list[tuple[str, list[str]]] = [
    ("Southern Arc", ["MAS", "SBC", "MYS"]),
    ("Kerala Coast", ["MAS", "TPJ", "MDU", "TVC"]),
    ("Western Ghats", ["SBC", "CBE", "ERS", "TVC"]),
    ("Konkan", ["MAQ", "MAO", "PUNE", "CSMT"]),
    ("Deccan", ["SBC", "SC", "NGP", "ET", "BPL", "JHS", "AGC", "NDLS"]),
    ("Coromandel", ["MAS", "BZA", "VSKP", "BBS", "HWH"]),
    ("Grand Trunk", ["MAS", "BZA", "SC"]),
    ("Desert Line", ["ADI", "KOTA", "JP", "NDLS"]),
    ("Gujarat Mail", ["CSMT", "ST", "BRC", "ADI"]),
    ("Capital Link", ["CSMT", "BRC", "KOTA", "NDLS"]),
    ("Gangetic", ["NDLS", "CNB", "PRYJ", "BSB", "PNBE", "HWH"]),
    ("Awadh", ["NDLS", "LKO", "BSB"]),
    ("Central India", ["CSMT", "ET", "PRYJ", "BSB"]),
    ("Eastern Hills", ["HWH", "RNC", "PNBE"]),
    ("North East", ["HWH", "GHY"]),
    ("Plateau", ["PUNE", "SC", "BZA"]),
]

DAILY = 0b1111111


def haversine_km(a: Station, b: Station) -> float:
    r = 6371.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _build_train(number: int, name: str, kind: str, codes: list[str], start_min: int,
                 speed_kmh: float, days: int) -> Train:
    stops: list[Stop] = []
    t, dist = start_min, 0.0
    for i, code in enumerate(codes):
        if i == 0:
            stops.append(Stop(code, None, t, 0))
            continue
        leg = haversine_km(STATION_BY_CODE[codes[i - 1]], STATION_BY_CODE[code]) * 1.25  # track detour
        dist += leg
        t += round(leg / speed_kmh * 60)
        last = i == len(codes) - 1
        halt = 0 if last else (10 if kind == "Superfast" else 5)
        stops.append(Stop(code, t, None if last else t + halt, round(dist)))
        t += halt
    classes = ("3A", "2A", "1A") if kind == "Rajdhani-class" else ("SL", "3A", "2A")
    return Train(str(number), name, kind, days, classes, stops)


def generate_trains(seed: int = 2026) -> list[Train]:
    """Deterministic: the same seed always yields the same timetable."""
    rng = random.Random(seed)  # noqa: S311 - synthetic timetable, not security
    trains: list[Train] = []
    number = 90001
    for corridor, codes in CORRIDORS:
        for direction, seq in (("Up", codes), ("Down", list(reversed(codes)))):
            for slot in range(rng.choice([2, 3, 3, 4])):
                kind = rng.choice(["Express", "Superfast", "Superfast", "Rajdhani-class"])
                speed = {"Express": 52, "Superfast": 62, "Rajdhani-class": 72}[kind]
                start = rng.choice([5, 6, 7, 9, 13, 16, 18, 20, 21, 22]) * 60 + rng.choice([0, 15, 30, 45])
                days = DAILY if rng.random() < 0.7 else rng.choice([0b0101010, 0b1010101, 0b0010011])
                label = f"PAYANI Sim {corridor} {kind} ({direction}{'' if slot == 0 else ' ' + str(slot + 1)})"
                trains.append(_build_train(number, label, kind, seq, start, speed, days))
                number += 1
    return trains


def station_search(query: str, limit: int = 8) -> list[Station]:
    """Autocomplete: exact code first, then name prefix, then substring."""
    q = query.strip().lower()
    if not q:
        return []
    scored = []
    for s in STATIONS:
        name = s.name.lower()
        if s.code.lower() == q:
            rank = 0
        elif name.startswith(q) or s.code.lower().startswith(q):
            rank = 1
        elif q in name:
            rank = 2
        else:
            continue
        scored.append((rank, s.name, s))
    return [s for _, _, s in sorted(scored)[:limit]]
