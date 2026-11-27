"""PAYANI BOOK: catalogue, booking policies, groups, searches, bookings, payments,
cancellations, refunds and idempotency keys.

Revision ID: 0002_book
Revises: 0001_foundation
Create Date: 2026-11-26
"""

from alembic import op

revision = "0002_book"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None

BOOKING_STATES = (
    "DRAFT", "SEARCHED", "PENDING_CONFIRMATION", "CONFIRMED", "FAILED",
    "CANCELLATION_REQUESTED", "CANCELLED", "REFUND_PENDING", "REFUNDED",
)

UPGRADE_SQL = f"""
CREATE TABLE stations (
    id UUID NOT NULL,
    code VARCHAR(8) NOT NULL,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    source VARCHAR(48) NOT NULL,
    CONSTRAINT pk_stations PRIMARY KEY (id),
    CONSTRAINT uq_stations_code UNIQUE (code)
);

CREATE TABLE trains (
    id UUID NOT NULL,
    number VARCHAR(8) NOT NULL,
    name TEXT NOT NULL,
    kind VARCHAR(24) NOT NULL,
    running_days SMALLINT NOT NULL,
    classes VARCHAR(64) NOT NULL,
    source VARCHAR(48) NOT NULL,
    snapshot DATE NOT NULL,
    CONSTRAINT pk_trains PRIMARY KEY (id),
    CONSTRAINT uq_trains_number UNIQUE (number),
    CONSTRAINT ck_trains_running_days CHECK (running_days BETWEEN 1 AND 127)
);

CREATE TABLE train_stops (
    id UUID NOT NULL,
    train_id UUID NOT NULL,
    seq SMALLINT NOT NULL,
    station_code VARCHAR(8) NOT NULL,
    arr_min INTEGER,
    dep_min INTEGER,
    distance_km INTEGER NOT NULL,
    CONSTRAINT pk_train_stops PRIMARY KEY (id),
    CONSTRAINT uq_train_stops_train_seq UNIQUE (train_id, seq),
    CONSTRAINT fk_train_stops_train_id_trains FOREIGN KEY (train_id) REFERENCES trains (id) ON DELETE CASCADE,
    CONSTRAINT fk_train_stops_station_code_stations FOREIGN KEY (station_code) REFERENCES stations (code),
    CONSTRAINT ck_train_stops_times CHECK (arr_min IS NOT NULL OR dep_min IS NOT NULL)
);
CREATE INDEX ix_train_stops_station_code ON train_stops (station_code);

CREATE TABLE provider_sync_runs (
    id UUID NOT NULL,
    provider VARCHAR(48) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    rows INTEGER NOT NULL,
    as_of DATE NOT NULL,
    licence TEXT NOT NULL,
    source_url TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_provider_sync_runs PRIMARY KEY (id)
);

CREATE TABLE booking_policies (
    id UUID NOT NULL,
    quota VARCHAR(16) NOT NULL,
    label VARCHAR(64) NOT NULL,
    max_passengers_per_pnr SMALLINT NOT NULL,
    source_url TEXT NOT NULL,
    verified_at DATE NOT NULL,
    note TEXT,
    CONSTRAINT pk_booking_policies PRIMARY KEY (id),
    CONSTRAINT uq_booking_policies_quota UNIQUE (quota),
    CONSTRAINT ck_booking_policies_cap CHECK (max_passengers_per_pnr BETWEEN 1 AND 12)
);

CREATE TABLE groups (
    id UUID NOT NULL,
    owner_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL,
    from_code VARCHAR(8),
    to_code VARCHAR(8),
    journey_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_groups PRIMARY KEY (id),
    CONSTRAINT fk_groups_owner_id_users FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_groups_owner_id ON groups (owner_id);

CREATE TABLE group_members (
    id UUID NOT NULL,
    group_id UUID NOT NULL,
    user_id UUID,
    name VARCHAR(80) NOT NULL,
    family VARCHAR(80) NOT NULL,
    is_minor BOOLEAN NOT NULL,
    berth_preference VARCHAR(16),
    role VARCHAR(8) DEFAULT 'member' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_group_members PRIMARY KEY (id),
    CONSTRAINT fk_group_members_group_id_groups FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_group_members_role CHECK (role IN ('owner', 'member'))
);
CREATE INDEX ix_group_members_group_id ON group_members (group_id);
CREATE UNIQUE INDEX uq_group_members_group_user ON group_members (group_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE group_invitations (
    id UUID NOT NULL,
    group_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    created_by UUID,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_group_invitations PRIMARY KEY (id),
    CONSTRAINT uq_group_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_group_invitations_group_id_groups FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
    CONSTRAINT fk_group_invitations_created_by_users FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_group_invitations_accepted_by_users FOREIGN KEY (accepted_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE journey_searches (
    id UUID NOT NULL,
    user_id UUID,
    params JSONB NOT NULL,
    result_count INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_journey_searches PRIMARY KEY (id),
    CONSTRAINT fk_journey_searches_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX ix_journey_searches_created_at ON journey_searches (created_at);

CREATE TABLE bookings (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    group_id UUID,
    batch_index SMALLINT,
    provider VARCHAR(32) NOT NULL,
    provider_mode VARCHAR(8) NOT NULL,
    provider_ref VARCHAR(32),
    status VARCHAR(32) NOT NULL,
    quota VARCHAR(16) NOT NULL,
    travel_class VARCHAR(4) NOT NULL,
    from_code VARCHAR(8) NOT NULL,
    to_code VARCHAR(8) NOT NULL,
    journey_date DATE NOT NULL,
    departure_at TIMESTAMP WITH TIME ZONE NOT NULL,
    journey JSONB NOT NULL,
    fare_paise INTEGER NOT NULL,
    service_charge_paise INTEGER DEFAULT 0 NOT NULL,
    total_paise INTEGER NOT NULL,
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_bookings PRIMARY KEY (id),
    CONSTRAINT uq_bookings_provider_ref UNIQUE (provider_ref),
    CONSTRAINT fk_bookings_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_bookings_group_id_groups FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE SET NULL,
    CONSTRAINT ck_bookings_status CHECK (status IN {BOOKING_STATES!r}),
    CONSTRAINT ck_bookings_provider_mode CHECK (provider_mode IN ('sandbox', 'live')),
    CONSTRAINT ck_bookings_amounts CHECK (fare_paise >= 0 AND service_charge_paise >= 0
        AND total_paise = fare_paise + service_charge_paise)
);
CREATE INDEX ix_bookings_user_journey ON bookings (user_id, journey_date);
CREATE INDEX ix_bookings_status ON bookings (status);

CREATE TABLE booking_passengers (
    id UUID NOT NULL,
    booking_id UUID NOT NULL,
    group_member_id UUID,
    name VARCHAR(80) NOT NULL,
    age_band VARCHAR(16) NOT NULL,
    is_minor BOOLEAN NOT NULL,
    berth_preference VARCHAR(16),
    status VARCHAR(16) DEFAULT 'pending' NOT NULL,
    coach VARCHAR(8),
    berth VARCHAR(8),
    CONSTRAINT pk_booking_passengers PRIMARY KEY (id),
    CONSTRAINT fk_booking_passengers_booking_id_bookings FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
    CONSTRAINT fk_booking_passengers_group_member_id_group_members FOREIGN KEY (group_member_id) REFERENCES group_members (id) ON DELETE SET NULL,
    CONSTRAINT ck_booking_passengers_status CHECK (status IN ('pending', 'confirmed', 'waitlisted', 'cancelled'))
);
CREATE INDEX ix_booking_passengers_booking_id ON booking_passengers (booking_id);

CREATE TABLE booking_events (
    id UUID NOT NULL,
    booking_id UUID NOT NULL,
    event VARCHAR(48) NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    actor VARCHAR(16) NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_booking_events PRIMARY KEY (id),
    CONSTRAINT fk_booking_events_booking_id_bookings FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
);
CREATE INDEX ix_booking_events_booking_id ON booking_events (booking_id);

CREATE TABLE payments (
    id UUID NOT NULL,
    booking_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_mode VARCHAR(8) NOT NULL,
    provider_payment_id VARCHAR(64) NOT NULL,
    amount_paise INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR' NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_payments PRIMARY KEY (id),
    CONSTRAINT uq_payments_provider_payment UNIQUE (provider, provider_payment_id),
    CONSTRAINT fk_payments_booking_id_bookings FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
    CONSTRAINT ck_payments_status CHECK (status IN ('created', 'succeeded', 'failed', 'refunded')),
    CONSTRAINT ck_payments_amount CHECK (amount_paise >= 0)
);
CREATE INDEX ix_payments_booking_id ON payments (booking_id);

CREATE TABLE refunds (
    id UUID NOT NULL,
    payment_id UUID NOT NULL,
    amount_paise INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL,
    provider_refund_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_refunds PRIMARY KEY (id),
    CONSTRAINT fk_refunds_payment_id_payments FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE,
    CONSTRAINT ck_refunds_status CHECK (status IN ('pending', 'succeeded', 'failed'))
);
CREATE INDEX ix_refunds_payment_id ON refunds (payment_id);

CREATE TABLE refund_tracking (
    id UUID NOT NULL,
    refund_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL,
    note TEXT NOT NULL,
    source VARCHAR(16) NOT NULL,
    observed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_refund_tracking PRIMARY KEY (id),
    CONSTRAINT fk_refund_tracking_refund_id_refunds FOREIGN KEY (refund_id) REFERENCES refunds (id) ON DELETE CASCADE
);
CREATE INDEX ix_refund_tracking_refund_id ON refund_tracking (refund_id);

CREATE TABLE cancellation_requests (
    id UUID NOT NULL,
    booking_id UUID NOT NULL,
    requested_by UUID,
    reason TEXT,
    status VARCHAR(16) NOT NULL,
    official_reference VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_cancellation_requests PRIMARY KEY (id),
    CONSTRAINT fk_cancellation_requests_booking_id_bookings FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
    CONSTRAINT fk_cancellation_requests_requested_by_users FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_cancellation_requests_status CHECK (status IN ('requested', 'completed', 'rejected'))
);
CREATE UNIQUE INDEX uq_cancellation_requests_open ON cancellation_requests (booking_id) WHERE status = 'requested';

CREATE TABLE idempotency_keys (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    endpoint VARCHAR(64) NOT NULL,
    key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status_code SMALLINT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    CONSTRAINT pk_idempotency_keys PRIMARY KEY (id),
    CONSTRAINT uq_idempotency_keys_scope UNIQUE (user_id, endpoint, key),
    CONSTRAINT fk_idempotency_keys_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO booking_policies (id, quota, label, max_passengers_per_pnr, source_url, verified_at, note) VALUES
 (gen_random_uuid(), 'GN', 'General', 6,
  'https://www.rrb.iitk.ac.in/sathee-railway-exams/student-corner/railway-gk/indian-railway-features/technology-irctc-services-guide',
  '2026-11-26', 'Secondary source only; confirm against an official IRCTC page before relying on it.'),
 (gen_random_uuid(), 'TQ', 'Tatkal', 4,
  'https://www.ixigo.com/trains/tatkal-railway-reservation',
  '2026-11-26', 'Consistently reported by several sources; not read from an IRCTC page.');
"""

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS idempotency_keys, cancellation_requests, refund_tracking, refunds, payments,
    booking_events, booking_passengers, bookings, journey_searches, group_invitations,
    group_members, groups, booking_policies, provider_sync_runs, train_stops, trains, stations;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
