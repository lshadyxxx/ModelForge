from functools import lru_cache
from pydantic import Field, SecretStr
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
    minio_read_timeout: float = Field(default=120.0, gt=0, le=600, allow_inf_nan=False)
    worker_url: str = "http://worker:8103"
    probe_timeout: float = 2.0
    file_limit_bytes: int = 1048576
    dataset_file_limit_bytes: int = 100 * 1024 * 1024
    dataset_sample_limit: int = 100_000
    dataset_line_limit_bytes: int = 1 * 1024 * 1024
    dataset_validation_error_limit: int = 100
    dataset_preview_samples: int = 20
    dataset_limits_version: str = "initial-2026-10-29"
    dataset_limits_locked: bool = False
    model_file_limit_bytes: int = 20 * 1024**3
    model_total_limit_bytes: int = 100 * 1024**3
    model_file_count_limit: int = 10_000
    model_limits_version: str = 'initial-2026-10-30'
    model_limits_locked: bool = False
    model_temporary_directory: str = '/tmp/modelforge-models'

    def conninfo(self) -> str:
        return make_conninfo(host=self.pg_host, port=self.pg_port,
                             dbname=self.pg_database, user=self.pg_user,
                             password=self.pg_password.get_secret_value(),
                             connect_timeout=2, options="-c statement_timeout=2000")


@lru_cache
def get_settings() -> Settings:
    return Settings()
