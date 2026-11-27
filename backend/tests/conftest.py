"""Test environment. Values are set before the app is imported so settings pick them up."""

import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-anywhere-else-0123456789")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault(
    "TEST_DATABASE_URL", "postgresql+psycopg://payani:payani@localhost:5432/payani_test"
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
