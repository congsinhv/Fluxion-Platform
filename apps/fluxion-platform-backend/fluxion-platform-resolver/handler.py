"""AppSync direct Lambda resolver. Dispatch by fieldName."""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config  # noqa: F401 — root logger setup as side effect
from config import logger
from db import Database
from errors import AppError
from resolvers import MUTATION_HANDLERS, QUERY_HANDLERS

_HANDLERS = {**QUERY_HANDLERS, **MUTATION_HANDLERS}


def lambda_handler(event: dict, _context) -> object:
    info = event.get("info") or {}
    parent_type = info.get("parentTypeName") or ""
    field = info.get("fieldName") or event.get("fieldName") or ""
    args = event.get("arguments") or {}
    identity = event.get("identity") or {}

    logger.info(
        "resolver.invoke type=%s field=%s args_keys=%s", parent_type, field, list(args.keys())
    )

    if field == "health":
        return {"status": "ok", "service": "fluxion-resolver", "version": "0.2-backend"}

    fn = _HANDLERS.get(field)
    if not fn:
        raise _gql_error("UNKNOWN_FIELD", f"No resolver for field {parent_type}.{field}")

    db = Database()
    try:
        return fn(db, args, identity)
    except AppError as ae:
        logger.warning("resolver.app_error code=%s msg=%s", ae.code, ae.message)
        raise _gql_error(ae.code, ae.message) from ae
    except Exception as exc:
        logger.exception("resolver.unhandled field=%s", field)
        raise _gql_error("INTERNAL_ERROR", "Unhandled server error") from exc


def _gql_error(code: str, message: str) -> Exception:
    payload = {"errorType": code, "errorMessage": message, "extensions": {"code": code}}
    return Exception(json.dumps(payload))
