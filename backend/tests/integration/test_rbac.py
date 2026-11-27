import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from tests.integration.conftest import bearer, grant_roles, login, register


@pytest.fixture
def passenger_token(client):
    return register(client, "passenger-rbac@example.com")["access_token"]


@pytest.fixture
def admin(client, db):
    user = register(client, "admin-rbac@example.com")["user"]
    grant_roles(db, user["id"], "admin")
    return user, login(client, "admin-rbac@example.com")


@pytest.fixture
def super_admin(client, db):
    user = register(client, "root-rbac@example.com")["user"]
    grant_roles(db, user["id"], "admin", "super_admin")
    return user, login(client, "root-rbac@example.com")


ADMIN_READ_ROUTES = ["/api/v1/admin/users", "/api/v1/admin/audit-logs"]


@pytest.mark.parametrize("path", ADMIN_READ_ROUTES)
def test_passenger_cannot_read_admin_routes(client, passenger_token, path):
    res = client.get(path, headers=bearer(passenger_token))
    assert res.status_code == 403
    assert res.json()["code"] == "forbidden"


@pytest.mark.parametrize("path", ADMIN_READ_ROUTES)
def test_admin_can_read_admin_routes(client, admin, path):
    assert client.get(path, headers=bearer(admin[1])).status_code == 200


def test_admin_cannot_grant_roles(client, admin, passenger_token):
    target = client.get("/api/v1/me", headers=bearer(passenger_token)).json()["id"]
    res = client.put(
        f"/api/v1/admin/users/{target}/roles", json={"roles": ["passenger", "admin"]},
        headers=bearer(admin[1]),
    )
    assert res.status_code == 403


def test_super_admin_grants_role_and_it_is_audited(client, db, super_admin, passenger_token):
    from payani.modules.admin.models import AdminAuditLog

    target = client.get("/api/v1/me", headers=bearer(passenger_token)).json()["id"]
    res = client.put(
        f"/api/v1/admin/users/{target}/roles", json={"roles": ["passenger", "admin"]},
        headers=bearer(super_admin[1]),
    )
    assert res.status_code == 200
    assert res.json()["roles"] == ["admin", "passenger"]

    entry = db.scalar(select(AdminAuditLog).where(AdminAuditLog.entity_id == target))
    assert entry.action == "role.grant"
    assert entry.before == {"roles": ["passenger"]}
    assert entry.after == {"roles": ["admin", "passenger"]}
    assert str(entry.actor_id) == super_admin[0]["id"]


def test_role_change_applies_to_existing_tokens_immediately(client, db, super_admin, admin):
    """Permissions are reloaded per request, so demotion does not wait for token expiry."""
    user, token = admin
    client.put(
        f"/api/v1/admin/users/{user['id']}/roles", json={"roles": ["passenger"]},
        headers=bearer(super_admin[1]),
    )
    assert client.get("/api/v1/admin/users", headers=bearer(token)).status_code == 403


def test_super_admin_cannot_remove_own_super_admin_role(client, super_admin):
    user, token = super_admin
    res = client.put(
        f"/api/v1/admin/users/{user['id']}/roles", json={"roles": ["passenger"]},
        headers=bearer(token),
    )
    assert res.status_code == 409
    assert res.json()["code"] == "self-demotion"


def test_unknown_role_rejected(client, super_admin, passenger_token):
    target = client.get("/api/v1/me", headers=bearer(passenger_token)).json()["id"]
    res = client.put(
        f"/api/v1/admin/users/{target}/roles", json={"roles": ["god_mode"]},
        headers=bearer(super_admin[1]),
    )
    assert res.status_code == 422


def test_audit_log_rejects_update_and_delete(db, client, super_admin, passenger_token):
    target = client.get("/api/v1/me", headers=bearer(passenger_token)).json()["id"]
    client.put(
        f"/api/v1/admin/users/{target}/roles", json={"roles": ["passenger", "admin"]},
        headers=bearer(super_admin[1]),
    )
    for statement in ("UPDATE admin_audit_logs SET action = 'tampered'", "DELETE FROM admin_audit_logs"):
        with pytest.raises(DBAPIError, match="append-only"):
            db.execute(text(statement))
        db.rollback()
