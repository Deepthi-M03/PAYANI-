"""Integration fixtures: a real PostgreSQL database, migrated with Alembic once per run,
truncated between tests. Requires TEST_DATABASE_URL (default: the compose database)."""

import os
import uuid
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[2]
TABLES = ("users, passenger_profiles, user_roles, refresh_tokens, consent_records, admin_audit_logs, "
          "jobs, travel_communities, service_charge_configs")
PASSWORD = "correct-horse-battery-staple"


def _ensure_database(url: str) -> None:
    target = make_url(url)
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": target.database})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    url = os.environ["TEST_DATABASE_URL"]
    _ensure_database(url)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    from payani.core.db import get_sessionmaker
    from payani.modules.book.catalog import load_synthetic

    db = get_sessionmaker()()
    load_synthetic(db)
    db.close()
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    from payani.core.db import get_engine
    from payani.core.rate_limit import limiter

    limiter.reset()
    with get_engine().begin() as conn:
        # TRUNCATE does not fire the row-level append-only trigger on the audit log.
        conn.execute(text(f"TRUNCATE {TABLES} CASCADE"))
    yield


@pytest.fixture
def client():
    from payani.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    from payani.core.db import get_sessionmaker

    session = get_sessionmaker()()
    yield session
    session.close()


def register(client: TestClient, email: str | None = None, password: str = PASSWORD) -> dict:
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    res = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": "Test Traveller"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def grant_roles(db, user_id: str, *codes: str) -> None:
    from payani.modules.identity.models import Role, UserRole

    for code in codes:
        role = db.scalar(select(Role).where(Role.code == code))
        db.add(UserRole(user_id=uuid.UUID(user_id), role_id=role.id))
    db.commit()


def login(client: TestClient, email: str, password: str = PASSWORD) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("payani_csrf", "")}
