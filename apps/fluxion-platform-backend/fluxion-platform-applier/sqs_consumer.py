"""SQS consumer for target_service=checkin — the single transition writer.

Two message shapes, branched on `extras.result`:
- result present  -> device-ack: a device reported a command result via
  POST /v1/checkin. Write APPLIED (SUCCESS) or FAILED, flip state on SUCCESS,
  clear the lock. applied_by=DEVICE.
- result absent    -> server-applied (REGISTER, ENROLL): no device ack. Write
  APPLIED, flip state, clear the lock. applied_by=SYSTEM. After a real
  (non-idempotent) APPLIED, auto-chain the next action (ENROLL -> ACTIVATE) by
  enqueuing it to the processor, which originates it on the device-bound path.

Real-time: a committed transition is broadcast to AppSync subscribers after the
transaction commits (never inside it — that would hold the FOR UPDATE row lock
across a network call). Each write path returns/sets a publish-intent that
`_process_one` fires post-commit; no-op and redelivery paths leave it unset.
"""

from __future__ import annotations

import json
from uuid import uuid4

from appsync_publisher import publish_device_change
from config import logger
from constants import AUTO_CHAIN_AFTER_APPLIED, TARGET_PROCESSOR
from db import Database
from sqs_client import enqueue_action


def handle_records(records: list[dict]) -> dict:
    failures: list[dict] = []
    for rec in records:
        msg_id = rec.get("messageId")
        try:
            body = json.loads(rec.get("body") or "{}")
        except Exception:
            logger.exception("checkin_sqs.bad_json msg=%s", msg_id)
            failures.append({"itemIdentifier": msg_id})
            continue

        if body.get("target_service") != "checkin":
            logger.info("checkin_sqs.skip msg=%s target=%s", msg_id, body.get("target_service"))
            continue

        try:
            _process_one(body)
        except Exception:
            logger.exception("checkin_sqs.failure msg=%s body=%s", msg_id, body)
            failures.append({"itemIdentifier": msg_id})

    return {"batchItemFailures": failures}


def _process_one(body: dict) -> None:
    device_id = body["device_id"]
    action_id = body["action_id"]
    command_id = body.get("command_id")
    result = (body.get("extras") or {}).get("result")

    db = Database()
    applied_type: str | None = None
    # (device_id, event_type) for the post-commit broadcast; None on no-op paths.
    publish_intent: tuple[str, str] | None = None
    with db.conn.transaction():
        device = db.lock_device_by_id(device_id)
        if not device:
            logger.warning("checkin_sqs.device_missing device=%s", device_id)
            return

        action = db.get_action_by_id(action_id)
        assert action

        assigned = device["assigned_action_id"]
        holds_this = assigned is not None and str(assigned) == str(action_id)

        if result is not None:
            # ---- Device-ack path (ACTIVATE/LOCK/UNLOCK/NOTIFY/RELEASE) ----
            publish_intent = _apply_device_ack(
                db, device, action, result, command_id, holds_this
            )
        else:
            # ---- Server-applied path (REGISTER, ENROLL) ----
            already = db.find_applied_milestone(device_id, action_id)

            if already:
                # Redelivery after the APPLIED was already written. Clear any
                # lingering lock and fall through to (re)attempt the auto-chain —
                # this covers the crash window where the first delivery committed
                # the APPLIED + cleared the lock but died before enqueuing the
                # chained action. Re-enqueue is guarded below by a "chain already
                # started" check, so a genuine redelivery does not double-chain.
                # No broadcast: the APPLIED was already published on first delivery.
                if holds_this:
                    db.update_device_fields(device["id"], assigned_action_id=None)
                applied_type = action["type"]
            elif not holds_this:
                # Not applied and the lock isn't ours (a different action holds it,
                # or it's already cleared without an APPLIED) — not our message.
                logger.warning(
                    "checkin_sqs.lock_mismatch device=%s sqs=%s db=%s",
                    device_id,
                    action_id,
                    assigned,
                )
            else:
                requested = db.find_latest_requested_for_action(device_id, action_id)
                from_state_id = (
                    requested["from_state_id"] if requested else device["current_state_id"]
                )
                db.insert_milestone(
                    device_id=device["id"],
                    action_id=action["id"],
                    event_type="APPLIED",
                    from_state_id=from_state_id,
                    to_state_id=action.get("target_state_id"),
                    template_id=requested["template_id"] if requested else None,
                    requested_by_id=requested["requested_by_id"] if requested else None,
                    payload={"applied_by": "SYSTEM", "command_id": command_id},
                )

                update_fields: dict = {"assigned_action_id": None}
                if action.get("target_state_id"):
                    update_fields["current_state_id"] = action["target_state_id"]
                db.update_device_fields(device["id"], **update_fields)

                applied_type = action["type"]
                publish_intent = (str(device["id"]), "APPLIED")
                logger.info(
                    "checkin_sqs.applied device=%s action=%s -> state=%s",
                    device_id,
                    applied_type,
                    action.get("target_state_id"),
                )

    # Broadcast the committed transition so admin clients refresh immediately
    # instead of waiting for the next poll. After commit; never raises.
    if publish_intent:
        publish_device_change(publish_intent[0], publish_intent[1], imei=device.get("imei"))

    # Auto-chain AFTER commit so the new state + cleared lock are durable before
    # the next action originates. Idempotent: skip if the chained action already
    # has a milestone (it was enqueued + originated on a prior delivery). The
    # processor's FOR UPDATE origination is the backstop against a concurrent
    # duplicate. This re-runs on redelivery so a lost enqueue self-heals.
    next_type = AUTO_CHAIN_AFTER_APPLIED.get(applied_type) if applied_type else None
    if next_type:
        next_action = db.get_action_by_type(next_type)
        if not next_action:
            logger.warning("checkin_sqs.auto_chain_action_missing type=%s", next_type)
            return
        nid = next_action["id"]
        if db.find_latest_requested_for_action(device_id, nid) or db.find_applied_milestone(
            device_id, nid
        ):
            logger.info(
                "checkin_sqs.auto_chain_already_started device=%s %s -> %s",
                device_id,
                applied_type,
                next_type,
            )
            return
        enqueue_action(
            TARGET_PROCESSOR,
            device_id,
            nid,
            command_id=f"cmd_{uuid4().hex[:16]}",
            extras={"branch": f"auto_chain_after_{applied_type.lower()}"},
        )
        logger.info("checkin_sqs.auto_chain device=%s %s -> %s", device_id, applied_type, next_type)


def _apply_device_ack(
    db: Database,
    device: dict,
    action: dict,
    result: dict,
    command_id: str | None,
    holds_this: bool,
) -> tuple[str, str] | None:
    """Within the caller's transaction: write APPLIED/FAILED for a device ack,
    flip state on SUCCESS, clear the lock. Device-bound actions never auto-chain.

    Returns a (device_id, event_type) publish-intent when a real APPLIED/FAILED
    was written (so the caller broadcasts it post-commit), or None on every
    no-op / stale / idempotent path.

    Resolution is keyed by `command_id` (matching the HTTP validate layer), NOT
    by `action_id`. A device-bound action repeats across the lifecycle
    (LOCK -> UNLOCK -> LOCK), so the same action re-acquires the same `action_id`
    lock each cycle. A stale SQS redelivery of an earlier cycle's ack must not be
    allowed to satisfy a live cycle: we (a) require the lock is held, (b) resolve
    the REQUESTED by this command_id, and (c) require that REQUESTED to be the
    latest one for the action (the in-flight cycle). A divergent/stale message
    no-ops and crucially leaves the live cycle's lock intact."""
    device_id = device["id"]
    action_id = action["id"]
    status = result.get("status")

    if not holds_this:
        logger.info(
            "checkin_sqs.ack_not_held device=%s action=%s status=%s",
            device_id,
            action["type"],
            status,
        )
        return None

    # Resolve by command_id (HTTP-parity), then confirm it is the in-flight cycle.
    requested = db.find_requested_by_command_id(device_id, command_id) if command_id else None
    if not requested:
        logger.warning(
            "checkin_sqs.ack_unknown_command device=%s action=%s cmd=%s",
            device_id,
            action["type"],
            command_id,
        )
        return None
    latest = db.find_latest_requested_for_action(device_id, action_id)
    if not latest or str(latest["id"]) != str(requested["id"]):
        # command_id belongs to a prior cycle of this repeating action; do NOT
        # touch the lock — it belongs to the current in-flight cycle.
        logger.info(
            "checkin_sqs.ack_stale_cycle device=%s action=%s cmd=%s",
            device_id,
            action["type"],
            command_id,
        )
        return None

    already = db.find_ack_milestone_after(device_id, action_id, requested["created_at"].isoformat())
    if already:
        db.update_device_fields(device_id, assigned_action_id=None)
        logger.info("checkin_sqs.ack_idempotent device=%s action=%s", device_id, action["type"])
        return None

    if status == "SUCCESS":
        db.insert_milestone(
            device_id=device_id,
            action_id=action_id,
            event_type="APPLIED",
            from_state_id=requested["from_state_id"],
            to_state_id=action.get("target_state_id"),
            template_id=requested.get("template_id"),
            requested_by_id=requested.get("requested_by_id"),
            payload={
                "applied_by": "DEVICE",
                "command_id": command_id,
                "executed_at": result.get("executed_at"),
            },
        )
        update_fields: dict = {"assigned_action_id": None}
        if action.get("target_state_id"):
            update_fields["current_state_id"] = action["target_state_id"]
        db.update_device_fields(device_id, **update_fields)
        logger.info(
            "checkin_sqs.device_applied device=%s action=%s -> state=%s",
            device_id,
            action["type"],
            action.get("target_state_id"),
        )
        return (str(device_id), "APPLIED")
    else:  # FAILED
        db.insert_milestone(
            device_id=device_id,
            action_id=action_id,
            event_type="FAILED",
            from_state_id=requested["from_state_id"],
            template_id=requested.get("template_id"),
            requested_by_id=requested.get("requested_by_id"),
            payload={
                "applied_by": "DEVICE",
                "command_id": command_id,
                "error": result.get("error") or {},
            },
        )
        db.update_device_fields(device_id, assigned_action_id=None)
        logger.info("checkin_sqs.device_failed device=%s action=%s", device_id, action["type"])
        return (str(device_id), "FAILED")
