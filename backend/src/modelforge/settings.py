from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from psycopg.conninfo import make_conninfo


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MF_", extra="ignore")
    pg_host: str = "postgres"
    pg_port: int = 5432
    pg_database: str = "modelforge"
    pg_user: str = "modelforge"
    pg_password: SecretStr
    minio_endpoint: str = "minio:9000"
    minio_access_key: SecretStr
    minio_secret_key: SecretStr
    minio_secure: bool = False
    minio_bucket: str = "modelforge"
    worker_url: str = "http://worker:8103"
    probe_timeout: float = 2.0
    file_limit_bytes: int = 1048576

    def conninfo(self) -> str:
        return make_conninfo(host=self.pg_host, port=self.pg_port,
                             dbname=self.pg_database, user=self.pg_user,
                             password=self.pg_password.get_secret_value(),
                             connect_timeout=2, options="-c statement_timeout=2000")


@lru_cache
def get_settings() -> Settings:
    return Settings()
