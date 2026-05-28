"""Lambda entry — SQS-only.

Consumes the `fluxion-action-checkin` queue and applies state transitions:
server-applied actions (REGISTER, ENROLL) and device acks (ACTIVATE/LOCK/...).
This is the single transition writer. No HTTP surface — POST /v1/checkin lives in
the fluxion-platform-checkin Lambda.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config  # noqa: E402 — root logger setup as side effect
from sqs_consumer import handle_records  # noqa: E402


def lambda_handler(event: dict, _context) -> object:
    records = event.get("Records") if isinstance(event, dict) else None
    if not records:
        config.logger.warning("applier.no_records")
        return {"batchItemFailures": []}
    return handle_records(records)
