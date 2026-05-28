"""seed message templates

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-25 12:03:00

Must run before 0005 (actions) since actions.default_template_id FKs to templates.
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO message_templates (service_id, title, content, type)
        SELECT s.id, v.title, v.content, v.type
        FROM (VALUES
            ('Welcome to Device Financing',
             'Your device is now active under the Device Financing program. Please follow the terms of your contract.',
             'FULLSCREEN'),
            ('Device locked — contact support',
             'This device has been locked. Please contact support to resolve.',
             'FULLSCREEN'),
            ('Device unlocked — welcome back',
             'Your device has been unlocked. All features are available again.',
             'POPUP')
        ) AS v(title, content, type)
        CROSS JOIN (SELECT id FROM services WHERE type = 'DEVICE_FINANCING') s
        WHERE NOT EXISTS (
            SELECT 1 FROM message_templates m WHERE m.title = v.title
        );
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM message_templates
        WHERE title IN (
            'Welcome to Device Financing',
            'Device locked — contact support',
            'Device unlocked — welcome back'
        )
    """)
