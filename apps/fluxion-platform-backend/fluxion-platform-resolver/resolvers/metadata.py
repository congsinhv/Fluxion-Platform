"""configMetadata — composes the service/state/action lookups for app start."""

from __future__ import annotations

from db import Database

from . import action, service, state


def config_metadata(db: Database, args: dict, identity: dict) -> dict:
    return {
        "services": service.list_all(db),
        "states": state.list_all(db),
        "actions": action.list_all(db),
    }


QUERY_HANDLERS = {
    "configMetadata": config_metadata,
}
