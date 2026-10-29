from alembic import command
from alembic.config import Config
from modelforge.settings import get_settings
from modelforge.infrastructure.minio import create_store


def main():
    command.upgrade(Config("/app/alembic.ini"), "head")
    settings = get_settings()
    store = create_store(settings)
    if not store.bucket_exists(settings.minio_bucket):
        store.make_bucket(settings.minio_bucket)
    print("Migrations applied; formal-file bucket exists", flush=True)


if __name__ == "__main__":
    main()
