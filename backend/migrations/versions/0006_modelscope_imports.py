"""Durable public model imports; keep existing directory versions unchanged."""
from alembic import op

revision = '0006_modelscope_imports'
down_revision = '0005_model_directory'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE model_versions DROP CONSTRAINT model_versions_source_kind_check;
        ALTER TABLE model_versions ADD CONSTRAINT model_versions_source_kind_check
            CHECK (source_kind IN ('directory','modelscope'));
        CREATE TABLE model_imports (
            model_version_id uuid PRIMARY KEY REFERENCES model_versions(id) ON DELETE CASCADE,
            source_snapshot jsonb NOT NULL,
            state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','failed','cancelled','succeeded')),
            cancel_requested boolean NOT NULL DEFAULT false,
            current_path text,
            current_bytes bigint NOT NULL DEFAULT 0 CHECK (current_bytes >= 0),
            error_code text,
            error_message text,
            attempt_count integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX model_imports_pending ON model_imports(updated_at) WHERE state IN ('queued','running');
    """)


def downgrade():
    # The constraint fails safely if ModelScope versions still exist.
    op.execute("ALTER TABLE model_versions DROP CONSTRAINT model_versions_source_kind_check")
    op.execute("ALTER TABLE model_versions ADD CONSTRAINT model_versions_source_kind_check CHECK (source_kind='directory')")
    op.execute('DROP TABLE model_imports')
