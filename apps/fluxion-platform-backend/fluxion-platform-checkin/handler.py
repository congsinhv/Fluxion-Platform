"""Lambda entry — HTTP-only (API Gateway via Mangum). Owns POST /v1/checkin.

The SQS applier path (state transitions) moved to the fluxion-platform-applier
Lambda; this Lambda no longer has an SQS event source.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config  # noqa: F401, E402 — root logger setup as side effect
from app import app  # noqa: E402

try:
    from mangum import Mangum  # type: ignore

    _http_handler = Mangum(app, lifespan="off")
except Exception:  # bundling not done yet during local linting
    _http_handler = None


def lambda_handler(event: dict, context) -> object:
    if _http_handler is None:
        return {"statusCode": 500, "body": '{"error":"mangum unavailable"}'}
    return _http_handler(event, context)
