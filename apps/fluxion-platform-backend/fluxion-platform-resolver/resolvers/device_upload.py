"""DeviceUpload entity — listDeviceUploads (single + future-CSV upload jobs)."""

from __future__ import annotations

from db import Database

from . import serializers as ser

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


def _limit(args: dict) -> int:
    n = args.get("first") or _DEFAULT_LIMIT
    return min(int(n), _MAX_LIMIT)


def list_device_uploads(db: Database, args: dict, identity: dict) -> dict:
    limit = _limit(args)
    cursor = ser.decode_cursor(args.get("after"))
    rows = db.list_device_uploads(
        status=args.get("status"),
        after_created_at=cursor["createdAt"] if cursor else None,
        limit=limit + 1,
    )
    total = db.count_device_uploads(args.get("status"))
    has_next = len(rows) > limit
    rows = rows[:limit]
    edges = [
        {"cursor": ser.encode_cursor(r["id"], r["created_at"]), "node": ser.device_upload(r)}
        for r in rows
    ]
    return ser.connection(edges, total, has_next)


QUERY_HANDLERS = {
    "listDeviceUploads": list_device_uploads,
}
