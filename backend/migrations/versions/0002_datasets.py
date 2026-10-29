"""DatasetVersion storage and deterministic split metadata."""
from alembic import op
import sqlalchemy as sa

revision = "0002_datasets"
down_revision = "0001_files"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "datasets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "dataset_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("dataset_id", sa.Uuid(), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("line_count", sa.Integer(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("validation_errors", sa.JSON(), nullable=False),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("split_object_key", sa.Text(), nullable=True),
        sa.Column("split_sha256", sa.String(64), nullable=True),
        sa.Column("split_ratio", sa.Numeric(4, 3), nullable=True),
        sa.Column("split_seed", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("dataset_id", "version_number", name="dataset_versions_dataset_number"),
        sa.CheckConstraint("size_bytes >= 0", name="dataset_versions_size_nonnegative"),
        sa.CheckConstraint("sample_count >= 0", name="dataset_versions_sample_nonnegative"),
        sa.CheckConstraint("state IN ('pending','draft','invalid','published','upload_failed','deleting','delete_failed')", name="dataset_versions_state"),
    )
    op.create_table(
        "dataset_version_references",
        sa.Column("dataset_version_id", sa.Uuid(), sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reference_type", sa.Text(), nullable=False),
        sa.Column("reference_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("dataset_version_id", "reference_type", "reference_id", name="dataset_version_references_pk"),
    )


def downgrade():
    op.drop_table("dataset_version_references")
    op.drop_table("dataset_versions")
    op.drop_table("datasets")
