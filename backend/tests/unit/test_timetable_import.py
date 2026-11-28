"""Timetable import: parsing, validation, duplicates, freshness and provenance.

Fixtures are tiny hand-made files in the two supported formats. Their train numbers
(99xxx) and station codes (TSA, TSB...) are test values, not real services.
"""

import io
import json
import zipfile
from datetime import date

import pytest

from payani.domain import timetable_import as ti

STATIONS = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [77.2, 28.6]},
         "properties": {"code": "TSA", "name": "Test Station A", "state": "Delhi", "zone": "NR"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [78.0, 27.2]},
         "properties": {"code": "TSB", "name": "Test Station B", "state": "Uttar Pradesh", "zone": "NCR"}},
        {"type": "Feature", "geometry": None,
         "properties": {"code": "TSC", "name": "Test Station C", "state": "Madhya Pradesh", "zone": "WCR"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-3.0, 51.0]},
         "properties": {"code": "TSD", "name": "Test Station D", "state": None, "zone": None}},
    ],
}


def _train(number, name="TEST EXPRESS", distance=500, **flags):
    props = {"number": number, "name": name, "type": "Exp", "distance": distance, **flags}
    return {"type": "Feature", "geometry": None, "properties": props}


def _row(rid, number, code, day, arr, dep, name="TEST EXPRESS"):
    return {"id": rid, "train_number": number, "train_name": name, "day": day, "station_code": code,
            "station_name": f"Name {code}", "arrival": arr, "departure": dep}


def datameet(schedules, trains=None):
    trains = trains if trains is not None else {"type": "FeatureCollection", "features": [
        _train("99901", third_ac=1, sleeper=1), _train("99902", name="TEST MAIL", distance=0)]}
    return {"stations.json": json.dumps(STATIONS).encode(), "trains.json": json.dumps(trains).encode(),
            "schedules.json": json.dumps(schedules).encode()}


GOOD = [
    _row(1, "99901", "TSA", 1, "None", "22:00:00"),
    _row(2, "99901", "TSB", 2, "01:10:00", "01:15:00"),
    _row(3, "99901", "TSC", 2, "06:30:00", "None"),
    _row(4, "99902", "TSC", 1, "None", "08:00:00"),
    _row(5, "99902", "TSA", 1, "14:00:00", "None"),
]


def test_datameet_parses_times_days_classes_and_positions():
    parsed = ti.parse("datameet-railways", datameet(GOOD))
    assert ti.accepted(parsed) == (True, None)
    t = next(t for t in parsed.trains if t.number == "99901")
    assert [s.station for s in t.stops] == ["TSA", "TSB", "TSC"]
    assert t.stops[0].arr is None and t.stops[0].dep == 22 * 60
    assert t.stops[1].arr == 1440 + 70 and t.stops[1].dep == 1440 + 75  # day 2
    assert t.stops[-1].dep is None and t.stops[-1].arr == 1440 + 390
    assert t.classes == ("3A", "SL")
    assert t.running_days_known is False  # neither source publishes days of operation
    assert (t.stops[0].distance_km, t.stops[1].distance_km, t.stops[-1].distance_km) == (0, None, 500)
    assert t.distance_basis == "endpoints"
    assert parsed.stations["TSA"].lat == 28.6 and parsed.stations["TSC"].lat is None
    assert parsed.stations["TSD"].lat is None  # outside India: position dropped, not guessed
    other = next(t for t in parsed.trains if t.number == "99902")
    assert other.distance_basis == "unknown" and all(s.distance_km is None for s in other.stops)
    counts = parsed.counts()
    assert counts["trains"] == 2 and counts["stops"] == 5 and counts["stations_with_position"] == 2


def test_missing_and_malformed_fields_reject_only_that_train():
    rows = GOOD + [
        _row(6, "99903", "TSA", 1, "None", "25:61"),  # malformed time
        _row(7, "99903", "TSB", 1, "10:00", "None"),
        _row(8, "99904", "TSA", None, "None", "10:00"),  # missing day
        _row(9, "99904", "TSB", 1, "11:00", "None"),
    ]
    parsed = ti.parse("datameet-railways", datameet(rows))
    codes = ti.issue_counts(parsed.report)
    assert codes["malformed_time"] == 1 and codes["missing_field"] == 1
    assert {t.number for t in parsed.trains} == {"99901", "99902"}
    assert parsed.rejected_trains == 2
    # 2 of 4 rejected is above the 25% limit: the whole dataset is refused.
    ok, reason = ti.accepted(parsed)
    assert not ok and "failed validation" in reason


def test_inconsistent_sequences_are_rejected():
    backwards = [_row(1, "99905", "TSA", 1, "None", "10:00"), _row(2, "99905", "TSB", 1, "09:00", "None")]
    repeat = [_row(3, "99906", "TSA", 1, "None", "10:00"), _row(4, "99906", "TSA", 1, "11:00", "None")]
    day_back = [_row(5, "99907", "TSA", 2, "None", "10:00"), _row(6, "99907", "TSB", 1, "11:00", "None")]
    parsed = ti.parse("datameet-railways", datameet(GOOD * 1 + backwards + repeat + day_back))
    assert {"99905", "99906", "99907"}.isdisjoint({t.number for t in parsed.trains})
    assert ti.issue_counts(parsed.report)["inconsistent_sequence"] == 3


def test_duplicate_rows_and_trains_are_detected():
    dup = GOOD + [_row(2, "99901", "TSB", 2, "01:10:00", "01:15:00")]  # same row id twice
    parsed = ti.parse("datameet-railways", datameet(dup))
    assert "99901" not in {t.number for t in parsed.trains}
    assert ti.issue_counts(parsed.report)["duplicate_train"] == 1
    trains = {"type": "FeatureCollection", "features": [_train("99901"), _train("99901", name="OTHER")]}
    parsed = ti.parse("datameet-railways", datameet(GOOD, trains))
    assert ti.issue_counts(parsed.report)["duplicate_train"] == 1  # kept the first listing


def test_invalid_station_codes():
    rows = GOOD + [_row(10, "99908", "ts-1", 1, "None", "10:00"), _row(11, "99908", "TSB", 1, "11:00", "None")]
    parsed = ti.parse("datameet-railways", datameet(rows))
    assert "99908" not in {t.number for t in parsed.trains}
    assert ti.issue_counts(parsed.report)["invalid_station_code"] >= 1


def test_station_missing_from_station_list_is_added_without_a_position():
    rows = [_row(1, "99901", "TSA", 1, "None", "10:00"), _row(2, "99901", "NEWX", 1, "12:00", "None")]
    parsed = ti.parse("datameet-railways", datameet(rows))
    assert parsed.stations["NEWX"].name == "Name NEWX" and parsed.stations["NEWX"].lat is None
    assert ti.issue_counts(parsed.report)["station_without_position"] == 1


def test_missing_file_is_a_dataset_error():
    files = datameet(GOOD)
    del files["trains.json"]
    with pytest.raises(ti.DatasetError, match="trains.json"):
        ti.parse("datameet-railways", files)


def test_zip_upload_and_digest_are_stable():
    files = datameet(GOOD)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(f"railways-master/{name}", data)
    unpacked = ti.read_zip(buf.getvalue())
    assert set(unpacked) == set(files)
    assert ti.bundle_digest(unpacked) == ti.bundle_digest(files)
    assert ti.bundle_digest(files) != ti.bundle_digest(datameet(GOOD[:3]))
    with pytest.raises(ti.DatasetError):
        ti.read_zip(b"not a zip")


CSV_HEADER = ("Train No.,train Name,islno,station Code,Station Name,Arrival time,Departure time,Distance,"
              "Source Station Code,source Station Name,Destination station Code,Destination Station Name\n")


def ogd(body: str) -> dict[str, bytes]:
    return {"timetable.csv": (CSV_HEADER + body).encode()}


def test_ogd_csv_infers_days_and_keeps_source_distances():
    parsed = ti.parse("data-gov-in-timetable", ogd(
        "'9901,TEST EXP,1,TSA,TEST A,00:00:00,22:30:00,0,TSA,TEST A,TSC,TEST C\n"
        "'9901,TEST EXP,2,TSB,TEST B,02:10:00,02:15:00,210,TSA,TEST A,TSC,TEST C\n"
        "'9901,TEST EXP,3,TSC,TEST C,07:00:00,00:00:00,455,TSA,TEST A,TSC,TEST C\n"))
    assert ti.accepted(parsed)[0]
    t = parsed.trains[0]
    assert t.number == "09901"  # leading zero restored, and reported
    assert [(s.arr, s.dep, s.distance_km) for s in t.stops] == [
        (None, 1350, 0), (1440 + 130, 1440 + 135, 210), (1440 + 420, None, 455)]
    assert t.kind == "Unknown" and t.classes == () and t.distance_basis == "source"
    codes = ti.issue_counts(parsed.report)
    assert codes["day_inferred"] == 1 and codes["train_number_padded"] >= 1


def test_ogd_csv_duplicates_and_missing_columns():
    parsed = ti.parse("data-gov-in-timetable", ogd(
        "99910,A,1,TSA,TEST A,00:00:00,10:00:00,0,,,,\n"
        "99910,A,1,TSA,TEST A,00:00:00,10:00:00,0,,,,\n"
        "99910,A,2,TSB,TEST B,11:00:00,00:00:00,50,,,,\n"
        "99911,B,1,TSA,TEST A,00:00:00,10:00:00,0,,,,\n"
        "99911,B,1,TSB,TEST B,11:00:00,00:00:00,50,,,,\n"
        "99912,C,1,TSA,TEST A,00:00:00,10:00:00,0,,,,\n"
        "99912,C,2,TSB,TEST B,11:00:00,00:00:00,50,,,,\n"
        "99913,D,1,TSA,TEST A,00:00:00,10:00:00,0,,,,\n"
        "99913,D,2,TSB,TEST B,11:00:00,00:00:00,50,,,,\n"))
    codes = ti.issue_counts(parsed.report)
    assert codes["duplicate_row"] == 1  # identical rows: kept one
    assert codes["duplicate_train"] == 1  # conflicting rows: train rejected
    assert {t.number for t in parsed.trains} == {"99910", "99912", "99913"}
    with pytest.raises(ti.DatasetError, match="missing required columns"):
        ti.parse("data-gov-in-timetable", {"t.csv": b"Train No.,Station Code\n1,A\n"})


def test_empty_dataset_is_rejected():
    parsed = ti.parse("data-gov-in-timetable", ogd(""))
    ok, reason = ti.accepted(parsed)
    assert not ok and "No train" in reason


@pytest.mark.parametrize(("published", "today", "freshness", "outdated"), [
    (date(2016, 8, 8), date(2026, 11, 27), "outdated", True),
    (date(2026, 3, 1), date(2026, 11, 27), "aging", False),
    (date(2026, 10, 1), date(2026, 11, 27), "recent", False),
])
def test_freshness_labels(published, today, freshness, outdated):
    label = ti.freshness_label(published, today)
    assert label["freshness"] == freshness and label["outdated"] is outdated
    if outdated:
        assert "Historical timetable" in label["warning"] and published.isoformat() in label["warning"]


def test_source_provenance_is_recorded_and_honest():
    dm = ti.SOURCES["datameet-railways"]
    assert dm.licence.startswith("CC0") and dm.published_on == date(2016, 8, 8) and not dm.official
    assert dm.url == "https://github.com/datameet/railways"
    ogd_src = ti.SOURCES["data-gov-in-timetable"]
    # Not verified automatically, so the operator must supply both at import time.
    assert ogd_src.licence is None and ogd_src.published_on is None and ogd_src.official


@pytest.mark.parametrize(("raw", "expected"), [
    ("22:05:00", (1325, True)), ("7:05", (425, True)), ("None", (None, True)), ("", (None, True)),
    ("24:00", (None, False)), ("12-30", (None, False)), (None, (None, True)),
])
def test_parse_time(raw, expected):
    assert ti.parse_time(raw) == expected
