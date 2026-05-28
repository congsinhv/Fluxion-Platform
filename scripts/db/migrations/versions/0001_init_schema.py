"""init schema

Revision ID: 0001
Revises:
Create Date: 2026-05-25 12:00:00

Initial schema for Fluxion MDM. 9 tables + extensions + triggers.

Drift reconciliation (from validation session):
- tacs uses uuid PK + tac char(8) UNIQUE (matches test-fixtures.sql)
- devices.tac_id is uuid FK to tacs.id (not natural-key tac)
- devices has api_key_hash for DPC /checkin auth
- milestones.requested_by_id (not requested_by_user_id)
- imei/tac match enforced at app layer (FK is uuid so no substring check)
"""

from __future__ import annotations

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_trgm"')

    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # services
    op.execute("""
        CREATE TABLE services (
            id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            type        text        NOT NULL UNIQUE,
            name        text        NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT NOW(),
            updated_at  timestamptz NOT NULL DEFAULT NOW(),
            deleted_at  timestamptz
        );
        CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # states
    op.execute("""
        CREATE TABLE states (
            id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            type        text        NOT NULL UNIQUE,
            service_id  uuid        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
            name        text        NOT NULL,
            color       text,
            description text,
            created_at  timestamptz NOT NULL DEFAULT NOW(),
            updated_at  timestamptz NOT NULL DEFAULT NOW(),
            deleted_at  timestamptz
        );
        CREATE INDEX idx_states_service ON states(service_id) WHERE deleted_at IS NULL;
        CREATE TRIGGER trg_states_updated BEFORE UPDATE ON states
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # message_templates (must precede actions FK)
    op.execute("""
        CREATE TABLE message_templates (
            id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            service_id            uuid        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
            title                 text        NOT NULL,
            content               text        NOT NULL,
            type                  text        NOT NULL CHECK (type IN ('POPUP', 'FULLSCREEN')),
            header_icon_url       text,
            notification_icon_url text,
            created_at            timestamptz NOT NULL DEFAULT NOW(),
            updated_at            timestamptz NOT NULL DEFAULT NOW(),
            deleted_at            timestamptz
        );
        CREATE INDEX idx_templates_service ON message_templates(service_id) WHERE deleted_at IS NULL;
        CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON message_templates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # actions
    op.execute("""
        CREATE TABLE actions (
            id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            type                 text        NOT NULL UNIQUE,
            service_id           uuid        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
            name                 text        NOT NULL,
            from_state_id        uuid        REFERENCES states(id) ON DELETE RESTRICT,
            target_state_id      uuid        REFERENCES states(id) ON DELETE RESTRICT,
            actor                text        NOT NULL CHECK (actor IN ('OPERATOR', 'SYSTEM')),
            default_template_id  uuid        REFERENCES message_templates(id) ON DELETE SET NULL,
            template_required    boolean     NOT NULL DEFAULT FALSE,
            description          text,
            created_at           timestamptz NOT NULL DEFAULT NOW(),
            updated_at           timestamptz NOT NULL DEFAULT NOW(),
            deleted_at           timestamptz
        );
        CREATE INDEX idx_actions_service ON actions(service_id) WHERE deleted_at IS NULL;
        CREATE INDEX idx_actions_from_state ON actions(from_state_id) WHERE deleted_at IS NULL;
        CREATE TRIGGER trg_actions_updated BEFORE UPDATE ON actions
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # tacs — uuid PK to match fixtures; tac is UNIQUE secondary key
    op.execute("""
        CREATE TABLE tacs (
            id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            tac           char(8)     NOT NULL UNIQUE,
            provider      text        NOT NULL DEFAULT 'DPC',
            manufacturer  text        NOT NULL,
            model         text        NOT NULL,
            created_at    timestamptz NOT NULL DEFAULT NOW(),
            updated_at    timestamptz NOT NULL DEFAULT NOW(),
            deleted_at    timestamptz,

            CONSTRAINT chk_tac_digits CHECK (tac ~ '^[0-9]{8}$'),
            CONSTRAINT chk_manuf_google CHECK (manufacturer = 'Google')
        );
        CREATE INDEX idx_tacs_manuf_trgm ON tacs USING gin (manufacturer gin_trgm_ops);
        CREATE INDEX idx_tacs_model_trgm ON tacs USING gin (model gin_trgm_ops);
        CREATE TRIGGER trg_tacs_updated BEFORE UPDATE ON tacs
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # users
    op.execute("""
        CREATE TABLE users (
            id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            cognito_sub   text        NOT NULL UNIQUE,
            email         text        NOT NULL UNIQUE,
            display_name  text,
            created_at    timestamptz NOT NULL DEFAULT NOW(),
            updated_at    timestamptz NOT NULL DEFAULT NOW(),
            deleted_at    timestamptz
        );
        CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # devices — tac_id uuid FK, api_key_hash, etc.
    op.execute("""
        CREATE TABLE devices (
            id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            imei                char(15)    NOT NULL UNIQUE,
            tac_id              uuid        NOT NULL REFERENCES tacs(id) ON DELETE RESTRICT,
            service_id          uuid        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
            current_state_id    uuid        NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
            assigned_action_id  uuid        REFERENCES actions(id) ON DELETE SET NULL,
            api_key_hash        text,
            fcm_token           text,
            info                jsonb       NOT NULL DEFAULT '{}'::jsonb,
            first_checkin_at    timestamptz,
            last_checkin_at     timestamptz,
            created_at          timestamptz NOT NULL DEFAULT NOW(),
            updated_at          timestamptz NOT NULL DEFAULT NOW(),
            deleted_at          timestamptz,

            CONSTRAINT chk_imei_digits CHECK (imei ~ '^[0-9]{15}$')
        );
        CREATE INDEX idx_devices_state ON devices(current_state_id) WHERE deleted_at IS NULL;
        CREATE INDEX idx_devices_service_state ON devices(service_id, current_state_id) WHERE deleted_at IS NULL;
        CREATE INDEX idx_devices_last_checkin ON devices(last_checkin_at) WHERE deleted_at IS NULL;
        CREATE INDEX idx_devices_info ON devices USING gin (info);
        CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # milestones — requested_by_id
    op.execute("""
        CREATE TABLE milestones (
            id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            device_id         uuid        NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
            action_id         uuid        NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
            event_type        text        NOT NULL CHECK (event_type IN ('REQUESTED', 'APPLIED', 'FAILED')),
            from_state_id     uuid        REFERENCES states(id) ON DELETE RESTRICT,
            to_state_id       uuid        REFERENCES states(id) ON DELETE RESTRICT,
            template_id       uuid        REFERENCES message_templates(id) ON DELETE SET NULL,
            requested_by_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
            payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
            created_at        timestamptz NOT NULL DEFAULT NOW(),
            updated_at        timestamptz NOT NULL DEFAULT NOW(),
            deleted_at        timestamptz
        );
        CREATE INDEX idx_milestones_device_time ON milestones(device_id, created_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX idx_milestones_pairing ON milestones(device_id, action_id, created_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX idx_milestones_payload ON milestones USING gin (payload);
        CREATE INDEX idx_milestones_template ON milestones(template_id) WHERE template_id IS NOT NULL;
        CREATE INDEX idx_milestones_pending ON milestones(event_type, created_at)
            WHERE event_type = 'REQUESTED' AND deleted_at IS NULL;
        CREATE TRIGGER trg_milestones_updated BEFORE UPDATE ON milestones
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)

    # device_uploads
    op.execute("""
        CREATE TABLE device_uploads (
            id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            source       text        NOT NULL CHECK (source IN ('SINGLE', 'BATCH')),
            status       text        NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
            uploaded_by  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            imei_input   char(15),
            file_name    text,
            result       jsonb       NOT NULL DEFAULT '{}'::jsonb,
            created_at   timestamptz NOT NULL DEFAULT NOW(),
            updated_at   timestamptz NOT NULL DEFAULT NOW(),
            deleted_at   timestamptz
        );
        CREATE INDEX idx_device_uploads_status ON device_uploads(status, created_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX idx_device_uploads_user ON device_uploads(uploaded_by, created_at DESC) WHERE deleted_at IS NULL;
        CREATE INDEX idx_device_uploads_result ON device_uploads USING gin (result);
        CREATE TRIGGER trg_device_uploads_updated BEFORE UPDATE ON device_uploads
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS device_uploads CASCADE")
    op.execute("DROP TABLE IF EXISTS milestones CASCADE")
    op.execute("DROP TABLE IF EXISTS devices CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.execute("DROP TABLE IF EXISTS tacs CASCADE")
    op.execute("DROP TABLE IF EXISTS actions CASCADE")
    op.execute("DROP TABLE IF EXISTS message_templates CASCADE")
    op.execute("DROP TABLE IF EXISTS states CASCADE")
    op.execute("DROP TABLE IF EXISTS services CASCADE")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at() CASCADE")
