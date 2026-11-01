"""External public base identity without fictitious MinIO ownership."""
from alembic import op

revision = '0008_external_base_models'
down_revision = '0007_model_transfer_cleanup'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE model_versions DROP CONSTRAINT model_versions_source_kind_check;
        ALTER TABLE model_versions ADD CONSTRAINT model_versions_source_kind_check
            CHECK (source_kind IN ('directory','modelscope','ucloud_public'));
        ALTER TABLE model_versions DROP CONSTRAINT model_versions_state_check;
        ALTER TABLE model_versions ADD CONSTRAINT model_versions_state_check
            CHECK (state IN ('uploading','available','cancelled','deleting','delete_failed','awaiting_verification'));
        ALTER TABLE model_versions ALTER COLUMN bucket DROP NOT NULL;
        ALTER TABLE model_versions ALTER COLUMN manifest_sha256 DROP NOT NULL;
        ALTER TABLE model_versions ADD CONSTRAINT model_versions_storage_ownership CHECK (
            (source_kind='ucloud_public' AND bucket IS NULL) OR
            (source_kind!='ucloud_public' AND bucket IS NOT NULL AND manifest_sha256 IS NOT NULL));
        CREATE TABLE external_base_models (
            model_version_id uuid PRIMARY KEY REFERENCES model_versions(id) ON DELETE CASCADE,
            source_snapshot jsonb NOT NULL,
            pinned_manifest jsonb,
            pinned_configuration jsonb,
            pinned_at timestamptz,
            last_check_state text NOT NULL DEFAULT 'pending'
                CHECK (last_check_state IN ('pending','verified','mismatch','failed')),
            check_generation bigint NOT NULL DEFAULT 0,
            last_checked_at timestamptz,
            last_instance_id text,
            last_error_code text
        );
    """)


def downgrade():
    # Fail before destructive work while external registrations still exist.
    op.execute("ALTER TABLE model_versions ADD CONSTRAINT no_external_versions CHECK (source_kind!='ucloud_public')")
    op.execute('DROP TABLE external_base_models')
    op.execute('ALTER TABLE model_versions DROP CONSTRAINT no_external_versions')
    op.execute('ALTER TABLE model_versions DROP CONSTRAINT model_versions_storage_ownership')
    op.execute('ALTER TABLE model_versions ALTER COLUMN bucket SET NOT NULL')
    op.execute('ALTER TABLE model_versions ALTER COLUMN manifest_sha256 SET NOT NULL')
    op.execute('ALTER TABLE model_versions DROP CONSTRAINT model_versions_source_kind_check')
    op.execute("ALTER TABLE model_versions ADD CONSTRAINT model_versions_source_kind_check CHECK (source_kind IN ('directory','modelscope'))")
    op.execute('ALTER TABLE model_versions DROP CONSTRAINT model_versions_state_check')
    op.execute("ALTER TABLE model_versions ADD CONSTRAINT model_versions_state_check CHECK (state IN ('uploading','available','cancelled','deleting','delete_failed'))")
