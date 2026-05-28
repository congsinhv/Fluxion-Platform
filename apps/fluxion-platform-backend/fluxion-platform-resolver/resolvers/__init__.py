"""Per-entity handler modules. Aggregate QUERY_HANDLERS + MUTATION_HANDLERS."""

from __future__ import annotations

from .device import MUTATION_HANDLERS as _DEV_M
from .device import QUERY_HANDLERS as _DEV_Q
from .device_upload import QUERY_HANDLERS as _DU_Q
from .message_template import MUTATION_HANDLERS as _MT_M
from .message_template import QUERY_HANDLERS as _MT_Q
from .metadata import QUERY_HANDLERS as _META_Q
from .milestone import QUERY_HANDLERS as _MS_Q
from .tac import MUTATION_HANDLERS as _TAC_M
from .tac import QUERY_HANDLERS as _TAC_Q

QUERY_HANDLERS: dict = {
    **_DEV_Q,
    **_MS_Q,
    **_MT_Q,
    **_TAC_Q,
    **_DU_Q,
    **_META_Q,
}

MUTATION_HANDLERS: dict = {
    **_DEV_M,
    **_MT_M,
    **_TAC_M,
}
