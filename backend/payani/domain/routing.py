"""Journey search: direct and connecting trains, Pareto filtering, ranking and reasons.

Times are minutes after midnight (IST) of the journey date; a train instance that
started on an earlier day has negative offsets folded in, so overnight trains work.

Two independent algorithms are kept on purpose:
- `search()` enumerates journeys with up to `max_transfers` changes (what users see);
- `earliest_arrival_dijkstra()` runs Dijkstra on a NetworkX time-expanded graph and is
  used by the tests as an oracle for the earliest possible arrival.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

import networkx as nx

from payani.domain.catalog_synth import SNAPSHOT, SOURCE, STATION_BY_CODE, Train

DAY = 1440


@dataclass(frozen=True)
class Instance:
    """One run of a train, identified by the day offset of its origin departure."""

    train: Train
    day_offset: int  # origin day = journey date + day_offset

    @property
    def key(self) -> str:
        return f"{self.train.number}@{self.day_offset}"

    def dep(self, i: int) -> int:
        return self.day_offset * DAY + self.train.stops[i].dep  # type: ignore[operator]

    def arr(self, i: int) -> int:
        return self.day_offset * DAY + self.train.stops[i].arr  # type: ignore[operator]


@dataclass(frozen=True)
class Leg:
    inst: Instance
    board: int
    alight: int

    @property
    def dep(self) -> int:
        return self.inst.dep(self.board)

    @property
    def arr(self) -> int:
        return self.inst.arr(self.alight)

    @property
    def from_code(self) -> str:
        return self.inst.train.stops[self.board].station

    @property
    def to_code(self) -> str:
        return self.inst.train.stops[self.alight].station

    @property
    def distance_km(self) -> int:
        stops = self.inst.train.stops
        return stops[self.alight].distance_km - stops[self.board].distance_km


@dataclass
class Journey:
    legs: list[Leg]
    reasons: list[dict] = field(default_factory=list)
    score: float = 0.0

    @property
    def dep(self) -> int:
        return self.legs[0].dep

    @property
    def arr(self) -> int:
        return self.legs[-1].arr

    @property
    def duration(self) -> int:
        return self.arr - self.dep

    @property
    def transfers(self) -> int:
        return len(self.legs) - 1

    @property
    def waits(self) -> list[tuple[str, int]]:
        return [(b.from_code, b.dep - a.arr) for a, b in zip(self.legs, self.legs[1:], strict=False)]

    @property
    def total_wait(self) -> int:
        return sum(w for _, w in self.waits)

    @property
    def signature(self) -> tuple:
        return tuple((leg.inst.key, leg.board, leg.alight) for leg in self.legs)


@dataclass(frozen=True)
class SearchOptions:
    max_transfers: int = 2
    min_transfer_min: int = 30
    max_wait_min: int = 720
    depart_after_min: int = 0
    depart_before_min: int = DAY
    arrive_by_min: int | None = None  # minutes from journey-date midnight, may exceed 1440
    preference: str = "balanced"  # balanced | fastest | fewest_changes | earliest_arrival
    limit: int = 12


def instances_for(trains: list[Train], journey_date: date, back_days: int = 3,
                  ahead_days: int = 3) -> list[Instance]:
    """Train runs that can matter for a trip starting on `journey_date`: earlier starts
    still running that day, and later starts for onward connections."""
    out = []
    for offset in range(-back_days, ahead_days + 1):
        weekday = (journey_date + timedelta(days=offset)).weekday()
        out.extend(Instance(t, offset) for t in trains if t.runs_on(weekday))
    return out


def _boarding_index(instances: list[Instance]) -> dict[str, list[tuple[int, Instance, int]]]:
    idx: dict[str, list[tuple[int, Instance, int]]] = {}
    for inst in instances:
        for i, stop in enumerate(inst.train.stops):
            if stop.dep is not None:
                idx.setdefault(stop.station, []).append((inst.dep(i), inst, i))
    for lst in idx.values():
        lst.sort(key=lambda x: (x[0], x[1].key))
    return idx


def enumerate_journeys(trains: list[Train], origin: str, dest: str, journey_date: date,
                       opts: SearchOptions = SearchOptions()) -> list[Journey]:
    if origin == dest:
        return []
    instances = instances_for(trains, journey_date)
    index = _boarding_index(instances)
    found: dict[tuple, Journey] = {}

    def extend(station: str, earliest: int, latest: int, legs: list[Leg], visited: frozenset[str]):
        for dep, inst, i in index.get(station, []):
            if dep < earliest or dep >= latest:
                continue
            if legs and any(leg.inst.key == inst.key for leg in legs):
                continue  # re-boarding the same train is not a transfer
            for j in range(i + 1, len(inst.train.stops)):
                code = inst.train.stops[j].station
                if code in visited:
                    continue
                leg = Leg(inst, i, j)
                path = [*legs, leg]
                if code == dest:
                    j_ = Journey(path)
                    found.setdefault(j_.signature, j_)
                    break  # riding beyond the destination never helps
                if len(legs) < opts.max_transfers:
                    arr = inst.arr(j)
                    extend(code, arr + opts.min_transfer_min, arr + opts.max_wait_min + 1,
                           path, visited | {code})

    extend(origin, opts.depart_after_min, opts.depart_before_min, [], frozenset({origin}))
    journeys = list(found.values())
    if opts.arrive_by_min is not None:
        journeys = [j for j in journeys if j.arr <= opts.arrive_by_min]
    return journeys


def pareto(journeys: list[Journey]) -> list[Journey]:
    """Keep a journey unless another leaves no earlier, arrives no later and changes
    no more often, and is strictly better on at least one of those."""
    keep = []
    for a in journeys:
        dominated = False
        for b in journeys:
            if b is a:
                continue
            no_worse = b.dep >= a.dep and b.arr <= a.arr and b.transfers <= a.transfers
            better = b.dep > a.dep or b.arr < a.arr or b.transfers < a.transfers
            if no_worse and better:
                dominated = True
                break
        if not dominated:
            keep.append(a)
    return keep


def _score(j: Journey, preference: str) -> float:
    if preference == "fastest":
        return j.duration + 30 * j.transfers
    if preference == "fewest_changes":
        return j.transfers * 100_000 + j.duration
    if preference == "earliest_arrival":
        return j.arr * 10 + j.transfers
    return j.duration + 90 * j.transfers + 0.5 * j.total_wait  # balanced


def fmt_duration(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def explain(journeys: list[Journey]) -> None:
    """Attach reasons derived from real differences between the options shown."""
    if not journeys:
        return
    fastest = min(journeys, key=lambda j: (j.duration, j.transfers))
    earliest = min(j.arr for j in journeys)
    for j in journeys:
        r: list[dict] = []
        if j.duration == fastest.duration:
            r.append({"code": "fastest", "text": f"Fastest option ({fmt_duration(j.duration)})"})
        else:
            extra = j.duration - fastest.duration
            r.append({"code": "slower", "minutes": extra,
                      "text": f"{fmt_duration(extra)} longer than the fastest option"})
        if j.transfers == 0:
            r.append({"code": "direct", "text": "Direct train, no changes"})
        elif j.transfers < fastest.transfers:
            n = fastest.transfers - j.transfers
            r.append({"code": "fewer_changes", "count": n,
                      "text": f"{n} fewer change{'s' if n > 1 else ''} than the fastest option"})
        if j.arr == earliest:
            r.append({"code": "earliest_arrival", "text": "Earliest arrival"})
        for station, wait in j.waits:
            name = STATION_BY_CODE[station].name
            if wait < 45:
                r.append({"code": "tight_connection", "station": station, "minutes": wait,
                          "text": f"Tight connection: {wait} min at {name}"})
            elif wait > 180:
                r.append({"code": "long_wait", "station": station, "minutes": wait,
                          "text": f"Long wait: {fmt_duration(wait)} at {name}"})
            else:
                r.append({"code": "wait", "station": station, "minutes": wait,
                          "text": f"Change at {name} with {fmt_duration(wait)} to spare"})
        j.reasons = r


def search(trains: list[Train], origin: str, dest: str, journey_date: date,
           opts: SearchOptions = SearchOptions()) -> list[Journey]:
    options = pareto(enumerate_journeys(trains, origin, dest, journey_date, opts))
    for j in options:
        j.score = _score(j, opts.preference)
    options.sort(key=lambda j: (j.score, j.dep))
    options = options[: opts.limit]
    explain(options)
    return options


def to_local(journey_date: date, minutes: int) -> datetime:
    return datetime.combine(journey_date, time()) + timedelta(minutes=minutes)


def journey_to_dict(j: Journey, journey_date: date) -> dict:
    """Serialisable view used by the API. Every journey carries its data confidence."""

    def iso(m: int) -> str:
        return to_local(journey_date, m).isoformat(timespec="minutes") + "+05:30"

    return {
        "id": "|".join(f"{k}:{b}:{a}" for k, b, a in j.signature),
        "departure": iso(j.dep),
        "arrival": iso(j.arr),
        "duration_min": j.duration,
        "transfers": j.transfers,
        "total_wait_min": j.total_wait,
        "distance_km": sum(leg.distance_km for leg in j.legs),
        "legs": [
            {
                "train_number": leg.inst.train.number,
                "train_name": leg.inst.train.name,
                "train_kind": leg.inst.train.kind,
                "classes": list(leg.inst.train.classes),
                "from": leg.from_code,
                "from_name": STATION_BY_CODE[leg.from_code].name,
                "to": leg.to_code,
                "to_name": STATION_BY_CODE[leg.to_code].name,
                "departure": iso(leg.dep),
                "arrival": iso(leg.arr),
                "duration_min": leg.arr - leg.dep,
                "distance_km": leg.distance_km,
                "train_origin_date": (journey_date + timedelta(days=leg.inst.day_offset)).isoformat(),
            }
            for leg in j.legs
        ],
        "reasons": j.reasons,
        "data": {"confidence": "simulated", "source": SOURCE, "as_of": SNAPSHOT},
    }


# --------------------------------------------------------------------------- oracle

def earliest_arrival_dijkstra(trains: list[Train], origin: str, dest: str, journey_date: date,
                              min_transfer_min: int = 30, depart_after_min: int = 0,
                              depart_before_min: int = DAY) -> int | None:
    """Earliest arrival at `dest` with unlimited transfers, via Dijkstra (NetworkX) on a
    time-expanded graph. Path length equals arrival time because the source edge to a
    departure event is weighted with that departure's time."""
    g = nx.DiGraph()
    deps_at: dict[str, list[tuple[int, str]]] = {}
    for inst in instances_for(trains, journey_date):
        stops = inst.train.stops
        for i, stop in enumerate(stops):
            if stop.dep is not None:
                d = ("d", inst.key, i)
                deps_at.setdefault(stop.station, []).append((inst.dep(i), d))
                a_next = ("a", inst.key, i + 1)
                g.add_edge(d, a_next, weight=inst.arr(i + 1) - inst.dep(i))
                g.nodes[d]["t"], g.nodes[d]["s"] = inst.dep(i), stop.station
            if stop.arr is not None:
                a = ("a", inst.key, i)
                g.add_node(a, t=inst.arr(i), s=stop.station)
                if stop.dep is not None:  # stay on board
                    g.add_edge(a, ("d", inst.key, i), weight=inst.dep(i) - inst.arr(i))
    # Waiting chains and transfers at each station.
    for station, lst in deps_at.items():
        lst.sort()
        for (t1, n1), (t2, n2) in zip(lst, lst[1:], strict=False):
            g.add_edge(("w", n1), ("w", n2), weight=t2 - t1)
        for t, n in lst:
            g.add_edge(("w", n), n, weight=0)
            g.nodes[("w", n)]["t"] = t
        times = [t for t, _ in lst]
        for node, data in list(g.nodes(data=True)):
            if node[0] == "a" and data.get("s") == station:
                k = _bisect_left(times, data["t"] + min_transfer_min)
                if k < len(lst):
                    g.add_edge(node, ("w", lst[k][1]), weight=lst[k][0] - data["t"])
    src, sink = "SRC", "SINK"
    for t, n in deps_at.get(origin, []):
        if depart_after_min <= t < depart_before_min:
            g.add_edge(src, n, weight=t - depart_after_min + 10**6)  # keep weights positive
    for node, data in list(g.nodes(data=True)):
        if node[0] == "a" and data.get("s") == dest:
            g.add_edge(node, sink, weight=0)
    if src not in g or sink not in g:
        return None
    try:
        length = nx.dijkstra_path_length(g, src, sink)
    except nx.NetworkXNoPath:
        return None
    return int(length - 10**6 + depart_after_min)


def _bisect_left(a: list[int], x: int) -> int:
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo


__all__ = [
    "Journey", "SearchOptions", "search", "journey_to_dict", "earliest_arrival_dijkstra",
    "enumerate_journeys", "pareto", "explain", "fmt_duration",
]
