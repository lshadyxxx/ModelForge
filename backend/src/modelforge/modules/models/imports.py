"""Model-owned background imports. A session lock enforces one importer."""
from __future__ import annotations

import hashlib
import shutil
import threading
from pathlib import Path

from minio.error import S3Error

from modelforge.errors import AppError
from .manifest import ModelFile
from .modelscope import ModelScope
from .registry import ModelRegistry
from .transfers import ModelTransfers

IMPORT_LOCK = 742193601


class Interrupted(Exception):
    pass


class ModelImports:
    def __init__(self, resources):
        self.registry = ModelRegistry(resources)
        self.source = ModelScope(resources.source_http)
        self.settings = resources.settings
        self.transfers = ModelTransfers(self.registry)

    def cleanup_status(self, version_id):
        return self.transfers.status(version_id)

    def discard_local(self, version_id):
        shutil.rmtree(Path(self.settings.model_temporary_directory) / str(version_id), ignore_errors=True)

    def create(self, name, repository, revision, model_id=None):
        snapshot = self.source.snapshot(repository, revision)
        files = [ModelFile(**{key: file[key] for key in ('path', 'size_bytes', 'sha256')})
                 for file in snapshot['files']]
        return self.registry.create(name, files, model_id, source_snapshot=snapshot)

    @staticmethod
    def _job(connection, version_id):
        row = connection.execute('SELECT * FROM model_imports WHERE model_version_id=%s', (version_id,)).fetchone()
        if row is None:
            raise AppError(409, 'conflict', 'ModelVersion is not a public repository import')
        return row

    def cancel(self, version_id):
        with self.registry._connection() as connection:
            row = self.registry._version(connection, version_id)
            job = self._job(connection, version_id)
            if row['state'] in {'available', 'deleting', 'delete_failed'}:
                raise AppError(409, 'conflict', 'Import cannot be cancelled in this state')
            if job['state'] == 'running':
                connection.execute('UPDATE model_imports SET cancel_requested=true,updated_at=now() WHERE model_version_id=%s', (version_id,))
            else:
                connection.execute("UPDATE model_imports SET state='cancelled',cancel_requested=true,current_path=NULL,current_bytes=0,updated_at=now() WHERE model_version_id=%s", (version_id,))
                connection.execute("UPDATE model_versions SET state='cancelled',updated_at=now() WHERE id=%s", (version_id,))
        return self.registry.get(version_id)

    def retry(self, version_id):
        with self.registry._connection() as connection:
            row = self.registry._version(connection, version_id)
            job = self._job(connection, version_id)
            if row['state'] in {'available', 'deleting', 'delete_failed'} or job['state'] not in {'failed', 'cancelled'}:
                raise AppError(409, 'conflict', 'Only failed or cancelled imports can be retried')
            connection.execute("UPDATE model_versions SET state='uploading',updated_at=now() WHERE id=%s", (version_id,))
            connection.execute("UPDATE model_imports SET state='queued',cancel_requested=false,current_path=NULL,current_bytes=0,error_code=NULL,error_message=NULL,updated_at=now() WHERE model_version_id=%s", (version_id,))
        return self.registry.get(version_id)

    def _claim(self, connection):
        with connection.transaction():
            # The session lock proves any durable running row belongs to a dead importer.
            row = connection.execute("""SELECT v.id FROM model_versions v JOIN model_imports j ON j.model_version_id=v.id
                WHERE v.state='uploading' AND j.state IN ('queued','running')
                ORDER BY j.updated_at FOR UPDATE OF v SKIP LOCKED LIMIT 1""").fetchone()
            if row is None:
                return None
            job = connection.execute("UPDATE model_imports SET state='running',attempt_count=attempt_count+1,current_path=NULL,current_bytes=0,error_code=NULL,error_message=NULL,updated_at=now() WHERE model_version_id=%s RETURNING attempt_count", (row['id'],)).fetchone()
            return row['id'], job['attempt_count']

    def _checkpoint(self, lock, version_id, attempt, path, size, stop):
        # Detect a lost session before doing more external I/O. Errors never expose URLs.
        lock.execute('SELECT 1')
        lock.commit()
        with self.registry._connection() as connection:
            self.registry._version(connection, version_id)
            job = self._job(connection, version_id)
            interrupted = (stop.is_set() or job['cancel_requested'] or job['state'] != 'running'
                           or job['attempt_count'] != attempt)
            if not interrupted:
                connection.execute('UPDATE model_imports SET current_path=%s,current_bytes=%s,updated_at=now() WHERE model_version_id=%s',
                                   (path, size, version_id))
        if interrupted:
            raise Interrupted()

    def _transfer(self, lock, version_id, attempt, stop):
        row = self.registry.get(version_id)
        snapshot = row['import']['source_snapshot']
        directory = Path(self.settings.model_temporary_directory) / str(version_id)
        for file in row['files']:
            checkpoint = lambda size: self._checkpoint(lock, version_id, attempt, file['path'], size, stop)
            checkpoint(0)
            if file['state'] == 'verified':
                try:
                    self.registry._verify_object(row, file)
                except AppError as error:
                    if error.code != 'model_checksum_mismatch':
                        raise
                except S3Error as error:
                    if error.code not in {'NoSuchKey', 'NoSuchObject'}:
                        raise
                else:
                    continue
                with self.registry._connection() as connection:
                    self.registry._version(connection, version_id)
                    self.registry._import_running(connection, version_id, attempt)
                    connection.execute("UPDATE model_version_files SET state='pending',verified_at=NULL WHERE model_version_id=%s AND path=%s", (version_id, file['path']))
            directory.mkdir(parents=True, exist_ok=True)
            partial = directory / (hashlib.sha256(file['path'].encode('utf-8')).hexdigest() + '.part')
            if partial.exists() and partial.stat().st_size > file['size_bytes']:
                partial.unlink()
            stream = partial.open('r+b' if partial.exists() else 'w+b')
            try:
                stream.seek(0, 2)
                resume_from = stream.tell()
                stream.seek(resume_from)
                try:
                    self.source.download(
                        snapshot['repository'], snapshot['revision'], file, stream, checkpoint,
                        resume_from=resume_from)
                except AppError as error:
                    if error.code == 'model_checksum_mismatch' and not stream.closed:
                        stream.close()
                        partial.unlink(missing_ok=True)
                    raise
                checkpoint(file['size_bytes'])
                self.registry.upload(version_id, file['path'], stream, file['size_bytes'], file['sha256'], import_attempt=attempt)
            finally:
                if not stream.closed:
                    stream.close()
            partial.unlink(missing_ok=True)
        try:
            directory.rmdir()
        except OSError:
            pass
        self._checkpoint(lock, version_id, attempt, None, 0, stop)
        self.registry.complete(version_id, import_attempt=attempt)

    def _settle(self, version_id, attempt, error=None):
        with self.registry._connection() as connection:
            row = self.registry._version(connection, version_id)
            job = self._job(connection, version_id)
            if row['state'] == 'available' or job['state'] != 'running' or job['attempt_count'] != attempt:
                return
            state = 'cancelled' if job['cancel_requested'] else ('failed' if error else 'queued')
            if state == 'cancelled':
                connection.execute("UPDATE model_versions SET state='cancelled',updated_at=now() WHERE id=%s", (version_id,))
            connection.execute("UPDATE model_imports SET state=%s,current_path=NULL,current_bytes=0,error_code=%s,error_message=%s,updated_at=now() WHERE model_version_id=%s",
                               (state, error.code if error else None, error.message if error else None, version_id))

    def run_once(self, stop=None):
        stop = stop or threading.Event()
        if stop.is_set():
            return False
        self.transfers.sweep()
        with self.registry.pool.connection() as lock:
            acquired = lock.execute('SELECT pg_try_advisory_lock(%s) AS acquired', (IMPORT_LOCK,)).fetchone()['acquired']
            lock.commit()
            if not acquired:
                return False
            try:
                claim = self._claim(lock)
                if claim is None:
                    return False
                version_id, attempt = claim
                try:
                    self._transfer(lock, version_id, attempt, stop)
                except Interrupted:
                    self._settle(version_id, attempt)
                except AppError as error:
                    self._settle(version_id, attempt, error)
                except Exception:
                    self._settle(version_id, attempt, AppError(503, 'model_import_failed',
                        'Import interrupted by a dependency or temporary storage failure; retry this fixed snapshot'))
                return True
            finally:
                if not lock.closed and not lock.broken:
                    lock.rollback()
                    lock.execute('SELECT pg_advisory_unlock(%s)', (IMPORT_LOCK,))
                    lock.commit()
