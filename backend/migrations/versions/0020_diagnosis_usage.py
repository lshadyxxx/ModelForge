"""Optional model usage and latency for diagnosis jobs."""
from alembic import op


revision = '0020_diagnosis_usage'
down_revision = '0019_inference_acceptance'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE training_diagnosis_jobs
        ADD COLUMN usage jsonb
            CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object')
    """)


def downgrade():
    op.execute(
        'ALTER TABLE training_diagnosis_jobs DROP COLUMN usage'
    )
