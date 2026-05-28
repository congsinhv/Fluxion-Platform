"""TAC entity — listTacs + CRUD mutations."""

from __future__ import annotations

from auth import get_user_from_identity
from db import Database
from errors import BadRequest, NotFound

from . import serializers as ser

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


def _limit(args: dict) -> int:
    n = args.get("first") or _DEFAULT_LIMIT
    return min(int(n), _MAX_LIMIT)


def _require_user(db: Database, identity: dict) -> dict:
    user = get_user_from_identity(db, identity)
    if not user:
        raise BadRequest(
            "USER_NOT_FOUND",
            "Admin user not found in database",
        )
    return user


def list_tacs(db: Database, args: dict, identity: dict) -> dict:
    limit = _limit(args)
    cursor = ser.decode_cursor(args.get("after"))
    rows = db.list_tacs(
        search=args.get("search"),
        after_tac=cursor.get("id") if cursor else None,
        limit=limit + 1,
    )
    total = db.count_tacs(args.get("search"))
    has_next = len(rows) > limit
    rows = rows[:limit]
    edges = [
        {"cursor": ser.encode_cursor(r["tac"], r["created_at"]), "node": ser.tac(r)} for r in rows
    ]
    return ser.connection(edges, total, has_next)


def create_tac(db: Database, args: dict, identity: dict) -> dict:
    _require_user(db, identity)
    inp = args["input"]
    if not inp["tac"].isdigit() or len(inp["tac"]) != 8:
        raise BadRequest("INVALID_TAC", "TAC must be 8 digits")
    row = db.create_tac(
        tac=inp["tac"],
        provider=inp["provider"],
        manufacturer=inp["manufacturer"],
        model=inp["model"],
    )
    return ser.tac(row)


def update_tac(db: Database, args: dict, identity: dict) -> dict:
    _require_user(db, identity)
    inp = args["input"]
    row = db.update_tac(tac=inp["tac"], provider=inp["provider"], model=inp["model"])
    if not row:
        raise NotFound("NOT_FOUND", "TAC not found")
    return ser.tac(row)


def delete_tac(db: Database, args: dict, identity: dict) -> bool:
    _require_user(db, identity)
    return db.soft_delete_tac(args["tac"])


QUERY_HANDLERS = {
    "listTacs": list_tacs,
}

MUTATION_HANDLERS = {
    "createTac": create_tac,
    "updateTac": update_tac,
    "deleteTac": delete_tac,
}
