"""seed per-state header icons

Sets message_templates.header_icon_url for the three device-status templates so
the DPC client renders a branded per-state glyph (HeroBox) instead of the
baked-in fallback. Icons are hosted on the public assets bucket created by the
infra AssetsConstruct (fluxion-public-assets-<account>); the bucket name is
deterministic so these URLs stay stable across deploys.

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-14 11:10:00
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

# Public S3 base — matches infra AssetsConstruct (bucket
# fluxion-public-assets-<account>, region ap-southeast-1).
_BASE = "https://fluxion-public-assets-439155107355.s3.ap-southeast-1.amazonaws.com/state-icons"


def upgrade() -> None:
    op.execute(f"""
        UPDATE message_templates SET header_icon_url = '{_BASE}/active.png'
        WHERE title = 'Welcome to Device Financing';
        UPDATE message_templates SET header_icon_url = '{_BASE}/locked.png'
        WHERE title = 'Device locked — contact support';
        UPDATE message_templates SET header_icon_url = '{_BASE}/unlocked.png'
        WHERE title = 'Device unlocked — welcome back';
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE message_templates SET header_icon_url = NULL
        WHERE title IN (
            'Welcome to Device Financing',
            'Device locked — contact support',
            'Device unlocked — welcome back'
        );
    """)
