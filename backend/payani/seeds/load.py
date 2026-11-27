"""Development seed data: one account per role. Idempotent; refuses to run in production.

Passwords come from SEED_PASSENGER_PASSWORD / SEED_ADMIN_PASSWORD / SEED_SUPER_ADMIN_PASSWORD
(written into .env by scripts/gen_secrets.py). Emails use the reserved example.com domain,
so nothing can ever be delivered to a real person.

    python -m payani.seeds.load --profile dev
"""

import argparse
import os
import sys

from sqlalchemy import select

from payani.core import security
from payani.core.config import get_settings
from payani.core.db import get_sessionmaker, uuid7
from payani.modules.identity.models import PassengerProfile, Role, User, UserRole
from payani.modules.identity.permissions import ADMIN, PASSENGER, SUPER_ADMIN

DEV_USERS = [
    ("passenger@example.com", "Demo Passenger", [PASSENGER], "SEED_PASSENGER_PASSWORD"),
    ("admin@example.com", "Demo Administrator", [PASSENGER, ADMIN], "SEED_ADMIN_PASSWORD"),
    (
        "superadmin@example.com",
        "Demo Super Administrator",
        [PASSENGER, ADMIN, SUPER_ADMIN],
        "SEED_SUPER_ADMIN_PASSWORD",
    ),
]


def load_dev() -> list[str]:
    created = []
    db = get_sessionmaker()()
    try:
        roles = {r.code: r for r in db.scalars(select(Role)).all()}
        for email, name, role_codes, env_var in DEV_USERS:
            if db.scalar(select(User).where(User.email == email)):
                continue
            password = os.environ.get(env_var)
            if not password or len(password) < 12:
                raise SystemExit(f"{env_var} is missing or shorter than 12 characters. Run `make secrets`.")
            user = User(
                id=uuid7(), email=email, display_name=name,
                password_hash=security.hash_password(password),
            )
            db.add(user)
            db.flush()
            for code in role_codes:
                db.add(UserRole(user_id=user.id, role_id=roles[code].id))
            db.add(PassengerProfile(id=uuid7(), user_id=user.id))
            created.append(email)
        db.commit()
    finally:
        db.close()
    return created


def load_catalogue() -> None:
    from payani.modules.book.catalog import load_synthetic
    from payani.modules.book.models import TrainRow

    db = get_sessionmaker()()
    try:
        if db.scalar(select(TrainRow).limit(1)):
            print("Synthetic catalogue already present")
        else:
            print(f"Loaded synthetic catalogue: {load_synthetic(db)} stops")
    finally:
        db.close()


def bootstrap_super_admin() -> None:
    """Production-safe first admin: if BOOTSTRAP_SUPER_ADMIN_EMAIL is set and NO super
    admin exists yet, grant the roles to that already-registered account. Does nothing
    once any super admin exists, so the variable cannot be abused later."""
    email = os.environ.get("BOOTSTRAP_SUPER_ADMIN_EMAIL", "").strip().lower()
    if not email:
        return
    from sqlalchemy import func

    db = get_sessionmaker()()
    try:
        roles = {r.code: r for r in db.scalars(select(Role)).all()}
        existing = db.scalar(select(func.count()).select_from(UserRole).where(UserRole.role_id == roles[SUPER_ADMIN].id))
        if existing:
            return
        user = db.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            print("BOOTSTRAP_SUPER_ADMIN_EMAIL is set but that account is not registered yet")
            return
        have = {ur.role_id for ur in db.scalars(select(UserRole).where(UserRole.user_id == user.id))}
        for code in (ADMIN, SUPER_ADMIN):
            if roles[code].id not in have:
                db.add(UserRole(user_id=user.id, role_id=roles[code].id))
        db.commit()
        print("Granted Super Administrator to the bootstrap account")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=["dev", "catalogue"], default="dev",
                        help="dev: catalogue + demo accounts; catalogue: catalogue only (production)")
    args = parser.parse_args()
    load_catalogue()
    bootstrap_super_admin()
    if args.profile == "catalogue":
        return
    if get_settings().is_production:
        sys.exit("Refusing to seed demo accounts in production.")
    created = load_dev()
    print(f"Seeded {len(created)} account(s): {', '.join(created) or 'already present'}")


if __name__ == "__main__":
    main()
