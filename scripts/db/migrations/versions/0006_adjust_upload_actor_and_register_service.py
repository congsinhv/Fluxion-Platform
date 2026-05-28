"""adjust upload actor and register service

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29 14:00:00

UPLOAD is an OPERATOR action — an operator adds the IMEI to inventory — and
keeps its None -> IDLE transition. REGISTER belongs to the Inventory service
because registration originates while the device is still in inventory (its
fromState is IDLE), even though it targets a Device Financing state.
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE actions SET actor = 'OPERATOR' WHERE type = 'UPLOAD'")
    op.execute(
        """
        UPDATE actions
        SET service_id = (SELECT id FROM services WHERE type = 'INVENTORY')
        WHERE type = 'REGISTER'
        """
    )


def downgrade() -> None:
    op.execute("UPDATE actions SET actor = 'SYSTEM' WHERE type = 'UPLOAD'")
    op.execute(
        """
        UPDATE actions
        SET service_id = (SELECT id FROM services WHERE type = 'DEVICE_FINANCING')
        WHERE type = 'REGISTER'
        """
    )
