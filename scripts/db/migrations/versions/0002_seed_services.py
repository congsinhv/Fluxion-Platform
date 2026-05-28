"""seed services

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-25 12:01:00
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO services (type, name) VALUES
            ('INVENTORY', 'Inventory'),
            ('DEVICE_FINANCING', 'Device Financing')
        ON CONFLICT (type) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM services WHERE type IN ('INVENTORY', 'DEVICE_FINANCING')")
