"""POST /v1/checkin — device gateway.

Two independent request shapes, branched on the presence of `command_result`:
- ACK  (command_result present): validate the device's command result, then
  enqueue it to the checkin queue for the applier to write APPLIED/FAILED +
  flip state + clear the lock. Never pulls a command. No inline state write.
- PULL (command_result absent): heartbeat + return the device's pending command.

Splitting on `command_result` enforces "an ACK request never pulls", so the
read (PULL) and the write (ACK) never touch the lock inside one request.
"""

from __future__ import annotations

from datetime import UTC, datetime

from auth import validate_device_bearer
from config import logger
from constants import (
    CHECKIN_INTERVAL_IDLE,
    CHECKIN_INTERVAL_PENDING,
    SYSTEM_ACTIONS,
    TARGET_CHECKIN,
)
from db import Database
from errors import BadRequest, Forbidden
from sqs_client import enqueue_action


def handle_checkin(body: dict, auth_header: str | None, imei_header: str | None) -> dict:
    if body.get("type") not in (None, "CHECKIN"):
        raise BadRequest("MISSING_FIELD", "type must be CHECKIN")

    db = Database()
    now = datetime.now(UTC)
    ack: dict | None = None

    with db.conn.transaction():
        device = validate_device_bearer(db, auth_header, imei_header)

        released = db.get_state_by_type("RELEASED")
        assert released
        if device["current_state_id"] == released["id"]:
            raise Forbidden("DEVICE_RELEASED", "Device is in terminal RELEASED state")

        # Heartbeat updates (both request shapes).
        update_fields: dict = {"last_checkin_at": now}
        device_info = body.get("device_info")
        if isinstance(device_info, dict):
            update_fields["info"] = device_info
        db.update_device_fields(device["id"], **update_fields)

        cmd_result = body.get("command_result")
        if cmd_result:
            # ACK request: validate synchronously, defer the transition to the
            # applier. Never pull a command on an ack.
            ack = _validate_ack(db, device, cmd_result)
            pending = None
        else:
            # PULL request: return the pending command (if any).
            pending = _pull_pending_command(db, device)

    # Enqueue the ack AFTER the transaction commits, matching the codebase
    # convention (side effects follow durable state). The transition itself
    # (APPLIED/FAILED + flip + clear lock) is written by the applier.
    if ack is not None:
        enqueue_action(
            TARGET_CHECKIN,
            ack["device_id"],
            ack["action_id"],
            command_id=ack["command_id"],
            extras={"result": ack["result"]},
        )

    next_interval = CHECKIN_INTERVAL_PENDING if pending else CHECKIN_INTERVAL_IDLE
    return {
        "command": pending,
        "next_checkin_in": next_interval,
        "server_time": now.isoformat().replace("+00:00", "Z"),
    }


def _validate_ack(db: Database, device: dict, result: dict) -> dict | None:
    """Validate a device command result. Returns enqueue params, or None if the
    ack was already applied (idempotent no-op). Raises on malformed/unknown acks
    so the device gets synchronous feedback."""
    cmd_id = result.get("command_id")
    status = result.get("status")
    if status not in ("SUCCESS", "FAILED"):
        raise BadRequest("MISSING_FIELD", "command_result.status must be SUCCESS or FAILED")
    if not cmd_id:
        raise BadRequest("MISSING_FIELD", "command_result.command_id required")

    requested = db.find_requested_by_command_id(device["id"], cmd_id)
    if not requested:
        raise BadRequest("UNKNOWN_COMMAND_ID", f"No REQUESTED milestone for command {cmd_id}")

    # REQUESTED-scoped idempotency: a device-bound action (LOCK/UNLOCK/...) repeats
    # across the lifecycle, so only an ack created AFTER this REQUESTED counts.
    already = db.find_ack_milestone_after(
        device["id"], requested["action_id"], requested["created_at"].isoformat()
    )
    if already:
        logger.info("checkin.ack.idempotent device=%s cmd=%s", device["id"], cmd_id)
        return None

    return {
        "device_id": device["id"],
        "action_id": requested["action_id"],
        "command_id": cmd_id,
        "result": {
            "status": status,
            "executed_at": result.get("executed_at"),
            "error": result.get("error") or {},
        },
    }


def _pull_pending_command(db: Database, device: dict) -> dict | None:
    if device["assigned_action_id"] is None:
        return None
    requested = db.find_latest_requested_for_action(device["id"], device["assigned_action_id"])
    if not requested:
        return None
    action = db.get_action_by_id(device["assigned_action_id"])
    assert action

    # Server-applied actions (REGISTER, ENROLL) transition server-side via the
    # checkin SQS consumer and need no device ack. During the brief
    # REQUESTED->APPLIED window a device check-in must not be handed one as a
    # command, or the device would try to "execute" a non-device action.
    if action["type"] in SYSTEM_ACTIONS:
        return None

    template = None
    if requested.get("template_id"):
        template = db.get_message_template(requested["template_id"])
    if template is None and action.get("default_template_id"):
        template = db.get_message_template(action["default_template_id"])

    payload: dict = {}
    if template:
        payload["notification"] = {
            "display_mode": template["type"],
            "title": template["title"],
            "content": template["content"],
            "header_icon_url": template.get("header_icon_url"),
            "notification_icon_url": template.get("notification_icon_url"),
        }
    return {
        "command_id": (requested.get("payload") or {}).get("command_id"),
        "action_type": action["type"],
        "payload": payload,
    }
