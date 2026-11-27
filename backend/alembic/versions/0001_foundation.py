"""Foundation: identity, RBAC, refresh tokens, consent records, admin audit log.

Revision ID: 0001_foundation
Revises:
Create Date: 2026-11-26

The DDL is written out explicitly so it can be reviewed (and was executed against
PostgreSQL 16 during development). Reference data for roles and permissions is
seeded here because the application cannot run without it.
"""

from alembic import op

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None

# Frozen copy of the reference data at this revision. Later changes go in new
# migrations; tests/unit/test_permissions.py checks this matches permissions.py.
ROLES = {
    "passenger": ("Passenger", "Plans journeys and manages their own bookings."),
    "admin": ("Administrator", "Monitors the platform; read access to operational data."),
    "super_admin": (
        "Super Administrator",
        "Grants roles and changes pricing, provider and critical system settings.",
    ),
}
PERMISSIONS = {
    "profile.read_own": "Read own profile",
    "profile.update_own": "Update own profile",
    "admin.access": "Open the administration area",
    "user.read_all": "List and view all users",
    "audit.read": "Read the admin audit log",
    "role.grant": "Grant or revoke roles",
    "service_charge.manage": "Change service-charge configuration",
    "provider.manage": "Change provider configuration",
    "system_settings.manage": "Change critical system settings",
}
ROLE_PERMISSIONS = {
    "passenger": ["profile.read_own", "profile.update_own"],
    "admin": [
        "profile.read_own",
        "profile.update_own",
        "admin.access",
        "user.read_all",
        "audit.read",
    ],
    "super_admin": list(PERMISSIONS),
}

UPGRADE_SQL = """
CREATE TABLE users (
    id UUID NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    status VARCHAR(16) DEFAULT 'active' NOT NULL,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    locale VARCHAR(8) DEFAULT 'en' NOT NULL,
    timezone VARCHAR(64) DEFAULT 'Asia/Kolkata' NOT NULL,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_status CHECK (status IN ('active', 'disabled'))
);
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

CREATE TABLE passenger_profiles (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    berth_preference VARCHAR(16),
    age_band VARCHAR(16),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_passenger_profiles PRIMARY KEY (id),
    CONSTRAINT uq_passenger_profiles_user_id UNIQUE (user_id),
    CONSTRAINT fk_passenger_profiles_user_id_users FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE roles (
    id UUID NOT NULL,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    CONSTRAINT pk_roles PRIMARY KEY (id),
    CONSTRAINT uq_roles_code UNIQUE (code)
);

CREATE TABLE permissions (
    id UUID NOT NULL,
    code VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    CONSTRAINT pk_permissions PRIMARY KEY (id),
    CONSTRAINT uq_permissions_code UNIQUE (code)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    granted_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user_id_users FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role_id_roles FOREIGN KEY (role_id)
        REFERENCES roles (id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_roles_granted_by_users FOREIGN KEY (granted_by)
        REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role_id_roles FOREIGN KEY (role_id)
        REFERENCES roles (id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission_id_permissions FOREIGN KEY (permission_id)
        REFERENCES permissions (id) ON DELETE CASCADE
);

CREATE TABLE refresh_tokens (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    family_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    replaced_by_id UUID,
    user_agent VARCHAR(256),
    ip VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_refresh_tokens PRIMARY KEY (id),
    CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_refresh_tokens_user_id_users FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_refresh_tokens_replaced_by_id_refresh_tokens FOREIGN KEY (replaced_by_id)
        REFERENCES refresh_tokens (id) ON DELETE SET NULL
);
CREATE INDEX ix_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX ix_refresh_tokens_family_id ON refresh_tokens (family_id);

CREATE TABLE consent_records (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    purpose VARCHAR(48) NOT NULL,
    granted BOOLEAN NOT NULL,
    policy_version VARCHAR(16) NOT NULL,
    source VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_consent_records PRIMARY KEY (id),
    CONSTRAINT fk_consent_records_user_id_users FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_consent_records_user_purpose ON consent_records (user_id, purpose);

CREATE TABLE admin_audit_logs (
    id UUID NOT NULL,
    actor_id UUID,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(48) NOT NULL,
    entity_id VARCHAR(64),
    before JSONB,
    after JSONB,
    ip VARCHAR(64),
    request_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_admin_audit_logs PRIMARY KEY (id),
    CONSTRAINT fk_admin_audit_logs_actor_id_users FOREIGN KEY (actor_id)
        REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX ix_admin_audit_logs_actor_id ON admin_audit_logs (actor_id);
CREATE INDEX ix_admin_audit_logs_created_at ON admin_audit_logs (created_at);

-- The audit log is append-only. Deleting a user nulls actor_id via the FK, which is
-- the one permitted update; anything else raises.
CREATE FUNCTION admin_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'admin_audit_logs is append-only (% rejected)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_audit_logs_append_only
    BEFORE UPDATE OR DELETE ON admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_append_only();
"""

DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON admin_audit_logs;
DROP FUNCTION IF EXISTS admin_audit_logs_append_only();
DROP TABLE IF EXISTS admin_audit_logs;
DROP TABLE IF EXISTS consent_records;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS passenger_profiles;
DROP TABLE IF EXISTS users;
"""


def _q(value: str) -> str:
    """Quote a trusted, hard-coded literal for the seed statements below."""
    return "'" + value.replace("'", "''") + "'"


def seed_sql() -> str:
    stmts = []
    for code, (name, description) in ROLES.items():
        stmts.append(
            "INSERT INTO roles (id, code, name, description) "
            f"VALUES (gen_random_uuid(), {_q(code)}, {_q(name)}, {_q(description)});"
        )
    for code, description in PERMISSIONS.items():
        stmts.append(
            "INSERT INTO permissions (id, code, description) "
            f"VALUES (gen_random_uuid(), {_q(code)}, {_q(description)});"
        )
    for role, perms in ROLE_PERMISSIONS.items():
        codes = ", ".join(_q(p) for p in perms)
        stmts.append(
            "INSERT INTO role_permissions (role_id, permission_id) "
            "SELECT r.id, p.id FROM roles r, permissions p "
            f"WHERE r.code = {_q(role)} AND p.code IN ({codes});"
        )
    return "\n".join(stmts)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    op.execute(seed_sql())


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
