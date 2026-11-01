"""Real isolated PostgreSQL/MinIO; provider and model bytes are explicit fixtures."""
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from modelforge.errors import AppError
from modelforge.infrastructure.model_probe import collect_directory
from modelforge.bootstrap import Resources
from modelforge.settings import Settings
from modelforge.entrypoints.api import app
from modelforge.modules.models.registry import ModelRegistry
from modelforge.modules.models.external import ExternalModels

if os.getenv('MF_TEST_INTEGRATION') == '1':
    if (os.getenv('MF_TEST_ISOLATED_STORES') != '1'
            or not os.getenv('MF_PG_DATABASE', '').startswith('modelforge_test_')
            or not os.getenv('MF_MINIO_BUCKET', '').startswith('modelforge-test-')):
        raise pytest.UsageError('External model tests require explicitly disposable database and bucket')

pytestmark = pytest.mark.skipif(os.getenv('MF_TEST_INTEGRATION') != '1', reason='Requires isolated PostgreSQL and MinIO')
SOURCE = '/model/ModelScope/example/base'


@pytest.fixture
def environment(monkeypatch):
    resources = Resources.open(Settings(ucloud_public_key='dummy-public', ucloud_private_key='dummy-private'))
    resources.source_http.close()
    resources.source_http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
        'RetCode': 0, 'Action': 'DescribeModelRepositoryModelsResponse',
        'Models': [{'Name': 'example-base', 'Path': SOURCE, 'Size': 'fixture', 'Tag': 'LLM'}]})))
    monkeypatch.setattr(app.state, 'resources', resources, raising=False)
    client = TestClient(app)
    external, registry = ExternalModels(resources), ModelRegistry(resources)
    created = []
    def register():
        response = client.post('/api/v1/models/external-bases', json={
            'name': 'external fixture', 'region': 'fixture-region', 'path': SOURCE})
        assert response.status_code == 201, response.text
        row = response.json(); assert 'id' in row, row; created.append(row['id']); return row
    yield resources, client, external, registry, register
    for identifier in created:
        with resources.pool.connection() as connection:
            connection.execute('DELETE FROM model_version_references WHERE model_version_id=%s', (identifier,))
        try:
            registry.delete(identifier)
        except AppError as error:
            if error.status != 404:
                raise
    resources.close()


def test_register_only_catalog_entries_without_claiming_a_copy(environment):
    resources, client, external, registry, register = environment
    row = register()
    assert row['source_kind'] == 'ucloud_public'
    assert row['state'] == 'awaiting_verification'
    assert row['bucket'] is None and row['manifest_sha256'] is None
    assert row['files'] == [] and row['verified_bytes'] == row['total_bytes'] == 0
    assert row['external']['last_check_state'] == 'pending'
    assert row['external']['source_snapshot']['path'] == SOURCE
    assert row['compatibility_state'] == 'unverified'
    assert client.get('/api/v1/model-versions/'+row['id']).json()['external'] == row['external']
    assert client.post('/api/v1/models/external-bases', json={
        'name': 'invalid', 'region': 'fixture-region', 'path': '/not/in/catalog'}).status_code == 422
    assert list(resources.store.list_objects(resources.settings.minio_bucket, prefix='models/'+row['model_id']+'/', recursive=True)) == []


CONTENT = {'config.json': b'{"model_type":"fixture-only"}', 'tokenizer.json': b'{}',
           'model.safetensors': b'fixture-only-weights', 'nested/readme': b'extra-file'}


def model_directory(root):
    for name, data in CONTENT.items():
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    return root


def test_server_check_pins_full_identity_without_creating_managed_files(environment, tmp_path):
    from modelforge.infrastructure.model_probe import collect_directory
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public'); calls = []
    def reader(source, instance_id):
        calls.append((source['path'], instance_id))
        return collect_directory(root)
    checked = external.check(row['id'], 'fixture-instance', reader)
    assert checked['state'] == 'available'
    assert checked['external']['last_check_state'] == 'verified'
    assert len(checked['external']['pinned_manifest']) == len(CONTENT)
    assert checked['external']['pinned_configuration'] == {'model_type': 'fixture-only'}
    assert checked['manifest_sha256'] and checked['bucket'] is None
    assert checked['compatibility_state'] == 'unverified'
    assert checked['verified_bytes'] == 0
    assert calls == [(SOURCE, 'fixture-instance')]
    again = client.get('/api/v1/model-versions/'+row['id']).json()
    assert again['manifest_sha256'] == checked['manifest_sha256']
    assert {f['path'] for f in again['files']} == set(CONTENT)
    assert all('object_key' not in f for f in again['files'])


@pytest.mark.parametrize('change', ['weights', 'tokenizer', 'extra', 'missing'])
def test_changed_directory_blocks_use_and_preserves_original_pin(environment, tmp_path, change):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    reader = lambda source, instance: collect_directory(root)
    original = external.check(row['id'], 'first-instance', reader)
    if change == 'weights':
        (root / 'model.safetensors').write_bytes(b'changed weights')
    elif change == 'tokenizer':
        (root / 'tokenizer.json').write_bytes(b'{"changed":true}')
    elif change == 'extra':
        (root / 'extra.txt').write_bytes(b'added file')
    else:
        (root / 'model.safetensors').unlink()
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'second-instance', reader, expected_fingerprint=original['manifest_sha256'])
    assert caught.value.code == ('external_base_invalid' if change == 'missing' else 'external_base_changed')
    current = registry.get(row['id'])
    assert current['state'] == 'awaiting_verification'
    assert current['external']['last_check_state'] == ('failed' if change == 'missing' else 'mismatch')
    for field in ['pinned_manifest', 'pinned_configuration', 'pinned_at']:
        assert current['external'][field] == original['external'][field]
    assert current['manifest_sha256'] == original['manifest_sha256']
    model_directory(root)
    if change == 'extra':
        (root / 'extra.txt').unlink()
    restored = external.check(row['id'], 'third-instance', reader, expected_fingerprint=original['manifest_sha256'])
    assert restored['state'] == 'available'
    assert restored['external']['pinned_at'] == original['external']['pinned_at']


def test_recheck_withholds_availability_and_references_while_reading(environment, tmp_path):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    external.check(row['id'], 'first-instance', lambda source, instance: collect_directory(root))
    observed = []
    def reader(source, instance):
        current = registry.get(row['id'])
        observed.append((current['state'], current['external']['last_check_state']))
        return collect_directory(root)
    assert external.check(row['id'], 'next-instance', reader)['state'] == 'available'
    assert observed == [('awaiting_verification', 'pending')]



def test_reader_failure_is_recorded_without_disclosing_source_error(environment):
    resources, client, external, registry, register = environment
    row = register()
    def unreadable(source, instance):
        raise OSError('sensitive remote error fixture')
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'fixture-instance', unreadable)
    assert caught.value.code == 'external_base_unreadable'
    current = client.get('/api/v1/model-versions/'+row['id'])
    assert current.json()['external']['last_check_state'] == 'failed'
    assert current.json()['manifest_sha256'] is None
    assert 'sensitive remote error' not in current.text


def test_newer_check_supersedes_old_observation(environment, tmp_path):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    def old_reader(source, instance):
        old = collect_directory(root)
        (root / 'model.safetensors').write_bytes(b'newer observed bytes')
        external.check(row['id'], 'new-instance', lambda source, instance: collect_directory(root))
        return old
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'old-instance', old_reader)
    assert caught.value.code == 'external_check_superseded'
    current = registry.get(row['id'])
    assert current['state'] == 'available'
    assert current['external']['last_instance_id'] == 'new-instance'
    assert current['external']['check_generation'] == 2


def test_expected_pin_is_checked_before_reading(environment, tmp_path):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    external.check(row['id'], 'fixture-instance', lambda source, instance: collect_directory(root))
    calls = []
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'wrong-input', lambda *args: calls.append(args), expected_fingerprint='0'*64)
    assert caught.value.code == 'external_base_changed'
    assert calls == []
    assert registry.get(row['id'])['external']['check_generation'] == 1


def test_external_reference_deletion_never_touches_files(environment, tmp_path, monkeypatch):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    checked = external.check(row['id'], 'fixture-instance', lambda source, instance: collect_directory(root))
    for operation, body in [('complete', None), ('cancel', None), ('resume', {'files': checked['files']})]:
        if operation == 'resume':
            body = {'files': [{k:f[k] for k in ('path','size_bytes','sha256')} for f in checked['files']]}
        response = client.post('/api/v1/model-versions/'+row['id']+'/'+operation, json=body)
        assert response.status_code == 409, response.text
    assert client.put('/api/v1/model-versions/'+row['id']+'/files?path=config.json',content=b'x').status_code == 409
    with resources.pool.connection() as connection:
        registry.add_reference(row['id'], 'fixture', 'using-base', connection=connection)
    assert client.delete('/api/v1/model-versions/'+row['id']).status_code == 409
    with resources.pool.connection() as connection:
        connection.execute('DELETE FROM model_version_references WHERE model_version_id=%s', (row['id'],))
    def forbidden(*args, **kwargs):
        pytest.fail('External references must not call object storage deletion')
    monkeypatch.setattr(resources.store, 'remove_object', forbidden)
    assert client.delete('/api/v1/model-versions/'+row['id']).status_code == 204
    assert client.get('/api/v1/model-versions/'+row['id']).status_code == 404
    assert {p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()} == CONTENT


def test_deleted_registration_cannot_be_resurrected_by_late_check(environment, tmp_path):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    def reader(source, instance):
        registry.delete(row['id'])
        return collect_directory(root)
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'fixture-instance', reader)
    assert caught.value.status == 404
    assert client.get('/api/v1/model-versions/'+row['id']).status_code == 404


def test_registration_refuses_client_supplied_proof_and_unknown_catalog_path(environment):
    resources, client, external, registry, register = environment
    body = {'name':'invalid', 'region':'fixture-region', 'path':SOURCE}
    assert client.post('/api/v1/models/external-bases',json={**body,'fingerprint':'0'*64}).status_code == 422
    assert client.post('/api/v1/models/external-bases',json={**body,'path':'/model/unknown'}).status_code == 422
    resources.source_http.close()
    resources.source_http=httpx.Client(transport=httpx.MockTransport(lambda request:httpx.Response(503)))
    assert client.post('/api/v1/models/external-bases',json=body).status_code == 502


def test_late_check_cannot_override_a_noncheckable_state(environment, tmp_path):
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    def reader(source, instance):
        with resources.pool.connection() as connection:
            connection.execute("UPDATE model_versions SET state='deleting' WHERE id=%s", (row['id'],))
        return collect_directory(root)
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'fixture-instance', reader)
    assert caught.value.code == 'conflict'
    assert registry.get(row['id'])['state'] == 'deleting'


def test_nonweight_shard_report_never_pins_or_claims_availability(environment, tmp_path):
    import json
    resources, client, external, registry, register = environment
    row = register(); root = model_directory(tmp_path / 'public')
    (root / 'model.safetensors').unlink()
    (root / 'model.safetensors.index.json').write_text(
        json.dumps({'weight_map': {'layer': 'config.json'}}), encoding='utf-8')
    with pytest.raises(AppError) as caught:
        external.check(row['id'], 'fixture-instance', lambda *args: collect_directory(root))
    assert caught.value.code == 'external_base_invalid'
    failed = registry.get(row['id'])
    assert failed['state'] == 'awaiting_verification'
    assert failed['manifest_sha256'] is None and failed['external']['pinned_manifest'] is None
    assert failed['external']['last_check_state'] == 'failed'
    assert failed['external']['last_error_code'] == 'external_base_invalid'
