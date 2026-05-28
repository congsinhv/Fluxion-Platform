"""POST /v1/enroll — validate + issue api_key. The ENROLL state transition is
applied asynchronously by the pipeline (processor originates, checkin applies).

This handler does NOT write milestones, flip state, set the single-flight lock,
or chain ACTIVATE. It validates the device is REGISTERED, issues the per-device
api_key (storing only the SHA-256 hash), and enqueues ENROLL to the processor —
which originates the request (lock + REQUESTED) under its FOR UPDATE lock and
routes it to the checkin consumer for the APPLIED + REGISTERED->ENROLLED flip.
ACTIVATE auto-chains from there.

Re-enroll is not supported: an already ENROLLED/ACTIVE device returns 409. The
DPC policy hard-disables app uninstall and factory-reset on EULA accept, so a
device never loses its local api_key and never re-enters the EULA -> enroll
flow. (Safe only while those restrictions remain applied.)
"""

from __future__ import annotations

from datetime import UTC, datetime

import config
from auth import generate_device_api_key
from constants import CHECKIN_INTERVAL_IDLE, IMEI_LENGTH, TARGET_PROCESSOR
from db import Database
from errors import BadRequest, Conflict, NotFound
from sqs_client import enqueue_action


def _validate_imei(imei: str) -> None:
    if not imei or len(imei) != IMEI_LENGTH or not imei.isdigit():
        raise BadRequest("INVALID_IMEI_FORMAT", f"IMEI must be {IMEI_LENGTH} digits")


def handle_enroll(body: dict) -> dict:
    imei = body.get("imei", "")
    fcm_token = body.get("fcm_token") or ""
    device_info = body.get("device_info") or {}
    if not isinstance(device_info, dict):
        raise BadRequest("MISSING_FIELD", "device_info must be object")
    _validate_imei(imei)

    db = Database()
    plaintext_key, key_hash = generate_device_api_key()

    with db.conn.transaction():
        device = db.lock_device_by_imei(imei)
        if not device:
            raise NotFound("DEVICE_NOT_FOUND", f"IMEI {imei} not registered")

        registered = db.get_state_by_type("REGISTERED")
        assert registered
        if device["current_state_id"] != registered["id"]:
            raise Conflict("INVALID_STATE", "Device must be REGISTERED to enroll")

        enroll_action = db.get_action_by_type("ENROLL")
        assert enroll_action

        now = datetime.now(UTC)
        update_fields: dict = {
            "api_key_hash": key_hash,
            "fcm_token": fcm_token,
            "info": device_info,
            "last_checkin_at": now,
        }
        if not device.get("first_checkin_at"):
            update_fields["first_checkin_at"] = now
        db.update_device_fields(device["id"], **update_fields)

        device_id = device["id"]
        enroll_action_id = enroll_action["id"]

    # After commit: enqueue ENROLL with no pre-set lock. The processor
    # originates it (sets assigned_action_id + writes REQUESTED) under FOR
    # UPDATE, then routes to the checkin consumer for the server-side APPLIED.
    enqueue_action(
        TARGET_PROCESSOR,
        device_id,
        enroll_action_id,
        extras={"branch": "enroll"},
    )

    return {
        "device_id": str(device_id),
        "api_key": plaintext_key,
        "checkin_endpoint": config.CHECKIN_PUBLIC_URL,
        "checkin_interval": CHECKIN_INTERVAL_IDLE,
        "server_time": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
