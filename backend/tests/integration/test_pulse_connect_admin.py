from datetime import date, datetime, timedelta

from sqlalchemy import func, select, update

from tests.integration.conftest import bearer, grant_roles, login, register

TRAVEL = date.today() + timedelta(days=21)


def _confirmed_booking(client, token, key="b"):
    jid = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "SBC",
                                                       "date": TRAVEL.isoformat()}).json()["results"][0]["id"]
    b = client.post("/api/v1/bookings", json={"journey_id": jid, "date": TRAVEL.isoformat(), "travel_class": "3A",
                                               "passengers": [{"name": "A", "age_band": "adult_18_59"}]},
                    headers={**bearer(token), "Idempotency-Key": key}).json()
    return client.post(f"/api/v1/bookings/{b['id']}/pay", json={}, headers={**bearer(token), "Idempotency-Key": key}).json()


def _force_due(db):
    from payani.core.db import utcnow
    from payani.modules.pulse.models import NotificationSchedule
    db.execute(update(NotificationSchedule).where(NotificationSchedule.status == "scheduled").values(fire_at=utcnow()))
    db.commit()


def test_reminders_fire_once_per_channel_and_reach_inbox(client, db):
    from payani.modules.pulse.models import NotificationOutbox
    from payani.worker.main import run_once

    token = register(client)["access_token"]
    _confirmed_booking(client, token)
    _force_due(db)
    run_once(db)
    run_once(db)  # second pass must not duplicate anything
    total = db.scalar(select(func.count()).select_from(NotificationOutbox))
    keys = db.scalar(select(func.count(func.distinct(NotificationOutbox.dedupe_key))))
    assert total == keys and total > 0
    inbox = client.get("/api/v1/notifications", headers=bearer(token)).json()
    assert inbox["unread"] >= 7  # 6 departure reminders + arrival alert
    assert any("not a real ticket" in i["body"] or "timetable" in i["body"] for i in inbox["items"])


def test_email_without_smtp_is_skipped_not_failed(client, db):
    from payani.modules.pulse.models import NotificationOutbox
    from payani.worker.main import run_once

    token = register(client)["access_token"]
    _confirmed_booking(client, token)
    _force_due(db)
    run_once(db)
    statuses = {o.status for o in db.scalars(select(NotificationOutbox).where(NotificationOutbox.channel == "email"))}
    assert statuses == {"skipped"}


def test_opt_out_stops_channel(client, db):
    from payani.modules.pulse.models import NotificationOutbox
    from payani.worker.main import run_once

    token = register(client)["access_token"]
    client.put("/api/v1/notification-preferences", json=[{"channel": "in_app", "enabled": False},
                                                          {"channel": "email", "enabled": False}], headers=bearer(token))
    _confirmed_booking(client, token)
    _force_due(db)
    run_once(db)
    assert db.scalar(select(func.count()).select_from(NotificationOutbox)) == 0


def test_whatsapp_requires_consent_and_stays_dry_run(client, db):
    token = register(client)["access_token"]
    res = client.put("/api/v1/notification-preferences", json=[{"channel": "whatsapp", "enabled": True}],
                     headers=bearer(token))
    assert res.status_code == 422
    client.post("/api/v1/consents", json={"purpose": "whatsapp", "granted": True}, headers=bearer(token))
    prefs = client.put("/api/v1/notification-preferences", json=[{"channel": "whatsapp", "enabled": True}],
                       headers=bearer(token)).json()
    assert prefs["whatsapp_mode"] == "dry_run"
    from payani.modules.pulse.models import NotificationDeliveryLog
    from payani.worker.main import run_once
    _confirmed_booking(client, token)
    _force_due(db)
    run_once(db)
    logs = db.scalars(select(NotificationDeliveryLog).where(NotificationDeliveryLog.provider == "whatsapp-dry-run")).all()
    assert logs and all(lg.status == "skipped" for lg in logs)


def test_cancellation_cancels_pending_reminders(client, db):
    from payani.modules.pulse.models import NotificationSchedule
    token = register(client)["access_token"]
    b = _confirmed_booking(client, token)
    client.post(f"/api/v1/bookings/{b['id']}/cancel", json={}, headers=bearer(token))
    live = db.scalar(select(func.count()).select_from(NotificationSchedule).where(NotificationSchedule.status == "scheduled"))
    assert live == 0


def test_reminder_reconfiguration(client):
    token = register(client)["access_token"]
    b = _confirmed_booking(client, token)
    res = client.put(f"/api/v1/bookings/{b['id']}/reminders", json={"offsets": [60], "arrival_alert": False},
                     headers=bearer(token)).json()
    enabled = [(r["kind"], r["offset_minutes"]) for r in res["reminders"] if r["enabled"]]
    assert enabled == [("departure", 60)]
    bad = client.put(f"/api/v1/bookings/{b['id']}/reminders", json={"offsets": [7]}, headers=bearer(token))
    assert bad.status_code == 422


def test_quiet_hours_defer_non_critical_reminders():
    from payani.modules.pulse.models import NotificationPreference
    from payani.modules.pulse.service import _quiet_delay
    pref = NotificationPreference(channel="email", enabled=True, quiet_start=22 * 60, quiet_end=7 * 60)
    at = datetime.fromisoformat("2026-12-17T23:30:00+05:30")
    assert _quiet_delay(pref, at, "Asia/Kolkata") == datetime.fromisoformat("2026-12-18T07:00:00+05:30")
    noon = datetime.fromisoformat("2026-12-17T12:00:00+05:30")
    assert _quiet_delay(pref, noon, "Asia/Kolkata") == noon


def test_train_status_labels(client):
    trains = client.post("/api/v1/journeys/search", json={"from_code": "MAS", "to_code": "SBC",
                                                          "date": TRAVEL.isoformat()}).json()["results"][0]["legs"][0]
    res = client.get(f"/api/v1/trains/{trains['train_number']}/status?date={trains['train_origin_date']}").json()
    assert res["schedule"]["confidence"] == "scheduled"
    assert res["estimated"]["confidence"] == "estimated"
    assert res["live"]["available"] is False


def test_tick_endpoint_requires_token(client):
    assert client.post("/api/v1/internal/tick").status_code == 403


# ------------------------------------------------------------------ connect

def _community(client, token, alias="Meena"):
    client.post("/api/v1/consents", json={"purpose": "community_discovery", "granted": True}, headers=bearer(token))
    b = _confirmed_booking(client, token, key=alias)
    leg = b["journey"]["legs"][0]
    res = client.post("/api/v1/connect/communities", json={"train_number": leg["train_number"],
                                                           "journey_date": leg["train_origin_date"], "alias": alias,
                                                           "notify_cancellations": True}, headers=bearer(token))
    assert res.status_code == 201, res.text
    return res.json()["id"], b


def test_community_requires_consent_and_booking(client):
    token = register(client)["access_token"]
    res = client.post("/api/v1/connect/communities", json={"train_number": "90001", "journey_date": TRAVEL.isoformat(),
                                                           "alias": "X1"}, headers=bearer(token))
    assert res.status_code == 422  # no consent yet
    client.post("/api/v1/consents", json={"purpose": "community_discovery", "granted": True}, headers=bearer(token))
    res = client.post("/api/v1/connect/communities", json={"train_number": "90001", "journey_date": TRAVEL.isoformat(),
                                                           "alias": "X1"}, headers=bearer(token))
    assert res.status_code == 403  # not travelling on it


def test_resale_and_phone_numbers_are_held(client):
    token = register(client)["access_token"]
    cid, _ = _community(client, token)
    ok = client.post(f"/api/v1/connect/communities/{cid}/posts", json={"body": "Coach B2 has a pantry nearby"},
                     headers=bearer(token)).json()
    assert ok["status"] == "visible"
    for text in ["Selling my confirmed ticket, pay me 500", "Call me on 9876543210", "Transfer my ticket for Rs 900",
                 "pay via priya@okaxis"]:
        res = client.post(f"/api/v1/connect/communities/{cid}/posts", json={"body": text}, headers=bearer(token)).json()
        assert res["status"] == "held", text


def test_blocking_hides_posts_and_contact_needs_both_consents(client, db):
    a = register(client)
    b = register(client)
    cid, _ = _community(client, a["access_token"], alias="Alpha")
    _community(client, b["access_token"], alias="Bravo")
    client.post(f"/api/v1/connect/communities/{cid}/posts", json={"body": "Hello all"}, headers=bearer(b["access_token"]))
    posts = client.get(f"/api/v1/connect/communities/{cid}/posts", headers=bearer(a["access_token"])).json()
    author = next(p for p in posts if p["body"] == "Hello all")
    assert "email" not in str(author) and "phone" not in str(author)

    res = client.post("/api/v1/connect/contact-requests", json={"recipient_id": author["author_id"], "community_id": cid},
                      headers=bearer(a["access_token"]))
    assert res.status_code == 422  # requester has not enabled contact sharing
    client.post("/api/v1/consents", json={"purpose": "contact_share", "granted": True}, headers=bearer(a["access_token"]))
    req = client.post("/api/v1/connect/contact-requests", json={"recipient_id": author["author_id"], "community_id": cid},
                      headers=bearer(a["access_token"])).json()
    mine = client.get("/api/v1/connect/contact-requests", headers=bearer(a["access_token"])).json()
    assert mine[0]["shared_email"] is None  # nothing shared before acceptance
    client.post("/api/v1/consents", json={"purpose": "contact_share", "granted": True}, headers=bearer(b["access_token"]))
    client.post(f"/api/v1/connect/contact-requests/{req['id']}/respond", json={"accept": True},
                headers=bearer(b["access_token"]))
    mine = client.get("/api/v1/connect/contact-requests", headers=bearer(a["access_token"])).json()
    assert mine[0]["shared_email"] == b["user"]["email"]

    client.post(f"/api/v1/connect/blocks/{author['author_id']}", headers=bearer(a["access_token"]))
    posts = client.get(f"/api/v1/connect/communities/{cid}/posts", headers=bearer(a["access_token"])).json()
    assert all(p["body"] != "Hello all" for p in posts)


def test_cancellation_notice_never_promises_a_berth(client):
    a = register(client)
    b = register(client)
    cid, booking_a = _community(client, a["access_token"], alias="Cancel")
    _community(client, b["access_token"], alias="Watcher")
    client.post(f"/api/v1/bookings/{booking_a['id']}/cancel", json={}, headers=bearer(a["access_token"]))
    posts = client.get(f"/api/v1/connect/communities/{cid}/posts", headers=bearer(b["access_token"])).json()
    notice = next(p for p in posts if p["kind"] == "system")
    assert "cannot guarantee" in notice["body"]


# ------------------------------------------------------------------ admin

def test_admin_routes_permission_matrix(client, db):
    passenger = register(client)["access_token"]
    adm = register(client)
    grant_roles(db, adm["user"]["id"], "admin")
    admin_token = login(client, adm["user"]["email"])
    read_routes = ["/api/v1/admin/overview", "/api/v1/admin/bookings", "/api/v1/admin/payments",
                   "/api/v1/admin/notifications", "/api/v1/admin/providers", "/api/v1/admin/analytics",
                   "/api/v1/admin/moderation", "/api/v1/admin/service-charges", "/api/v1/admin/settings"]
    for path in read_routes:
        assert client.get(path, headers=bearer(passenger)).status_code == 403, path
        assert client.get(path, headers=bearer(admin_token)).status_code == 200, path
    # Super-admin-only writes
    assert client.post("/api/v1/admin/service-charges", json={"kind": "flat", "value": 0, "note": "test"},
                       headers=bearer(admin_token)).status_code == 403
    assert client.put("/api/v1/admin/settings/community_enabled", json={"value": False},
                      headers=bearer(admin_token)).status_code == 403
    assert client.post("/api/v1/admin/providers/catalog/resync", headers=bearer(admin_token)).status_code == 403


def test_super_admin_cannot_enable_live_whatsapp_and_changes_are_audited(client, db):
    root = register(client)
    grant_roles(db, root["user"]["id"], "admin", "super_admin")
    token = login(client, root["user"]["email"])
    assert client.put("/api/v1/admin/settings/whatsapp_mode", json={"value": "live"},
                      headers=bearer(token)).status_code == 422
    res = client.post("/api/v1/admin/service-charges", json={"kind": "flat", "value": 1500, "note": "future release"},
                      headers=bearer(token))
    assert res.status_code == 201 and res.json()["applied_in_v1"] is False
    logs = client.get("/api/v1/admin/audit-logs", headers=bearer(token)).json()
    assert any(entry["action"] == "service_charge.set" for entry in logs)


def test_moderation_flow(client, db):
    token = register(client)["access_token"]
    cid, _ = _community(client, token, alias="Mod")
    held = client.post(f"/api/v1/connect/communities/{cid}/posts", json={"body": "selling my ticket"},
                       headers=bearer(token)).json()
    mod = register(client)
    grant_roles(db, mod["user"]["id"], "admin")
    mt = login(client, mod["user"]["email"])
    queue = client.get("/api/v1/admin/moderation", headers=bearer(mt)).json()
    assert any(p["id"] == held["id"] for p in queue["held_posts"])
    assert client.post(f"/api/v1/admin/moderation/posts/{held['id']}", json={"action": "remove"},
                       headers=bearer(mt)).json()["status"] == "removed"


def test_disabled_user_loses_access(client, db):
    victim = register(client)
    adm = register(client)
    grant_roles(db, adm["user"]["id"], "admin")
    at = login(client, adm["user"]["email"])
    client.put(f"/api/v1/admin/users/{victim['user']['id']}/status", json={"status": "disabled"}, headers=bearer(at))
    assert client.get("/api/v1/me", headers=bearer(victim["access_token"])).status_code == 401
