"""Advisory AI diagnosis jobs, frozen evidence and immutable reports."""
from alembic import op

revision = '0018_training_diagnosis'
down_revision = '0017_remote_jobs'
branch_labels = None
depends_on = None


def upgrade():
    # LangGraph owns all tables inside this schema. Business tables stay in
    # public and remain the only source of truth for jobs and reports.
    op.execute('CREATE SCHEMA IF NOT EXISTS langgraph_checkpoint')
    op.execute("""
        CREATE TABLE training_diagnosis_jobs (
            id uuid PRIMARY KEY,
            attempt_id uuid NOT NULL REFERENCES training_attempts(id),
            request_key text NOT NULL,
            policy_version text NOT NULL,
            graph_version text NOT NULL,
            prompt_version text NOT NULL,
            generator_version text NOT NULL,
            state text NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','running','ready','failed')),
            attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            repair_count integer NOT NULL DEFAULT 0
                CHECK (repair_count BETWEEN 0 AND 1),
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            lease_owner text,
            lease_expires_at timestamptz,
            fencing_token bigint NOT NULL DEFAULT 0
                CHECK (fencing_token >= 0),
            gate_snapshot jsonb,
            error_code text,
            created_at timestamptz NOT NULL DEFAULT now(),
            started_at timestamptz,
            finished_at timestamptz,
            UNIQUE (attempt_id, request_key),
            CHECK (
                state <> 'running'
                OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
            )
        )
    """)
    op.execute("""
        CREATE INDEX idx_training_diagnosis_jobs_pick
            ON training_diagnosis_jobs (state, next_attempt_at, created_at)
    """)

    op.execute("""
        CREATE TABLE training_diagnosis_evidence (
            job_id uuid PRIMARY KEY REFERENCES training_diagnosis_jobs(id),
            attempt_id uuid NOT NULL REFERENCES training_attempts(id),
            schema_version text NOT NULL,
            evidence_pack jsonb NOT NULL
                CHECK (jsonb_typeof(evidence_pack) = 'object'),
            evidence_digest text NOT NULL
                CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
            redaction_version text NOT NULL,
            captured_at timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE training_diagnosis_reports (
            id uuid PRIMARY KEY,
            job_id uuid NOT NULL UNIQUE
                REFERENCES training_diagnosis_jobs(id),
            attempt_id uuid NOT NULL REFERENCES training_attempts(id),
            version integer NOT NULL CHECK (version > 0),
            schema_version text NOT NULL,
            report_mode text NOT NULL
                CHECK (report_mode IN ('full','limited')),
            health_status text NOT NULL
                CHECK (health_status IN
                    ('healthy','attention','blocked','partial','unknown')),
            delivery_status text NOT NULL
                CHECK (delivery_status IN
                    ('not_deliverable','artifact_deliverable_model_unverified',
                     'ready_for_release_review','unknown')),
            report jsonb NOT NULL
                CHECK (jsonb_typeof(report) = 'object'),
            report_digest text NOT NULL
                CHECK (report_digest ~ '^[0-9a-f]{64}$'),
            evidence_digest text NOT NULL
                CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
            policy_version text NOT NULL,
            graph_version text NOT NULL,
            prompt_version text NOT NULL,
            generator_version text NOT NULL,
            model_name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            published_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (attempt_id, version)
        )
    """)
    op.execute("""
        CREATE INDEX idx_training_diagnosis_reports_attempt
            ON training_diagnosis_reports (attempt_id, version DESC)
    """)
    op.execute("""
        CREATE FUNCTION mf_diagnosis_report_immutable()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Published diagnosis reports are immutable';
        END $$;
    """)
    op.execute("""
        CREATE TRIGGER training_diagnosis_report_no_update
        BEFORE UPDATE ON training_diagnosis_reports
        FOR EACH ROW EXECUTE FUNCTION mf_diagnosis_report_immutable()
    """)


def downgrade():
    op.execute(
        'LOCK TABLE training_diagnosis_reports, training_diagnosis_evidence, '
        'training_diagnosis_jobs IN ACCESS EXCLUSIVE MODE'
    )
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM training_diagnosis_jobs
                WHERE state IN ('queued','running')
            ) THEN
                RAISE EXCEPTION 'Active diagnosis jobs prevent downgrade';
            END IF;
        END $$
    """)
    op.execute(
        'DROP TRIGGER training_diagnosis_report_no_update '
        'ON training_diagnosis_reports'
    )
    op.execute('DROP FUNCTION mf_diagnosis_report_immutable()')
    op.execute('DROP TABLE training_diagnosis_reports')
    op.execute('DROP TABLE training_diagnosis_evidence')
    op.execute('DROP TABLE training_diagnosis_jobs')
    # Never drop langgraph_checkpoint here. It is managed by its own
    # deployment/TTL lifecycle and may contain recoverable workflow state.
