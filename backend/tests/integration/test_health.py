def test_liveness(client):
    assert client.get("/health/live").json() == {"status": "ok"}


def test_readiness_reports_migration(client):
    """Readiness reports the newest migration in the repository, whatever its name is."""
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "alembic"))
    head = ScriptDirectory.from_config(cfg).get_current_head()

    res = client.get("/health/ready")
    assert res.status_code == 200
    assert res.json()["migration"] == head


def test_security_headers_present(client):
    res = client.get("/api/v1/me")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Cache-Control"] == "no-store"


def test_station_map_lists_every_station_with_position(client):
    body = client.get("/api/v1/stations/map").json()
    assert len(body["stations"]) >= 30
    first = body["stations"][0]
    assert {"code", "name", "state", "lat", "lon"} <= first.keys()
    assert 6 < first["lat"] < 37 and 68 < first["lon"] < 98
    assert "Approximate" in body["position_note"]
    codes = {s["code"] for s in body["stations"]}
    assert body["links"] and all(a in codes and b in codes for a, b in body["links"])
