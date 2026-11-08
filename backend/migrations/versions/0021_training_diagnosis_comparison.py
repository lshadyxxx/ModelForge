"""Historical training comparison for advisory AI diagnosis."""
from alembic import op


revision = '0021_diagnosis_comparison'
down_revision = '0020_diagnosis_usage'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE INDEX idx_training_tasks_comparison_key
        ON training_tasks (
            (snapshot->'base'->>'fingerprint'),
            (snapshot->'dataset'->>'sha256'),
            (snapshot->'dataset'->>'split_sha256')
        )
    """)

    op.execute("""
        ALTER TABLE training_diagnosis_jobs
            ADD COLUMN comparison_mode text NOT NULL DEFAULT 'none',
            ADD COLUMN baseline_attempt_id uuid
                REFERENCES training_attempts(id),
            ADD COLUMN comparison_policy_version text,
            ADD COLUMN baseline_evidence_digest text
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_jobs
            ADD CONSTRAINT training_diagnosis_jobs_comparison_mode_check
            CHECK (comparison_mode IN ('none', 'auto', 'explicit'))
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_jobs
            ADD CONSTRAINT training_diagnosis_jobs_baseline_distinct
            CHECK (
                baseline_attempt_id IS NULL
                OR baseline_attempt_id <> attempt_id
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_jobs
            ADD CONSTRAINT training_diagnosis_jobs_baseline_digest_check
            CHECK (
                baseline_evidence_digest IS NULL
                OR baseline_evidence_digest ~ '^[0-9a-f]{64}$'
            )
    """)
    op.execute("""
        CREATE INDEX idx_training_diagnosis_jobs_baseline
        ON training_diagnosis_jobs (baseline_attempt_id)
        WHERE baseline_attempt_id IS NOT NULL
    """)

    op.execute("""
        ALTER TABLE training_diagnosis_evidence
            ADD COLUMN baseline_attempt_id uuid
                REFERENCES training_attempts(id),
            ADD COLUMN baseline_evidence_digest text
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_evidence
            ADD CONSTRAINT training_diagnosis_evidence_baseline_distinct
            CHECK (
                baseline_attempt_id IS NULL
                OR baseline_attempt_id <> attempt_id
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_evidence
            ADD CONSTRAINT training_diagnosis_evidence_baseline_digest_check
            CHECK (
                baseline_evidence_digest IS NULL
                OR baseline_evidence_digest ~ '^[0-9a-f]{64}$'
            )
    """)

    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD COLUMN baseline_attempt_id uuid
                REFERENCES training_attempts(id),
            ADD COLUMN comparison_status text,
            ADD COLUMN comparison_confidence text,
            ADD COLUMN training_signal text,
            ADD COLUMN delivery_signal text,
            ADD COLUMN model_effect_status text
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_comparison_status_check
            CHECK (
                comparison_status IS NULL
                OR comparison_status IN (
                    'strict', 'conditional', 'not_comparable', 'no_baseline'
                )
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_baseline_distinct
            CHECK (
                baseline_attempt_id IS NULL
                OR baseline_attempt_id <> attempt_id
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_confidence_check
            CHECK (
                comparison_confidence IS NULL
                OR comparison_confidence IN ('high', 'medium', 'low', 'none')
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_training_signal_check
            CHECK (
                training_signal IS NULL
                OR training_signal IN (
                    'improved', 'worsened', 'mixed', 'flat', 'inconclusive'
                )
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_delivery_signal_check
            CHECK (
                delivery_signal IS NULL
                OR delivery_signal IN (
                    'improved', 'worsened', 'same', 'inconclusive'
                )
            )
    """)
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            ADD CONSTRAINT training_diagnosis_reports_model_effect_check
            CHECK (
                model_effect_status IS NULL
                OR model_effect_status IN (
                    'verified_better',
                    'verified_worse',
                    'verified_same',
                    'inconclusive',
                    'unverified'
                )
            )
    """)


def downgrade():
    op.execute(
        'LOCK TABLE training_diagnosis_reports, training_diagnosis_evidence, '
        'training_diagnosis_jobs IN ACCESS EXCLUSIVE MODE'
    )
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1
                FROM training_diagnosis_reports
                WHERE schema_version = 'advisory-report-v2'
            ) OR EXISTS (
                SELECT 1
                FROM training_diagnosis_jobs
                WHERE comparison_mode <> 'none'
                   OR baseline_attempt_id IS NOT NULL
            ) OR EXISTS (
                SELECT 1
                FROM training_diagnosis_evidence
                WHERE baseline_attempt_id IS NOT NULL
            ) THEN
                RAISE EXCEPTION
                    'Comparison diagnosis data prevents destructive downgrade';
            END IF;
        END $$
    """)

    for name in (
        'training_diagnosis_reports_model_effect_check',
        'training_diagnosis_reports_delivery_signal_check',
        'training_diagnosis_reports_training_signal_check',
        'training_diagnosis_reports_confidence_check',
        'training_diagnosis_reports_baseline_distinct',
        'training_diagnosis_reports_comparison_status_check',
    ):
        op.execute(
            f'ALTER TABLE training_diagnosis_reports DROP CONSTRAINT {name}'
        )
    op.execute("""
        ALTER TABLE training_diagnosis_reports
            DROP COLUMN model_effect_status,
            DROP COLUMN delivery_signal,
            DROP COLUMN training_signal,
            DROP COLUMN comparison_confidence,
            DROP COLUMN comparison_status,
            DROP COLUMN baseline_attempt_id
    """)

    for name in (
        'training_diagnosis_evidence_baseline_digest_check',
        'training_diagnosis_evidence_baseline_distinct',
    ):
        op.execute(
            f'ALTER TABLE training_diagnosis_evidence DROP CONSTRAINT {name}'
        )
    op.execute("""
        ALTER TABLE training_diagnosis_evidence
            DROP COLUMN baseline_evidence_digest,
            DROP COLUMN baseline_attempt_id
    """)

    op.execute('DROP INDEX idx_training_diagnosis_jobs_baseline')
    for name in (
        'training_diagnosis_jobs_baseline_digest_check',
        'training_diagnosis_jobs_baseline_distinct',
        'training_diagnosis_jobs_comparison_mode_check',
    ):
        op.execute(
            f'ALTER TABLE training_diagnosis_jobs DROP CONSTRAINT {name}'
        )
    op.execute("""
        ALTER TABLE training_diagnosis_jobs
            DROP COLUMN baseline_evidence_digest,
            DROP COLUMN comparison_policy_version,
            DROP COLUMN baseline_attempt_id,
            DROP COLUMN comparison_mode
    """)
    op.execute('DROP INDEX idx_training_tasks_comparison_key')
