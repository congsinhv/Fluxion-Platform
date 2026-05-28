"""Database — thin psycopg wrapper with the methods the checkin Lambda needs.

Connection is single global, cached at module scope, dict_row + autocommit=True.
Multi-statement writes use `with db.conn.transaction():` (psycopg native context).
All values bound via %(name)s — never f-string-interpolated into SQL.
"""

from __future__ import annotations

import json
import threading
import uuid

import config
import psycopg
from psycopg.rows import dict_row

_conn: psycopg.Connection | None = None
_lock = threading.Lock()


def _build_url() -> str:
    if config.DATABASE_URL:
        return config.DATABASE_URL
    if not config.DB_SECRET_ARN or not config.DB_ENDPOINT:
        raise RuntimeError("DB_SECRET_ARN and DB_ENDPOINT required when DATABASE_URL is unset")
    raw = config.secretsmanager().get_secret_value(SecretId=config.DB_SECRET_ARN)["SecretString"]
    s = json.loads(raw)
    return (
        f"postgresql://{s['username']}:{s['password']}"
        f"@{config.DB_ENDPOINT}:5432/{s.get('dbname', 'fluxion')}"
    )


def _get_conn() -> psycopg.Connection:
    global _conn
    if _conn is not None and not _conn.closed and not _conn.broken:
        return _conn
    with _lock:
        if _conn is None or _conn.closed or _conn.broken:
            _conn = psycopg.connect(_build_url(), row_factory=dict_row, autocommit=True)
    return _conn


class Database:
    def __init__(self) -> None:
        self.conn = _get_conn()

    def _fetch_one(self, query: str, params: dict | None = None) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute(query, params or {})
            return cur.fetchone()

    def _execute(self, query: str, params: dict | None = None) -> None:
        with self.conn.cursor() as cur:
            cur.execute(query, params or {})

    # ---- States / Actions / Templates ----
    def get_state_by_type(self, type_: str) -> dict | None:
        query = """
            SELECT id, type, name
            FROM states
            WHERE type = %(type)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"type": type_})

    def get_action_by_type(self, type_: str) -> dict | None:
        query = """
            SELECT
                id,
                type,
                name,
                actor,
                template_required,
                from_state_id,
                target_state_id,
                default_template_id
            FROM actions
            WHERE type = %(type)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"type": type_})

    def get_action_by_id(self, action_id: str | uuid.UUID) -> dict | None:
        query = """
            SELECT
                id,
                type,
                name,
                actor,
                template_required,
                from_state_id,
                target_state_id,
                default_template_id
            FROM actions
            WHERE id = %(id)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"id": str(action_id)})

    def get_message_template(self, template_id: str | uuid.UUID) -> dict | None:
        query = """
            SELECT
                id,
                title,
                content,
                type,
                header_icon_url,
                notification_icon_url
            FROM message_templates
            WHERE id = %(id)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"id": str(template_id)})

    # ---- Devices ----
    def lock_device_by_imei(self, imei: str) -> dict | None:
        query = """
            SELECT
                id,
                imei,
                tac_id,
                service_id,
                current_state_id,
                assigned_action_id,
                api_key_hash,
                fcm_token,
                info,
                first_checkin_at,
                last_checkin_at
            FROM devices
            WHERE imei = %(imei)s AND deleted_at IS NULL
            FOR UPDATE
        """
        return self._fetch_one(query, {"imei": imei})

    def lock_device_by_id(self, device_id: str | uuid.UUID) -> dict | None:
        query = """
            SELECT
                id,
                imei,
                tac_id,
                service_id,
                current_state_id,
                assigned_action_id,
                api_key_hash,
                fcm_token,
                info,
                first_checkin_at,
                last_checkin_at
            FROM devices
            WHERE id = %(id)s AND deleted_at IS NULL
            FOR UPDATE
        """
        return self._fetch_one(query, {"id": str(device_id)})

    def update_device_fields(self, device_id: str | uuid.UUID, **fields) -> None:
        """Set columns by name. None values are skipped (use SQL NULL via explicit COALESCE if needed)."""
        if not fields:
            return
        # Build set clause from caller-controlled column whitelist
        allowed = {
            "current_state_id",
            "assigned_action_id",
            "api_key_hash",
            "fcm_token",
            "info",
            "first_checkin_at",
            "last_checkin_at",
        }
        cols = [k for k in fields.keys() if k in allowed]
        if not cols:
            return
        set_parts = [f"{c} = %({c})s" for c in cols]
        # State transitions can cross services (REGISTER: INVENTORY → DEVICE_FINANCING).
        # When current_state_id changes, sync service_id from the new state's service
        # in the same UPDATE so the two columns can never drift apart.
        if "current_state_id" in cols:
            set_parts.append(
                "service_id = (SELECT service_id FROM states WHERE id = %(current_state_id)s)"
            )
        set_clause = ", ".join(set_parts)
        query = f"UPDATE devices SET {set_clause} WHERE id = %(id)s"
        params: dict = {"id": str(device_id)}
        for c in cols:
            v = fields[c]
            if c == "info" and isinstance(v, dict):
                params[c] = json.dumps(v)
            else:
                params[c] = v
        self._execute(query, params)

    # ---- Milestones ----
    def find_requested_by_command_id(
        self, device_id: str | uuid.UUID, command_id: str
    ) -> dict | None:
        query = """
            SELECT
                id,
                device_id,
                action_id,
                event_type,
                from_state_id,
                to_state_id,
                template_id,
                requested_by_id,
                payload,
                created_at
            FROM milestones
            WHERE device_id = %(device_id)s
                AND event_type = 'REQUESTED'
                AND payload->>'command_id' = %(cmd)s
                AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
        """
        return self._fetch_one(
            query,
            {
                "device_id": str(device_id),
                "cmd": command_id,
            },
        )

    def find_ack_milestone_after(
        self,
        device_id: str | uuid.UUID,
        action_id: str | uuid.UUID,
        after_created_at: str,
    ) -> dict | None:
        """APPLIED or FAILED milestone written after the matching REQUESTED."""
        query = """
            SELECT id, event_type, created_at
            FROM milestones
            WHERE device_id = %(device_id)s
                AND action_id = %(action_id)s
                AND event_type IN ('APPLIED', 'FAILED')
                AND created_at > %(after)s
                AND deleted_at IS NULL
            LIMIT 1
        """
        return self._fetch_one(
            query,
            {
                "device_id": str(device_id),
                "action_id": str(action_id),
                "after": after_created_at,
            },
        )

    def find_latest_requested_for_action(
        self, device_id: str | uuid.UUID, action_id: str | uuid.UUID
    ) -> dict | None:
        query = """
            SELECT
                id,
                template_id,
                requested_by_id,
                payload,
                from_state_id,
                to_state_id,
                created_at
            FROM milestones
            WHERE device_id = %(device_id)s
                AND action_id = %(action_id)s
                AND event_type = 'REQUESTED'
                AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
        """
        return self._fetch_one(
            query,
            {
                "device_id": str(device_id),
                "action_id": str(action_id),
            },
        )

    def find_applied_milestone(
        self, device_id: str | uuid.UUID, action_id: str | uuid.UUID
    ) -> dict | None:
        query = """
            SELECT id, event_type, created_at
            FROM milestones
            WHERE device_id = %(device_id)s
                AND action_id = %(action_id)s
                AND event_type = 'APPLIED'
                AND deleted_at IS NULL
            LIMIT 1
        """
        return self._fetch_one(
            query,
            {
                "device_id": str(device_id),
                "action_id": str(action_id),
            },
        )

    def insert_milestone(
        self,
        *,
        device_id: str | uuid.UUID,
        action_id: str | uuid.UUID,
        event_type: str,
        from_state_id: str | uuid.UUID | None = None,
        to_state_id: str | uuid.UUID | None = None,
        template_id: str | uuid.UUID | None = None,
        requested_by_id: str | uuid.UUID | None = None,
        payload: dict | None = None,
    ) -> dict:
        query = """
            INSERT INTO milestones (
                device_id,
                action_id,
                event_type,
                from_state_id,
                to_state_id,
                template_id,
                requested_by_id,
                payload
            )
            VALUES (
                %(device_id)s,
                %(action_id)s,
                %(event_type)s,
                %(from_state_id)s,
                %(to_state_id)s,
                %(template_id)s,
                %(requested_by_id)s,
                %(payload)s::jsonb
            )
            RETURNING id, created_at
        """
        row = self._fetch_one(
            query,
            {
                "device_id": str(device_id),
                "action_id": str(action_id),
                "event_type": event_type,
                "from_state_id": str(from_state_id) if from_state_id else None,
                "to_state_id": str(to_state_id) if to_state_id else None,
                "template_id": str(template_id) if template_id else None,
                "requested_by_id": str(requested_by_id) if requested_by_id else None,
                "payload": json.dumps(payload or {}),
            },
        )
        assert row is not None
        return row
