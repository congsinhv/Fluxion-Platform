"""Firebase Admin SDK wrapper. Lazy-init from Secrets Manager; cache module-scope.

Transient init failures do not permanently flip to mock mode — only an empty
secret or malformed credentials are permanent.
"""

from __future__ import annotations

import json
import threading

import config
from config import logger

_initialized = False
_lock = threading.Lock()
_messaging = None  # firebase_admin.messaging module after init


def _init() -> bool:
    """Returns True on success, False if secret is empty (permanent mock).
    Transient errors leave _initialized=False so the next call retries.
    """
    global _initialized, _messaging
    if _initialized:
        return _messaging is not None
    with _lock:
        if _initialized:
            return _messaging is not None
        if not config.FIREBASE_SECRET_ARN:
            logger.warning("FIREBASE_SECRET_ARN unset -> permanent mock dispatch mode")
            _initialized = True
            return False
        try:
            raw = config.secretsmanager().get_secret_value(SecretId=config.FIREBASE_SECRET_ARN)[
                "SecretString"
            ]
        except Exception:
            logger.exception("FCM secret fetch failed (transient); will retry next call")
            return False
        if not raw or raw.strip() in ("", "{}", "placeholder"):
            logger.warning("FCM secret empty -> permanent mock dispatch mode")
            _initialized = True
            return False
        try:
            cred_data = json.loads(raw)
            import firebase_admin
            from firebase_admin import credentials, messaging  # type: ignore

            cred = credentials.Certificate(cred_data)
            if not firebase_admin._apps:
                firebase_admin.initialize_app(cred)
            _messaging = messaging
            _initialized = True
            logger.info("Firebase Admin SDK initialized")
            return True
        except (json.JSONDecodeError, ValueError):
            logger.exception("Firebase credentials malformed -> permanent mock dispatch mode")
            _initialized = True
            return False
        except Exception:
            logger.exception("Firebase init transient failure; will retry next call")
            return False


def dispatch(fcm_token: str | None, payload: dict) -> dict:
    """Send a data-only wake-up to a device. Returns {ok, message_id, mocked, reason?}.

    Never raises — FCM failure must not block milestone bookkeeping. The next
    /v1/checkin tick acts as a fallback wake.
    """
    if not fcm_token:
        return {"ok": False, "mocked": True, "reason": "no_fcm_token"}
    if not _init():
        logger.info("fcm.mock token=%s payload=%s", fcm_token[:12], list(payload.keys()))
        return {"ok": True, "mocked": True, "message_id": "mock"}
    assert _messaging is not None
    try:
        data = {k: str(v) for k, v in payload.items()}
        msg = _messaging.Message(data=data, token=fcm_token)
        message_id = _messaging.send(msg)
        return {"ok": True, "mocked": False, "message_id": message_id}
    except Exception as e:
        logger.warning("fcm.send_failed token=%s err=%s", fcm_token[:12], e)
        return {"ok": False, "mocked": False, "reason": str(e)}
