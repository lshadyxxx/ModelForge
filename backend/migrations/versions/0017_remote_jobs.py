"""Durable remote launch receipts and observed process facts."""
from alembic import op

revision = '0017_remote_jobs'
down_revision = '0016_training_provisioning'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE training_remote_jobs (
            attempt_id uuid PRIMARY KEY REFERENCES training_attempts(id),
            instance_id text NOT NULL,
            launch_state text NOT NULL
                CHECK (launch_state IN
                    ('not_started','launch_requested','running','exited','unknown','lost')),
            remote_dir text NOT NULL,
            argv_hash text NOT NULL CHECK (argv_hash ~ '^[0-9a-f]{64}$'),
            input_manifest_hash text NOT NULL
                CHECK (input_manifest_hash ~ '^[0-9a-f]{64}$'),
            requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            observed_at timestamptz,
            started_at timestamptz,
            finished_at timestamptz,
            exit_code integer,
            cancelled boolean NOT NULL DEFAULT false,
            group_exited boolean NOT NULL DEFAULT false,
            CHECK ((launch_state = 'exited') = (exit_code IS NOT NULL)),
            CHECK ((exit_code IS NULL) OR (exit_code >= -2147483648 AND exit_code < 2147483648))
        )
    """)
    op.execute("""
        CREATE FUNCTION mf_remote_job_exit_immutable()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.launch_state = 'exited' AND (
                NEW.exit_code IS DISTINCT FROM OLD.exit_code
                OR NEW.cancelled IS DISTINCT FROM OLD.cancelled
                OR NEW.group_exited IS DISTINCT FROM OLD.group_exited
            ) THEN
                RAISE EXCEPTION 'Confirmed remote exit facts are immutable';
            END IF;
            RETURN NEW;
        END $$;
    """)
    op.execute("""
        CREATE TRIGGER training_remote_exit_immutable
        BEFORE UPDATE ON training_remote_jobs
        FOR EACH ROW EXECUTE FUNCTION mf_remote_job_exit_immutable()
    """)


def downgrade():
    op.execute('LOCK TABLE training_remote_jobs IN ACCESS EXCLUSIVE MODE')
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM training_remote_jobs
                WHERE launch_state NOT IN ('exited','lost')
            ) THEN
                RAISE EXCEPTION 'Unresolved remote jobs prevent downgrade';
            END IF;
        END $$
    """)
    op.execute('DROP TABLE training_remote_jobs')
    op.execute('DROP FUNCTION mf_remote_job_exit_immutable()')
