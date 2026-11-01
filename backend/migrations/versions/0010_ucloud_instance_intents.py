"""Immutable provider parameters and durable cleanup dispatch facts."""
from alembic import op

revision = '0010_ucloud_instance_intents'
down_revision = '0009_gpu_leases'
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""CREATE TABLE ucloud_instance_intents (
        reservation_id uuid PRIMARY KEY REFERENCES gpu_reservations(id),
        label text NOT NULL UNIQUE,
        spec jsonb NOT NULL CHECK (jsonb_typeof(spec)='object'),
        stop_requested boolean NOT NULL DEFAULT false,
        terminate_requested boolean NOT NULL DEFAULT false,
        terminate_acknowledged boolean NOT NULL DEFAULT false,
        CHECK (NOT terminate_acknowledged OR terminate_requested)
    )""")

def downgrade():
    # Prevent a new intent from committing between the held check and DROP.
    op.execute('LOCK TABLE ucloud_instance_intents IN ACCESS EXCLUSIVE MODE')
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM ucloud_instance_intents i
            JOIN gpu_reservations r ON r.id=i.reservation_id WHERE r.state='held')
        THEN RAISE EXCEPTION 'Held instance intents prevent downgrade'; END IF;
        END $$""")
    op.execute('DROP TABLE ucloud_instance_intents')
