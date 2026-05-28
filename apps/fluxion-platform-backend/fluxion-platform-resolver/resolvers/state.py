"""State entity — read-only lookup. Seeded once at migration time."""

from __future__ import annotations

from db import Database

from . import serializers as ser


def list_all(db: Database) -> list[dict]:
    return [ser.state(s) for s in db.list_states()]
