"""External read-only base-model registration and immutable content identity."""
import hashlib
import json
import math
from pathlib import PurePosixPath
import unicodedata
import uuid

from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from modelforge.errors import AppError
from modelforge.modules.resources import Catalog
from .manifest import ModelFile, content_fingerprint, model_structure
from .registry import ModelRegistry


def _metadata_json(text):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    value = json.loads(text, object_pairs_hook=unique_object)
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
        elif isinstance(item, str):
            item.encode('utf-8')
            if chr(0) in item:
                raise ValueError('Unsupported JSON string')
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError('Nonfinite JSON number')
    return value


class DirectoryReport(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    schema_version: int
    files: list[ModelFile] = Field(min_length=1, max_length=10_000)
    metadata: dict[str, str]


def report_identity(report):
    try:
        report = DirectoryReport.model_validate(report)
        if report.schema_version != 1:
            raise ValueError('Unknown directory report version')
        files = [row.model_dump() for row in report.files]
        paths = {row['path'] for row in files}
        if len(paths) != len(files) or any(row['sha256'] is None for row in files):
            raise ValueError('Complete unique hashed manifest required')
        if any('/'.join(path.split('/')[:i]) in paths for path in paths for i in range(1, len(path.split('/')))):
            raise ValueError('File/directory collision')
        indexes = {'model.safetensors.index.json', 'pytorch_model.bin.index.json'} & paths
        if set(report.metadata) != {'config.json'} | indexes:
            raise ValueError('Required model metadata is missing')
        metadata = {}
        by_path = {row['path']: row for row in files}
        for path, text in report.metadata.items():
            data = text.encode('utf-8')
            if len(data) > 8 * 1024**2 or len(data) != by_path[path]['size_bytes'] or hashlib.sha256(data).hexdigest() != by_path[path]['sha256']:
                raise ValueError('Model metadata differs from hashed bytes')
            metadata[path] = _metadata_json(text)
        config = metadata['config.json']
        try:
            summary = model_structure(paths, metadata)
        except AppError as error:
            raise ValueError('Invalid model structure') from error
        return {'files': sorted(files, key=lambda row: row['path']),
                'fingerprint': content_fingerprint(files), 'configuration': config,
                'format_summary': summary}
    except (ValidationError, ValueError, TypeError, AttributeError, KeyError, UnicodeError, RecursionError) as error:
        raise AppError(422, 'external_base_invalid', 'External model report is incomplete or invalid') from error


class ExternalModels:
    def __init__(self, resources):
        self.resources = resources

    def create(self, name, region, path):
        if not name.strip():
            raise AppError(422, 'validation_error', 'Model name must not be blank')
        if (not path.startswith('/model/') or str(PurePosixPath(path)) != path
                or any(part in {'.', '..', ''} for part in path.split('/')[1:])
                or chr(92) in path or any(unicodedata.category(c).startswith('C') for c in path)):
            raise AppError(422, 'external_source_invalid', 'Select an absolute model path from the public directory')
        catalog = Catalog(self.resources).read('models', {'Region': region})
        rows = [row for row in catalog['items'] if row['Path'] == path]
        if len(rows) != 1:
            raise AppError(422, 'external_source_invalid', 'Selected public model is absent or ambiguous in the current directory')
        snapshot = {'provider': 'ucloud', 'region': region, 'path': path,
                    'catalog_entry': rows[0], 'fetched_at': catalog['fetched_at']}
        model_id, version_id = uuid.uuid4(), uuid.uuid4()
        registry = ModelRegistry(self.resources)
        with registry._connection() as connection:
            connection.execute('INSERT INTO models (id,name) VALUES (%s,%s)', (model_id, name.strip()))
            connection.execute("""INSERT INTO model_versions
                (id,model_id,version_number,source_kind,state,bucket,manifest_sha256)
                VALUES (%s,%s,1,'ucloud_public','awaiting_verification',NULL,NULL)""", (version_id, model_id))
            connection.execute('INSERT INTO external_base_models (model_version_id,source_snapshot) VALUES (%s,%s)',
                               (version_id, Jsonb(snapshot)))
        return registry.get(version_id)

    def check(self, version_id, instance_id, read_directory, *, expected_fingerprint=None):
        """Called only by a server-owned execution channel, never with browser reports.

        The reader receives the stored source snapshot and the execution instance.
        It must execute the bundled probe on that instance and return its full report.
        Every execution calls this again; a historical successful check is not a permit.
        """
        if not isinstance(instance_id, str) or not instance_id.strip() or len(instance_id) > 120:
            raise AppError(422, 'validation_error', 'An execution instance identity is required')
        registry = ModelRegistry(self.resources)
        with registry._connection() as connection:
            row = registry._version(connection, version_id)
            if row['source_kind'] != 'ucloud_public' or row['state'] not in {'awaiting_verification', 'available'}:
                raise AppError(409, 'conflict', 'ModelVersion is not an external base reference')
            external = connection.execute('SELECT * FROM external_base_models WHERE model_version_id=%s FOR UPDATE',
                                          (version_id,)).fetchone()
            if expected_fingerprint is not None and row['manifest_sha256'] != expected_fingerprint:
                raise AppError(409, 'external_base_changed', 'Pinned base identity does not match the execution input')
            connection.execute("UPDATE model_versions SET state='awaiting_verification',updated_at=now() WHERE id=%s", (version_id,))
            source = external['source_snapshot']
            generation = external['check_generation'] + 1
            connection.execute("""UPDATE external_base_models SET check_generation=%s,last_check_state='pending',
                last_instance_id=%s,last_error_code=NULL WHERE model_version_id=%s""", (generation, instance_id, version_id))
        # Remote hashing may be long-running. Never keep a database lock while reading.
        failure, identity = None, None
        try:
            report = read_directory(source, instance_id)
        except Exception:
            failure = AppError(503, 'external_base_unreadable', 'Cannot verify the complete external model directory')
        else:
            try:
                identity = report_identity(report)
            except AppError as error:
                failure = error
        with registry._connection() as connection:
            row = registry._version(connection, version_id)
            external = connection.execute('SELECT * FROM external_base_models WHERE model_version_id=%s FOR UPDATE',
                                          (version_id,)).fetchone()
            if external['check_generation'] != generation:
                raise AppError(409, 'external_check_superseded', 'A newer base verification superseded this result')
            if row['source_kind'] != 'ucloud_public' or row['state'] != 'awaiting_verification':
                raise AppError(409, 'conflict', 'ModelVersion no longer accepts this verification')
            if identity and row['manifest_sha256'] is not None and row['manifest_sha256'] != identity['fingerprint']:
                failure = AppError(409, 'external_base_changed', 'External model content changed; the pinned identity was preserved')
            if failure:
                connection.execute("""UPDATE external_base_models SET last_check_state=%s,last_checked_at=now(),
                    last_error_code=%s WHERE model_version_id=%s""",
                    ('mismatch' if failure.code == 'external_base_changed' else 'failed', failure.code, version_id))
                connection.execute("UPDATE model_versions SET state='awaiting_verification',updated_at=now() WHERE id=%s", (version_id,))
            else:
                if row['manifest_sha256'] is None:
                    connection.execute("""UPDATE external_base_models SET pinned_manifest=%s,pinned_configuration=%s,
                        pinned_at=now() WHERE model_version_id=%s""",
                        (Jsonb(identity['files']), Jsonb(identity['configuration']), version_id))
                    connection.execute("UPDATE model_versions SET manifest_sha256=%s,format_summary=%s WHERE id=%s",
                                       (identity['fingerprint'], Jsonb(identity['format_summary']), version_id))
                connection.execute("""UPDATE external_base_models SET last_check_state='verified',
                    last_checked_at=now(),last_error_code=NULL WHERE model_version_id=%s""", (version_id,))
                connection.execute("UPDATE model_versions SET state='available',updated_at=now() WHERE id=%s", (version_id,))
        # Commit failed/mismatched observation without replacing the original pin.
        if failure:
            raise failure
        return registry.get(version_id)
