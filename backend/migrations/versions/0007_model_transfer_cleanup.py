"""Transfer records survive version deletion until late writes are reconciled."""
from alembic import op

revision = '0007_model_transfer_cleanup'
down_revision = '0006_modelscope_imports'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('''CREATE TABLE model_object_transfers (
        id uuid PRIMARY KEY,
        model_version_id uuid NOT NULL,
        attempt_count integer NOT NULL,
        bucket text NOT NULL,
        object_key text NOT NULL UNIQUE,
        state text NOT NULL CHECK (state IN ('writing','published','cleanup','deleted')),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX model_object_transfers_version ON model_object_transfers(model_version_id);''')


def downgrade():
    op.execute('DROP TABLE model_object_transfers')
