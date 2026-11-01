"""Training attempts, immutable artifacts, trials and explicit manual bindings."""
from alembic import op
revision = '0011_execution_workflows'
down_revision = '0010_ucloud_instance_intents'
branch_labels = None
depends_on = None

def upgrade():
    op.execute("ALTER TABLE gpu_reservations ADD COLUMN process_cancelled boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE ucloud_instance_intents ADD COLUMN binding_mode text NOT NULL DEFAULT 'platform' CHECK(binding_mode IN ('platform','manual'))")
    op.execute("ALTER TABLE ucloud_instance_intents ADD COLUMN manually_bound_at timestamptz")
    op.execute('''CREATE TABLE training_tasks (
        id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
        snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
        snapshot_sha256 text NOT NULL CHECK(length(snapshot_sha256)=64), created_at timestamptz NOT NULL DEFAULT now())''')
    op.execute('''CREATE FUNCTION mf_immutable_task() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
        THEN RAISE EXCEPTION 'Training snapshot is immutable'; END IF; RETURN NEW; END $$''')
    op.execute('CREATE TRIGGER training_snapshot_immutable BEFORE UPDATE ON training_tasks FOR EACH ROW EXECUTE FUNCTION mf_immutable_task()')
    op.execute('''CREATE TABLE training_attempts (
        id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES training_tasks(id), number integer NOT NULL CHECK(number>0),
        state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','waiting_instance','preparing','running','syncing','cleanup','succeeded','failed','cancelled','blocked')),
        stage text NOT NULL DEFAULT 'queue', cancel_requested boolean NOT NULL DEFAULT false,
        lease_id uuid REFERENCES gpu_reservations(id), instance_id text,
        outcome text CHECK(outcome IN ('succeeded','failed','cancelled')), exit_code integer,
        error_code text, metrics jsonb NOT NULL DEFAULT '[]', runtime_report jsonb, token_preflight jsonb, execution_manifest jsonb, log_offset bigint NOT NULL DEFAULT 0 CHECK(log_offset>=0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(task_id,number))''')
    op.execute('''CREATE UNIQUE INDEX training_one_live_attempt ON training_attempts(task_id)
        WHERE state NOT IN ('succeeded','failed','cancelled')''')
    op.execute('''CREATE TABLE training_log_chunks (attempt_id uuid NOT NULL REFERENCES training_attempts(id),
        offset_bytes bigint NOT NULL, next_offset bigint NOT NULL, content text NOT NULL, gap boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(attempt_id,offset_bytes), CHECK(next_offset>=offset_bytes))''')
    op.execute('''CREATE TABLE adapter_versions (
        id uuid PRIMARY KEY, source_attempt_id uuid NOT NULL REFERENCES training_attempts(id),
        role text NOT NULL CHECK(role IN ('best','final')), snapshot jsonb NOT NULL, manifest jsonb NOT NULL,
        fingerprint text NOT NULL, bucket text NOT NULL, state text NOT NULL DEFAULT 'syncing' CHECK(state IN ('syncing','available')),
        metrics jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_attempt_id,role))''')
    op.execute('''CREATE TABLE inference_trials (
        id uuid PRIMARY KEY, adapter_id uuid NOT NULL REFERENCES adapter_versions(id),
        state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','waiting_instance','preparing','ready','stopping','stopped','blocked')),
        snapshot jsonb NOT NULL, lease_id uuid REFERENCES gpu_reservations(id), instance_id text,
        stop_requested boolean NOT NULL DEFAULT false, error_code text,
        last_activity_at timestamptz NOT NULL DEFAULT now(), request_id uuid,
        request_state text NOT NULL DEFAULT 'idle' CHECK(request_state IN ('idle','running','cancelling','unknown')),
        request_cancel_requested boolean NOT NULL DEFAULT false, stream_alive_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())''')

def downgrade():
    op.execute('LOCK TABLE training_attempts,inference_trials IN ACCESS EXCLUSIVE MODE')
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM training_attempts WHERE state NOT IN ('succeeded','failed','cancelled'))
        OR EXISTS(SELECT 1 FROM inference_trials WHERE state!='stopped')
        THEN RAISE EXCEPTION 'Live work prevents downgrade'; END IF; END $$""")
    for table in ('inference_trials','adapter_versions','training_log_chunks','training_attempts','training_tasks'): op.execute('DROP TABLE '+table)
    op.execute('DROP FUNCTION mf_immutable_task()')
    op.execute('ALTER TABLE ucloud_instance_intents DROP COLUMN binding_mode, DROP COLUMN manually_bound_at')
    op.execute('ALTER TABLE gpu_reservations DROP COLUMN process_cancelled')
