"""Remove datasets that have no remaining versions."""

from alembic import op


revision = "0014_dataset_orphan_cleanup"
down_revision = "0013_dataset_derivation_request"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """DELETE FROM datasets d
           WHERE NOT EXISTS (
             SELECT 1 FROM dataset_versions v WHERE v.dataset_id=d.id
           )"""
    )


def downgrade():
    pass
