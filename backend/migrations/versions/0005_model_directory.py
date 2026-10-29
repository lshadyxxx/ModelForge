"""Immutable model-directory manifests and file-granularity recovery."""
from alembic import op

revision = '0005_model_directory'
down_revision = '0004_dataset_split_precision'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('''
        CREATE TABLE models (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE model_versions (
            id uuid PRIMARY KEY,
            model_id uuid NOT NULL REFERENCES models(id),
            version_number integer NOT NULL,
            source_kind text NOT NULL CHECK (source_kind = 'directory'),
            state text NOT NULL CHECK (state IN ('uploading','available','cancelled','deleting','delete_failed')),
            bucket text NOT NULL,
            manifest_sha256 char(64) NOT NULL,
            compatibility_state text NOT NULL DEFAULT 'unverified' CHECK (compatibility_state = 'unverified'),
            format_summary jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(model_id,version_number)
        );
        CREATE TABLE model_version_files (
            model_version_id uuid NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
            path text NOT NULL,
            size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
            sha256 char(64) NOT NULL,
            object_key text NOT NULL UNIQUE,
            state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','verified')),
            verified_at timestamptz,
            PRIMARY KEY(model_version_id,path)
        );
        CREATE TABLE model_version_references (
            model_version_id uuid NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
            reference_type text NOT NULL,
            reference_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY(model_version_id,reference_type,reference_id)
        );
    ''')


def downgrade():
    for table in ('model_version_references', 'model_version_files', 'model_versions', 'models'):
        op.execute(f'DROP TABLE {table}')
