import os

from sqlalchemy import engine_from_config, pool

from alembic import context
from payani.core.config import get_settings, normalize_db_url
from payani.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    return normalize_db_url(os.environ.get("DATABASE_URL") or get_settings().database_url)


def include_object(obj, name, type_, reflected, compare_to):
    # Expression index on lower(email) is defined in both places but cannot be
    # compared by autogenerate; skip it rather than report false drift.
    return not (type_ == "index" and name == "uq_users_email_lower")


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
