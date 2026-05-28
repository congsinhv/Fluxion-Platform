"""Auth helpers: DPC api_key bearer -> Device row; api-key generator."""

from __future__ import annotations

import hashlib
import secrets

import config
from constants import API_KEY_PREFIX, API_KEY_TOKEN_LEN
from db import Database
from errors import Forbidden, Unauthorized

_dpc_shared_key_cache: str | None = None


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def validate_device_bearer(db: Database, auth_header: str | None, imei_header: str | None) -> dict:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise Unauthorized("MISSING_API_KEY", "Missing Authorization header")
    token = auth_header.split(None, 1)[1].strip()
    if not token.startswith(API_KEY_PREFIX):
        raise Forbidden("INVALID_CREDENTIALS", "Malformed api_key")
    key_hash = sha256_hex(token)
    query = """
        SELECT
            id,
            imei,
            tac_id,
            service_id,
            current_state_id,
            assigned_action_id,
            api_key_hash,
            fcm_token,
            info,
            first_checkin_at,
            last_checkin_at
        FROM devices
        WHERE api_key_hash = %(h)s AND deleted_at IS NULL
    """
    device = db._fetch_one(query, {"h": key_hash})
    if not device:
        raise Forbidden("INVALID_CREDENTIALS", "api_key not recognized")
    if imei_header and device["imei"] != imei_header:
        raise Forbidden("INVALID_DEVICE_BINDING", "IMEI header does not match api_key device")
    return device


def get_dpc_shared_key() -> str:
    global _dpc_shared_key_cache
    if _dpc_shared_key_cache:
        return _dpc_shared_key_cache
    if not config.DPC_SHARED_KEY_SECRET_ARN:
        raise Unauthorized("MISSING_API_KEY", "DPC shared key not configured")
    _dpc_shared_key_cache = config.secretsmanager().get_secret_value(
        SecretId=config.DPC_SHARED_KEY_SECRET_ARN
    )["SecretString"]
    return _dpc_shared_key_cache


def generate_device_api_key() -> tuple[str, str]:
    token = (
        secrets.token_urlsafe(API_KEY_TOKEN_LEN)
        .replace("-", "")
        .replace("_", "")[:API_KEY_TOKEN_LEN]
    )
    plaintext = API_KEY_PREFIX + token
    return plaintext, sha256_hex(plaintext)
