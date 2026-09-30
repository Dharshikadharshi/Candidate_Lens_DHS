"""Add leetcode and hackerrank verification

Revision ID: a97d7dfe6553
Revises: b085b818da74
Create Date: 2026-09-29 10:44:22.188189

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a97d7dfe6553'
down_revision: Union[str, Sequence[str], None] = 'b085b818da74'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('resume_validation_reports', sa.Column('leetcode_verification', sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql"), nullable=True))
    op.add_column('resume_validation_reports', sa.Column('hackerrank_verification', sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql"), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('resume_validation_reports', 'hackerrank_verification')
    op.drop_column('resume_validation_reports', 'leetcode_verification')
