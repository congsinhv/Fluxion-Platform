"""SQS dispatch helper. Picks the right queue from constants.TARGET_*."""

from __future__ import annotations

import json
import uuid

import config
from config import logger
from constants import TARGET_CHECKIN, TARGET_PROCESSOR


def _queue_url_for(target_service: str) -> str:
    if target_service == TARGET_PROCESSOR:
        url = config.PROCESSOR_QUEUE_URL
    elif target_service == TARGET_CHECKIN:
        url = config.CHECKIN_QUEUE_URL
    else:
        raise ValueError(f"Unknown target_service: {target_service}")
    if not url:
        raise RuntimeError(f"Queue URL env var unset for target {target_service}")
    return url


def enqueue_action(
    target_service: str,
    device_id: str | uuid.UUID,
    action_id: str | uuid.UUID,
    *,
    command_id: str | None = None,
    template_id: str | uuid.UUID | None = None,
    requested_by_id: str | uuid.UUID | None = None,
    extras: dict | None = None,
) -> str:
    queue_url = _queue_url_for(target_service)
    body = {
        "target_service": target_service,
        "device_id": str(device_id),
        "action_id": str(action_id),
        "command_id": command_id,
        "template_id": str(template_id) if template_id else None,
        "requested_by_id": str(requested_by_id) if requested_by_id else None,
        "extras": extras or {},
    }
    resp = config.sqs().send_message(QueueUrl=queue_url, MessageBody=json.dumps(body))
    logger.info(
        "sqs.enqueue target=%s device=%s action=%s msg=%s",
        target_service,
        body["device_id"],
        body["action_id"],
        resp.get("MessageId"),
    )
    return resp["MessageId"]
