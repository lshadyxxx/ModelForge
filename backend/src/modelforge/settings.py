from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
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
    dataset_limits_version: str = "conservative-2026-11-02"
    dataset_limits_locked: bool = False
    model_file_limit_bytes: int = 20 * 1024**3
    model_total_limit_bytes: int = 100 * 1024**3
    model_file_count_limit: int = 10_000
    model_limits_version: str = 'conservative-2026-11-02'
    model_limits_locked: bool = False
    model_temporary_directory: str = '/tmp/modelforge-models'

    # Diagnosis is advisory and remains disabled until an operator opts in.
    # Fake generators are injected by tests and never selected from this flag.
    ai_enabled: bool = False
    ai_model: str | None = None
    ai_base_url: str | None = None
    ai_api_key: SecretStr | None = None
    ai_timeout_seconds: int = Field(default=25, ge=5, le=120)
    ai_structured_output_method: Literal[
        'json_schema', 'function_calling', 'json_mode'
    ] = 'json_schema'
    ai_checkpoint_dsn: SecretStr | None = None
    ai_checkpoint_schema: str = 'langgraph_checkpoint'
    ai_checkpoint_ttl_hours: int = Field(default=24, ge=1, le=720)
    ai_worker_poll_seconds: float = Field(default=2.0, ge=.5, le=60)
    ai_max_attempts: int = Field(default=3, ge=1, le=10)
    ai_lease_seconds: int = Field(default=90, ge=30, le=600)

    @field_validator('ai_model', 'ai_base_url', mode='before')
    @classmethod
    def blank_ai_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator('ai_api_key', 'ai_checkpoint_dsn', mode='before')
    @classmethod
    def blank_ai_secret(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value

    ucloud_public_key: SecretStr | None = None
    ucloud_private_key: SecretStr | None = None
    ucloud_region: str | None = None
    ucloud_project_id: str | None = None
    ucloud_api_url: str = "https://api.compshare.cn"
    ucloud_timeout: float = Field(default=20, gt=0, le=60, allow_inf_nan=False)
    ucloud_training_window_minutes: int = Field(default=75, ge=5, le=360)
    ucloud_training_budget_cny: float = Field(default=5.0, gt=0, allow_inf_nan=False)
    ucloud_training_max_hourly_cny: float = Field(default=3.0, gt=0, allow_inf_nan=False)

    @field_validator("ucloud_public_key", "ucloud_private_key", mode="before")
    @classmethod
    def nonblank_cloud_secret(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("ucloud_api_url")
    @classmethod
    def official_cloud_endpoint(cls, value):
        if value.rstrip("/") != "https://api.compshare.cn":
            raise ValueError("Only the official HTTPS CompShare endpoint is supported")
        return value.rstrip("/")


    ssh_endpoints_file: str = '/run/modelforge/ssh/endpoints.json'
    ssh_executable: str = 'ssh'
    ssh_transfer_timeout: int = Field(default=1800, ge=10, le=7200)

    def conninfo(self) -> str:
        return make_conninfo(host=self.pg_host, port=self.pg_port,
                             dbname=self.pg_database, user=self.pg_user,
                             password=self.pg_password.get_secret_value(),
                             connect_timeout=2, options="-c statement_timeout=2000")


@lru_cache
def get_settings() -> Settings:
    return Settings()
