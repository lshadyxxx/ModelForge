"""Record requested validation ratio separately from the actual split ratio."""
from alembic import op
import sqlalchemy as sa


revision = "0003_dataset_split_metadata"
down_revision = "0002_datasets"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dataset_versions", sa.Column("split_requested_ratio", sa.Numeric(4, 3), nullable=True))


def downgrade():
    op.drop_column("dataset_versions", "split_requested_ratio")
