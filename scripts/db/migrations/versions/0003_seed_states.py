"""seed states

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-25 12:02:00
"""

from __future__ import annotations

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO states (type, service_id, name, color, description)
        SELECT v.type, s.id, v.name, v.color, v.description
        FROM (VALUES
            ('IDLE',       'INVENTORY',        'Idle',       '#9A9389', 'Device uploaded, not yet registered'),
            ('REGISTERED', 'DEVICE_FINANCING', 'Registered', '#B88A3A', 'Registered to Device Financing, awaiting enrollment'),
            ('ENROLLED',   'DEVICE_FINANCING', 'Enrolled',   '#3A4A8C', 'DPC connected, awaiting activation'),
            ('ACTIVE',     'DEVICE_FINANCING', 'Active',     '#2A6F5B', 'Device is active under contract'),
            ('LOCKED',     'DEVICE_FINANCING', 'Locked',     '#B04545', 'Device locked by operator'),
            ('RELEASED',   'DEVICE_FINANCING', 'Released',   '#6A6A6A', 'Device released from program (terminal)')
        ) AS v(type, service_type, name, color, description)
        JOIN services s ON s.type = v.service_type
        ON CONFLICT (type) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute(
        "DELETE FROM states WHERE type IN ('IDLE','REGISTERED','ENROLLED','ACTIVE','LOCKED','RELEASED')"
    )
