"""Models-owned preparation and immutable Adapter publication."""
import hashlib
import io
import json
import tempfile
import uuid
import zipfile
from pathlib import PurePosixPath
from psycopg.types.json import Jsonb
from modelforge.errors import AppError
from .registry import ModelRegistry
from .external import ExternalModels
from .manifest import safe_path

_ADAPTER_FILES = {'adapter_config.json', 'adapter_model.safetensors'}


def _archive_file(path):
    info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o100600 << 16
    return info


class AdapterDownload:
    """A verified, ready-to-stream Adapter ZIP and its response metadata."""

    def __init__(self, row, stream, filename, size, sha256):
        self.row = row
        self.stream = stream
        self.filename = filename
        self.size = size
        self.sha256 = sha256

    def chunks(self, block_size=1024**2):
        try:
            while data := self.stream.read(block_size):
                yield data
        finally:
            self.stream.close()

class ModelExecution:
    def __init__(self, resources):
        self.resources = resources

    def prepare(self, snapshot, channel, instance_id, job_id):
        if snapshot['source_kind'] == 'ucloud_public':
            ExternalModels(self.resources).check(uuid.UUID(snapshot['id']), instance_id,
                lambda source, instance: channel.probe(instance, job_id, source['path']),
                expected_fingerprint=snapshot['fingerprint'])
            return snapshot['external']['path']
        for item in snapshot['files']:
            response = self.resources.store.get_object(snapshot['bucket'], item['object_key'])
            try:
                with tempfile.SpooledTemporaryFile(max_size=8*1024**2) as target:
                    digest = hashlib.sha256(); size = 0
                    while block := response.read(1024**2):
                        digest.update(block); size += len(block); target.write(block)
                    if size != item['size_bytes'] or digest.hexdigest() != item['sha256']:
                        raise AppError(503, 'base_integrity_failed', 'Managed base model integrity verification failed')
                    target.seek(0)
                    channel.upload(instance_id, job_id, 'base/'+safe_path(item['path']), target, size, item['sha256'])
            finally:
                response.close(); response.release_conn()
        endpoint = channel.endpoint(instance_id)
        return endpoint.root+'/'+str(job_id)+'/base'

class Adapters:
    def __init__(self, resources):
        self.resources = resources; self.pool = resources.pool

    def available_count(self):
        with self.pool.connection() as c:
            return c.execute("SELECT count(*) AS n FROM adapter_versions WHERE state='available'").fetchone()['n']

    def list(self, *, attempt_id=None, offset=0, limit=200):
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=200:
            raise AppError(422,'validation_error','Use a nonnegative offset and a page size from 1 to 200')
        where=' WHERE source_attempt_id=%s' if attempt_id is not None else ''
        values=[attempt_id] if attempt_id is not None else []
        with self.pool.connection() as c:
            return c.execute('SELECT * FROM adapter_versions'+where+' ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s',
                             (*values,limit,offset)).fetchall()

    def get(self, identifier, *, available=True):
        with self.pool.connection() as c:
            row = c.execute('SELECT * FROM adapter_versions WHERE id=%s', (identifier,)).fetchone()
        if not row: raise AppError(404, 'not_found', 'Adapter not found')
        if available and row['state'] != 'available':
            raise AppError(409, 'adapter_unavailable', 'Adapter synchronization has not completed')
        return row

    def publish(self, attempt_id, snapshot, channel, instance_id, result):
        published = []
        for role in ('best','final'):
            path = result[role+'_path']
            if path != 'output' and not (path.startswith('output/checkpoint-') and path.removeprefix('output/checkpoint-').isdigit()):
                raise AppError(503, 'adapter_output_invalid', 'Invalid Adapter output directory')
            report = channel.call(instance_id, attempt_id, 'manifest', path=path)
            files = [f for f in report['files'] if PurePosixPath(f['path']).parent == PurePosixPath(path)
                     and PurePosixPath(f['path']).name in ('adapter_config.json','adapter_model.safetensors')]
            if {PurePosixPath(f['path']).name for f in files} != {'adapter_config.json','adapter_model.safetensors'}:
                raise AppError(503, 'adapter_incomplete', 'Both Adapter config and safetensors are required')
            files = sorted([{'path': PurePosixPath(f['path']).name, 'remote_path': f['path'],
                             'size': f['size'], 'sha256': f['sha256']} for f in files], key=lambda f:f['path'])
            if any(type(f['size']) is not int or not 1 <= f['size'] <= self.resources.settings.model_file_limit_bytes
                   or len(f['sha256']) != 64 for f in files):
                raise AppError(503, 'adapter_output_invalid', 'Adapter file limits exceeded')
            fingerprint = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
            identifier = uuid.uuid5(uuid.UUID(str(attempt_id)), role)
            bucket = self.resources.settings.minio_bucket
            with self.pool.connection() as c:
                c.execute('''INSERT INTO adapter_versions(id,source_attempt_id,role,snapshot,manifest,fingerprint,bucket,metrics)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (source_attempt_id,role) DO NOTHING''',
                    (identifier, attempt_id, role, Jsonb(snapshot), Jsonb(files),fingerprint,bucket,Jsonb(result[role+'_metrics'])))
            existing = self.get(identifier, available=False)
            if existing['manifest'] != files or existing['fingerprint'] != fingerprint:
                raise AppError(409, 'adapter_changed', 'Previously observed output changed; retain instance for investigation')
            if existing['state'] != 'available':
                for item in files:
                    key = 'adapters/'+str(identifier)+'/'+item['path']
                    with tempfile.SpooledTemporaryFile(max_size=8*1024**2) as target:
                        channel.download(instance_id, attempt_id, {**item,'path':item['remote_path']}, target)
                        if item['path'] == 'adapter_config.json':
                            if item['size'] > 1024**2: raise AppError(422,'adapter_invalid','Adapter config is too large')
                            target.seek(0); config = json.load(target)
                            if config.get('peft_type') != 'LORA' or config.get('auto_mapping') or config.get('auto_map'):
                                raise AppError(422,'adapter_invalid','Only a plain LoRA Adapter is supported')
                        target.seek(0)
                        self.resources.store.put_object(bucket,key,target,item['size'])
                    self._verify(bucket,key,item)
                content=json.dumps({'schema':1,'id':str(identifier),'attempt_id':str(attempt_id),
                    'role':role,'fingerprint':fingerprint,'files':files,'snapshot':snapshot,'metrics':result[role+'_metrics']},
                    sort_keys=True,ensure_ascii=False,allow_nan=False).encode()
                key='adapters/'+str(identifier)+'/manifest.json'
                self.resources.store.put_object(bucket,key,io.BytesIO(content),len(content))
                self._verify(bucket,key,{'size':len(content),'sha256':hashlib.sha256(content).hexdigest()})
            published.append(identifier)
        # Both roles are one publication gate. A failed Final transfer keeps Best
        # unavailable even when its own bytes have already passed verification.
        with self.pool.connection() as c:
            for identifier in published:
                c.execute("UPDATE adapter_versions SET state='available' WHERE id=%s", (identifier,))
        return [self.get(identifier) for identifier in published]

    def _verify(self,bucket,key,item):
        response = self.resources.store.get_object(bucket,key)
        try:
            digest = hashlib.sha256(); size = 0
            while data := response.read(1024**2): digest.update(data); size += len(data)
            if size != item['size'] or digest.hexdigest() != item['sha256']:
                raise AppError(503,'adapter_sync_failed','Adapter MinIO read-back verification failed')
        finally: response.close(); response.release_conn()

    def download(self, identifier):
        """Package the immutable Adapter after re-verifying every persisted byte."""
        row = self.get(identifier)
        files = self._download_manifest(row)
        manifest = self._download_manifest_document(row)
        archive_stream = tempfile.SpooledTemporaryFile(max_size=8*1024**2, mode='w+b')
        try:
            with zipfile.ZipFile(archive_stream, 'w', compression=zipfile.ZIP_STORED,
                                 allowZip64=True) as archive:
                archive.writestr(_archive_file('manifest.json'), manifest)
                for item in files:
                    key = 'adapters/' + str(identifier) + '/' + item['path']
                    response = self.resources.store.get_object(row['bucket'], key)
                    try:
                        with archive.open(_archive_file(item['path']), 'w',
                                          force_zip64=True) as target:
                            digest = hashlib.sha256()
                            size = 0
                            while data := response.read(1024**2):
                                size += len(data)
                                if size > item['size']:
                                    raise AppError(
                                        503, 'adapter_download_integrity_failed',
                                        'Stored Adapter is larger than its immutable manifest')
                                digest.update(data)
                                target.write(data)
                        if size != item['size'] or digest.hexdigest() != item['sha256']:
                            raise AppError(
                                503, 'adapter_download_integrity_failed',
                                'Stored Adapter does not match its immutable manifest',
                                {'path': item['path']})
                    finally:
                        response.close()
                        response.release_conn()
            size = archive_stream.tell()
            archive_stream.seek(0)
            digest = hashlib.sha256()
            while data := archive_stream.read(1024**2):
                digest.update(data)
            archive_stream.seek(0)
            role = row['role'] if row['role'] in {'best', 'final'} else 'adapter'
            return AdapterDownload(
                row=row,
                stream=archive_stream,
                filename='modelforge-' + role + '-' + str(identifier)[:8] + '.zip',
                size=size,
                sha256=digest.hexdigest(),
            )
        except Exception:
            archive_stream.close()
            raise

    def _download_manifest(self, row):
        files = row['manifest']
        if not isinstance(files, list) or len(files) != len(_ADAPTER_FILES):
            raise AppError(503, 'adapter_download_manifest_invalid',
                           'Adapter manifest does not contain exactly two files')
        seen = set()
        for item in files:
            if not isinstance(item, dict):
                raise AppError(503, 'adapter_download_manifest_invalid',
                               'Adapter manifest contains an invalid file entry')
            path = item.get('path')
            try:
                safe_path(path)
            except (TypeError, ValueError) as error:
                raise AppError(503, 'adapter_download_manifest_invalid',
                               'Adapter manifest contains an unsafe file path') from error
            if path not in _ADAPTER_FILES or path in seen:
                raise AppError(503, 'adapter_download_manifest_invalid',
                               'Adapter manifest contains an unexpected or duplicate file',
                               {'path': path})
            seen.add(path)
            if (type(item.get('size')) is not int or item['size'] < 1
                    or not isinstance(item.get('sha256'), str)
                    or len(item['sha256']) != 64
                    or any(char not in '0123456789abcdef' for char in item['sha256'])):
                raise AppError(503, 'adapter_download_manifest_invalid',
                               'Adapter manifest contains invalid file integrity data',
                               {'path': path})
        return sorted(files, key=lambda item: item['path'])

    def _download_manifest_document(self, row):
        expected = json.dumps({
            'schema': 1,
            'id': str(row['id']),
            'attempt_id': str(row['source_attempt_id']),
            'role': row['role'],
            'fingerprint': row['fingerprint'],
            'files': row['manifest'],
            'snapshot': row['snapshot'],
            'metrics': row['metrics'],
        }, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
        key = 'adapters/' + str(row['id']) + '/manifest.json'
        response = self.resources.store.get_object(row['bucket'], key)
        try:
            data = response.read(len(expected) + 1)
        finally:
            response.close()
            response.release_conn()
        if data != expected:
            raise AppError(503, 'adapter_download_manifest_invalid',
                           'Stored Adapter manifest differs from its immutable lineage')
        return data

    def restore(self, identifier, channel, instance_id, job_id):
        row = self.get(identifier)
        for item in row['manifest']:
            key = 'adapters/'+str(identifier)+'/'+item['path']
            self._verify(row['bucket'],key,item)
            source = self.resources.store.get_object(row['bucket'],key)
            try:
                channel.upload(instance_id,job_id,'adapter/'+item['path'],source,item['size'],item['sha256'])
            finally: source.close(); source.release_conn()
        return row
