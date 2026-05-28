"""Fire-and-forget AppSync broadcast for real-time admin-console subscriptions.

Calls the internal publishDeviceChange / publishDeviceUploadChange mutations
(NONE-data-source passthrough resolvers) which trigger @aws_subscribe, pushing a
scalar change-event to subscribed admin clients. Signed with SigV4/IAM via
botocore (already a dependency — no new package); sent with urllib.

NEVER raises: by the time this runs the DB transition is already committed, so a
failed broadcast must not fail the SQS message / resolver response. The admin
console's polling refresh is the fallback. Mirror edits across the resolver,
processor, and applier copies (no shared package — see backend CLAUDE.md).
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from config import APPSYNC_ENDPOINT, AWS_REGION, logger

_DEVICE_CHANGE = (
    "mutation Pub($i: PublishDeviceChangeInput!) "
    "{ publishDeviceChange(input: $i) { deviceId } }"
)
_UPLOAD_CHANGE = (
    "mutation Pub($i: PublishDeviceUploadChangeInput!) "
    "{ publishDeviceUploadChange(input: $i) { uploadId } }"
)

_session = None  # lazy boto3 session (credential provider)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def publish_device_change(device_id, event_type: str, imei: str | None = None) -> None:
    """Broadcast a device change. event_type is a MilestoneEventType value
    (REQUESTED | APPLIED | FAILED)."""
    payload = {
        "deviceId": str(device_id),
        "imei": imei,
        "eventType": event_type,
        "at": _now_iso(),
    }
    _post(_DEVICE_CHANGE, {"i": payload})


def publish_upload_change(upload_id, status: str, imei: str | None = None) -> None:
    """Broadcast a device-upload change. status is an UploadStatus value."""
    payload = {
        "uploadId": str(upload_id),
        "imei": imei,
        "status": status,
        "at": _now_iso(),
    }
    _post(_UPLOAD_CHANGE, {"i": payload})


def _post(query: str, variables: dict) -> None:
    if not APPSYNC_ENDPOINT:
        logger.warning("appsync_publish.no_endpoint")
        return
    try:
        global _session
        if _session is None:
            _session = boto3.Session()
        creds = _session.get_credentials()
        if creds is None:
            logger.warning("appsync_publish.no_credentials")
            return
        body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
        signed = AWSRequest(
            method="POST",
            url=APPSYNC_ENDPOINT,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        SigV4Auth(creds, "appsync", AWS_REGION).add_auth(signed)
        req = urllib.request.Request(
            APPSYNC_ENDPOINT, data=body, headers=dict(signed.headers), method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            logger.info("appsync_publish.ok status=%s", resp.status)
    except Exception:
        logger.exception("appsync_publish.failed")  # swallow — never raise
