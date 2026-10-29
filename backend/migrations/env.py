from alembic import context
from sqlalchemy import create_engine, URL
from sqlalchemy.pool import NullPool
from modelforge.settings import get_settings

settings = get_settings()
url = URL.create("postgresql+psycopg", username=settings.pg_user,
                 password=settings.pg_password.get_secret_value(), host=settings.pg_host,
                 port=settings.pg_port, database=settings.pg_database)
engine = create_engine(url, poolclass=NullPool, connect_args={"connect_timeout": 3})
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
