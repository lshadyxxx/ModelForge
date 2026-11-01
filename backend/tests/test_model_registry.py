"""Failure semantics at the model contract; substitutes are not live acceptance."""
from contextlib import contextmanager
from types import SimpleNamespace
import hashlib
import io
import uuid

import pytest

from modelforge.errors import AppError
from modelforge.modules.models import ModelFile, ModelRegistry


class Body(io.BytesIO):
    def release_conn(self):
        pass


class Store:
    def __init__(self):
        self.objects = {}
        self.corrupt = False
        self.fail_write_response = False
        self.writes = 0
        self.fail_delete = False
        self.ignore_delete = False

    def put_object(self, bucket, key, stream, size, content_type):
        self.writes += 1
        self.objects[key] = stream.read()
        if self.fail_write_response:
            raise OSError('write response lost')

    def get_object(self, bucket, key):
        from minio.error import S3Error
        if key not in self.objects:
            raise S3Error(code='NoSuchKey', message='missing', resource=key, request_id='request', host_id='host', response=None)
        return Body(b'corrupt' if self.corrupt else self.objects[key])

    def remove_object(self, bucket, key):
        if self.fail_delete:
            raise OSError('object store unavailable')
        if not self.ignore_delete:
            self.objects.pop(key, None)

    def stat_object(self, bucket, key):
        response = self.get_object(bucket, key)
        response.close()
        return SimpleNamespace(size=len(self.objects[key]))


class Connection:
    def __init__(self, version, files):
        self.version, self.files = version, files
        self.rows = []

    def execute(self, sql, params=()):
        if sql.startswith('SELECT * FROM model_versions'):
            self.rows = [dict(self.version)] if self.version else []
        elif sql.startswith('SELECT * FROM model_version_files'):
            self.rows = [dict(f) for f in self.files]
        elif sql.startswith(('SELECT reference_type', 'SELECT 1 FROM model_version_references')):
            self.rows = []
        elif sql.startswith('UPDATE model_version_files SET state='):
            for file in self.files:
                if file['path'] == params[-1]:
                    file['state'] = 'verified' if "state='verified'" in sql else 'pending'
        elif sql.startswith("UPDATE model_versions SET state='uploading'"):
            self.version['state'] = 'uploading'
        elif sql.startswith("UPDATE model_versions SET state='available'"):
            self.version['state'] = 'available'
        elif sql.startswith("UPDATE model_versions SET state='cancelled'"):
            self.version['state'] = 'cancelled'
        elif sql.startswith("UPDATE model_versions SET state='deleting'"):
            self.version['state'] = 'deleting'
        elif sql.startswith("UPDATE model_versions SET state='delete_failed'"):
            self.version['state'] = 'delete_failed'
        elif sql.startswith('DELETE FROM model_versions'):
            self.version = None
            self.files.clear()
        else:
            raise AssertionError(f'Unsupported SQL in test boundary: {sql}')
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class Pool:
    def __init__(self, connection):
        self.c = connection

    @contextmanager
    def connection(self):
        yield self.c


def subject():
    data = b'known-content'
    files = [{'path': 'model.safetensors', 'size_bytes': len(data),
              'sha256': hashlib.sha256(data).hexdigest(), 'object_key': 'test/model', 'state': 'pending'}]
    from modelforge.modules.models.manifest import content_fingerprint
    row = {'id': uuid.uuid4(), 'bucket': 'test', 'state': 'uploading',
           'manifest_sha256': content_fingerprint(files)}
    c, store = Connection(row, files), Store()
    settings = SimpleNamespace(minio_bucket='test', model_file_count_limit=100,
                               model_file_limit_bytes=100000, model_total_limit_bytes=100000)
    return ModelRegistry(SimpleNamespace(pool=Pool(c), store=store, settings=settings)), c, store, data


def test_resume_reuses_only_readback_verified_files():
    registry, c, store, data = subject()
    file = c.files[0]
    registry.upload(c.version['id'], file['path'], io.BytesIO(data), len(data), file['sha256'])
    result = registry.resume(c.version['id'], [ModelFile(**{k:file[k] for k in ('path','size_bytes','sha256')})])
    assert result['reusable_paths'] == ['model.safetensors']
    assert result['upload_paths'] == []
    assert store.writes == 1


def test_resume_marks_missing_verified_file_for_retransmission():
    registry, c, store, data = subject()
    file = c.files[0]
    registry.upload(c.version['id'], file['path'], io.BytesIO(data), len(data), file['sha256'])
    store.objects.clear()
    result = registry.resume(c.version['id'], [ModelFile(**{k:file[k] for k in ('path','size_bytes','sha256')})])
    assert result['upload_paths'] == ['model.safetensors']
    assert c.files[0]['state'] == 'pending'


def test_changed_directory_never_reuses_stale_content():
    registry, c, store, data = subject()
    with pytest.raises(AppError) as caught:
        registry.resume(c.version['id'], [ModelFile(path='model.safetensors', size_bytes=len(data), sha256='f'*64)])
    assert caught.value.code == 'model_manifest_changed'
    assert c.version['state'] == 'uploading'


def test_lost_write_response_does_not_verify_file_and_is_retryable():
    registry, c, store, data = subject()
    store.fail_write_response = True
    file = c.files[0]
    with pytest.raises(AppError) as caught:
        registry.upload(c.version['id'], file['path'], io.BytesIO(data), len(data), file['sha256'])
    assert caught.value.status == 503
    assert file['state'] == 'pending'
    assert store.objects[file['object_key']] == data
    store.fail_write_response = False
    result = registry.upload(c.version['id'], file['path'], io.BytesIO(data), len(data), file['sha256'])
    assert result['state'] == 'verified'


def test_cancelled_version_cannot_accept_file():
    registry, c, store, data = subject()
    identifier = c.version['id']
    file = c.files[0]
    manifest = [ModelFile(**{k: file[k] for k in ('path', 'size_bytes', 'sha256')})]
    assert registry.cancel(identifier)['state'] == 'cancelled'
    assert registry.get(identifier)['state'] == 'cancelled'
    assert registry.cancel(identifier)['state'] == 'cancelled'
    with pytest.raises(AppError) as caught:
        registry.upload(c.version['id'], c.files[0]['path'], io.BytesIO(data), len(data), c.files[0]['sha256'])
    assert caught.value.status == 409
    assert store.writes == 0
    assert registry.resume(identifier, manifest)['upload_paths'] == ['model.safetensors']
    assert registry.get(identifier)['state'] == 'uploading'
    assert registry.upload(identifier, file['path'], io.BytesIO(data), len(data), file['sha256'])['state'] == 'verified'


@pytest.mark.parametrize('failure', ['fail_delete', 'ignore_delete'])
def test_failed_or_unconfirmed_delete_preserves_metadata_and_can_be_retried(failure):
    registry, c, store, data = subject()
    identifier = c.version['id']
    file = c.files[0]
    registry.upload(identifier, file['path'], io.BytesIO(data), len(data), file['sha256'])
    setattr(store, failure, True)
    with pytest.raises(AppError) as caught:
        registry.delete(identifier)
    assert caught.value.status == 503
    assert registry.get(identifier)['state'] == 'delete_failed'
    assert store.objects[file['object_key']] == data
    setattr(store, failure, False)
    registry.delete(identifier)
    assert store.objects == {}
    with pytest.raises(AppError) as caught:
        registry.get(identifier)
    assert caught.value.status == 404


def test_pending_file_prevents_completion():
    registry, c, store, data = subject()
    with pytest.raises(AppError) as caught:
        registry.complete(c.version['id'])
    assert caught.value.code == 'model_incomplete'


def complete_subject():
    registry, c, store, data = subject()
    c.files.clear()
    for path, content in {'config.json': b'{"model_type":"test-only"}',
                          'tokenizer.json': b'{}', 'model.safetensors': b'fixture-not-a-real-model'}.items():
        file = {'path': path, 'size_bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
                'object_key': 'fixture/' + path, 'state': 'verified'}
        c.files.append(file)
        store.objects[file['object_key']] = content
    return registry, c, store


def test_complete_verifies_all_minio_files_without_claiming_runtime_support():
    registry, c, store = complete_subject()
    result = registry.complete(c.version['id'])
    assert result['state'] == 'available'
    assert result['verified_bytes'] == result['total_bytes']


def test_corrupt_verified_file_prevents_completion():
    registry, c, store = complete_subject()
    store.objects['fixture/model.safetensors'] = b'changed'
    with pytest.raises(AppError) as caught:
        registry.complete(c.version['id'])
    assert caught.value.code == 'model_checksum_mismatch'
    assert c.version['state'] == 'uploading'


def test_missing_shard_in_index_prevents_completion():
    registry, c, store = complete_subject()
    content = b'{"weight_map":{"layer":"missing.safetensors"}}'
    c.files.append({'path': 'model.safetensors.index.json', 'size_bytes': len(content),
                    'sha256': hashlib.sha256(content).hexdigest(), 'object_key': 'index', 'state': 'verified'})
    store.objects['index'] = content
    with pytest.raises(AppError) as caught:
        registry.complete(c.version['id'])
    assert caught.value.code == 'model_format_invalid'
    assert c.version['state'] == 'uploading'


def test_http_upload_enforces_streamed_size_and_content_identity(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from modelforge.entrypoints.api import app
    registry, c, store, data = subject()
    registry.settings.model_temporary_directory = str(tmp_path)
    resources = SimpleNamespace(pool=registry.pool, store=store, settings=registry.settings)
    monkeypatch.setattr(app.state, 'resources', resources, raising=False)
    client = TestClient(app)
    url = f'/api/v1/model-versions/{c.version["id"]}/files?path=model.safetensors'
    response = client.put(url, content=iter([data, b'excess']))
    assert response.status_code == 413
    assert response.json()['error']['code'] == 'file_too_large'
    assert store.writes == 0
    response = client.put(url, content=b'x' * len(data))
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'model_checksum_mismatch'
    assert store.writes == 0
    response = client.put(url, content=data)
    assert response.status_code == 200
    assert response.json() == {'path': 'model.safetensors', 'state': 'verified', 'reused': False}
    assert store.objects[c.files[0]['object_key']] == data
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('target', ['config.json', 'tokenizer.json', 'model.safetensors.index.json'])
def test_complete_rejects_nonweight_shard_targets(target):
    registry, c, store = complete_subject()
    c.files[:] = [file for file in c.files if file['path'] != 'model.safetensors']
    content = __import__('json').dumps({'weight_map': {'layer': target}}).encode()
    c.files.append({'path': 'model.safetensors.index.json', 'size_bytes': len(content),
                    'sha256': hashlib.sha256(content).hexdigest(), 'object_key': 'index', 'state': 'verified'})
    store.objects['index'] = content
    with pytest.raises(AppError) as caught:
        registry.complete(c.version['id'])
    assert caught.value.code == 'model_format_invalid'
    assert c.version['state'] == 'uploading'
