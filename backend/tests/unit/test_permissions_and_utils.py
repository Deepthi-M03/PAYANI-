import importlib.util
import uuid
from pathlib import Path

from payani.core.db import uuid7
from payani.core.logging import redact
from payani.modules.identity import permissions as p

VERSIONS = Path(__file__).resolve().parents[2] / "alembic/versions"


def _migration(name="0001_foundation"):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_seed_matches_permission_registry():
    m, m3 = _migration(), _migration("0003_pulse_connect_admin")
    assert m.ROLES == p.ROLES
    assert {**m.PERMISSIONS, **m3.ADDED_PERMISSIONS} == p.PERMISSIONS
    seeded = {k: set(v) | set(m3.ADDED_ROLE_PERMISSIONS.get(k, [])) for k, v in m.ROLE_PERMISSIONS.items()}
    assert seeded == p.ROLE_PERMISSIONS


def test_role_separation():
    assert "admin.access" not in p.ROLE_PERMISSIONS[p.PASSENGER]
    super_only = {"role.grant", "service_charge.manage", "provider.manage", "system_settings.manage"}
    assert not super_only & p.ROLE_PERMISSIONS[p.ADMIN]
    assert super_only <= p.ROLE_PERMISSIONS[p.SUPER_ADMIN]


def test_uuid7_is_version_7_and_time_ordered():
    ids = [uuid7() for _ in range(200)]
    assert all(isinstance(i, uuid.UUID) and i.version == 7 for i in ids)
    prefixes = [i.int >> 80 for i in ids]
    assert prefixes == sorted(prefixes)


def test_redaction_of_secrets_and_identifiers():
    out = redact({"password": "hunter2-hunter2", "nested": {"refresh_token": "abc"}, "note": "call 9876543210"})
    assert out["password"] == "[REDACTED]"
    assert out["nested"]["refresh_token"] == "[REDACTED]"
    assert "9876543210" not in out["note"]
    assert redact("Authorization: Bearer abc.def.ghi") == "Authorization: Bearer [REDACTED]"
