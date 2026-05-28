"""seed actions

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-25 12:04:00

10 actions. References resolved via service.type / state.type / template.title joins.
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO actions (
            type, service_id, name,
            from_state_id, target_state_id,
            actor, template_required, default_template_id, description
        )
        SELECT
            v.type, s.id, v.name,
            fs.id, ts.id,
            v.actor, v.tpl_req, t.id, v.description
        FROM (VALUES
            ('UPLOAD',              'INVENTORY',        'Upload',   NULL::text, 'IDLE',       'OPERATOR', FALSE, NULL::text,                              'New device added to inventory'),
            ('REGISTER',            'INVENTORY',        'Register', 'IDLE',     'REGISTERED', 'OPERATOR', FALSE, NULL,                                    'Register device into Device Financing service'),
            ('ENROLL',              'DEVICE_FINANCING', 'Enroll',   'REGISTERED','ENROLLED',  'SYSTEM',   FALSE, NULL,                                    'DPC enrolled and verified'),
            ('ACTIVATE',            'DEVICE_FINANCING', 'Activate', 'ENROLLED', 'ACTIVE',     'SYSTEM',   TRUE,  'Welcome to Device Financing',           'Device activated under contract'),
            ('LOCK',                'DEVICE_FINANCING', 'Lock',     'ACTIVE',   'LOCKED',     'OPERATOR', TRUE,  'Device locked — contact support',       'Lock device'),
            ('UNLOCK',              'DEVICE_FINANCING', 'Unlock',   'LOCKED',   'ACTIVE',     'OPERATOR', TRUE,  'Device unlocked — welcome back',        'Unlock device'),
            ('RELEASE_FROM_ACTIVE', 'DEVICE_FINANCING', 'Release',  'ACTIVE',   'RELEASED',   'OPERATOR', FALSE, NULL,                                    'Release device from program (from active)'),
            ('RELEASE_FROM_LOCKED', 'DEVICE_FINANCING', 'Release',  'LOCKED',   'RELEASED',   'OPERATOR', FALSE, NULL,                                    'Release device from program (from locked)'),
            ('NOTIFY_FROM_ACTIVE',  'DEVICE_FINANCING', 'Notify',   'ACTIVE',   NULL,         'OPERATOR', TRUE,  NULL,                                    'Send notification (state unchanged)'),
            ('NOTIFY_FROM_LOCKED',  'DEVICE_FINANCING', 'Notify',   'LOCKED',   NULL,         'OPERATOR', TRUE,  NULL,                                    'Send notification (state unchanged)')
        ) AS v(type, service_type, name, from_state_type, target_state_type, actor, tpl_req, default_template_title, description)
        JOIN services s ON s.type = v.service_type
        LEFT JOIN states fs ON fs.type = v.from_state_type
        LEFT JOIN states ts ON ts.type = v.target_state_type
        LEFT JOIN message_templates t ON t.title = v.default_template_title
        ON CONFLICT (type) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM actions WHERE type IN (
            'UPLOAD','REGISTER','ENROLL','ACTIVATE','LOCK','UNLOCK',
            'RELEASE_FROM_ACTIVE','RELEASE_FROM_LOCKED',
            'NOTIFY_FROM_ACTIVE','NOTIFY_FROM_LOCKED'
        )
    """)
