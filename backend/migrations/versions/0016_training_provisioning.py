"""Orthogonal facts for managed training resource preparation."""
from alembic import op

revision = '0016_training_provisioning'
down_revision = '0015_compute_environments'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE training_attempts
        ADD COLUMN execution_mode text NOT NULL DEFAULT 'manual'
            CHECK (execution_mode IN ('managed','manual'))
    """)
    op.execute("""
        CREATE FUNCTION mf_training_execution_mode_immutable()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.execution_mode IS DISTINCT FROM OLD.execution_mode THEN
                RAISE EXCEPTION 'Training execution mode is immutable';
            END IF;
            RETURN NEW;
        END $$;
    """)
    op.execute("""
        CREATE TRIGGER training_execution_mode_immutable
        BEFORE UPDATE ON training_attempts
        FOR EACH ROW EXECUTE FUNCTION mf_training_execution_mode_immutable()
    """)
    op.execute("""
        CREATE TABLE training_provisioning (
            attempt_id uuid PRIMARY KEY REFERENCES training_attempts(id),
            reservation_id uuid NOT NULL UNIQUE REFERENCES gpu_reservations(id),
            provider_profile text NOT NULL
                CHECK (provider_profile IN ('training-base-b','base-image-a-prime')),
            training_image_profile_id text NOT NULL,
            training_image_profile_sha256 text NOT NULL
                CHECK (training_image_profile_sha256 ~ '^[0-9a-f]{64}$'),
            image_id text NOT NULL,
            image_group_id text,
            project_id text,
            request_fingerprint text NOT NULL
                CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
            request_disposition text NOT NULL DEFAULT 'not_requested'
                CHECK (request_disposition IN
                    ('not_requested','requested','confirmed','unknown','conflict','rejected')),
            provider_state text NOT NULL DEFAULT 'unknown'
                CHECK (provider_state IN
                    ('unknown','not_found','pending','running','stopped','terminating','deleted')),
            provider_observed_at timestamptz,
            cost_guard_state text NOT NULL DEFAULT 'pending'
                CHECK (cost_guard_state IN ('not_required','pending','set','failed','cleared')),
            cost_guard_deadline timestamptz,
            cost_guard_set_at timestamptz,
            credential_state text NOT NULL DEFAULT 'none'
                CHECK (credential_state IN
                    ('none','temp_password','key_installed','key_only_verified',
                     'rotated','password_disabled','exception')),
            temporary_password_sha256 text
                CHECK (temporary_password_sha256 IS NULL
                       OR temporary_password_sha256 ~ '^[0-9a-f]{64}$'),
            bootstrap_profile text,
            host_key_fingerprint text,
            endpoint_epoch integer NOT NULL DEFAULT 0 CHECK (endpoint_epoch >= 0),
            runtime_state text NOT NULL DEFAULT 'absent'
                CHECK (runtime_state IN
                    ('absent','installing','installed','preflight_ready','preflight_mismatch')),
            artifact_state text NOT NULL DEFAULT 'pending'
                CHECK (artifact_state IN ('pending','uploading','verified','failed')),
            artifact_verified_at timestamptz,
            last_error_code text,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CHECK (request_disposition <> 'not_requested'
                   OR (provider_state = 'unknown' AND provider_observed_at IS NULL)),
            CHECK ((artifact_state = 'verified') = (artifact_verified_at IS NOT NULL)),
            CHECK ((cost_guard_state = 'set') = (cost_guard_set_at IS NOT NULL))
        )
    """)


def downgrade():
    op.execute('LOCK TABLE training_provisioning, training_attempts IN ACCESS EXCLUSIVE MODE')
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM training_attempts
                WHERE execution_mode = 'managed'
                  AND state NOT IN ('succeeded','failed','cancelled')
            ) THEN
                RAISE EXCEPTION 'Active managed training prevents downgrade';
            END IF;
        END $$
    """)
    op.execute('DROP TABLE training_provisioning')
    op.execute('DROP TRIGGER training_execution_mode_immutable ON training_attempts')
    op.execute('DROP FUNCTION mf_training_execution_mode_immutable()')
    op.execute('ALTER TABLE training_attempts DROP COLUMN execution_mode')
