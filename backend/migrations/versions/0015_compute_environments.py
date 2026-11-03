"""Independent compute environments, idempotent commands and truthful events."""
from alembic import op


revision = "0015_compute_environments"
down_revision = "0014_dataset_orphan_cleanup"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE gpu_reservations DROP CONSTRAINT gpu_reservations_owner_kind_check"
    )
    op.execute(
        """ALTER TABLE gpu_reservations ADD CONSTRAINT gpu_reservations_owner_kind_check
           CHECK (owner_kind IN ('attempt','trial','environment'))"""
    )
    op.execute(
        """ALTER TABLE ucloud_instance_intents
           ADD COLUMN start_requested boolean NOT NULL DEFAULT false"""
    )
    op.execute(
        """CREATE TABLE compute_environments (
            id uuid PRIMARY KEY,
            name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name=btrim(name)),
            resource_owner text NOT NULL DEFAULT 'personal-workspace'
                CHECK (resource_owner ~ '^[A-Za-z0-9_.:-]{1,80}$'),
            spec jsonb NOT NULL CHECK (jsonb_typeof(spec)='object'),
            state text NOT NULL DEFAULT 'creating' CHECK (state IN (
                'creating','starting','running','stopping','stopped','deleting',
                'cleanup_failed','failed','unavailable','unknown','deleted')),
            lease_id uuid UNIQUE REFERENCES gpu_reservations(id),
            provider_instance_id text,
            provider_state text,
            provider_state_observed_at timestamptz,
            last_error_code text,
            cleanup_policy text
                CHECK (cleanup_policy IN ('discard','outputs_persisted')),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            deleted_at timestamptz,
            CHECK ((state='deleted') = (deleted_at IS NOT NULL))
        )"""
    )
    op.execute(
        """CREATE UNIQUE INDEX compute_environments_active_name_idx
           ON compute_environments(resource_owner, name)
           WHERE deleted_at IS NULL"""
    )
    op.execute(
        """CREATE FUNCTION mf_immutable_compute_environment()
           RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN
             IF NEW.name IS DISTINCT FROM OLD.name
                OR NEW.resource_owner IS DISTINCT FROM OLD.resource_owner
                OR NEW.spec IS DISTINCT FROM OLD.spec
             THEN
               RAISE EXCEPTION 'Compute environment identity is immutable';
             END IF;
             RETURN NEW;
           END $$
        """
    )
    op.execute(
        """CREATE TRIGGER compute_environment_identity_immutable
           BEFORE UPDATE ON compute_environments
           FOR EACH ROW EXECUTE FUNCTION mf_immutable_compute_environment()"""
    )
    op.execute(
        """CREATE TABLE compute_environment_requests (
            id uuid PRIMARY KEY,
            idempotency_key text NOT NULL UNIQUE
                CHECK (length(idempotency_key) BETWEEN 1 AND 128),
            action text NOT NULL CHECK (action IN ('create','start','stop','delete','reconcile')),
            environment_id uuid REFERENCES compute_environments(id),
            request_sha256 text NOT NULL CHECK (length(request_sha256)=64),
            state text NOT NULL DEFAULT 'accepted'
                CHECK (state IN ('accepted','succeeded','failed')),
            error_code text,
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )"""
    )
    op.execute(
        """CREATE TABLE compute_environment_events (
            id bigserial PRIMARY KEY,
            environment_id uuid NOT NULL REFERENCES compute_environments(id),
            source text NOT NULL CHECK (source IN ('platform','provider')),
            action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
            detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail)='object'),
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )"""
    )
    op.execute(
        "CREATE INDEX compute_environments_state_idx ON compute_environments(state, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX compute_environments_provider_idx "
        "ON compute_environments(provider_instance_id) WHERE provider_instance_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX compute_environment_events_env_idx "
        "ON compute_environment_events(environment_id, id)"
    )


def downgrade():
    op.execute(
        "LOCK TABLE compute_environments, compute_environment_requests, "
        "compute_environment_events, gpu_reservations IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM compute_environments)
          THEN RAISE EXCEPTION 'Compute environment history prevents downgrade'; END IF;
          IF EXISTS (SELECT 1 FROM gpu_reservations WHERE owner_kind='environment')
          THEN RAISE EXCEPTION 'Environment lease history prevents downgrade'; END IF;
        END $$"""
    )
    op.execute("DROP TABLE compute_environment_events")
    op.execute("DROP TABLE compute_environment_requests")
    op.execute("DROP TRIGGER compute_environment_identity_immutable ON compute_environments")
    op.execute("DROP FUNCTION mf_immutable_compute_environment()")
    op.execute("DROP TABLE compute_environments")
    op.execute("ALTER TABLE ucloud_instance_intents DROP COLUMN start_requested")
    op.execute(
        "ALTER TABLE gpu_reservations DROP CONSTRAINT gpu_reservations_owner_kind_check"
    )
    op.execute(
        """ALTER TABLE gpu_reservations ADD CONSTRAINT gpu_reservations_owner_kind_check
           CHECK (owner_kind IN ('attempt','trial'))"""
    )
