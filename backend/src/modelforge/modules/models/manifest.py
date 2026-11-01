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


def model_structure(paths, metadata):
    """Shared config/tokenizer/weight-shard structure; not runtime validation."""
    paths = set(paths)
    config = metadata.get('config.json')
    if not isinstance(config, dict) or not isinstance(config.get('model_type'), str) or not config['model_type'].strip():
        raise AppError(422, 'model_format_invalid', 'config.json requires model_type')
    if not ({'tokenizer.json', 'tokenizer.model'} & paths) and not {'vocab.json', 'merges.txt'} <= paths:
        raise AppError(422, 'model_format_invalid', 'Tokenizer files are missing')
    indexes = {'model.safetensors.index.json', 'pytorch_model.bin.index.json'} & paths
    if not ({'model.safetensors', 'pytorch_model.bin'} & paths) and not indexes:
        raise AppError(422, 'model_format_invalid', 'Model weights or shard index are missing')
    for index in sorted(indexes):
        mapping = metadata.get(index)
        mapping = mapping.get('weight_map') if isinstance(mapping, dict) else None
        if not isinstance(mapping, dict) or not mapping:
            raise AppError(422, 'model_format_invalid', 'Weight index requires a nonempty weight_map')
        suffix = '.safetensors' if index == 'model.safetensors.index.json' else '.bin'
        for shard in mapping.values():
            try:
                safe_path(shard)
            except (ValueError, TypeError, AttributeError) as error:
                raise AppError(422, 'model_format_invalid', 'Weight index contains an unsafe shard path') from error
            if not shard.endswith(suffix):
                raise AppError(422, 'model_format_invalid', 'Weight index must reference weight files of its format')
            if shard not in paths:
                raise AppError(422, 'model_format_invalid', 'Weight index references a missing shard', {'path': shard})
    return {'model_type': config['model_type'], 'validation': 'directory_structure_only',
            'runtime_verified': False}
