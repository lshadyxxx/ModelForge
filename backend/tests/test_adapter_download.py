import hashlib
import io
import json
from types import SimpleNamespace
import uuid
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from modelforge.errors import AppError, configure_errors
from modelforge.modules.models.artifacts import AdapterDownload, Adapters
from modelforge.modules.serving.routes import router


class Response:
    def __init__(self, data):
        self.stream = io.BytesIO(data)
        self.closed = False

    def read(self, size=-1):
        return self.stream.read(size)

    def close(self):
        self.closed = True

    def release_conn(self):
        pass


class Store:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, bucket, key):
        assert bucket == 'fixture-bucket'
        return Response(self.objects[key])


def fixture():
    identifier = uuid.uuid4()
    attempt_id = uuid.uuid4()
    config = b'{"peft_type":"LORA","r":8}'
    weights = (b'fixture-safetensors-' * 4096) + b'end'
    row = {
        'id': identifier,
        'source_attempt_id': attempt_id,
        'role': 'best',
        'fingerprint': 'a' * 64,
        'bucket': 'fixture-bucket',
        'snapshot': {
            'base': {'id': str(uuid.uuid4()), 'fingerprint': 'b' * 64},
            'dataset': {'id': str(uuid.uuid4()), 'sha256': 'c' * 64},
            'config': {'template': 'qwen3_nothink', 'cutoff_len': 512, 'lora_rank': 8},
        },
        'metrics': {'eval_loss': 0.5},
        'manifest': sorted([
            {'path': 'adapter_config.json', 'remote_path': 'output/adapter_config.json',
             'size': len(config), 'sha256': hashlib.sha256(config).hexdigest()},
            {'path': 'adapter_model.safetensors',
             'remote_path': 'output/adapter_model.safetensors',
             'size': len(weights), 'sha256': hashlib.sha256(weights).hexdigest()},
        ], key=lambda item: item['path']),
    }
    manifest = json.dumps({
        'schema': 1,
        'id': str(identifier),
        'attempt_id': str(attempt_id),
        'role': 'best',
        'fingerprint': row['fingerprint'],
        'files': row['manifest'],
        'snapshot': row['snapshot'],
        'metrics': row['metrics'],
    }, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    objects = {
        'adapters/' + str(identifier) + '/manifest.json': manifest,
        'adapters/' + str(identifier) + '/adapter_config.json': config,
        'adapters/' + str(identifier) + '/adapter_model.safetensors': weights,
    }
    resources = SimpleNamespace(store=Store(objects), pool=None)
    return identifier, row, resources, config, weights, manifest


def subject(resources, row, monkeypatch):
    result = Adapters(resources)
    monkeypatch.setattr(result, 'get', lambda identifier: row)
    return result


def test_download_is_verified_zip_with_exact_adapter_files(monkeypatch):
    identifier, row, resources, config, weights, manifest = fixture()
    adapters = subject(resources, row, monkeypatch)
    archive = adapters.download(identifier)
    payload = b''.join(archive.chunks())
    repeated = adapters.download(identifier)
    repeated_payload = b''.join(repeated.chunks())

    assert archive.filename == 'modelforge-best-' + str(identifier)[:8] + '.zip'
    assert archive.size == len(payload)
    assert archive.sha256 == hashlib.sha256(payload).hexdigest()
    assert repeated.sha256 == archive.sha256
    assert repeated_payload == payload
    with zipfile.ZipFile(io.BytesIO(payload)) as downloaded:
        assert downloaded.namelist() == [
            'manifest.json', 'adapter_config.json', 'adapter_model.safetensors']
        assert downloaded.read('manifest.json') == manifest
        assert downloaded.read('adapter_config.json') == config
        assert downloaded.read('adapter_model.safetensors') == weights


def test_download_rejects_object_bytes_that_do_not_match_manifest(monkeypatch):
    identifier, row, resources, *_ = fixture()
    resources.store.objects[
        'adapters/' + str(identifier) + '/adapter_model.safetensors'] = b'tampered'

    with pytest.raises(AppError) as caught:
        subject(resources, row, monkeypatch).download(identifier)

    assert caught.value.code == 'adapter_download_integrity_failed'
    assert caught.value.details == {'path': 'adapter_model.safetensors'}


def test_download_rejects_manifest_document_drift(monkeypatch):
    identifier, row, resources, *_ = fixture()
    resources.store.objects['adapters/' + str(identifier) + '/manifest.json'] = b'{}'

    with pytest.raises(AppError) as caught:
        subject(resources, row, monkeypatch).download(identifier)

    assert caught.value.code == 'adapter_download_manifest_invalid'


def test_download_response_exposes_archive_integrity(monkeypatch):
    identifier, row, resources, *_ = fixture()
    verified = subject(resources, row, monkeypatch).download(identifier)
    monkeypatch.setattr(Adapters, 'download', lambda self, requested: verified)
    app = FastAPI()
    app.state.resources = resources
    configure_errors(app)
    app.include_router(router)

    response = TestClient(app).get('/api/v1/serving/adapters/' + str(identifier) + '/download')

    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/zip'
    assert response.headers['content-disposition'] == (
        'attachment; filename="' + verified.filename + '"')
    assert response.headers['content-length'] == str(verified.size)
    assert response.headers['x-content-sha256'] == verified.sha256
    assert response.headers['x-adapter-fingerprint'] == row['fingerprint']
    with zipfile.ZipFile(io.BytesIO(response.content)) as downloaded:
        assert downloaded.namelist() == [
            'manifest.json', 'adapter_config.json', 'adapter_model.safetensors']
