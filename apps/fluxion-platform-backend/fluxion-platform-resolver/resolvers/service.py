"""Service entity — read-only lookup. Seeded once at migration time.

Currently only feeds `configMetadata`. Promote to top-level Query if/when
needed.
"""

from __future__ import annotations

from db import Database

from . import serializers as ser


def list_all(db: Database) -> list[dict]:
    return [ser.service(s) for s in db.list_services()]
