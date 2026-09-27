"""Add interview presence heartbeat table

Revision ID: d5e2f7a1c9b3
Revises: c3a9e1f0d2b4
Create Date: 2026-09-27 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


revision: str = 'd5e2f7a1c9b3'
down_revision: Union[str, Sequence[str], None] = 'c3a9e1f0d2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_table_names()
    if 'interview_presence' not in existing:
        op.create_table('interview_presence',
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('interview_id', 'role')
        )


def downgrade() -> None:
    op.drop_table('interview_presence')
