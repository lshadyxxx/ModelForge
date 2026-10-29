"""Preserve caller supplied split ratios without three-decimal truncation."""
from alembic import op
import sqlalchemy as sa


revision = "0004_dataset_split_precision"
down_revision = "0003_dataset_split_metadata"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("dataset_versions", "split_requested_ratio", type_=sa.Numeric(8, 6), existing_type=sa.Numeric(4, 3))
    op.alter_column("dataset_versions", "split_ratio", type_=sa.Numeric(8, 6), existing_type=sa.Numeric(4, 3))


def downgrade():
    op.alter_column("dataset_versions", "split_requested_ratio", type_=sa.Numeric(4, 3), existing_type=sa.Numeric(8, 6))
    op.alter_column("dataset_versions", "split_ratio", type_=sa.Numeric(4, 3), existing_type=sa.Numeric(8, 6))
