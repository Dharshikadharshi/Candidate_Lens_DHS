"""Add resume_validation_reports table

Revision ID: 88f61c4c63ec
Revises: d5e2f7a1c9b3
Create Date: 2026-09-28 14:21:03.040184

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '88f61c4c63ec'
down_revision: Union[str, Sequence[str], None] = 'd5e2f7a1c9b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB()


def upgrade() -> None:
    existing = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_table_names()

    if 'resume_validation_reports' not in existing:
        op.create_table(
            'resume_validation_reports',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('candidate_id', sa.UUID(), nullable=False),
            sa.Column('resume_id', sa.UUID(), nullable=True),
            sa.Column('resume_fingerprint', sa.String(length=64), nullable=True),
            sa.Column('resume_filename', sa.String(), nullable=True),
            sa.Column('target_role', sa.String(), nullable=False),
            sa.Column('experience_level', sa.String(), nullable=True),
            sa.Column('status', sa.String(), nullable=False, server_default='processing'),
            sa.Column('overall_score', sa.Float(), nullable=True),
            sa.Column('category_scores', JSONB, nullable=True),
            sa.Column('detailed_findings', JSONB, nullable=True),
            sa.Column('skills_evidence_map', JSONB, nullable=True),
            sa.Column('suggested_questions', JSONB, nullable=True),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('rubric_version', sa.String(), nullable=False, server_default='rv-1.0'),
            sa.Column('model_name', sa.String(), nullable=True),
            sa.Column('prompt_version', sa.String(), nullable=True, server_default='resume-validation-v1'),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_by', sa.UUID(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_resume_validation_reports_candidate_id'), 'resume_validation_reports', ['candidate_id'], unique=False)
        op.create_index(op.f('ix_resume_validation_reports_resume_id'), 'resume_validation_reports', ['resume_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_resume_validation_reports_resume_id'), table_name='resume_validation_reports')
    op.drop_index(op.f('ix_resume_validation_reports_candidate_id'), table_name='resume_validation_reports')
    op.drop_table('resume_validation_reports')
