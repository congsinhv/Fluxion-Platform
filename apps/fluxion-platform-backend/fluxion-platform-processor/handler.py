"""SQS consumer (target_service=processor).

The processor is the sole request-initiator for every action. Under the device
row's FOR UPDATE lock it sets `assigned_action_id` and writes the REQUESTED
milestone when no action is in flight (origination); on redelivery of the same
action it proceeds; if a different action holds the lock it drops the message
(device busy). After the transaction commits it routes outbound side effects:
server-applied actions (REGISTER, ENROLL) -> re-enqueue to checkin for the
APPLIED write; device-bound actions -> FCM dispatch.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config  # noqa: F401 — root logger setup as side effect
from appsync_publisher import publish_device_change
from config import logger
from constants import DEVICE_BOUND_ACTIONS, SYSTEM_ACTIONS, TARGET_CHECKIN
from db import Database
from fcm_dispatcher import dispatch as fcm_dispatch
from sqs_client import enqueue_action


def lambda_handler(event: dict, _context) -> dict:
    records = event.get("Records") or []
    failures: list[dict] = []
    for rec in records:
        msg_id = rec.get("messageId")
        try:
            body = json.loads(rec.get("body") or "{}")
        except Exception:
            logger.exception("processor.bad_json msg=%s", msg_id)
            failures.append({"itemIdentifier": msg_id})
            continue

        if body.get("target_service") != "processor":
            logger.info("processor.skip msg=%s target=%s", msg_id, body.get("target_service"))
            continue

        try:
            _process_one(body)
        except Exception:
            logger.exception("processor.failure msg=%s body=%s", msg_id, body)
            failures.append({"itemIdentifier": msg_id})

    return {"batchItemFailures": failures}


def _process_one(body: dict) -> None:
    device_id = body["device_id"]
    action_id = body["action_id"]
    command_id = body.get("command_id")
    template_id = body.get("template_id")
    requested_by_id = body.get("requested_by_id")

    metadata = (body.get("extras") or {}).get("metadata") or {}

    db = Database()
    originated = False
    with db.conn.transaction():
        device = db.lock_device_by_id(device_id)
        if device is None:
            logger.warning("processor.device_missing device=%s", device_id)
            return

        assigned = device["assigned_action_id"]
        if assigned is not None and str(assigned) != str(action_id):
            # A different action already holds the single-flight lock — drop this
            # message (device busy). The winner originated first under FOR UPDATE.
            logger.warning(
                "processor.busy device=%s sqs_action=%s db_assigned=%s",
                device_id,
                action_id,
                assigned,
            )
            return

        action = db.get_action_by_id(action_id)
        if action is None:
            logger.warning("processor.action_missing action=%s", action_id)
            return

        template = None
        if template_id:
            template = db.get_message_template(template_id)
        if template is None and action.get("default_template_id"):
            template = db.get_message_template(action["default_template_id"])

        if assigned is None:
            # Origination: claim the lock and write a fresh REQUESTED for THIS
            # dispatch. The FOR UPDATE row lock + null-check is the idempotency
            # boundary — an SQS redelivery of this message sees the lock already
            # set to this action and takes the proceed branch above (no second
            # REQUESTED). We must NOT dedupe on (device, action): the same action
            # is dispatched many times across a device's life (LOCK/UNLOCK/NOTIFY)
            # and each dispatch needs its own REQUESTED carrying its command_id.
            db.set_device_assigned_action(device["id"], action["id"])
            db.insert_milestone(
                device_id=device["id"],
                action_id=action["id"],
                event_type="REQUESTED",
                from_state_id=device["current_state_id"],
                to_state_id=action.get("target_state_id"),
                template_id=template["id"] if template else None,
                requested_by_id=requested_by_id,
                payload={"command_id": command_id, "metadata": metadata},
            )
            originated = True

        fcm_token = device.get("fcm_token")

    # Real-time: a fresh REQUESTED was written under the lock — broadcast it so
    # admin clients refresh immediately instead of waiting for the next poll.
    # After commit, never raises. Redelivery/busy paths don't originate → no push.
    if originated:
        publish_device_change(device_id, "REQUESTED", imei=device.get("imei"))

    # Side effects after tx commits
    if action["type"] in SYSTEM_ACTIONS:
        enqueue_action(
            TARGET_CHECKIN,
            device_id,
            action_id,
            command_id=command_id,
            template_id=template_id,
            requested_by_id=requested_by_id,
            extras={"branch": "system"},
        )
        logger.info(
            "processor.routed system device=%s action=%s -> checkin", device_id, action["type"]
        )
        return

    if action["type"] in DEVICE_BOUND_ACTIONS:
        payload = _build_fcm_payload(action["type"], template, command_id)
        result = fcm_dispatch(fcm_token, payload)
        logger.info(
            "processor.fcm device=%s action=%s cmd=%s ok=%s mocked=%s msg=%s",
            device_id,
            action["type"],
            command_id,
            result.get("ok"),
            result.get("mocked"),
            result.get("message_id"),
        )
        return

    logger.warning("processor.unclassified action=%s", action["type"])


def _build_fcm_payload(action_type: str, template: dict | None, command_id: str | None) -> dict:
    payload = {"wake": "true", "command_id": command_id or "", "action_type": action_type}
    if template is not None:
        payload["template_title"] = template["title"]
        payload["template_type"] = template["type"]
    return payload
