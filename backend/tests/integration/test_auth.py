from tests.integration.conftest import PASSWORD, bearer, csrf, login, register


def test_register_returns_session_and_passenger_role(client):
    body = register(client, "priya@example.com")
    assert body["token_type"] == "bearer"
    assert body["user"]["roles"] == ["passenger"]
    assert "admin.access" not in body["user"]["permissions"]
    assert client.cookies.get("payani_refresh")
    assert client.cookies.get("payani_csrf")


def test_password_is_not_stored_or_returned(client, db):
    from sqlalchemy import select

    from payani.modules.identity.models import User

    body = register(client, "hash@example.com")
    assert "password" not in str(body)
    stored = db.scalar(select(User).where(User.email == "hash@example.com"))
    assert stored.password_hash.startswith("$argon2id$")
    assert PASSWORD not in stored.password_hash


def test_duplicate_email_is_case_insensitive(client):
    register(client, "Arjun@Example.com")
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "arjun@example.com", "password": PASSWORD, "display_name": "A"},
    )
    assert res.status_code == 409
    assert res.headers["content-type"].startswith("application/problem+json")
    assert res.json()["code"] == "email-taken"


def test_short_password_rejected_with_field_error(client):
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "s@example.com", "password": "short", "display_name": "S"},
    )
    assert res.status_code == 422
    assert res.json()["errors"][0]["field"] == "password"


def test_login_and_me(client):
    register(client, "meena@example.com")
    token = login(client, "meena@example.com")
    res = client.get("/api/v1/me", headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["email"] == "meena@example.com"


def test_wrong_password_and_unknown_email_look_identical(client):
    register(client, "same@example.com")
    a = client.post("/api/v1/auth/login", json={"email": "same@example.com", "password": "wrong-password-123"})
    b = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-123"})
    assert a.status_code == b.status_code == 401
    assert a.json()["title"] == b.json()["title"]


def test_me_requires_token(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers=bearer("not-a-jwt")).status_code == 401


def refresh_with(client, refresh_value: str):
    """Send a specific refresh token, bypassing the cookie jar."""
    token = client.cookies.get("payani_csrf") or "csrf-test-value"
    client.cookies.clear()
    return client.post(
        "/api/v1/auth/refresh",
        headers={
            "Cookie": f"payani_refresh={refresh_value}; payani_csrf={token}",
            "X-CSRF-Token": token,
        },
    )


def test_refresh_rotates_and_reuse_revokes_family(client):
    register(client, "rotate@example.com")
    old_refresh = client.cookies.get("payani_refresh")

    first = client.post("/api/v1/auth/refresh", headers=csrf(client))
    assert first.status_code == 200
    new_refresh = client.cookies.get("payani_refresh")
    assert new_refresh and new_refresh != old_refresh

    # Replaying the old (already rotated) token signals theft: the whole family dies.
    assert refresh_with(client, old_refresh).status_code == 401
    assert refresh_with(client, new_refresh).status_code == 401


def test_failed_refresh_clears_session_cookies(client):
    res = refresh_with(client, "not-a-real-token")
    assert res.status_code == 401
    set_cookie = " ".join(res.headers.get_list("set-cookie"))
    assert "payani_refresh=" in set_cookie and "Max-Age=0" in set_cookie


def test_validation_messages_are_user_facing(client):
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "rep@example.com", "password": "aaaaaaaaaaaaaa", "display_name": "R"},
    )
    assert res.status_code == 422
    assert res.json()["errors"][0]["message"] == "Password is too repetitive."


def test_refresh_requires_csrf_header(client):
    register(client, "csrf@example.com")
    res = client.post("/api/v1/auth/refresh")
    assert res.status_code == 403
    assert res.json()["code"] == "csrf-failed"


def test_logout_revokes_refresh_token(client):
    register(client, "bye@example.com")
    refresh_value = client.cookies.get("payani_refresh")
    assert client.post("/api/v1/auth/logout", headers=csrf(client)).status_code == 204
    assert refresh_with(client, refresh_value).status_code == 401


def test_login_is_rate_limited(client):
    register(client, "brute@example.com")
    codes = [
        client.post("/api/v1/auth/login", json={"email": "brute@example.com", "password": "nope-nope-nope"}).status_code
        for _ in range(12)
    ]
    assert 429 in codes


def test_error_responses_carry_request_id(client):
    res = client.get("/api/v1/me", headers={"X-Request-ID": "trace-12345678"})
    assert res.headers["X-Request-ID"] == "trace-12345678"
    assert res.json()["request_id"] == "trace-12345678"
