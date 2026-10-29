"""ModelVersion ownership: immutable directory, verified storage, references."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import uuid

from minio.error import S3Error
from psycopg.types.json import Jsonb
from psycopg.errors import LockNotAvailable

from modelforge.errors import AppError
from .manifest import ModelFile, content_fingerprint, safe_path, validate_manifest


class ModelRegistry:
    def __init__(self, resources):
        self.pool, self.store, self.settings = resources.pool, resources.store, resources.settings
        self.bucket = self.settings.minio_bucket

    @contextmanager
    def _connection(self):
        try:
            with self.pool.connection() as connection:
                yield connection
        except AppError:
            raise
        except LockNotAvailable as error:
            raise AppError(409, 'model_busy', 'ModelVersion is busy; operation was not accepted, retry after the active operation completes',
                           {'retryable': True}) from error
        except Exception as error:
            raise AppError(503, 'dependency_unavailable', 'Model metadata operation failed') from error

    @staticmethod
    def _version(connection, version_id, *, for_update=True):
        query = 'SELECT * FROM model_versions WHERE id=%s'
        if for_update:
            query += ' FOR UPDATE NOWAIT'
        row = connection.execute(query, (version_id,)).fetchone()
        if row is None:
            raise AppError(404, 'not_found', 'ModelVersion not found')
        return row

    @staticmethod
    def _files(connection, version_id):
        return list(connection.execute('SELECT * FROM model_version_files WHERE model_version_id=%s ORDER BY path', (version_id,)).fetchall())

    def _manifest(self, files):
        return validate_manifest(files, max_files=self.settings.model_file_count_limit,
            max_file_bytes=self.settings.model_file_limit_bytes, max_total_bytes=self.settings.model_total_limit_bytes)

    def create(self, name: str, files: list[ModelFile], model_id=None):
        if not name.strip():
            raise AppError(422, 'validation_error', 'Model name must not be blank')
        manifest = self._manifest(files)
        version_id = uuid.uuid4()
        with self._connection() as connection:
            if model_id is None:
                model_id = uuid.uuid4()
                connection.execute('INSERT INTO models (id,name) VALUES (%s,%s)', (model_id, name.strip()))
            elif connection.execute('SELECT id FROM models WHERE id=%s FOR UPDATE', (model_id,)).fetchone() is None:
                raise AppError(404, 'not_found', 'Model not found')
            number = connection.execute('SELECT COALESCE(MAX(version_number),0)+1 AS n FROM model_versions WHERE model_id=%s', (model_id,)).fetchone()['n']
            connection.execute('''INSERT INTO model_versions
                (id,model_id,version_number,source_kind,state,bucket,manifest_sha256)
                VALUES (%s,%s,%s,'directory','uploading',%s,%s)''',
                (version_id, model_id, number, self.bucket, content_fingerprint(manifest)))
            for file in manifest:
                key = f'models/{model_id}/versions/{version_id}/files/{file["path"]}'
                connection.execute('''INSERT INTO model_version_files (model_version_id,path,size_bytes,sha256,object_key)
                    VALUES (%s,%s,%s,%s,%s)''', (version_id, file['path'], file['size_bytes'], file['sha256'], key))
        return self.get(version_id)

    def get(self, version_id):
        with self._connection() as connection:
            row = self._version(connection, version_id, for_update=False)
            row['files'] = self._files(connection, version_id)
            row['references'] = list(connection.execute('SELECT reference_type,reference_id FROM model_version_references WHERE model_version_id=%s', (version_id,)).fetchall())
        row['verified_bytes'] = sum(f['size_bytes'] for f in row['files'] if f['state'] == 'verified')
        row['total_bytes'] = sum(f['size_bytes'] for f in row['files'])
        return row

    def list(self):
        with self._connection() as connection:
            return list(connection.execute('''SELECT v.*,m.name FROM model_versions v JOIN models m ON m.id=v.model_id
                ORDER BY v.created_at DESC''').fetchall())

    @staticmethod
    def _editable(row):
        if row['state'] != 'uploading':
            raise AppError(409, 'conflict', 'ModelVersion does not accept uploads', {'state': row['state']})

    def _verify_object(self, row, file, *, collect=False):
        response = self.store.get_object(row['bucket'], file['object_key'])
        digest = hashlib.sha256()
        size = 0
        data = bytearray()
        try:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > file['size_bytes']:
                    raise AppError(409, 'model_checksum_mismatch', 'Stored model file size changed')
                digest.update(chunk)
                if collect:
                    if size > 8 * 1024**2:
                        raise AppError(422, 'model_manifest_invalid', 'Model metadata JSON exceeds 8 MiB')
                    data.extend(chunk)
        finally:
            response.close()
            response.release_conn()
        if size != file['size_bytes'] or digest.hexdigest() != file['sha256']:
            raise AppError(409, 'model_checksum_mismatch', 'Stored model file checksum changed')
        return bytes(data)

    def upload(self, version_id, path, stream, size, sha256):
        with self._connection() as connection:
            row = self._version(connection, version_id)
            self._editable(row)
            file = next((f for f in self._files(connection, version_id) if f['path'] == path), None)
            if file is None:
                raise AppError(404, 'not_found', 'File is absent from the immutable manifest')
            if size != file['size_bytes'] or sha256 != file['sha256']:
                raise AppError(409, 'model_checksum_mismatch', 'Upload differs from the immutable manifest; create a new version')
            try:
                if file['state'] == 'verified':
                    self._verify_object(row, file)
                    return {'path': path, 'state': 'verified', 'reused': True}
                stream.seek(0)
                self.store.put_object(row['bucket'], file['object_key'], stream, size, content_type='application/octet-stream')
                self._verify_object(row, file)
            except AppError:
                raise
            except Exception as error:
                raise AppError(503, 'dependency_unavailable', 'Model file upload or verification failed',
                    {'version_id': str(version_id), 'path': path, 'retryable': True}) from error
            connection.execute(
                "UPDATE model_version_files SET state='verified',verified_at=now() WHERE model_version_id=%s AND path=%s", (version_id,path))
        return {'path': path, 'state': 'verified', 'reused': False}

    def resume(self, version_id, files):
        manifest = self._manifest(files)
        reusable, upload = [], []
        with self._connection() as connection:
            row = self._version(connection, version_id)
            if row['state'] not in {'uploading', 'cancelled'}:
                raise AppError(409, 'conflict', 'ModelVersion cannot be resumed', {'state': row['state']})
            if content_fingerprint(manifest) != row['manifest_sha256']:
                raise AppError(409, 'model_manifest_changed', 'Directory content changed; create a new version')
            for file in self._files(connection, version_id):
                if file['state'] == 'verified':
                    try:
                        self._verify_object(row, file)
                    except AppError as error:
                        if error.code != 'model_checksum_mismatch':
                            raise
                    except S3Error as error:
                        if error.code not in {'NoSuchKey', 'NoSuchObject'}:
                            raise
                    else:
                        reusable.append(file['path'])
                        continue
                    connection.execute("UPDATE model_version_files SET state='pending',verified_at=NULL WHERE model_version_id=%s AND path=%s",
                                       (version_id, file['path']))
                upload.append(file['path'])
            connection.execute("UPDATE model_versions SET state='uploading',updated_at=now() WHERE id=%s", (version_id,))
        return {'version_id': str(version_id), 'reusable_paths': reusable, 'upload_paths': upload}

    def complete(self, version_id):
        with self._connection() as connection:
            row = self._version(connection, version_id)
            self._editable(row)
            files = self._files(connection, version_id)
            if any(f['state'] != 'verified' for f in files):
                raise AppError(409, 'model_incomplete', 'All manifest files must be verified before completion')
            by_path = {f['path']: f for f in files}
            if 'config.json' not in by_path:
                raise AppError(422, 'model_format_invalid', 'Complete model directory requires config.json')
            metadata_paths = {'config.json'}
            indexes = {'model.safetensors.index.json', 'pytorch_model.bin.index.json'} & by_path.keys()
            metadata_paths |= indexes
            metadata = {}
            try:
                for file in files:
                    data = self._verify_object(row, file, collect=file['path'] in metadata_paths)
                    if file['path'] in metadata_paths:
                        try:
                            metadata[file['path']] = json.loads(data)
                        except (ValueError, UnicodeError) as error:
                            raise AppError(422, 'model_format_invalid', 'Model configuration JSON is invalid') from error
            except AppError:
                raise
            except Exception as error:
                raise AppError(503, 'dependency_unavailable', 'Cannot verify all model files in MinIO') from error
            config = metadata['config.json']
            if not isinstance(config, dict) or not isinstance(config.get('model_type'), str) or not config['model_type'].strip():
                raise AppError(422, 'model_format_invalid', 'config.json requires model_type')
            if not ({'tokenizer.json', 'tokenizer.model'} & by_path.keys()) and not {'vocab.json', 'merges.txt'} <= by_path.keys():
                raise AppError(422, 'model_format_invalid', 'Tokenizer files are missing')
            if not ({'model.safetensors', 'pytorch_model.bin'} & by_path.keys()) and not indexes:
                raise AppError(422, 'model_format_invalid', 'Model weights or shard index are missing')
            for index in indexes:
                mapping = metadata[index].get('weight_map') if isinstance(metadata[index], dict) else None
                if not isinstance(mapping, dict) or not mapping:
                    raise AppError(422, 'model_format_invalid', 'Weight index requires a nonempty weight_map')
                for shard in mapping.values():
                    try:
                        safe_path(shard)
                    except (ValueError, TypeError, AttributeError) as error:
                        raise AppError(422, 'model_format_invalid', 'Weight index contains an unsafe shard path') from error
                    if shard not in by_path:
                        raise AppError(422, 'model_format_invalid', 'Weight index references a missing shard', {'path': shard})
            summary = {'model_type': config['model_type'], 'validation': 'directory_structure_only',
                       'runtime_verified': False}
            connection.execute("UPDATE model_versions SET state='available',format_summary=%s,updated_at=now() WHERE id=%s",
                               (Jsonb(summary), version_id))
        return self.get(version_id)

    def cancel(self, version_id):
        with self._connection() as connection:
            row = self._version(connection, version_id)
            if row['state'] != 'cancelled':
                self._editable(row)
                connection.execute("UPDATE model_versions SET state='cancelled',updated_at=now() WHERE id=%s", (version_id,))
        return self.get(version_id)

    def delete(self, version_id):
        with self._connection() as connection:
            row = self._version(connection, version_id)
            if connection.execute('SELECT 1 FROM model_version_references WHERE model_version_id=%s', (version_id,)).fetchone():
                raise AppError(409, 'model_in_use', 'ModelVersion is referenced')
            connection.execute("UPDATE model_versions SET state='deleting',updated_at=now() WHERE id=%s", (version_id,))
            files = self._files(connection, version_id)
        try:
            for file in files:
                self.store.remove_object(row['bucket'], file['object_key'])
                try:
                    self.store.stat_object(row['bucket'], file['object_key'])
                except S3Error as error:
                    if error.code not in {'NoSuchKey', 'NoSuchObject'}:
                        raise
                else:
                    raise ValueError('Object deletion was not confirmed')
        except Exception as error:
            with self._connection() as connection:
                connection.execute("UPDATE model_versions SET state='delete_failed',updated_at=now() WHERE id=%s", (version_id,))
            raise AppError(503, 'dependency_unavailable', 'Model deletion failed; retry required', {'version_id': str(version_id)}) from error
        with self._connection() as connection:
            self._version(connection, version_id)
            connection.execute('DELETE FROM model_versions WHERE id=%s', (version_id,))

    def add_reference(self, version_id, reference_type, reference_id, *, connection):
        row = self._version(connection, version_id)
        if row['state'] != 'available':
            raise AppError(409, 'conflict', 'Only an available ModelVersion can be referenced')
        connection.execute('''INSERT INTO model_version_references (model_version_id,reference_type,reference_id)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING''', (version_id,reference_type,reference_id))
