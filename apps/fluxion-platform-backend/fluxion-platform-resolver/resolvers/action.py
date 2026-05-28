"""Action entity — read-only lookup. Seeded once at migration time."""

from __future__ import annotations

from db import Database

from . import serializers as ser


def list_all(db: Database) -> list[dict]:
    return [ser.action(a) for a in db.list_actions()]
