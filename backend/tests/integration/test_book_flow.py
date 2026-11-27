from datetime import date, timedelta

import pytest

from tests.integration.conftest import bearer, register

TRAVEL = date.today() + timedelta(days=21)


def _search(client, token=None, frm="MAS", to="SBC"):
    res = client.post("/api/v1/journeys/search", json={"from_code": frm, "to_code": to, "date": TRAVEL.isoformat()},
                      headers=bearer(token) if token else {})
    assert res.status_code == 200, res.text
    return res.json()


def _book(client, token, journey_id, key="k1", n=2, cls="3A"):
    pax = [{"name": f"Traveller {i}", "age_band": "adult_18_59"} for i in range(n)]
    return client.post("/api/v1/bookings", json={"journey_id": journey_id, "date": TRAVEL.isoformat(),
                                                  "travel_class": cls, "quota": "GN", "passengers": pax},
                       headers={**bearer(token), "Idempotency-Key": key})


def test_station_autocomplete_and_freshness(client):
    assert client.get("/api/v1/stations?q=chen").json()[0]["code"] == "MAS"
    f = client.get("/api/v1/catalog/freshness").json()
    assert f["confidence"] == "simulated" and f["trains"] > 50


def test_search_is_public_labelled_and_explained(client):
    body = _search(client)
    assert body["results"]
    first = body["results"][0]
    assert first["data"]["confidence"] == "simulated"
    assert first["reasons"]


def test_search_validation(client):
    bad = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "MAS", "date": TRAVEL.isoformat()})
    assert bad.status_code == 422
    far = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "SBC",
                                                       "date": (date.today() + timedelta(days=400)).isoformat()})
    assert far.status_code == 422


def test_full_sandbox_lifecycle_with_refund(client):
    from payani.core.db import get_sessionmaker
    from payani.worker.main import run_once

    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    created = _book(client, token, jid)
    assert created.status_code == 201, created.text
    b = created.json()
    assert b["status"] == "SEARCHED" and b["service_charge_paise"] == 0 and b["total_paise"] == b["fare_paise"]

    paid = client.post(f"/api/v1/bookings/{b['id']}/pay", json={}, headers={**bearer(token), "Idempotency-Key": "p1"})
    assert paid.status_code == 200, paid.text
    p = paid.json()
    assert p["status"] == "CONFIRMED" and p["pnr"].startswith("SBX-") and p["provider_mode"] == "sandbox"
    assert all(x["status"] == "confirmed" for x in p["passengers"])
    rem = client.get(f"/api/v1/bookings/{b['id']}/reminders", headers=bearer(token)).json()
    assert {r["offset_minutes"] for r in rem["reminders"] if r["kind"] == "departure"} == {1440, 360, 120, 60, 30, 0}

    cancelled = client.post(f"/api/v1/bookings/{b['id']}/cancel", json={"reason": "plans changed"},
                            headers=bearer(token)).json()
    assert cancelled["status"] == "REFUND_PENDING"
    assert cancelled["refunds"][0]["status"] == "pending"

    db = get_sessionmaker()()
    from sqlalchemy import update

    from payani.core.db import utcnow
    from payani.modules.pulse.models import Job
    db.execute(update(Job).values(run_at=utcnow()))  # don't wait 2 minutes in a test
    db.commit()
    run_once(db)
    db.close()
    final = client.get(f"/api/v1/bookings/{b['id']}", headers=bearer(token)).json()
    assert final["status"] == "REFUNDED"
    assert [e["to"] for e in final["events"]] == ["SEARCHED", "PENDING_CONFIRMATION", "CONFIRMED",
                                                  "CANCELLATION_REQUESTED", "CANCELLED", "REFUND_PENDING", "REFUNDED"]


def test_idempotent_create_and_pay(client):
    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    a, b = _book(client, token, jid, key="same").json(), _book(client, token, jid, key="same").json()
    assert a["id"] == b["id"]
    assert len(client.get("/api/v1/bookings", headers=bearer(token)).json()) == 1
    other = _book(client, token, jid, key="same", n=1)
    assert other.status_code == 422  # same key, different body
    h = {**bearer(token), "Idempotency-Key": "pay-1"}
    one = client.post(f"/api/v1/bookings/{a['id']}/pay", json={}, headers=h).json()
    two = client.post(f"/api/v1/bookings/{a['id']}/pay", json={}, headers=h).json()
    assert one["pnr"] == two["pnr"] and len(two["payments"]) == 1


def test_missing_idempotency_key_rejected(client):
    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    res = client.post("/api/v1/bookings", json={"journey_id": jid, "date": TRAVEL.isoformat(), "travel_class": "3A",
                                                 "passengers": [{"name": "A", "age_band": "adult_18_59"}]},
                      headers=bearer(token))
    assert res.status_code == 428


def test_provider_failure_refunds_automatically(client):
    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    b = _book(client, token, jid).json()
    res = client.post(f"/api/v1/bookings/{b['id']}/pay", json={"simulate": "fail"},
                      headers={**bearer(token), "Idempotency-Key": "pf"}).json()
    assert res["status"] == "FAILED" and res["failure_reason"]
    assert res["refunds"] and res["refunds"][0]["amount_paise"] == b["total_paise"]


def test_passenger_cap_and_adult_rule(client):
    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    assert _book(client, token, jid, key="c7", n=7).status_code == 422  # GN cap is 6
    res = client.post("/api/v1/bookings", json={"journey_id": jid, "date": TRAVEL.isoformat(), "travel_class": "3A",
                                                 "passengers": [{"name": "Kid", "age_band": "child_5_11"}]},
                      headers={**bearer(token), "Idempotency-Key": "kid"})
    assert res.status_code == 422


def test_tampered_journey_rejected(client):
    token = register(client)["access_token"]
    assert _book(client, token, "99999@0:0:1", key="t").status_code == 422


def test_bookings_are_private(client):
    owner = register(client)["access_token"]
    other = register(client)["access_token"]
    jid = _search(client, owner)["results"][0]["id"]
    b = _book(client, owner, jid).json()
    assert client.get(f"/api/v1/bookings/{b['id']}", headers=bearer(other)).status_code == 404


def test_handoff_and_calendar(client):
    token = register(client)["access_token"]
    jid = _search(client, token)["results"][0]["id"]
    b = _book(client, token, jid).json()
    h = client.get(f"/api/v1/bookings/{b['id']}/handoff", headers=bearer(token)).json()
    assert h["url"].startswith("https://www.irctc.co.in/") and "does not sign in" in h["note"]
    ics = client.get(f"/api/v1/bookings/{b['id']}/calendar.ics", headers=bearer(token))
    assert ics.headers["content-type"].startswith("text/calendar") and "BEGIN:VALARM" in ics.text


def test_groups_invitations_and_batch_plan(client):
    owner = register(client)
    token = owner["access_token"]
    g = client.post("/api/v1/groups", json={"name": "Wedding trip"}, headers=bearer(token)).json()
    for i in range(7):
        client.post(f"/api/v1/groups/{g['id']}/members",
                    json={"name": f"Sharma {i}", "family": "Sharma", "is_minor": i > 4}, headers=bearer(token))
    plan = client.get(f"/api/v1/groups/{g['id']}/batch-plan?quota=GN", headers=bearer(token)).json()
    assert plan["cap"] == 6 and len(plan["batches"]) == 2
    assert any("adjacent seats" in line for line in plan["explanation"])

    inv = client.post(f"/api/v1/groups/{g['id']}/invitations", headers=bearer(token)).json()
    friend = register(client)["access_token"]
    assert client.get(f"/api/v1/groups/{g['id']}", headers=bearer(friend)).status_code == 404
    joined = client.post(f"/api/v1/invitations/{inv['token']}/accept", headers=bearer(friend))
    assert joined.status_code == 200 and not joined.json()["is_owner"]
    again = client.post(f"/api/v1/invitations/{inv['token']}/accept", headers=bearer(friend))
    assert again.status_code == 410
    # members cannot change the group
    assert client.post(f"/api/v1/groups/{g['id']}/members", json={"name": "X"}, headers=bearer(friend)).status_code == 404


@pytest.mark.slow
def test_forecast_is_synthetic(client):
    token = register(client)["access_token"]
    res = client.get(f"/api/v1/intelligence/forecast?route=MAS-SBC&date={(date.today() + timedelta(days=10)).isoformat()}",
                     headers=bearer(token))
    assert res.status_code == 200, res.text
    assert res.json()["data"]["synthetic"] is True
    card = client.get("/api/v1/intelligence/model-card", headers=bearer(token)).json()
    assert card["synthetic"] is True
