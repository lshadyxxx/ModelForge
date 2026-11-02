"""Make dataset derivation requests idempotent."""

from alembic import op
import sqlalchemy as sa


revision = "0013_dataset_derivation_request"
down_revision = "0012_dataset_derivation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "dataset_versions",
        sa.Column("derivation_request_id", sa.Uuid(), nullable=True),
    )
    op.create_unique_constraint(
        "dataset_versions_derivation_request_uq",
        "dataset_versions",
        ["dataset_id", "derivation_request_id"],
    )


def downgrade():
    op.drop_constraint(
        "dataset_versions_derivation_request_uq",
        "dataset_versions",
        type_="unique",
    )
    op.drop_column("dataset_versions", "derivation_request_id")
