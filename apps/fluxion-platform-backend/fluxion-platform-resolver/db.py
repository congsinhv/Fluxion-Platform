"""Database — thin psycopg wrapper with domain methods for the resolver Lambda.

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

    # ---- primitives ----
    def _fetch_one(self, query: str, params: dict | None = None) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute(query, params or {})
            return cur.fetchone()

    def _fetch_all(self, query: str, params: dict | None = None) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute(query, params or {})
            return cur.fetchall()

    def _execute(self, query: str, params: dict | None = None) -> None:
        with self.conn.cursor() as cur:
            cur.execute(query, params or {})

    # ============================================================
    # LOOKUPS  (services, states, actions, templates, tacs, users)
    # ============================================================

    def list_services(self) -> list[dict]:
        query = """
            SELECT
                id,
                type,
                name
            FROM services
            WHERE deleted_at IS NULL
            ORDER BY type
        """
        return self._fetch_all(query)

    def list_states(self) -> list[dict]:
        query = """
            SELECT
                st.id,
                st.type,
                st.name,
                st.color,
                st.description,
                row_to_json(s.*) AS service
            FROM states st
            JOIN services s ON s.id = st.service_id
            WHERE st.deleted_at IS NULL
            ORDER BY st.type
        """
        return self._fetch_all(query)

    def list_actions(self) -> list[dict]:
        # State.service is non-null in the schema, so the from_state / target_state
        # JSON must carry a nested service. Without it AppSync sees a null on a
        # non-null field and cascades the whole fromState to null. Join services
        # twice (one per state) and merge into the state JSON via jsonb concat.
        # The CASE guards left-join misses (UPLOAD has no from_state; NOTIFY_*
        # have no target_state).
        query = """
            SELECT
                a.id,
                a.type,
                a.name,
                a.actor,
                a.template_required,
                a.description,
                row_to_json(s.*) AS service,
                CASE WHEN fs.id IS NOT NULL
                    THEN to_jsonb(fs.*) || jsonb_build_object('service', to_jsonb(fss.*))
                END AS from_state,
                CASE WHEN ts.id IS NOT NULL
                    THEN to_jsonb(ts.*) || jsonb_build_object('service', to_jsonb(tss.*))
                END AS target_state,
                row_to_json(mt.*) AS default_template
            FROM actions a
            JOIN services s ON s.id = a.service_id
            LEFT JOIN states fs    ON fs.id  = a.from_state_id
            LEFT JOIN services fss ON fss.id = fs.service_id
            LEFT JOIN states ts    ON ts.id  = a.target_state_id
            LEFT JOIN services tss ON tss.id = ts.service_id
            LEFT JOIN message_templates mt ON mt.id = a.default_template_id
            WHERE a.deleted_at IS NULL
            ORDER BY a.type
        """
        return self._fetch_all(query)

    def get_service_by_type(self, type_: str) -> dict | None:
        query = """
            SELECT id, type, name
            FROM services
            WHERE type = %(type)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"type": type_})

    def get_state_by_type(self, type_: str) -> dict | None:
        query = """
            SELECT id, type, name, color, description, service_id
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
                default_template_id,
                description
            FROM actions
            WHERE type = %(type)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"type": type_})

    def get_tac_by_code(self, tac: str) -> dict | None:
        query = """
            SELECT id, tac, provider, manufacturer, model
            FROM tacs
            WHERE tac = %(tac)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"tac": tac})

    def get_message_template(self, template_id: str | uuid.UUID) -> dict | None:
        query = """
            SELECT
                mt.id,
                mt.title,
                mt.content,
                mt.type,
                mt.header_icon_url,
                mt.notification_icon_url,
                mt.created_at,
                mt.updated_at,
                row_to_json(s.*) AS service
            FROM message_templates mt
            JOIN services s ON s.id = mt.service_id
            WHERE mt.id = %(id)s AND mt.deleted_at IS NULL
        """
        return self._fetch_one(query, {"id": str(template_id)})

    # ============================================================
    # USERS
    # ============================================================

    def get_user_by_cognito_sub(self, cognito_sub: str) -> dict | None:
        """Read-only lookup of an admin user by Cognito subject."""
        query = """
            SELECT id, cognito_sub, email, display_name
            FROM users
            WHERE cognito_sub = %(sub)s AND deleted_at IS NULL
        """
        return self._fetch_one(query, {"sub": cognito_sub})

    # ============================================================
    # DEVICES
    # ============================================================

    def _device_select(self) -> str:
        """Common SELECT body for device row with all joins flattened to JSON."""
        return """
            SELECT
                d.id,
                d.imei,
                d.info,
                d.first_checkin_at,
                d.last_checkin_at,
                d.created_at,
                d.updated_at,
                d.assigned_action_id,
                d.current_state_id,
                d.service_id,
                row_to_json(t.*) AS tac,
                row_to_json(s.*) AS service,
                row_to_json(st.*) AS current_state,
                row_to_json(a.*) AS assigned_action
            FROM devices d
            JOIN tacs t ON t.id = d.tac_id
            JOIN services s ON s.id = d.service_id
            JOIN states st ON st.id = d.current_state_id
            LEFT JOIN actions a ON a.id = d.assigned_action_id
        """

    def list_devices(
        self,
        *,
        service_type: str | None = None,
        state_type: str | None = None,
        search: str | None = None,
        after_created_at: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = (
            self._device_select()
            + """
            WHERE d.deleted_at IS NULL
                AND (%(service_type)s::text IS NULL OR s.type = %(service_type)s)
                AND (%(state_type)s::text IS NULL OR st.type = %(state_type)s)
                AND (%(search)s::text IS NULL OR d.imei LIKE %(search)s)
                AND (%(after)s::timestamptz IS NULL OR d.created_at < %(after)s)
            ORDER BY d.created_at DESC
            LIMIT %(limit)s
        """
        )
        return self._fetch_all(
            query,
            {
                "service_type": service_type,
                "state_type": state_type,
                "search": f"%{search}%" if search else None,
                "after": after_created_at,
                "limit": limit,
            },
        )

    def count_devices(
        self,
        *,
        service_type: str | None = None,
        state_type: str | None = None,
        search: str | None = None,
    ) -> int:
        query = """
            SELECT count(*) AS n
            FROM devices d
            JOIN services s ON s.id = d.service_id
            JOIN states st ON st.id = d.current_state_id
            WHERE d.deleted_at IS NULL
                AND (%(service_type)s::text IS NULL OR s.type = %(service_type)s)
                AND (%(state_type)s::text IS NULL OR st.type = %(state_type)s)
                AND (%(search)s::text IS NULL OR d.imei LIKE %(search)s)
        """
        row = self._fetch_one(
            query,
            {
                "service_type": service_type,
                "state_type": state_type,
                "search": f"%{search}%" if search else None,
            },
        )
        return row["n"] if row else 0

    def get_device_by_id(self, device_id: str | uuid.UUID) -> dict | None:
        query = (
            self._device_select()
            + """
            WHERE d.id = %(id)s AND d.deleted_at IS NULL
        """
        )
        return self._fetch_one(query, {"id": str(device_id)})

    def get_device_by_imei(self, imei: str) -> dict | None:
        query = (
            self._device_select()
            + """
            WHERE d.imei = %(imei)s AND d.deleted_at IS NULL
        """
        )
        return self._fetch_one(query, {"imei": imei})

    def lock_device_by_id(self, device_id: str | uuid.UUID) -> dict | None:
        """SELECT FOR UPDATE on devices only (no JOIN — avoids FOR UPDATE on nullable side)."""
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
                last_checkin_at,
                created_at,
                updated_at
            FROM devices
            WHERE id = %(id)s AND deleted_at IS NULL
            FOR UPDATE
        """
        return self._fetch_one(query, {"id": str(device_id)})

    def create_device(
        self,
        *,
        imei: str,
        tac_id: str | uuid.UUID,
        service_id: str | uuid.UUID,
        current_state_id: str | uuid.UUID,
    ) -> dict:
        query = """
            INSERT INTO devices (imei, tac_id, service_id, current_state_id, info)
            VALUES (%(imei)s, %(tac_id)s, %(service_id)s, %(state_id)s, '{}'::jsonb)
            RETURNING id, imei, created_at
        """
        row = self._fetch_one(
            query,
            {
                "imei": imei,
                "tac_id": str(tac_id),
                "service_id": str(service_id),
                "state_id": str(current_state_id),
            },
        )
        assert row is not None
        return row

    def set_device_assigned_action(
        self, device_id: str | uuid.UUID, action_id: str | uuid.UUID | None
    ) -> None:
        query = """
            UPDATE devices
            SET assigned_action_id = %(action_id)s
            WHERE id = %(id)s
        """
        self._execute(
            query,
            {
                "id": str(device_id),
                "action_id": str(action_id) if action_id else None,
            },
        )

    # ============================================================
    # MILESTONES
    # ============================================================

    def list_milestones(
        self,
        device_id: str | uuid.UUID,
        *,
        after_created_at: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = """
            SELECT
                m.id,
                m.event_type,
                m.payload,
                m.created_at,
                row_to_json(a.*) AS action,
                row_to_json(fs.*) AS from_state,
                row_to_json(ts.*) AS to_state,
                row_to_json(u.*) AS requested_by
            FROM milestones m
            JOIN actions a ON a.id = m.action_id
            LEFT JOIN states fs ON fs.id = m.from_state_id
            LEFT JOIN states ts ON ts.id = m.to_state_id
            LEFT JOIN users u ON u.id = m.requested_by_id
            WHERE m.device_id = %(device_id)s
                AND m.deleted_at IS NULL
                AND (%(after)s::timestamptz IS NULL OR m.created_at < %(after)s)
            ORDER BY m.created_at DESC
            LIMIT %(limit)s
        """
        return self._fetch_all(
            query,
            {
                "device_id": str(device_id),
                "after": after_created_at,
                "limit": limit,
            },
        )

    def count_milestones(self, device_id: str | uuid.UUID) -> int:
        query = """
            SELECT count(*) AS n
            FROM milestones
            WHERE device_id = %(device_id)s AND deleted_at IS NULL
        """
        row = self._fetch_one(query, {"device_id": str(device_id)})
        return row["n"] if row else 0

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

    # ============================================================
    # MESSAGE TEMPLATES (CRUD)
    # ============================================================

    def list_message_templates(self, service_type: str) -> list[dict]:
        query = """
            SELECT
                mt.id,
                mt.title,
                mt.content,
                mt.type,
                mt.header_icon_url,
                mt.notification_icon_url,
                mt.created_at,
                mt.updated_at,
                row_to_json(s.*) AS service
            FROM message_templates mt
            JOIN services s ON s.id = mt.service_id
            WHERE mt.deleted_at IS NULL AND s.type = %(service_type)s
            ORDER BY mt.created_at
        """
        return self._fetch_all(query, {"service_type": service_type})

    def create_message_template(
        self,
        *,
        service_id: str | uuid.UUID,
        title: str,
        content: str,
        type_: str,
        header_icon_url: str | None = None,
        notification_icon_url: str | None = None,
    ) -> dict:
        query = """
            INSERT INTO message_templates (
                service_id,
                title,
                content,
                type,
                header_icon_url,
                notification_icon_url
            )
            VALUES (
                %(service_id)s,
                %(title)s,
                %(content)s,
                %(type)s,
                %(header_icon_url)s,
                %(notification_icon_url)s
            )
            RETURNING id, title, content, type, header_icon_url, notification_icon_url,
                      service_id, created_at, updated_at
        """
        row = self._fetch_one(
            query,
            {
                "service_id": str(service_id),
                "title": title,
                "content": content,
                "type": type_,
                "header_icon_url": header_icon_url,
                "notification_icon_url": notification_icon_url,
            },
        )
        assert row is not None
        return row

    def update_message_template(
        self,
        template_id: str | uuid.UUID,
        *,
        title: str | None = None,
        content: str | None = None,
        type_: str | None = None,
        header_icon_url: str | None = None,
        notification_icon_url: str | None = None,
    ) -> dict | None:
        query = """
            UPDATE message_templates
            SET title = COALESCE(%(title)s, title),
                content = COALESCE(%(content)s, content),
                type = COALESCE(%(type)s, type),
                header_icon_url = COALESCE(%(header_icon_url)s, header_icon_url),
                notification_icon_url = COALESCE(%(notification_icon_url)s, notification_icon_url)
            WHERE id = %(id)s AND deleted_at IS NULL
            RETURNING id, title, content, type, header_icon_url, notification_icon_url,
                      service_id, created_at, updated_at
        """
        return self._fetch_one(
            query,
            {
                "id": str(template_id),
                "title": title,
                "content": content,
                "type": type_,
                "header_icon_url": header_icon_url,
                "notification_icon_url": notification_icon_url,
            },
        )

    def soft_delete_message_template(self, template_id: str | uuid.UUID) -> bool:
        query = """
            UPDATE message_templates
            SET deleted_at = NOW()
            WHERE id = %(id)s AND deleted_at IS NULL
            RETURNING id
        """
        return self._fetch_one(query, {"id": str(template_id)}) is not None

    # ============================================================
    # TACs (CRUD)
    # ============================================================

    def list_tacs(
        self,
        *,
        search: str | None = None,
        after_tac: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = """
            SELECT id, tac, provider, manufacturer, model, created_at, updated_at
            FROM tacs
            WHERE deleted_at IS NULL
                AND (%(search)s::text IS NULL
                     OR tac LIKE %(search)s
                     OR manufacturer ILIKE %(search)s
                     OR model ILIKE %(search)s)
                AND (%(after)s::text IS NULL OR tac > %(after)s)
            ORDER BY tac
            LIMIT %(limit)s
        """
        return self._fetch_all(
            query,
            {
                "search": f"%{search}%" if search else None,
                "after": after_tac,
                "limit": limit,
            },
        )

    def count_tacs(self, search: str | None = None) -> int:
        query = """
            SELECT count(*) AS n
            FROM tacs
            WHERE deleted_at IS NULL
                AND (%(search)s::text IS NULL
                     OR tac LIKE %(search)s
                     OR manufacturer ILIKE %(search)s
                     OR model ILIKE %(search)s)
        """
        row = self._fetch_one(query, {"search": f"%{search}%" if search else None})
        return row["n"] if row else 0

    def create_tac(self, *, tac: str, provider: str, manufacturer: str, model: str) -> dict:
        query = """
            INSERT INTO tacs (tac, provider, manufacturer, model)
            VALUES (%(tac)s, %(provider)s, %(manufacturer)s, %(model)s)
            RETURNING id, tac, provider, manufacturer, model, created_at, updated_at
        """
        row = self._fetch_one(
            query,
            {
                "tac": tac,
                "provider": provider,
                "manufacturer": manufacturer,
                "model": model,
            },
        )
        assert row is not None
        return row

    def update_tac(self, *, tac: str, provider: str, model: str) -> dict | None:
        query = """
            UPDATE tacs
            SET model = %(model)s, provider = %(provider)s
            WHERE tac = %(tac)s AND deleted_at IS NULL
            RETURNING id, tac, provider, manufacturer, model, created_at, updated_at
        """
        return self._fetch_one(query, {"tac": tac, "provider": provider, "model": model})

    def soft_delete_tac(self, tac: str) -> bool:
        query = """
            UPDATE tacs
            SET deleted_at = NOW()
            WHERE tac = %(tac)s AND deleted_at IS NULL
            RETURNING id
        """
        return self._fetch_one(query, {"tac": tac}) is not None

    # ============================================================
    # DEVICE UPLOADS
    # ============================================================

    def list_device_uploads(
        self,
        *,
        status: str | None = None,
        after_created_at: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = """
            SELECT
                du.id,
                du.source,
                du.status,
                du.imei_input,
                du.file_name,
                du.result,
                du.created_at,
                du.updated_at,
                row_to_json(u.*) AS uploaded_by
            FROM device_uploads du
            JOIN users u ON u.id = du.uploaded_by
            WHERE du.deleted_at IS NULL
                AND (%(status)s::text IS NULL OR du.status = %(status)s)
                AND (%(after)s::timestamptz IS NULL OR du.created_at < %(after)s)
            ORDER BY du.created_at DESC
            LIMIT %(limit)s
        """
        return self._fetch_all(
            query,
            {
                "status": status,
                "after": after_created_at,
                "limit": limit,
            },
        )

    def count_device_uploads(self, status: str | None = None) -> int:
        query = """
            SELECT count(*) AS n
            FROM device_uploads
            WHERE deleted_at IS NULL
                AND (%(status)s::text IS NULL OR status = %(status)s)
        """
        row = self._fetch_one(query, {"status": status})
        return row["n"] if row else 0

    def create_device_upload(
        self,
        *,
        source: str,
        status: str,
        uploaded_by: str | uuid.UUID,
        imei_input: str | None = None,
        file_name: str | None = None,
        result: dict | None = None,
    ) -> dict:
        query = """
            INSERT INTO device_uploads (source, status, uploaded_by, imei_input, file_name, result)
            VALUES (
                %(source)s,
                %(status)s,
                %(uploaded_by)s,
                %(imei_input)s,
                %(file_name)s,
                %(result)s::jsonb
            )
            RETURNING id, source, status, imei_input, file_name, result, uploaded_by,
                      created_at, updated_at
        """
        row = self._fetch_one(
            query,
            {
                "source": source,
                "status": status,
                "uploaded_by": str(uploaded_by),
                "imei_input": imei_input,
                "file_name": file_name,
                "result": json.dumps(result or {}),
            },
        )
        assert row is not None
        return row
