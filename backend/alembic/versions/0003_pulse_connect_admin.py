"""PULSE (jobs, reminders, outbox, delivery logs, devices, in-app inbox), CONNECT
(communities, posts, reports, blocks, contact sharing) and ADMIN (service charges, settings).

Revision ID: 0003_pulse_connect_admin
Revises: 0002_book
Create Date: 2026-11-26
"""

from alembic import op

revision = "0003_pulse_connect_admin"
down_revision = "0002_book"
branch_labels = None
depends_on = None

ADDED_PERMISSIONS = {
    "moderation.manage": "Moderate community posts and reports",
    "booking.read_all": "View all bookings, payments and refunds",
    "user.manage": "Enable or disable user accounts",
    "analytics.read": "View analytics and monitoring",
}
ADDED_ROLE_PERMISSIONS = {"admin": list(ADDED_PERMISSIONS), "super_admin": list(ADDED_PERMISSIONS)}

UPGRADE_SQL = """
CREATE TABLE jobs (
    id UUID NOT NULL,
    kind VARCHAR(48) NOT NULL,
    payload JSONB NOT NULL,
    run_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(16) NOT NULL,
    attempts SMALLINT DEFAULT 0 NOT NULL,
    max_attempts SMALLINT DEFAULT 5 NOT NULL,
    last_error TEXT,
    dedupe_key VARCHAR(160),
    locked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_jobs PRIMARY KEY (id),
    CONSTRAINT uq_jobs_dedupe_key UNIQUE (dedupe_key),
    CONSTRAINT ck_jobs_status CHECK (status IN ('pending', 'running', 'done', 'failed', 'dead', 'cancelled'))
);
CREATE INDEX ix_jobs_due ON jobs (status, run_at);

CREATE TABLE notification_preferences (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    channel VARCHAR(16) NOT NULL,
    enabled BOOLEAN NOT NULL,
    language VARCHAR(8) DEFAULT 'en' NOT NULL,
    quiet_start SMALLINT,
    quiet_end SMALLINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_notification_preferences PRIMARY KEY (id),
    CONSTRAINT uq_notification_preferences_user_channel UNIQUE (user_id, channel),
    CONSTRAINT fk_notification_preferences_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_preferences_channel CHECK (channel IN ('in_app', 'email', 'webpush', 'whatsapp')),
    CONSTRAINT ck_notification_preferences_quiet CHECK (
        (quiet_start IS NULL AND quiet_end IS NULL) OR
        (quiet_start BETWEEN 0 AND 1439 AND quiet_end BETWEEN 0 AND 1439))
);

CREATE TABLE journey_reminders (
    id UUID NOT NULL,
    booking_id UUID NOT NULL,
    kind VARCHAR(16) NOT NULL,
    offset_minutes INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL,
    CONSTRAINT pk_journey_reminders PRIMARY KEY (id),
    CONSTRAINT uq_journey_reminders_booking_kind_offset UNIQUE (booking_id, kind, offset_minutes),
    CONSTRAINT fk_journey_reminders_booking_id_bookings FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
    CONSTRAINT ck_journey_reminders_kind CHECK (kind IN ('departure', 'arrival'))
);

CREATE TABLE notification_schedules (
    id UUID NOT NULL,
    reminder_id UUID NOT NULL,
    user_id UUID NOT NULL,
    fire_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_notification_schedules PRIMARY KEY (id),
    CONSTRAINT fk_notification_schedules_reminder_id_journey_reminders FOREIGN KEY (reminder_id) REFERENCES journey_reminders (id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_schedules_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_schedules_status CHECK (status IN ('scheduled', 'enqueued', 'cancelled', 'skipped'))
);
CREATE INDEX ix_notification_schedules_due ON notification_schedules (status, fire_at);
CREATE UNIQUE INDEX uq_notification_schedules_live ON notification_schedules (reminder_id) WHERE status = 'scheduled';

CREATE TABLE notification_outbox (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    schedule_id UUID,
    channel VARCHAR(16) NOT NULL,
    template VARCHAR(48) NOT NULL,
    language VARCHAR(8) NOT NULL,
    payload JSONB NOT NULL,
    dedupe_key VARCHAR(160) NOT NULL,
    status VARCHAR(16) NOT NULL,
    attempts SMALLINT DEFAULT 0 NOT NULL,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_notification_outbox PRIMARY KEY (id),
    CONSTRAINT uq_notification_outbox_dedupe_key UNIQUE (dedupe_key),
    CONSTRAINT fk_notification_outbox_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_outbox_schedule_id_notification_schedules FOREIGN KEY (schedule_id) REFERENCES notification_schedules (id) ON DELETE SET NULL,
    CONSTRAINT ck_notification_outbox_status CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'dead'))
);
CREATE INDEX ix_notification_outbox_due ON notification_outbox (status, next_attempt_at);

CREATE TABLE notification_delivery_logs (
    id UUID NOT NULL,
    outbox_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    provider_message_id VARCHAR(128),
    error TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_notification_delivery_logs PRIMARY KEY (id),
    CONSTRAINT fk_notification_delivery_logs_outbox_id_notification_outbox FOREIGN KEY (outbox_id) REFERENCES notification_outbox (id) ON DELETE CASCADE
);
CREATE INDEX ix_notification_delivery_logs_outbox_id ON notification_delivery_logs (outbox_id);

CREATE TABLE device_registrations (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    kind VARCHAR(16) NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT,
    auth TEXT,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    expired_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_device_registrations PRIMARY KEY (id),
    CONSTRAINT uq_device_registrations_endpoint UNIQUE (endpoint),
    CONSTRAINT fk_device_registrations_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_device_registrations_kind CHECK (kind IN ('webpush', 'android'))
);
CREATE INDEX ix_device_registrations_user_id ON device_registrations (user_id);

CREATE TABLE in_app_notifications (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    link VARCHAR(200),
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_in_app_notifications PRIMARY KEY (id),
    CONSTRAINT fk_in_app_notifications_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_in_app_notifications_user_read ON in_app_notifications (user_id, read_at);

CREATE TABLE travel_communities (
    id UUID NOT NULL,
    train_number VARCHAR(8) NOT NULL,
    journey_date DATE NOT NULL,
    title VARCHAR(160) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_travel_communities PRIMARY KEY (id),
    CONSTRAINT uq_travel_communities_train_date UNIQUE (train_number, journey_date)
);

CREATE TABLE community_members (
    id UUID NOT NULL,
    community_id UUID NOT NULL,
    user_id UUID NOT NULL,
    alias VARCHAR(40) NOT NULL,
    notify_cancellations BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_community_members PRIMARY KEY (id),
    CONSTRAINT uq_community_members_community_user UNIQUE (community_id, user_id),
    CONSTRAINT fk_community_members_community_id_travel_communities FOREIGN KEY (community_id) REFERENCES travel_communities (id) ON DELETE CASCADE,
    CONSTRAINT fk_community_members_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE community_posts (
    id UUID NOT NULL,
    community_id UUID NOT NULL,
    author_id UUID,
    kind VARCHAR(16) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    moderation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_community_posts PRIMARY KEY (id),
    CONSTRAINT fk_community_posts_community_id_travel_communities FOREIGN KEY (community_id) REFERENCES travel_communities (id) ON DELETE CASCADE,
    CONSTRAINT fk_community_posts_author_id_users FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_community_posts_status CHECK (status IN ('visible', 'held', 'removed')),
    CONSTRAINT ck_community_posts_kind CHECK (kind IN ('post', 'tip', 'system'))
);
CREATE INDEX ix_community_posts_community_id ON community_posts (community_id);

CREATE TABLE community_reports (
    id UUID NOT NULL,
    post_id UUID,
    reported_user_id UUID,
    reporter_id UUID,
    reason VARCHAR(32) NOT NULL,
    details TEXT,
    status VARCHAR(16) NOT NULL,
    resolved_by UUID,
    resolution TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_community_reports PRIMARY KEY (id),
    CONSTRAINT fk_community_reports_post_id_community_posts FOREIGN KEY (post_id) REFERENCES community_posts (id) ON DELETE SET NULL,
    CONSTRAINT fk_community_reports_reported_user_id_users FOREIGN KEY (reported_user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_community_reports_reporter_id_users FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_community_reports_resolved_by_users FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_community_reports_status CHECK (status IN ('open', 'resolved', 'dismissed'))
);
CREATE INDEX ix_community_reports_status ON community_reports (status);

CREATE TABLE user_blocks (
    id UUID NOT NULL,
    blocker_id UUID NOT NULL,
    blocked_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_user_blocks PRIMARY KEY (id),
    CONSTRAINT uq_user_blocks_pair UNIQUE (blocker_id, blocked_id),
    CONSTRAINT fk_user_blocks_blocker_id_users FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_blocks_blocked_id_users FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE contact_share_requests (
    id UUID NOT NULL,
    requester_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    community_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    responded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_contact_share_requests PRIMARY KEY (id),
    CONSTRAINT fk_contact_share_requests_requester_id_users FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_contact_share_requests_recipient_id_users FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_contact_share_requests_community_id_travel_communities FOREIGN KEY (community_id) REFERENCES travel_communities (id) ON DELETE CASCADE,
    CONSTRAINT ck_contact_share_requests_status CHECK (status IN ('pending', 'accepted', 'declined'))
);
CREATE UNIQUE INDEX uq_contact_share_requests_open ON contact_share_requests (requester_id, recipient_id) WHERE status = 'pending';

CREATE TABLE service_charge_configs (
    id UUID NOT NULL,
    kind VARCHAR(8) NOT NULL,
    value INTEGER NOT NULL,
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by UUID,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_service_charge_configs PRIMARY KEY (id),
    CONSTRAINT fk_service_charge_configs_created_by_users FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_service_charge_configs_kind CHECK (kind IN ('flat', 'percent')),
    CONSTRAINT ck_service_charge_configs_value CHECK (value >= 0)
);

CREATE TABLE app_settings (
    key VARCHAR(64) NOT NULL,
    value JSONB NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_app_settings PRIMARY KEY (key),
    CONSTRAINT fk_app_settings_updated_by_users FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO service_charge_configs (id, kind, value, effective_from, note)
VALUES (gen_random_uuid(), 'flat', 0, now(), 'ADR 007: no service charge in v1');
INSERT INTO app_settings (key, value) VALUES
 ('whatsapp_mode', '"dry_run"'),
 ('community_enabled', 'true'),
 ('default_reminder_offsets', '[1440, 360, 120, 60, 30, 0]');
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS app_settings, service_charge_configs, contact_share_requests, user_blocks,
    community_reports, community_posts, community_members, travel_communities, in_app_notifications,
    device_registrations, notification_delivery_logs, notification_outbox, notification_schedules,
    journey_reminders, notification_preferences, jobs;
"""


def seed_sql() -> str:
    stmts = [f"INSERT INTO permissions (id, code, description) VALUES (gen_random_uuid(), '{c}', '{d}');"
             for c, d in ADDED_PERMISSIONS.items()]
    for role, perms in ADDED_ROLE_PERMISSIONS.items():
        codes = ", ".join(f"'{c}'" for c in perms)
        stmts.append("INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, "
                     f"permissions p WHERE r.code = '{role}' AND p.code IN ({codes});")
    return "\n".join(stmts)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)
    op.execute(seed_sql())


def downgrade() -> None:
    codes = ", ".join(f"'{c}'" for c in ADDED_PERMISSIONS)
    op.execute(f"DELETE FROM permissions WHERE code IN ({codes});")
    op.execute(DOWNGRADE_SQL)
