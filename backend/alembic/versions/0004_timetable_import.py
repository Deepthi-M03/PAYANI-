"""Timetable import: import history with provenance, and catalogue columns for imported data.

* `timetable_imports` keeps every import attempt (accepted, rejected or failed) with its
  source, licence, publication date, file fingerprint, counts and validation report.
* Imported stations may have no position, so `stations.lat/lon/state` become nullable.
* Imported and synthetic trains can share a number, so uniqueness moves to (source, number).
* `train_stops.distance_km` becomes nullable: some sources only publish the total distance.

Revision ID: 0004_timetable_import
Revises: 0003_pulse_connect_admin
Create Date: 2026-11-27
"""

from alembic import op

revision = "0004_timetable_import"
down_revision = "0003_pulse_connect_admin"
branch_labels = None
depends_on = None

STATES = ("validating", "rejected", "failed", "active", "superseded", "unchanged", "withdrawn")

UPGRADE_SQL = f"""
CREATE TABLE timetable_imports (
    id UUID NOT NULL,
    source_key VARCHAR(48) NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    licence TEXT NOT NULL,
    licence_url TEXT,
    published_on DATE NOT NULL,
    published_note TEXT,
    retrieved_on DATE,
    official BOOLEAN NOT NULL,
    file_name TEXT NOT NULL,
    file_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    counts JSONB DEFAULT '{{}}'::jsonb NOT NULL,
    report JSONB DEFAULT '{{}}'::jsonb NOT NULL,
    error TEXT,
    imported_by UUID,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    activated_at TIMESTAMP WITH TIME ZONE,
    superseded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_timetable_imports PRIMARY KEY (id),
    CONSTRAINT ck_timetable_imports_status CHECK (status IN {STATES!r})
);
CREATE INDEX ix_timetable_imports_file_sha256 ON timetable_imports (file_sha256);
CREATE INDEX ix_timetable_imports_started_at ON timetable_imports (started_at);
CREATE UNIQUE INDEX uq_timetable_imports_one_active ON timetable_imports (status) WHERE status = 'active';

ALTER TABLE stations ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE stations ALTER COLUMN lon DROP NOT NULL;
ALTER TABLE stations ALTER COLUMN state DROP NOT NULL;
ALTER TABLE stations ADD COLUMN zone VARCHAR(16);

ALTER TABLE trains DROP CONSTRAINT uq_trains_number;
ALTER TABLE trains ADD CONSTRAINT uq_trains_source_number UNIQUE (source, number);
ALTER TABLE trains ADD COLUMN dataset_id UUID;
ALTER TABLE trains ADD COLUMN running_days_known BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE trains ADD COLUMN distance_basis VARCHAR(16) DEFAULT 'source' NOT NULL;
ALTER TABLE trains ADD CONSTRAINT fk_trains_dataset_id_timetable_imports
    FOREIGN KEY (dataset_id) REFERENCES timetable_imports (id);
CREATE INDEX ix_trains_dataset_id ON trains (dataset_id);

ALTER TABLE train_stops ALTER COLUMN distance_km DROP NOT NULL;
"""

# Downgrade removes imported data (the earlier schema cannot hold it) and keeps the synthetic catalogue.
DOWNGRADE_SQL = """
DELETE FROM trains WHERE dataset_id IS NOT NULL;
DELETE FROM stations s WHERE NOT EXISTS (SELECT 1 FROM train_stops t WHERE t.station_code = s.code)
    AND (s.lat IS NULL OR s.lon IS NULL OR s.state IS NULL);
UPDATE stations SET state = '' WHERE state IS NULL;
DELETE FROM train_stops WHERE distance_km IS NULL;

ALTER TABLE train_stops ALTER COLUMN distance_km SET NOT NULL;

DROP INDEX ix_trains_dataset_id;
ALTER TABLE trains DROP CONSTRAINT fk_trains_dataset_id_timetable_imports;
ALTER TABLE trains DROP COLUMN distance_basis;
ALTER TABLE trains DROP COLUMN running_days_known;
ALTER TABLE trains DROP COLUMN dataset_id;
ALTER TABLE trains DROP CONSTRAINT uq_trains_source_number;
ALTER TABLE trains ADD CONSTRAINT uq_trains_number UNIQUE (number);

ALTER TABLE stations DROP COLUMN zone;
ALTER TABLE stations ALTER COLUMN state SET NOT NULL;
ALTER TABLE stations ALTER COLUMN lon SET NOT NULL;
ALTER TABLE stations ALTER COLUMN lat SET NOT NULL;

DROP TABLE timetable_imports;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
