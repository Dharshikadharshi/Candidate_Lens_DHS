"""Add interviews and interview_events tables

Revision ID: b7c1d2e3f4a5
Revises: 66ae62784d5c
Create Date: 2026-09-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = '66ae62784d5c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_PREDICATE = "status IN ('request_pending','accepted','in_progress')"


def upgrade() -> None:
    """Upgrade schema."""
    # app.main also calls Base.metadata.create_all on startup, so skip if already present.
    existing = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_table_names()

    if 'interviews' not in existing:
        op.create_table('interviews',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('interviewer_id', sa.UUID(), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('is_instant', sa.Boolean(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('invitation_message', sa.Text(), nullable=True),
        sa.Column('invitation_token_hash', sa.String(length=64), nullable=True),
        sa.Column('invitation_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('video_provider', sa.String(), nullable=False),
        sa.Column('video_room_id', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.CheckConstraint("status IN ('request_pending','accepted','declined','in_progress','completed','cancelled','expired','failed')", name='ck_interviews_status'),
        sa.CheckConstraint('duration_minutes > 0', name='ck_interviews_duration_positive'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['interviewer_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('invitation_token_hash'),
        sa.UniqueConstraint('video_room_id')
        )
        op.create_index(op.f('ix_interviews_id'), 'interviews', ['id'], unique=False)
        op.create_index('ix_interviews_candidate_status', 'interviews', ['candidate_id', 'status'], unique=False)
        op.create_index('ix_interviews_interviewer_scheduled', 'interviews', ['interviewer_id', 'scheduled_at'], unique=False)
        op.create_index('uq_interviews_one_active_per_candidate', 'interviews', ['candidate_id'], unique=True,
                        postgresql_where=sa.text(ACTIVE_PREDICATE))

    if 'interview_events' not in existing:
        op.create_table('interview_events',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('actor_type', sa.String(), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_interview_events_interview_id'), 'interview_events', ['interview_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_interview_events_interview_id'), table_name='interview_events')
    op.drop_table('interview_events')
    op.drop_index('uq_interviews_one_active_per_candidate', table_name='interviews')
    op.drop_index('ix_interviews_interviewer_scheduled', table_name='interviews')
    op.drop_index('ix_interviews_candidate_status', table_name='interviews')
    op.drop_index(op.f('ix_interviews_id'), table_name='interviews')
    op.drop_table('interviews')
