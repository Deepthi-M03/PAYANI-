"""Timetable import: parse and validate third-party railway timetable datasets.

Pure Python (no database), so every rule here is unit-tested in isolation. The service in
`payani.modules.timetable.service` writes an accepted dataset to the database in one
transaction; nothing here touches existing records.

Supported sources (see docs/timetable-data.md for how each one was checked):

* ``datameet-railways``: DataMeet "Indian Railways Data" (stations.json, trains.json,
  schedules.json), CC0. Volunteer-collected; the data commit is dated 8 August 2016.
* ``data-gov-in-timetable``: the Open Government Data Platform India CSV "Indian Railways
  Time Table for trains available for reservation". The operator must confirm the licence
  and publication date from the download page, because PAYANI could not read them
  automatically.

Honesty rules enforced here:
* nothing is invented: a field missing from the source stays missing (``None``);
* the only derived values are documented and reported (day roll-over for CSV rows without
  a day column, and copying a halt's single published time to the missing one);
* neither source publishes days of operation, so every imported train is marked
  ``running_days_known = False`` and the UI says so.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

# --------------------------------------------------------------------------- sources


@dataclass(frozen=True)
class SourceProfile:
    key: str
    name: str
    url: str
    format: str  # "datameet-json" | "ogd-csv"
    official: bool
    licence: str | None  # None: the operator must supply it at import time
    licence_url: str | None
    published_on: date | None  # None: the operator must supply it at import time
    published_note: str
    files: tuple[str, ...]


SOURCES: dict[str, SourceProfile] = {
    "datameet-railways": SourceProfile(
        key="datameet-railways",
        name="DataMeet: Indian Railways Data",
        url="https://github.com/datameet/railways",
        format="datameet-json",
        official=False,
        licence="CC0 1.0 Universal (public domain dedication)",
        licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
        published_on=date(2016, 8, 8),
        published_note=("Date of the repository commit that added the data files (21aa4a0, "
                        "8 August 2016). Collected by volunteers; not an official Indian Railways "
                        "publication. The repository has not been updated since."),
        files=("stations.json", "trains.json", "schedules.json"),
    ),
    "data-gov-in-timetable": SourceProfile(
        key="data-gov-in-timetable",
        name="Indian Railways Time Table (Open Government Data Platform India)",
        url="https://www.data.gov.in/catalog/indian-railways-train-time-table",
        format="ogd-csv",
        official=True,
        licence=None,
        licence_url=None,
        published_on=None,
        published_note=("Enter the publication or 'as on' date shown on the data.gov.in resource "
                        "page you downloaded from."),
        files=("*.csv",),
    ),
}

# Validation limits.
MAX_REJECTED_TRAIN_SHARE = 0.25  # reject the whole dataset above this
MAX_SAMPLES_PER_CODE = 20
MAX_JOURNEY_DAYS = 6
CODE_RE = re.compile(r"^[A-Z]{1,8}$")
TRAIN_RE = re.compile(r"^\d{4,5}$")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
MISSING_TIME = {"", "none", "null", "--", "-", "source", "destination", "na", "n/a"}
INDIA_LON, INDIA_LAT = (60.0, 100.0), (5.0, 38.0)
CLASS_FLAGS = (("first_ac", "1A"), ("second_ac", "2A"), ("third_ac", "3A"), ("sleeper", "SL"),
               ("chair_car", "CC"), ("first_class", "FC"))


class DatasetError(Exception):
    """The input cannot be read at all (missing file, wrong format, unreadable archive)."""


# --------------------------------------------------------------------------- records


@dataclass
class StationRec:
    code: str
    name: str
    state: str | None = None
    zone: str | None = None
    lat: float | None = None
    lon: float | None = None


@dataclass
class StopRec:
    station: str
    arr: int | None  # minutes after midnight of the train's origin day
    dep: int | None
    distance_km: int | None


@dataclass
class TrainRec:
    number: str
    name: str
    kind: str
    classes: tuple[str, ...]
    stops: list[StopRec]
    running_days: int = 127
    running_days_known: bool = False
    distance_basis: str = "unknown"  # "source" | "endpoints" | "unknown"


@dataclass
class Issue:
    severity: str  # "error" rejects the train (or file), "warning" is informational
    code: str
    message: str
    train: str | None = None


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)
    rows_read: int = 0
    trains_seen: int = 0

    def error(self, code: str, message: str, train: str | None = None) -> None:
        self.issues.append(Issue("error", code, message, train))

    def warn(self, code: str, message: str, train: str | None = None) -> None:
        self.issues.append(Issue("warning", code, message, train))

    def to_dict(self) -> dict:
        by: dict[tuple[str, str], list[Issue]] = defaultdict(list)
        for i in self.issues:
            by[(i.severity, i.code)].append(i)
        return {
            "rows_read": self.rows_read,
            "trains_seen": self.trains_seen,
            "errors": sum(1 for i in self.issues if i.severity == "error"),
            "warnings": sum(1 for i in self.issues if i.severity == "warning"),
            "by_code": [
                {"severity": sev, "code": code, "count": len(items),
                 "samples": [{"train": i.train, "message": i.message} for i in items[:MAX_SAMPLES_PER_CODE]]}
                for (sev, code), items in sorted(by.items(), key=lambda kv: (kv[0][0], -len(kv[1])))
            ],
        }


@dataclass
class ParsedDataset:
    source_key: str
    stations: dict[str, StationRec]
    trains: list[TrainRec]
    report: Report
    rejected_trains: int = 0

    @property
    def stop_count(self) -> int:
        return sum(len(t.stops) for t in self.trains)

    def counts(self) -> dict:
        used = {s.station for t in self.trains for s in t.stops}
        return {
            "trains": len(self.trains),
            "stops": self.stop_count,
            "stations": len(used),
            "stations_with_position": sum(1 for c in used if self.stations[c].lat is not None),
            "trains_rejected": self.rejected_trains,
            "trains_seen": self.report.trains_seen,
            "rows_read": self.report.rows_read,
        }


# --------------------------------------------------------------------------- helpers


def parse_time(value) -> tuple[int | None, bool]:
    """Return (minutes after midnight, ok). Missing markers give (None, True)."""
    if value is None:
        return None, True
    text = str(value).strip()
    if text.lower() in MISSING_TIME:
        return None, True
    m = TIME_RE.match(text)
    if not m:
        return None, False
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if h > 23 or mi > 59 or s > 59:
        return None, False
    return h * 60 + mi, True


def norm_code(value) -> str:
    return str(value or "").strip().upper()


def norm_train_number(value, report: Report) -> str | None:
    text = str(value or "").strip().lstrip("'")
    if text.endswith(".0"):
        text = text[:-2]
    if not TRAIN_RE.match(text):
        return None
    if len(text) == 4:  # spreadsheets drop the leading zero of numbers such as 01013
        report.warn("train_number_padded", f"Train number {text} restored to 0{text}.", f"0{text}")
        text = f"0{text}"
    return text


def clean_name(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _int_or_none(value) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(round(number)) if number >= 0 else None


def bundle_digest(files: dict[str, bytes]) -> str:
    """Stable fingerprint of an upload, independent of archive packaging."""
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(name.rsplit("/", 1)[-1].lower().encode())
        h.update(hashlib.sha256(files[name]).digest())
    return h.hexdigest()


def read_zip(data: bytes, max_total_bytes: int = 700 * 1024 * 1024) -> dict[str, bytes]:
    """Files from a ZIP upload, keyed by base name. Guards against archive bombs."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise DatasetError("The upload is not a readable ZIP archive.") from exc
    infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX")]
    if sum(i.file_size for i in infos) > max_total_bytes:
        raise DatasetError("The archive expands to more than the allowed size.")
    out: dict[str, bytes] = {}
    for info in infos:
        base = info.filename.rsplit("/", 1)[-1]
        if base.lower().endswith((".json", ".csv")):
            out[base] = zf.read(info)
    if not out:
        raise DatasetError("The archive contains no .json or .csv files.")
    return out


def _load_json(files: dict[str, bytes], name: str):
    match = next((k for k in files if k.rsplit("/", 1)[-1].lower() == name), None)
    if match is None:
        raise DatasetError(f"Missing {name}. The DataMeet import needs stations.json, trains.json and schedules.json.")
    try:
        return json.loads(files[match].decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DatasetError(f"{name} is not valid JSON ({exc.__class__.__name__}).") from exc


def _features(doc, name: str) -> list[dict]:
    if isinstance(doc, dict) and isinstance(doc.get("features"), list):
        return doc["features"]
    raise DatasetError(f"{name} is not a GeoJSON FeatureCollection.")


# --------------------------------------------------------------------------- shared train checks


def finish_train(t: TrainRec, report: Report, stations: dict[str, StationRec]) -> bool:
    """Validate one assembled train in place. Returns False if the train must be rejected."""
    n = t.number
    if not t.name:
        report.error("missing_field", "Train name is missing.", n)
        return False
    if len(t.stops) < 2:
        report.error("too_few_stops", "A train needs at least two stops.", n)
        return False
    for s in t.stops:
        if not CODE_RE.match(s.station):
            report.error("invalid_station_code", f"Station code {s.station!r} is not valid.", n)
            return False
        if s.station not in stations:
            report.error("invalid_station_code", f"Station {s.station} has no name in the source.", n)
            return False
    for a, b in zip(t.stops, t.stops[1:], strict=False):
        if a.station == b.station:
            report.error("inconsistent_sequence", f"{a.station} appears twice in a row.", n)
            return False
    first, last = t.stops[0], t.stops[-1]
    first.arr = None
    last.dep = None
    if first.dep is None:
        report.error("missing_field", f"No departure time at the origin {first.station}.", n)
        return False
    if last.arr is None:
        report.error("missing_field", f"No arrival time at the destination {last.station}.", n)
        return False
    for s in t.stops[1:-1]:
        if s.arr is None and s.dep is None:
            report.error("missing_field", f"No arrival or departure time at {s.station}.", n)
            return False
        if s.arr is None or s.dep is None:
            report.warn("time_filled", f"Only one time is published at {s.station}; used it for both.", n)
            s.arr = s.dep if s.arr is None else s.arr
            s.dep = s.arr if s.dep is None else s.dep
    previous = first.dep
    for s in t.stops[1:]:
        if s.arr < previous or (s.dep is not None and s.dep < s.arr):  # type: ignore[operator]
            report.error("inconsistent_sequence", f"Times go backwards at {s.station}.", n)
            return False
        previous = s.dep if s.dep is not None else s.arr
    if last.arr - first.dep > MAX_JOURNEY_DAYS * 1440:  # type: ignore[operator]
        report.error("inconsistent_sequence", f"Journey longer than {MAX_JOURNEY_DAYS} days.", n)
        return False
    dists = [s.distance_km for s in t.stops if s.distance_km is not None]
    if any(b < a for a, b in zip(dists, dists[1:], strict=False)):
        report.error("inconsistent_sequence", "Distances decrease along the route.", n)
        return False
    return True


def _decide(parsed: ParsedDataset) -> None:
    seen = parsed.report.trains_seen
    if not parsed.trains:
        parsed.report.error("no_valid_trains", "No train passed validation.")
    elif seen and parsed.rejected_trains / seen > MAX_REJECTED_TRAIN_SHARE:
        parsed.report.error(
            "too_many_rejected",
            f"{parsed.rejected_trains} of {seen} trains failed validation (limit {int(MAX_REJECTED_TRAIN_SHARE * 100)}%).",
        )


def accepted(parsed: ParsedDataset) -> tuple[bool, str | None]:
    """Whole-dataset decision. Train-level errors only drop that train; these reject everything."""
    fatal = [i for i in parsed.report.issues if i.code in ("no_valid_trains", "too_many_rejected")]
    return (False, fatal[0].message) if fatal else (True, None)


# --------------------------------------------------------------------------- DataMeet


def parse_datameet(files: dict[str, bytes]) -> ParsedDataset:
    report = Report()
    stations: dict[str, StationRec] = {}
    for f in _features(_load_json(files, "stations.json"), "stations.json"):
        props = f.get("properties") or {}
        code = norm_code(props.get("code"))
        if not CODE_RE.match(code):
            report.warn("invalid_station_code", f"Skipped station with code {code!r}.")
            continue
        if code in stations:
            report.warn("duplicate_station", f"Station {code} is listed more than once; kept the first.")
            continue
        rec = StationRec(code, clean_name(props.get("name")) or code, clean_name(props.get("state")) or None,
                         clean_name(props.get("zone")) or None)
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") if geom.get("type") == "Point" else None
        if isinstance(coords, list) and len(coords) >= 2:
            try:
                lon, lat = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                lon = lat = None  # type: ignore[assignment]
            if lon is not None and INDIA_LON[0] <= lon <= INDIA_LON[1] and INDIA_LAT[0] <= lat <= INDIA_LAT[1]:
                rec.lon, rec.lat = lon, lat
            else:
                report.warn("position_out_of_range", f"Ignored the position of {code}: outside India.")
        stations[code] = rec

    meta: dict[str, dict] = {}
    for f in _features(_load_json(files, "trains.json"), "trains.json"):
        props = f.get("properties") or {}
        num = norm_train_number(props.get("number"), report)
        if num is None:
            report.warn("invalid_train_number", f"Skipped train with number {props.get('number')!r}.")
            continue
        if num in meta:
            report.warn("duplicate_train", "Listed more than once in trains.json; kept the first.", num)
            continue
        meta[num] = props

    rows = _load_json(files, "schedules.json")
    if not isinstance(rows, list):
        raise DatasetError("schedules.json is not a list of stops.")
    report.rows_read = len(rows)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if not isinstance(r, dict):
            report.warn("malformed_row", "Skipped a schedule row that is not an object.")
            continue
        num = norm_train_number(r.get("train_number"), report)
        if num is None:
            report.warn("invalid_train_number", f"Skipped a stop with train number {r.get('train_number')!r}.")
            continue
        grouped[num].append(r)

    trains: list[TrainRec] = []
    rejected = 0
    report.trains_seen = len(grouped)
    for num, items in grouped.items():
        items.sort(key=lambda r: (_int_or_none(r.get("id")) or 0))
        t = _datameet_train(num, items, meta.get(num), stations, report)
        if t is None or not finish_train(t, report, stations):
            rejected += 1
            continue
        trains.append(t)
    parsed = ParsedDataset("datameet-railways", stations, trains, report, rejected)
    _decide(parsed)
    return parsed


def _datameet_train(num: str, items: list[dict], props: dict | None, stations: dict[str, StationRec],
                    report: Report) -> TrainRec | None:
    ids = [r.get("id") for r in items if r.get("id") is not None]
    if len(ids) != len(set(map(str, ids))):
        report.error("duplicate_train", "The same schedule row appears more than once.", num)
        return None
    stops: list[StopRec] = []
    last_day = 1
    for r in items:
        code = norm_code(r.get("station_code"))
        day = _int_or_none(r.get("day"))
        if day is None or day < 1:
            report.error("missing_field", f"Stop {code or '?'} has no valid day number.", num)
            return None
        if day < last_day:
            report.error("inconsistent_sequence", f"Day number goes backwards at {code}.", num)
            return None
        last_day = day
        arr, ok_a = parse_time(r.get("arrival"))
        dep, ok_d = parse_time(r.get("departure"))
        if not (ok_a and ok_d):
            report.error("malformed_time", f"Unreadable time at {code}: {r.get('arrival')!r} / {r.get('departure')!r}.", num)
            return None
        base = (day - 1) * 1440
        arr_m = base + arr if arr is not None else None
        dep_m = base + dep if dep is not None else None
        if arr_m is not None and dep_m is not None and dep_m < arr_m:
            dep_m += 1440  # departs after midnight on the following day
        if code and code not in stations and CODE_RE.match(code):
            name = clean_name(r.get("station_name"))
            if name:
                stations[code] = StationRec(code, name)
                report.warn("station_without_position", f"{code} is not in stations.json; added without a position.", num)
        stops.append(StopRec(code, arr_m, dep_m, None))
    name = clean_name((props or {}).get("name")) or clean_name(items[0].get("train_name"))
    kind = clean_name((props or {}).get("type")) or "Unknown"
    classes = tuple(c for flag, c in CLASS_FLAGS if _truthy((props or {}).get(flag)))
    t = TrainRec(num, name, kind[:24], classes, stops)
    total = _int_or_none((props or {}).get("distance"))
    if total is not None and total > 0 and stops:
        stops[0].distance_km, stops[-1].distance_km = 0, total
        t.distance_basis = "endpoints"
    return t


def _truthy(v) -> bool:
    return v in (1, True, "1", "true", "True", "Y", "y")


# --------------------------------------------------------------------------- data.gov.in CSV

CSV_ALIASES = {
    "number": ("trainno", "trainnumber", "trainnum"),
    "name": ("trainname",),
    "seq": ("seq", "islno", "serialno", "sno", "sequence"),
    "code": ("stationcode", "stncode"),
    "station_name": ("stationname", "stnname"),
    "arrival": ("arrivaltime", "arrival", "arrtime"),
    "departure": ("departuretime", "departure", "deptime"),
    "distance": ("distance", "distancekm"),
}
CSV_REQUIRED = ("number", "name", "seq", "code", "arrival", "departure")


def _csv_columns(header: list[str]) -> dict[str, int]:
    normal = [re.sub(r"[^a-z0-9]", "", h.lower()) for h in header]
    cols: dict[str, int] = {}
    for key, aliases in CSV_ALIASES.items():
        for i, h in enumerate(normal):
            if h in aliases:
                cols[key] = i
                break
    return cols


def parse_ogd_csv(files: dict[str, bytes]) -> ParsedDataset:
    csvs = [k for k in files if k.lower().endswith(".csv")]
    if len(csvs) != 1:
        raise DatasetError("Upload exactly one .csv file for the data.gov.in timetable.")
    try:
        text = files[csvs[0]].decode("utf-8-sig")
    except UnicodeDecodeError:
        text = files[csvs[0]].decode("latin-1")
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header:
        raise DatasetError("The CSV file is empty.")
    cols = _csv_columns(header)
    missing = [k for k in CSV_REQUIRED if k not in cols]
    if missing:
        raise DatasetError(f"The CSV is missing required columns: {', '.join(missing)}. Found: {', '.join(header)}.")

    report = Report()
    stations: dict[str, StationRec] = {}
    grouped: dict[str, list[tuple[int, list[str]]]] = defaultdict(list)

    def get(row: list[str], key: str) -> str:
        i = cols.get(key)
        return row[i].strip() if i is not None and i < len(row) else ""

    for row in reader:
        if not any(c.strip() for c in row):
            continue
        report.rows_read += 1
        num = norm_train_number(get(row, "number"), report)
        if num is None:
            report.warn("invalid_train_number", f"Skipped a row with train number {get(row, 'number')!r}.")
            continue
        grouped[num].append((report.rows_read, row))
        code = norm_code(get(row, "code"))
        name = clean_name(get(row, "station_name"))
        if CODE_RE.match(code) and name and code not in stations:
            stations[code] = StationRec(code, name)

    trains: list[TrainRec] = []
    rejected = 0
    report.trains_seen = len(grouped)
    for num, rows in grouped.items():
        t = _ogd_train(num, rows, get, report)
        if t is None or not finish_train(t, report, stations):
            rejected += 1
            continue
        trains.append(t)
    parsed = ParsedDataset("data-gov-in-timetable", stations, trains, report, rejected)
    _decide(parsed)
    return parsed


def _ogd_train(num: str, rows, get, report: Report) -> TrainRec | None:
    by_seq: dict[int, list[str]] = {}
    for _, row in rows:
        seq = _int_or_none(get(row, "seq"))
        if seq is None:
            report.error("missing_field", "A stop has no sequence number.", num)
            return None
        if seq in by_seq:
            if [c.strip() for c in by_seq[seq]] == [c.strip() for c in row]:
                report.warn("duplicate_row", f"Identical row repeated at sequence {seq}; kept one.", num)
                continue
            report.error("duplicate_train", f"Two different stops share sequence {seq}.", num)
            return None
        by_seq[seq] = row
    ordered = [by_seq[k] for k in sorted(by_seq)]
    keys = sorted(by_seq)
    if keys != list(range(keys[0], keys[0] + len(keys))):
        report.warn("sequence_gap", "Sequence numbers have gaps.", num)
    names = {clean_name(get(r, "name")) for r in ordered} - {""}
    if len(names) > 1:
        report.warn("name_mismatch", f"Rows use different names: {', '.join(sorted(names))}.", num)
    stops: list[StopRec] = []
    offset, previous, rolled = 0, None, False
    for i, row in enumerate(ordered):
        code = norm_code(get(row, "code"))
        arr, ok_a = parse_time(get(row, "arrival"))
        dep, ok_d = parse_time(get(row, "departure"))
        if not (ok_a and ok_d):
            report.error("malformed_time", f"Unreadable time at {code}: {get(row, 'arrival')!r} / {get(row, 'departure')!r}.", num)
            return None
        if i == 0:
            arr = None  # the CSV writes 00:00:00 as a placeholder at the origin
        if i == len(ordered) - 1:
            dep = None  # and at the destination
        times = []
        for t in (arr, dep):
            if t is None:
                times.append(None)
                continue
            if previous is not None and t + offset < previous:
                offset += 1440  # the row has no day column: a smaller clock time means the next day
                rolled = True
            times.append(t + offset)
            previous = t + offset
        dist_raw = get(row, "distance")
        dist = _int_or_none(dist_raw)
        if dist_raw and dist is None:
            report.error("malformed_field", f"Unreadable distance {dist_raw!r} at {code}.", num)
            return None
        stops.append(StopRec(code, times[0], times[1], dist))
    if rolled:
        report.warn("day_inferred", "Days after the first were inferred from clock times (the CSV has no day column).", num)
    t = TrainRec(num, clean_name(get(ordered[0], "name")), "Unknown", (), stops)
    known = [s.distance_km for s in stops]
    t.distance_basis = "source" if all(d is not None for d in known) else "unknown"
    if t.distance_basis == "unknown":
        for s in stops:
            s.distance_km = None
    return t


# --------------------------------------------------------------------------- entry point and freshness

PARSERS = {"datameet-json": parse_datameet, "ogd-csv": parse_ogd_csv}


def parse(source_key: str, files: dict[str, bytes]) -> ParsedDataset:
    if source_key not in SOURCES:
        raise DatasetError(f"Unknown source {source_key!r}.")
    return PARSERS[SOURCES[source_key].format](files)


AGING_AFTER_DAYS = 180
OUTDATED_AFTER_DAYS = 365


def freshness_label(published_on: date, today: date) -> dict:
    """How current a scheduled timetable is. Historical data is never called current."""
    age = (today - published_on).days
    if age > OUTDATED_AFTER_DAYS:
        years = age // 365
        return {"freshness": "outdated", "age_days": age, "outdated": True,
                "warning": (f"Historical timetable published {published_on.isoformat()} "
                            f"({years} year{'s' if years != 1 else ''} old). Trains, numbers and times have "
                            "changed since. Check the current schedule with Indian Railways or IRCTC before travelling.")}
    if age > AGING_AFTER_DAYS:
        return {"freshness": "aging", "age_days": age, "outdated": False,
                "warning": f"Timetable published {published_on.isoformat()}; it may not include recent changes."}
    return {"freshness": "recent", "age_days": max(age, 0), "outdated": False, "warning": None}


def issue_counts(report: Report) -> Counter:
    return Counter(i.code for i in report.issues)
