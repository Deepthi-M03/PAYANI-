"""Timetable import end to end against PostgreSQL: permissions, provenance, idempotency,
rollback on failure, search over imported data and the switch back to the simulated catalogue.

The uploaded files are tiny test fixtures (train numbers 99xxx, station codes TSA...);
they are not real services."""

import io
import json
import zipfile
from datetime import date, timedelta

import pytest
from sqlalchemy import delete, func, select

from tests.integration.conftest import bearer, grant_roles, login, register
from tests.unit.test_timetable_import import GOOD, STATIONS, _row, _train

TRAVEL = date.today() + timedelta(days=21)
URL = "/api/v1/admin/timetable/imports"
PARAMS = {"source": "datameet-railways", "file_name": "railways.zip", "licence_confirmed": "true"}


def _zip(schedules=GOOD, trains=None) -> bytes:
    trains = trains or {"type": "FeatureCollection", "features": [_train("99901", third_ac=1, sleeper=1),
                                                                 _train("99902", name="TEST MAIL", distance=0)]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("stations.json", json.dumps(STATIONS))
        zf.writestr("trains.json", json.dumps(trains))
        zf.writestr("schedules.json", json.dumps(schedules))
    return buf.getvalue()


@pytest.fixture(autouse=True)
def reset_timetable(db):
    yield
    from payani.modules.book import catalog
    from payani.modules.book.models import TrainRow
    from payani.modules.timetable.models import TimetableImport

    db.execute(delete(TrainRow).where(TrainRow.dataset_id.is_not(None)))
    db.execute(delete(TimetableImport))
    db.commit()
    catalog.invalidate()


@pytest.fixture
def super_token(client, db):
    user = register(client)
    grant_roles(db, user["user"]["id"], "admin", "super_admin")
    return login(client, user["user"]["email"])


@pytest.fixture
def admin_token(client, db):
    user = register(client)
    grant_roles(db, user["user"]["id"], "admin")
    return login(client, user["user"]["email"])


def _upload(client, token, body=None, **params):
    return client.post(URL, params={**PARAMS, **params}, content=body if body is not None else _zip(),
                       headers={**bearer(token), "Content-Type": "application/octet-stream"})


def test_unauthorised_import_attempts_are_refused(client, admin_token):
    assert client.post(URL, params=PARAMS, content=_zip()).status_code == 401
    passenger = register(client)["access_token"]
    assert _upload(client, passenger).status_code == 403
    assert _upload(client, admin_token).status_code == 403  # admin can inspect, not import
    assert client.get(URL, headers=bearer(passenger)).status_code == 403
    assert client.get(URL, headers=bearer(admin_token)).status_code == 200
    assert client.post("/api/v1/admin/timetable/withdraw", headers=bearer(admin_token)).status_code == 403


def test_import_records_provenance_and_switches_search(client, db, super_token):
    before = client.get("/api/v1/timetable/status").json()
    assert before["label"] == "simulated"

    res = _upload(client, super_token)
    assert res.status_code == 201, res.text
    rec = res.json()
    assert rec["status"] == "active"
    assert rec["licence"].startswith("CC0") and rec["published_on"] == "2016-08-08"
    assert rec["source_url"] == "https://github.com/datameet/railways" and rec["official"] is False
    assert rec["counts"]["trains"] == 2 and rec["outdated"] is True and "Historical timetable" in rec["warning"]
    assert len(rec["file_sha256"]) == 64

    status = client.get("/api/v1/timetable/status").json()
    assert status["label"] == "scheduled" and status["status"] == "outdated" and status["imported_at"]
    assert status["running_days_known"] is False

    found = client.post("/api/v1/journeys/search", json={"from_code": "TSA", "to_code": "TSC",
                                                         "date": TRAVEL.isoformat()}).json()
    assert found["results"], found
    j = found["results"][0]
    assert j["legs"][0]["train_number"] == "99901" and j["legs"][0]["to_name"] == "Test Station C"
    assert j["data"]["confidence"] == "scheduled" and j["data"]["source"] == "datameet-railways"
    assert j["data"]["outdated"] is True
    assert "running_days_unknown" in {w["code"] for w in j["warnings"]}
    assert found["freshness"]["label"] == "scheduled"

    # Synthetic stations are not served by the imported timetable.
    bad = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "SBC", "date": TRAVEL.isoformat()})
    assert bad.status_code == 422

    stations = client.get("/api/v1/stations", params={"q": "test station"}).json()
    assert {s["code"] for s in stations} >= {"TSA", "TSB", "TSC"}
    tsa = next(s for s in stations if s["code"] == "TSA")
    assert tsa["google_maps_url"].startswith("https://www.google.com/maps/search/?api=1&query=28.6")
    tsc = next(s for s in stations if s["code"] == "TSC")
    assert tsc["lat"] is None and "Test+Station+C" in tsc["google_maps_url"]

    m = client.get("/api/v1/stations/map", params={"include": "TSA,TSC"}).json()
    assert {s["code"] for s in m["stations"]} >= {"TSA"} and m["missing_positions"] == ["TSC"]

    from payani.modules.admin.models import AdminAuditLog
    assert db.scalar(select(func.count()).select_from(AdminAuditLog).where(AdminAuditLog.action == "timetable.import")) == 1


def test_reimporting_the_same_file_is_idempotent(client, db, super_token):
    from payani.modules.book.models import TrainRow
    from payani.modules.timetable.models import TimetableImport

    first = _upload(client, super_token).json()
    trains = db.scalar(select(func.count()).select_from(TrainRow).where(TrainRow.dataset_id.is_not(None)))
    again = _upload(client, super_token).json()
    assert first["status"] == "active" and again["status"] == "unchanged"
    assert db.scalar(select(func.count()).select_from(TrainRow).where(TrainRow.dataset_id.is_not(None))) == trains == 2
    statuses = db.scalars(select(TimetableImport.status).order_by(TimetableImport.started_at)).all()
    assert statuses == ["active", "unchanged"]  # history kept, no duplicate data


def test_new_dataset_supersedes_the_previous_one(client, db, super_token):
    _upload(client, super_token)
    smaller = _zip(GOOD[:3])
    res = _upload(client, super_token, body=smaller).json()
    assert res["status"] == "active" and res["counts"]["trains"] == 1
    from payani.modules.timetable.models import TimetableImport
    statuses = sorted(db.scalars(select(TimetableImport.status)).all())
    assert statuses == ["active", "superseded"]


def test_invalid_dataset_is_rejected_and_catalogue_unchanged(client, db, super_token):
    _upload(client, super_token)
    broken = [_row(1, "99950", "TSA", 1, "None", "99:99"), _row(2, "99950", "TSB", 1, "10:00", "None")]
    res = _upload(client, super_token, body=_zip(broken)).json()
    assert res["status"] == "rejected" and res["errors"] >= 1
    assert any(item["code"] == "malformed_time" for item in res["report"]["by_code"])
    status = client.get("/api/v1/timetable/status").json()
    assert status["label"] == "scheduled" and status["trains"] == 2  # previous import still active

    res = _upload(client, super_token, body=b"not a zip or csv", file_name="x.csv").json()
    assert res["status"] == "rejected"


def test_database_failure_rolls_back_and_keeps_previous(client, db, super_token, monkeypatch):
    from payani.modules.timetable import service

    _upload(client, super_token)

    def boom(*_a, **_k):
        raise RuntimeError("simulated failure while inserting stops")

    monkeypatch.setattr(service, "_insert_stops", boom)
    res = _upload(client, super_token, body=_zip(GOOD[:3])).json()
    assert res["status"] == "failed" and "previous timetable is still in use" in res["error"]
    status = client.get("/api/v1/timetable/status").json()
    assert status["trains"] == 2  # the earlier two-train import, untouched
    from payani.modules.timetable.models import TimetableImport
    assert sorted(db.scalars(select(TimetableImport.status)).all()) == ["active", "failed"]


def test_metadata_is_required_for_data_gov_in(client, super_token):
    csv = b"Train No.,train Name,islno,station Code,Station Name,Arrival time,Departure time,Distance\n"
    res = _upload(client, super_token, body=csv, source="data-gov-in-timetable", file_name="t.csv")
    assert res.status_code == 422 and res.json()["code"] == "licence-required"
    res = _upload(client, super_token, body=csv, source="data-gov-in-timetable", file_name="t.csv",
                  licence="Checked licence text")
    assert res.json()["code"] == "published-date-required"
    res = _upload(client, super_token, body=csv, source="datameet-railways", licence_confirmed="false")
    assert res.json()["code"] == "licence-not-confirmed"


def test_withdraw_returns_to_simulated_catalogue(client, super_token):
    _upload(client, super_token)
    res = client.post("/api/v1/admin/timetable/withdraw", headers=bearer(super_token))
    assert res.status_code == 200 and res.json()["label"] == "simulated"
    found = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "SBC",
                                                         "date": TRAVEL.isoformat()}).json()
    assert found["results"] and found["results"][0]["data"]["confidence"] == "simulated"


def test_imported_trains_without_classes_or_distance_cannot_be_sandbox_booked(client, super_token):
    _upload(client, super_token)
    token = register(client)["access_token"]
    jid = client.post("/api/v1/journeys/search", json={"from_code": "TSC", "to_code": "TSA",
                                                       "date": TRAVEL.isoformat()}).json()["results"][0]["id"]
    res = client.post("/api/v1/bookings", json={"journey_id": jid, "date": TRAVEL.isoformat(), "travel_class": "3A",
                                                "passengers": [{"name": "A", "age_band": "adult_18_59"}]},
                      headers={**bearer(token), "Idempotency-Key": "imp-1"})
    assert res.status_code == 422 and res.json()["code"] == "class-unknown"
