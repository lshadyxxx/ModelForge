"""Track immutable dataset derivation lineage."""

from alembic import op
import sqlalchemy as sa


revision = "0012_dataset_derivation"
down_revision = "0011_execution_workflows"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "dataset_versions",
        sa.Column("derived_from_version_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "dataset_versions_derived_from_fk",
        "dataset_versions",
        "dataset_versions",
        ["derived_from_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "dataset_versions_derived_from_idx",
        "dataset_versions",
        ["derived_from_version_id"],
    )


def downgrade():
    op.drop_index("dataset_versions_derived_from_idx", table_name="dataset_versions")
    op.drop_constraint(
        "dataset_versions_derived_from_fk",
        "dataset_versions",
        type_="foreignkey",
    )
    op.drop_column("dataset_versions", "derived_from_version_id")
