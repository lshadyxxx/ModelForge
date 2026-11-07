"""Explicit, append-only independent inference acceptance records."""
from alembic import op


revision = '0019_inference_acceptance'
down_revision = '0018_training_diagnosis'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE training_inference_acceptance (
            id uuid PRIMARY KEY,
            adapter_id uuid NOT NULL
                REFERENCES adapter_versions(id),
            adapter_fingerprint text NOT NULL
                CHECK (adapter_fingerprint ~ '^[0-9a-f]{64}$'),
            trial_id uuid NOT NULL
                REFERENCES inference_trials(id),
            result text NOT NULL
                CHECK (result IN ('passed','failed','inconclusive')),
            criteria_version text NOT NULL
                CHECK (criteria_version = 'inference-acceptance-v1'),
            evidence_digest text NOT NULL
                CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
            reviewer_ref text NOT NULL
                CHECK (length(reviewer_ref) BETWEEN 1 AND 120),
            accepted_at timestamptz NOT NULL,
            recorded_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (trial_id, criteria_version, evidence_digest)
        )
    """)
    op.execute("""
        CREATE INDEX idx_training_inference_acceptance_adapter
            ON training_inference_acceptance
                (adapter_id, adapter_fingerprint, accepted_at DESC)
    """)
    op.execute("""
        CREATE FUNCTION mf_training_inference_acceptance_immutable()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Inference acceptance records are immutable';
        END $$;
    """)
    op.execute("""
        CREATE TRIGGER training_inference_acceptance_no_update
        BEFORE UPDATE ON training_inference_acceptance
        FOR EACH ROW
        EXECUTE FUNCTION mf_training_inference_acceptance_immutable()
    """)
    op.execute("""
        CREATE TRIGGER training_inference_acceptance_no_delete
        BEFORE DELETE ON training_inference_acceptance
        FOR EACH ROW
        EXECUTE FUNCTION mf_training_inference_acceptance_immutable()
    """)


def downgrade():
    op.execute(
        'LOCK TABLE training_inference_acceptance '
        'IN ACCESS EXCLUSIVE MODE'
    )
    op.execute(
        'DROP TRIGGER training_inference_acceptance_no_delete '
        'ON training_inference_acceptance'
    )
    op.execute(
        'DROP TRIGGER training_inference_acceptance_no_update '
        'ON training_inference_acceptance'
    )
    op.execute(
        'DROP FUNCTION mf_training_inference_acceptance_immutable()'
    )
    op.execute('DROP TABLE training_inference_acceptance')
