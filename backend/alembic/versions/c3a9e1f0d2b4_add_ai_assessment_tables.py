"""Add AI assessment tables

Revision ID: c3a9e1f0d2b4
Revises: b7c1d2e3f4a5
Create Date: 2026-09-27 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3a9e1f0d2b4'
down_revision: Union[str, Sequence[str], None] = 'b7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB()


def _ts(name, nullable=True, default=False):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text('now()') if default else None, nullable=nullable)


def upgrade() -> None:
    """Upgrade schema."""
    # app.main also calls Base.metadata.create_all on startup, so skip tables that already exist.
    existing = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_table_names()

    if 'resume_analyses' not in existing:
        op.create_table('resume_analyses',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=False),
        sa.Column('resume_id', sa.UUID(), nullable=True),
        sa.Column('resume_fingerprint', sa.String(length=64), nullable=True),
        sa.Column('resume_filename', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('extracted_profile', JSONB, nullable=True),
        sa.Column('extracted_claims', JSONB, nullable=True),
        sa.Column('text_stats', JSONB, nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('model_name', sa.String(), nullable=True),
        sa.Column('prompt_version', sa.String(), nullable=True),
        _ts('created_at', default=True), _ts('updated_at', default=True),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_resume_analyses_candidate_id', 'resume_analyses', ['candidate_id'])

    if 'interview_question_plans' not in existing:
        op.create_table('interview_question_plans',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('resume_analysis_id', sa.UUID(), nullable=True),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('role_profile_key', sa.String(), nullable=True),
        sa.Column('difficulty', sa.String(), nullable=False),
        sa.Column('configuration', JSONB, nullable=False),
        sa.Column('rubric_version', sa.String(), nullable=False),
        sa.Column('prompt_version', sa.String(), nullable=True),
        sa.Column('model_name', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('current_question_id', sa.UUID(), nullable=True),
        _ts('started_at'), _ts('completed_at'),
        sa.Column('completion_reason', sa.String(), nullable=True),
        _ts('ai_disclosure_ack_at'), _ts('transcription_consent_at'),
        sa.Column('transcription_consent', sa.Boolean(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        _ts('created_at', default=True), _ts('updated_at', default=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resume_analysis_id'], ['resume_analyses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id')
        )

    if 'interview_questions' not in existing:
        op.create_table('interview_questions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('plan_id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('sequence_number', sa.Integer(), nullable=False),
        sa.Column('follow_up_index', sa.Integer(), nullable=False),
        sa.Column('is_follow_up', sa.Boolean(), nullable=False),
        sa.Column('parent_question_id', sa.UUID(), nullable=True),
        sa.Column('question_category', sa.String(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('topic', sa.String(), nullable=True),
        sa.Column('source_claim', JSONB, nullable=True),
        sa.Column('expected_evidence', JSONB, nullable=True),
        sa.Column('dimensions', JSONB, nullable=False),
        sa.Column('difficulty', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('skip_reason', sa.Text(), nullable=True),
        sa.Column('next_action', JSONB, nullable=True),
        sa.Column('rubric_version', sa.String(), nullable=False),
        _ts('asked_at'), _ts('handled_at'), _ts('created_at', default=True),
        sa.ForeignKeyConstraint(['plan_id'], ['interview_question_plans.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_question_id'], ['interview_questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('plan_id', 'sequence_number', 'follow_up_index', name='uq_question_sequence')
        )
        op.create_index('ix_interview_questions_interview_id', 'interview_questions', ['interview_id'])

    if 'interview_answers' not in existing:
        op.create_table('interview_answers',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('question_id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('capture_method', sa.String(), nullable=False),
        sa.Column('transcript_text', sa.Text(), nullable=True),
        sa.Column('answer_text', sa.Text(), nullable=True),
        sa.Column('transcript_edited', sa.Boolean(), nullable=False),
        sa.Column('transcription_status', sa.String(), nullable=False),
        sa.Column('transcription_error', sa.Text(), nullable=True),
        sa.Column('audio_duration_seconds', sa.Float(), nullable=True),
        sa.Column('transcript_flagged', sa.Boolean(), nullable=False),
        sa.Column('transcript_flag_note', sa.Text(), nullable=True),
        sa.Column('transcript_flagged_by', sa.String(), nullable=True),
        sa.Column('evaluation_status', sa.String(), nullable=False),
        sa.Column('evaluation_error', sa.Text(), nullable=True),
        sa.Column('evaluation_attempts', sa.Integer(), nullable=False),
        _ts('evaluation_started_at'),
        sa.Column('transcript_quality', sa.String(), nullable=True),
        sa.Column('answer_addresses_question', sa.Boolean(), nullable=True),
        sa.Column('evidence_sufficient', sa.Boolean(), nullable=True),
        sa.Column('missing_evidence', JSONB, nullable=True),
        sa.Column('idempotency_key', sa.String(length=64), nullable=True),
        _ts('submitted_at'), _ts('created_at', default=True), _ts('updated_at', default=True),
        sa.ForeignKeyConstraint(['question_id'], ['interview_questions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('question_id')
        )
        op.create_index('ix_interview_answers_interview_id', 'interview_answers', ['interview_id'])

    if 'answer_evaluations' not in existing:
        op.create_table('answer_evaluations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('answer_id', sa.UUID(), nullable=False),
        sa.Column('question_id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('dimension', sa.String(), nullable=False),
        sa.Column('evaluation_version', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('evidence_status', sa.String(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('rubric_version', sa.String(), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=True),
        sa.Column('evidence_excerpt', sa.Text(), nullable=True),
        sa.Column('excerpt_verified', sa.Boolean(), nullable=True),
        sa.Column('confidence_label', sa.String(), nullable=True),
        sa.Column('review_status', sa.String(), nullable=False),
        sa.Column('model_name', sa.String(), nullable=True),
        sa.Column('prompt_version', sa.String(), nullable=True),
        sa.Column('reviewer_id', sa.UUID(), nullable=True),
        _ts('created_at', default=True),
        sa.ForeignKeyConstraint(['answer_id'], ['interview_answers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['question_id'], ['interview_questions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewer_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('answer_id', 'dimension', 'evaluation_version', name='uq_evaluation_version')
        )
        op.create_index('ix_answer_evaluations_interview_id', 'answer_evaluations', ['interview_id'])

    if 'interview_assessment_reports' not in existing:
        op.create_table('interview_assessment_reports',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=False),
        sa.Column('report_version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        *[sa.Column(name, JSONB, nullable=True) for name in (
            'candidate_info', 'executive_summary', 'dimension_scores', 'aggregate', 'question_analysis', 'strengths',
            'areas_for_follow_up', 'suggested_questions', 'claim_verification', 'limitations')],
        sa.Column('rubric_version', sa.String(), nullable=True),
        sa.Column('model_name', sa.String(), nullable=True),
        sa.Column('prompt_version', sa.String(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        _ts('generated_at'), _ts('created_at', default=True),
        sa.Column('reviewed_by', sa.UUID(), nullable=True),
        sa.Column('reviewer_name', sa.String(), nullable=True),
        _ts('reviewed_at'),
        sa.Column('hr_notes', sa.Text(), nullable=True),
        sa.Column('hr_clarifications', sa.Text(), nullable=True),
        sa.Column('hr_next_step', sa.String(), nullable=True),
        sa.Column('hr_decision', sa.Text(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', 'report_version', name='uq_report_version')
        )

    if 'ai_usage_events' not in existing:
        op.create_table('ai_usage_events',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('interview_id', sa.UUID(), nullable=True),
        sa.Column('candidate_id', sa.UUID(), nullable=True),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=False),
        sa.Column('operation', sa.String(), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('audio_duration_seconds', sa.Float(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('error_type', sa.String(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('estimated_cost', sa.Float(), nullable=True),
        _ts('created_at', default=True),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_ai_usage_interview', 'ai_usage_events', ['interview_id'])
        op.create_index('ix_ai_usage_created', 'ai_usage_events', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    for table in ('ai_usage_events', 'interview_assessment_reports', 'answer_evaluations', 'interview_answers',
                  'interview_questions', 'interview_question_plans', 'resume_analyses'):
        op.drop_table(table)
