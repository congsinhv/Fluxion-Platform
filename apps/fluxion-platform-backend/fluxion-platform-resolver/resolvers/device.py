"""Device entity — listDevices, device, uploadImei, dispatchAction.

uploadImei is synchronous (creates Device + UPLOAD-APPLIED milestone, no SQS).
dispatchAction is validate-only: it checks the state machine + best-effort
busy-read and enqueues to the processor queue, which originates the request
(sets the single-flight lock + writes REQUESTED) under its own FOR UPDATE lock.
It returns a minimal DispatchResult{actionId, status}.
"""

from __future__ import annotations

from uuid import uuid4

from appsync_publisher import publish_device_change, publish_upload_change
from auth import get_user_from_identity
from config import logger  # noqa: F401 — keep config side-effects loaded
from constants import (
    DEVICE_BOUND_ACTIONS,
    IMEI_LENGTH,
    INLINE_ENROLL,
    INLINE_UPLOAD,
    SYSTEM_ACTIONS,
    TARGET_PROCESSOR,
)
from db import Database
from errors import BadRequest, Conflict, NotFound
from sqs_client import enqueue_action

from . import serializers as ser

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


def _limit(args: dict) -> int:
    n = args.get("first") or _DEFAULT_LIMIT
    return min(int(n), _MAX_LIMIT)


def _require_user(db: Database, identity: dict) -> dict:
    user = get_user_from_identity(db, identity)
    if not user:
        raise BadRequest(
            "USER_NOT_FOUND",
            "Admin user not found in database",
        )
    return user


# ---- Queries ----


def list_devices(db: Database, args: dict, identity: dict) -> dict:
    limit = _limit(args)
    cursor = ser.decode_cursor(args.get("after"))
    rows = db.list_devices(
        service_type=args.get("serviceType"),
        state_type=args.get("stateType"),
        search=args.get("search"),
        after_created_at=cursor["createdAt"] if cursor else None,
        limit=limit + 1,
    )
    total = db.count_devices(
        service_type=args.get("serviceType"),
        state_type=args.get("stateType"),
        search=args.get("search"),
    )
    has_next = len(rows) > limit
    rows = rows[:limit]
    edges = [
        {"cursor": ser.encode_cursor(r["id"], r["created_at"]), "node": ser.device(r)} for r in rows
    ]
    return ser.connection(edges, total, has_next)


def get_device(db: Database, args: dict, identity: dict) -> dict | None:
    if args.get("id"):
        return ser.device(db.get_device_by_id(args["id"]))
    if args.get("imei"):
        return ser.device(db.get_device_by_imei(args["imei"]))
    return None


# ---- Mutations ----


def upload_imei(db: Database, args: dict, identity: dict) -> dict:
    user = _require_user(db, identity)
    imei = (args.get("input") or {}).get("imei", "")
    if not imei or len(imei) != IMEI_LENGTH or not imei.isdigit():
        raise BadRequest("INVALID_IMEI_FORMAT", f"IMEI must be {IMEI_LENGTH} digits")
    tac_code = imei[:8]

    tac = db.get_tac_by_code(tac_code)
    if not tac:
        upload = db.create_device_upload(
            source="SINGLE",
            status="COMPLETED",
            uploaded_by=user["id"],
            imei_input=imei,
            result={
                "total_count": 1,
                "created_count": 0,
                "duplicate_count": 0,
                "error_count": 1,
                "errors": [{"row": 1, "imei": imei, "reason": "TAC_NOT_FOUND"}],
            },
        )
        upload["uploaded_by"] = user
        publish_upload_change(upload["id"], upload["status"], imei=imei)
        return ser.device_upload(upload)

    existing = db.get_device_by_imei(imei)
    if existing:
        upload = db.create_device_upload(
            source="SINGLE",
            status="COMPLETED",
            uploaded_by=user["id"],
            imei_input=imei,
            result={
                "total_count": 1,
                "created_count": 0,
                "duplicate_count": 1,
                "error_count": 0,
                "errors": [],
            },
        )
        upload["uploaded_by"] = user
        publish_upload_change(upload["id"], upload["status"], imei=imei)
        return ser.device_upload(upload, attached_device=existing)

    inventory_svc = db.get_service_by_type("INVENTORY")
    idle_state = db.get_state_by_type("IDLE")
    upload_action = db.get_action_by_type(INLINE_UPLOAD)
    assert inventory_svc and idle_state and upload_action

    with db.conn.transaction():
        new_device = db.create_device(
            imei=imei,
            tac_id=tac["id"],
            service_id=inventory_svc["id"],
            current_state_id=idle_state["id"],
        )
        db.insert_milestone(
            device_id=new_device["id"],
            action_id=upload_action["id"],
            event_type="REQUESTED",
            to_state_id=idle_state["id"],
            requested_by_id=user["id"],
            payload={"trigger": "uploadImei"},
        )
        db.insert_milestone(
            device_id=new_device["id"],
            action_id=upload_action["id"],
            event_type="APPLIED",
            to_state_id=idle_state["id"],
            requested_by_id=user["id"],
            payload={"applied_by": "SYSTEM"},
        )
        upload = db.create_device_upload(
            source="SINGLE",
            status="COMPLETED",
            uploaded_by=user["id"],
            imei_input=imei,
            result={
                "total_count": 1,
                "created_count": 1,
                "duplicate_count": 0,
                "error_count": 0,
                "errors": [],
            },
        )

    upload["uploaded_by"] = user
    full_device = db.get_device_by_id(new_device["id"])
    # New device appeared (IDLE, UPLOAD applied) + a new upload row — broadcast both.
    publish_device_change(new_device["id"], "APPLIED", imei=imei)
    publish_upload_change(upload["id"], upload["status"], imei=imei)
    return ser.device_upload(upload, attached_device=full_device)


def dispatch_action(db: Database, args: dict, identity: dict) -> dict:
    user = _require_user(db, identity)
    inp = args.get("input") or {}
    device_id = inp.get("deviceId")
    action_type = inp.get("actionType")
    template_id = inp.get("templateId")

    if action_type in (INLINE_UPLOAD, INLINE_ENROLL):
        raise BadRequest("INVALID_ACTION", f"{action_type} cannot be dispatched via this mutation")

    action_row = db.get_action_by_type(action_type)
    if not action_row:
        raise BadRequest("INVALID_ACTION", f"Unknown action {action_type}")
    if action_type not in SYSTEM_ACTIONS and action_type not in DEVICE_BOUND_ACTIONS:
        raise BadRequest("INVALID_ACTION", f"{action_type} has no SQS routing")

    effective_template_id = template_id or action_row.get("default_template_id")

    # Validate-only: a plain read, no lock. The processor sets the authoritative
    # single-flight lock + writes REQUESTED later under FOR UPDATE, so this
    # busy-check is best-effort — two truly-concurrent dispatches can both pass
    # it; the processor then serializes them and the loser is a no-op.
    device = db.get_device_by_id(device_id)
    if not device:
        raise NotFound("DEVICE_NOT_FOUND", f"Device {device_id} not found")
    if action_row["from_state_id"] != device["current_state_id"]:
        cs = db._fetch_one(
            "SELECT type FROM states WHERE id = %(id)s",
            {"id": str(device["current_state_id"])},
        )
        raise Conflict(
            "INVALID_STATE",
            f"Action {action_type} not valid from state {cs['type'] if cs else 'UNKNOWN'}",
        )
    if device["assigned_action_id"] is not None:
        raise Conflict("DEVICE_BUSY", "Device already has a pending action; wait for completion")
    if action_row["template_required"] and not effective_template_id:
        raise BadRequest("TEMPLATE_REQUIRED", f"Action {action_type} needs templateId")

    command_id = f"cmd_{uuid4().hex[:16]}"
    enqueue_action(
        TARGET_PROCESSOR,
        device["id"],
        action_row["id"],
        command_id=command_id,
        template_id=effective_template_id,
        requested_by_id=user["id"],
        extras={"metadata": inp.get("metadata") or {}},
    )

    return ser.dispatch_result(action_row["id"])


QUERY_HANDLERS = {
    "listDevices": list_devices,
    "device": get_device,
}

MUTATION_HANDLERS = {
    "uploadImei": upload_imei,
    "dispatchAction": dispatch_action,
}
