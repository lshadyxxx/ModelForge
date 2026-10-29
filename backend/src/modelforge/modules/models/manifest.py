"""Immutable directory identity. Transfer validity is separate from runtime support."""
from __future__ import annotations

import hashlib
import json
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator

from modelforge.errors import AppError


def safe_path(value: str) -> str:
    if (not value or len(value.encode('utf-8', errors='surrogatepass')) > 1024
            or '\\' in value or ':' in value or value.startswith('/')
            or any(part in {'', '.', '..'} for part in value.split('/'))
            or any(unicodedata.category(c).startswith('C') for c in value)):
        raise ValueError('File path must be a safe relative POSIX path')
    return value


class ModelFile(BaseModel):
    model_config = ConfigDict(extra='forbid')
    path: str
    size_bytes: int = Field(ge=0, strict=True)
    sha256: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')

    _safe_path = field_validator('path')(safe_path)


def validate_manifest(files: list[ModelFile], *, max_files: int, max_file_bytes: int,
                      max_total_bytes: int, require_hash: bool = True) -> list[dict]:
    if not files:
        raise AppError(422, 'model_manifest_invalid', 'Model directory must not be empty')
    if len(files) > max_files or sum(f.size_bytes for f in files) > max_total_bytes:
        raise AppError(413, 'model_limit_exceeded', 'Model directory exceeds the configured limit')
    if require_hash and any(f.sha256 is None for f in files):
        raise AppError(422, 'model_manifest_invalid', 'Every uploaded file requires SHA-256')
    paths = [f.path for f in files]
    # UUID path segments have a fixed length; S3 counts the whole UTF-8 key.
    prefix = 'models/' + '0'*36 + '/versions/' + '0'*36 + '/files/'
    if any(len((prefix + path).encode('utf-8')) > 1024 for path in paths):
        raise AppError(422, 'model_manifest_invalid', 'Relative path exceeds the MinIO object key limit')
    if len(paths) != len(set(paths)):
        raise AppError(422, 'model_manifest_invalid', 'Duplicate relative file path')
    all_paths = set(paths)
    if any('/'.join(path.split('/')[:i]) in all_paths
           for path in paths for i in range(1, len(path.split('/')))):
        raise AppError(422, 'model_manifest_invalid', 'File path conflicts with a directory')
    if any(f.size_bytes > max_file_bytes for f in files):
        raise AppError(413, 'file_too_large', 'Model file exceeds the configured limit')
    return [f.model_dump() for f in sorted(files, key=lambda f: f.path)]


def content_fingerprint(files: list[dict]) -> str:
    canonical = [{k: f[k] for k in ('path', 'size_bytes', 'sha256')}
                 for f in sorted(files, key=lambda f: f['path'])]
    return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()
