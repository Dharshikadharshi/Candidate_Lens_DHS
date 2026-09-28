"""Initial users and candidates tables

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-09-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_table_names()

    if 'users' not in existing:
        op.create_table(
            'users',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(), nullable=True),
            sa.Column('email', sa.String(), nullable=False),
            sa.Column('password_hash', sa.String(), nullable=False),
            sa.Column('role', sa.String(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
        op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
        op.create_index(op.f('ix_users_name'), 'users', ['name'], unique=False)

    if 'candidates' not in existing:
        op.create_table(
            'candidates',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('full_name', sa.String(), nullable=False),
            sa.Column('email', sa.String(), nullable=False),
            sa.Column('phone', sa.String(), nullable=True),
            sa.Column('target_role', sa.String(), nullable=False),
            sa.Column('status', sa.String(), nullable=False),
            sa.Column('resume_id', sa.String(), nullable=True),
            sa.Column('resume_file_name', sa.String(), nullable=True),
            sa.Column('created_by', sa.UUID(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['created_by'], ['users.id']),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_candidates_email'), 'candidates', ['email'], unique=False)
        op.create_index(op.f('ix_candidates_full_name'), 'candidates', ['full_name'], unique=False)
        op.create_index(op.f('ix_candidates_id'), 'candidates', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_candidates_id'), table_name='candidates')
    op.drop_index(op.f('ix_candidates_full_name'), table_name='candidates')
    op.drop_index(op.f('ix_candidates_email'), table_name='candidates')
    op.drop_table('candidates')
    op.drop_index(op.f('ix_users_name'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
