"""Runtime config: env vars, AWS clients (lazy), root logger setup.

Importing this module configures the root logger once. Other modules should
use `logging.getLogger(__name__)` to inherit that configuration.
"""

from __future__ import annotations

import logging
import os
import threading

import boto3

# ---- Logger ----
_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(_LEVEL)

# Single shared logger for the whole Lambda. Modules use `from config import logger`.
logger = logging.getLogger("fluxion")
logger.setLevel(_LEVEL)

# ---- Region ----
AWS_REGION = (
    os.environ.get("AWS_REGION_OVERRIDE") or os.environ.get("AWS_REGION") or "ap-southeast-1"
)

# AppSync GraphQL endpoint for real-time broadcast (publishDeviceChange etc.).
# Empty when unset (local) — the publisher no-ops without it.
APPSYNC_ENDPOINT = os.environ.get("APPSYNC_ENDPOINT", "")

# ---- Env vars (empty string if unset; consumers check) ----
DB_ENDPOINT = os.environ.get("DB_ENDPOINT", "")
DB_SECRET_ARN = os.environ.get("DB_SECRET_ARN", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

FIREBASE_SECRET_ARN = os.environ.get("FIREBASE_SECRET_ARN", "")
DPC_SHARED_KEY_SECRET_ARN = os.environ.get("DPC_SHARED_KEY_SECRET_ARN", "")

PROCESSOR_QUEUE_URL = os.environ.get("PROCESSOR_QUEUE_URL", "")
CHECKIN_QUEUE_URL = os.environ.get("CHECKIN_QUEUE_URL", "")
CHECKIN_PUBLIC_URL = os.environ.get("CHECKIN_PUBLIC_URL", "https://api.mdm.dev/v1/checkin")

# ---- Lazy AWS clients ----
_lock = threading.Lock()
_clients: dict = {}


def _client(service: str):
    if service not in _clients:
        with _lock:
            if service not in _clients:
                _clients[service] = boto3.client(service, region_name=AWS_REGION)
    return _clients[service]


def secretsmanager():
    return _client("secretsmanager")


def sqs():
    return _client("sqs")
