def test_liveness(client):
    assert client.get("/health/live").json() == {"status": "ok"}


def test_readiness_reports_migration(client):
    res = client.get("/health/ready")
    assert res.status_code == 200
    assert res.json()["migration"] == "0001_foundation"


def test_security_headers_present(client):
    res = client.get("/api/v1/me")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Cache-Control"] == "no-store"
