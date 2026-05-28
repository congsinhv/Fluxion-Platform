"""Dict-row -> GraphQL shape converters. Each function renames snake_case
keys to camelCase and stringifies non-JSON-native types (UUID, datetime).
"""

from __future__ import annotations

import base64
import json
from datetime import date, datetime
from typing import Any
from uuid import UUID


def _as_str(v: Any) -> Any:
    """UUID -> str; datetime -> ISO Z; else passthrough."""
    if v is None:
        return None
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat().replace("+00:00", "Z")
    if isinstance(v, date):
        return v.isoformat()
    return v


def _opt_json_field(value: Any) -> Any:
    """row_to_json may return a Python dict (already parsed) or None."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    return None


def service(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {"id": _as_str(row["id"]), "type": row["type"], "name": row["name"]}


def state(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),
        "type": row["type"],
        "name": row["name"],
        "color": row.get("color"),
        "description": row.get("description"),
        "service": service(row.get("service")) if "service" in row else None,
    }


def message_template(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),
        "title": row["title"],
        "content": row["content"],
        "type": row["type"],
        "headerIconUrl": row.get("header_icon_url"),
        "notificationIconUrl": row.get("notification_icon_url"),
        "service": service(row.get("service")) if "service" in row else None,
        "createdAt": _as_str(row.get("created_at")),
        "updatedAt": _as_str(row.get("updated_at")),
    }


def action(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),
        "type": row["type"],
        "name": row["name"],
        "actor": row["actor"],
        "templateRequired": row["template_required"],
        "description": row.get("description"),
        "service": service(row.get("service")) if "service" in row else None,
        "fromState": state(row.get("from_state")) if "from_state" in row else None,
        "targetState": state(row.get("target_state")) if "target_state" in row else None,
        "defaultTemplate": message_template(row.get("default_template"))
        if "default_template" in row
        else None,
    }


def tac(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),
        "tac": row["tac"],
        "provider": row.get("provider", "DPC"),
        "manufacturer": row["manufacturer"],
        "model": row["model"],
        "createdAt": _as_str(row.get("created_at")),
        "updatedAt": _as_str(row.get("updated_at")),
    }


def user(row: Any) -> dict | None:
    row = _opt_json_field(row) if not isinstance(row, dict) else row
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),
        "email": row["email"],
        "displayName": row.get("display_name"),
    }


def device(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": _as_str(row["id"]),
        "imei": row["imei"],
        "tac": tac(row.get("tac")),
        "service": service(row.get("service")),
        "currentState": state(row.get("current_state")),
        "assignedAction": action(row.get("assigned_action")),
        "info": json.dumps(row.get("info") or {}),
        "firstCheckinAt": _as_str(row.get("first_checkin_at")),
        "lastCheckinAt": _as_str(row.get("last_checkin_at")),
        "createdAt": _as_str(row.get("created_at")),
        "updatedAt": _as_str(row.get("updated_at")),
    }


def milestone(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": _as_str(row["id"]),
        "eventType": row["event_type"],
        "action": action(row.get("action")),
        "fromState": state(row.get("from_state")),
        "toState": state(row.get("to_state")),
        "requestedBy": user(row.get("requested_by")),
        "payload": json.dumps(row.get("payload") or {}),
        "createdAt": _as_str(row.get("created_at")),
    }


def dispatch_result(action_id: Any) -> dict:
    """Minimal accept-receipt for dispatchAction (validate-only mutation)."""
    return {"actionId": _as_str(action_id), "status": "SUCCESS"}


def device_upload(row: dict, attached_device: dict | None = None) -> dict:
    return {
        "id": _as_str(row["id"]),
        "source": row["source"],
        "status": row["status"],
        "uploadedBy": user(row.get("uploaded_by"))
        if isinstance(row.get("uploaded_by"), (dict, type(None)))
        else None,
        "imeiInput": row.get("imei_input"),
        "fileName": row.get("file_name"),
        "result": json.dumps(row.get("result") or {}),
        "device": device(attached_device),
        "createdAt": _as_str(row.get("created_at")),
        "updatedAt": _as_str(row.get("updated_at")),
    }


def encode_cursor(row_id: UUID | str, created_at: datetime | str) -> str:
    raw = json.dumps({"id": _as_str(row_id), "createdAt": _as_str(created_at)})
    return base64.b64encode(raw.encode()).decode()


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        return json.loads(base64.b64decode(cursor.encode()).decode())
    except Exception:
        return None


def connection(edges: list[dict], total: int, has_next: bool) -> dict:
    end = edges[-1]["cursor"] if edges else None
    return {
        "edges": edges,
        "pageInfo": {"hasNextPage": has_next, "endCursor": end},
        "totalCount": total,
    }
