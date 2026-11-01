"""Durable single GPU reservation, creation intent and release facts."""
from alembic import op

revision = '0009_gpu_leases'
down_revision = '0008_external_base_models'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE gpu_reservations (
            id uuid PRIMARY KEY,
            owner_kind text NOT NULL CHECK (owner_kind IN ('attempt','trial')),
            owner_id uuid NOT NULL,
            generation bigint NOT NULL UNIQUE CHECK (generation > 0),
            state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','released')),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            released_at timestamptz,
            create_operation_id uuid UNIQUE,
            create_state text NOT NULL DEFAULT 'not_requested'
                CHECK (create_state IN ('not_requested','requested','bound')),
            region text,
            provider_instance_id text,
            process_state text NOT NULL DEFAULT 'not_started'
                CHECK (process_state IN ('not_started','unknown','exited')),
            exit_code integer,
            cleanup_policy text CHECK (cleanup_policy IN ('discard','outputs_persisted')),
            instance_state text NOT NULL DEFAULT 'none'
                CHECK (instance_state IN ('none','unknown','stopped','deleted')),
            cleanup_state text NOT NULL DEFAULT 'not_requested'
                CHECK (cleanup_state IN ('not_requested','pending','failed','confirmed')),
            cleanup_error_code text CHECK (cleanup_error_code='instance_delete_failed'),
            UNIQUE (owner_kind, owner_id),
            UNIQUE (region, provider_instance_id),
            CHECK ((state='released') = (released_at IS NOT NULL)),
            CHECK ((process_state='exited') = (exit_code IS NOT NULL)),
            CHECK ((create_state='not_requested' AND create_operation_id IS NULL
                    AND region IS NULL AND provider_instance_id IS NULL AND instance_state='none')
                OR (create_state='requested' AND create_operation_id IS NOT NULL
                    AND region IS NOT NULL AND provider_instance_id IS NULL AND instance_state='unknown')
                OR (create_state='bound' AND create_operation_id IS NOT NULL
                    AND region IS NOT NULL AND provider_instance_id IS NOT NULL
                    AND instance_state IN ('unknown','stopped','deleted')))
        );
        CREATE TABLE gpu_slots (
            id smallint PRIMARY KEY CHECK (id=1),
            generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
            reservation_id uuid UNIQUE REFERENCES gpu_reservations(id)
        );
        INSERT INTO gpu_slots(id) VALUES (1);
        CREATE TABLE gpu_lease_events (
            id bigserial PRIMARY KEY,
            reservation_id uuid NOT NULL REFERENCES gpu_reservations(id),
            action text NOT NULL CHECK (action IN ('reserved','renewed','creation_requested',
                'instance_bound','execution_requested','process_exited','cleanup_allowed',
                'instance_stopped','deletion_failed','deletion_confirmed','released')),
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
        );
    """)


def downgrade():
    # Refuse destructive rollback even for an unbound held reservation.
    op.execute("ALTER TABLE gpu_reservations ADD CONSTRAINT no_held_gpu CHECK (state='released')")
    op.execute('DROP TABLE gpu_lease_events, gpu_slots, gpu_reservations')
