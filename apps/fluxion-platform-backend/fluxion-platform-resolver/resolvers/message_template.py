"""MessageTemplate entity — listMessageTemplates + CRUD mutations."""

from __future__ import annotations

from auth import get_user_from_identity
from db import Database
from errors import BadRequest, NotFound

from . import serializers as ser


def _require_user(db: Database, identity: dict) -> dict:
    user = get_user_from_identity(db, identity)
    if not user:
        raise BadRequest(
            "USER_NOT_FOUND",
            "Admin user not found in database",
        )
    return user


def list_message_templates(db: Database, args: dict, identity: dict) -> list[dict]:
    rows = db.list_message_templates(args["serviceType"])
    return [ser.message_template(r) for r in rows]


def create_message_template(db: Database, args: dict, identity: dict) -> dict:
    _require_user(db, identity)
    inp = args["input"]
    svc = db.get_service_by_type(inp["serviceType"])
    if not svc:
        raise BadRequest("INVALID_SERVICE", f"Service {inp['serviceType']} not found")
    row = db.create_message_template(
        service_id=svc["id"],
        title=inp["title"],
        content=inp["content"],
        type_=inp["type"],
        header_icon_url=inp.get("headerIconUrl"),
        notification_icon_url=inp.get("notificationIconUrl"),
    )
    row["service"] = svc
    return ser.message_template(row)


def update_message_template(db: Database, args: dict, identity: dict) -> dict:
    _require_user(db, identity)
    inp = args["input"]
    row = db.update_message_template(
        inp["id"],
        title=inp.get("title"),
        content=inp.get("content"),
        type_=inp.get("type"),
        header_icon_url=inp.get("headerIconUrl"),
        notification_icon_url=inp.get("notificationIconUrl"),
    )
    if not row:
        raise NotFound("NOT_FOUND", "Template not found")
    full = db.get_message_template(row["id"])
    return ser.message_template(full or row)


def delete_message_template(db: Database, args: dict, identity: dict) -> bool:
    _require_user(db, identity)
    return db.soft_delete_message_template(args["id"])


QUERY_HANDLERS = {
    "listMessageTemplates": list_message_templates,
}

MUTATION_HANDLERS = {
    "createMessageTemplate": create_message_template,
    "updateMessageTemplate": update_message_template,
    "deleteMessageTemplate": delete_message_template,
}
