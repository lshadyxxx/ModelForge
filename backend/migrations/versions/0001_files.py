"""Verified file metadata."""
from alembic import op
import sqlalchemy as sa

revision = "0001_files"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("files",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("size_bytes >= 0", name="files_size_nonnegative"),
        sa.CheckConstraint("sha256 ~ '^[a-f0-9]{64}$'", name="files_sha256"),
        sa.CheckConstraint("state IN ('pending','available','upload_failed','deleting','delete_failed')", name="files_state"))


def downgrade():
    op.drop_table("files")
