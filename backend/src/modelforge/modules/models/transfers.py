"""Durable import writes. Unique keys isolate a stale writer from its successor."""
from __future__ import annotations

import uuid
import logging

from minio.error import S3Error

from modelforge.errors import AppError

logger = logging.getLogger(__name__)


class ModelTransfers:
    def __init__(self, registry):
        self.registry = registry

    def upload(self, version_id, path, stream, size, sha256, attempt):
        r = self.registry
        identifier = uuid.uuid4()
        key = 'model-transfers/' + str(identifier)
        with r._connection() as connection:
            row = r._version(connection, version_id)
            r._editable(row, import_worker=True)
            r._import_running(connection, version_id, attempt)
            file = next((f for f in r._files(connection, version_id) if f['path'] == path), None)
            if file is None or size != file['size_bytes'] or sha256 != file['sha256']:
                raise AppError(409, 'model_checksum_mismatch', 'Transfer differs from the fixed manifest')
            connection.execute('''INSERT INTO model_object_transfers
                (id,model_version_id,attempt_count,bucket,object_key,state) VALUES (%s,%s,%s,%s,%s,'writing')''',
                (identifier, version_id, attempt, row['bucket'], key))
        published = False
        try:
            stream.seek(0)
            r.store.put_object(row['bucket'], key, stream, size, content_type='application/octet-stream')
            r._verify_object(row, {**file, 'object_key': key})
            with r._connection() as connection:
                r._version(connection, version_id)
                r._import_running(connection, version_id, attempt)
                connection.execute('''UPDATE model_object_transfers SET state='cleanup',updated_at=now()
                    WHERE object_key=(SELECT object_key FROM model_version_files
                        WHERE model_version_id=%s AND path=%s) AND state='published' ''',
                    (version_id, path))
                connection.execute('''UPDATE model_version_files SET object_key=%s,state='verified',verified_at=now()
                    WHERE model_version_id=%s AND path=%s''', (key, version_id, path))
                connection.execute("UPDATE model_object_transfers SET state='published',updated_at=now() WHERE id=%s", (identifier,))
            published = True
            return {'path': path, 'state': 'verified', 'reused': False}
        except AppError:
            raise
        except Exception as error:
            raise AppError(503, 'dependency_unavailable', 'Model transfer or readback failed; retry this snapshot') from error
        finally:
            if not published:
                # Do not remove a possibly committed publication after a lost commit receipt.
                # This independent transaction resolves ownership after network I/O has ended.
                self.finish(identifier)

    def finish(self, identifier):
        r = self.registry
        with r._connection() as connection:
            transfer = connection.execute('SELECT * FROM model_object_transfers WHERE id=%s FOR UPDATE', (identifier,)).fetchone()
            if transfer is None:
                return
            # A committed publication is authoritative even if the caller lost the receipt.
            referenced = connection.execute('SELECT 1 FROM model_version_files WHERE object_key=%s', (transfer['object_key'],)).fetchone()
            if referenced:
                connection.execute("UPDATE model_object_transfers SET state='published',updated_at=now() WHERE id=%s", (identifier,))
                return
            connection.execute("UPDATE model_object_transfers SET state='cleanup',updated_at=now() WHERE id=%s", (identifier,))
        self.remove(transfer)

    def remove(self, transfer):
        r = self.registry
        r.store.remove_object(transfer['bucket'], transfer['object_key'])
        try:
            r.store.stat_object(transfer['bucket'], transfer['object_key'])
        except S3Error as error:
            if error.code not in {'NoSuchKey', 'NoSuchObject'}:
                raise
        else:
            raise AppError(503, 'dependency_unavailable', 'Transfer cleanup could not be confirmed')
        with r._connection() as connection:
            connection.execute("UPDATE model_object_transfers SET state='deleted',updated_at=now() WHERE id=%s AND state='cleanup'", (transfer['id'],))

    def sweep(self):
        with self.registry._connection() as connection:
            rows = connection.execute("SELECT * FROM model_object_transfers WHERE state='cleanup' ORDER BY updated_at LIMIT 20").fetchall()
        for row in rows:
            try:
                self.remove(row)
            except Exception:
                # Retain the ledger entry for retry without starving unrelated imports.
                logger.warning('Model object cleanup failed; durable cleanup remains pending')
                with self.registry._connection() as connection:
                    connection.execute("UPDATE model_object_transfers SET updated_at=clock_timestamp() WHERE id=%s AND state='cleanup'",
                                       (row['id'],))

    def status(self, version_id):
        with self.registry._connection() as connection:
            rows = connection.execute('SELECT state FROM model_object_transfers WHERE model_version_id=%s', (version_id,)).fetchall()
        pending = sum(row['state'] in {'writing', 'cleanup'} for row in rows)
        return {'version_id': str(version_id), 'state': 'pending' if pending else 'complete',
                'pending_transfers': pending, 'reason': 'Awaiting writer completion or confirmed object removal' if pending else None}
