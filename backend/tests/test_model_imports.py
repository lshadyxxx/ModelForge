"""Opt-in real PostgreSQL/MinIO tests with a controlled external HTTP source."""
import hashlib
import io
import os
import threading

import httpx
import pytest

from modelforge.bootstrap import Resources
from modelforge.errors import AppError
from modelforge.settings import Settings

if os.getenv('MF_TEST_INTEGRATION') == '1':
    database = os.getenv('MF_PG_DATABASE', '')
    bucket = os.getenv('MF_MINIO_BUCKET', '')
    if (os.getenv('MF_TEST_ISOLATED_STORES') != '1'
            or not database.startswith('modelforge_test_')
            or not bucket.startswith('modelforge-test-')):
        raise pytest.UsageError('Integration tests require explicitly disposable modelforge_test_* database, '
                                'modelforge-test-* bucket and MF_TEST_ISOLATED_STORES=1')

pytestmark = pytest.mark.skipif(os.getenv('MF_TEST_INTEGRATION') != '1', reason='Requires migrated real PostgreSQL and MinIO')
COMMIT = '09b42cad3d112e832108974449ccb5e8e0f5b5d1'
CONTENT = {'config.json': b'{"model_type":"fixture-only"}', 'tokenizer.json': b'{}',
           'model.safetensors': b'fixture-not-a-real-model'}


@pytest.fixture
def environment(tmp_path):
    from modelforge.modules.models import ModelImports, ModelRegistry
    resources = Resources.open(Settings(model_temporary_directory=str(tmp_path)))
    state = {'fail': None, 'downloads': [], 'callback': None}
    def serve(request):
        assert request.url.params['Revision'] == COMMIT
        if request.url.path.endswith('/files'):
            return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [
                {'Path': path, 'Size': len(data), 'Type': 'blob', 'Revision': 'b'*40,
                 'Sha256': hashlib.sha256(data).hexdigest()} for path, data in CONTENT.items()]}})
        path = request.url.params['FilePath']
        state['downloads'].append(path)
        if state['callback']:
            state['callback'](path)
        return httpx.Response(503) if path == state['fail'] else httpx.Response(200, content=CONTENT[path])
    resources.source_http.close()
    resources.source_http = httpx.Client(transport=httpx.MockTransport(serve))
    imports, registry, created = ModelImports(resources), ModelRegistry(resources), []
    def create():
        row = imports.create('integration fixture', 'Qwen/Qwen3-0.6B', COMMIT)
        created.append(row['id'])
        return row
    yield resources, imports, registry, state, create
    state['callback'] = None
    for identifier in created:
        try:
            row = registry.get(identifier)
            if row['import']['state'] in {'queued', 'running'}:
                imports.cancel(identifier)
                imports.run_once()
            registry.delete(identifier)
        except AppError as error:
            if error.status != 404:
                raise
    resources.close()


def test_failed_import_retries_fixed_snapshot_and_reuses_verified_file(environment):
    resources, imports, registry, state, create = environment
    row = create()
    assert row['import']['state'] == 'queued'
    state['fail'] = 'model.safetensors'
    assert imports.run_once() is True
    row = registry.get(row['id'])
    assert row['state'] == 'uploading'
    assert row['import']['state'] == 'failed'
    assert row['import']['error_code'] == 'model_source_unavailable'
    assert row['verified_bytes'] == len(CONTENT['config.json'])
    assert imports.retry(row['id'])['import']['state'] == 'queued'
    state['fail'] = None
    assert imports.run_once() is True
    row = registry.get(row['id'])
    assert row['state'] == 'available'
    assert row['compatibility_state'] == 'unverified'
    assert row['verified_bytes'] == row['total_bytes']
    assert row['import']['source_snapshot']['revision'] == COMMIT
    assert state['downloads'].count('config.json') == 1


def test_running_cancel_is_prompt_and_delete_waits_for_worker(environment):
    resources, imports, registry, state, create = environment
    row = create()
    seen = []
    def interrupt(path):
        if seen:
            return
        seen.append(path)
        assert imports.cancel(row['id'])['import']['cancel_requested'] is True
        with pytest.raises(AppError) as caught:
            registry.delete(row['id'])
        assert caught.value.code == 'model_busy'
    state['callback'] = interrupt
    imports.run_once()
    row = registry.get(row['id'])
    assert row['import']['state'] == 'cancelled'
    assert row['state'] == 'cancelled'
    state['callback'] = None
    imports.retry(row['id'])
    imports.run_once()
    assert registry.get(row['id'])['state'] == 'available'


def test_restart_recovers_running_import_without_changing_source(environment):
    resources, imports, registry, state, create = environment
    row = create()
    # A process crash releases its session lock but leaves a durable running row.
    with resources.pool.connection() as connection:
        connection.execute("UPDATE model_imports SET state='running',current_path='config.json',current_bytes=9 WHERE model_version_id=%s", (row['id'],))
    assert imports.run_once() is True
    row = registry.get(row['id'])
    assert row['state'] == 'available'
    assert row['import']['source_snapshot']['revision'] == COMMIT


def test_directory_upload_cannot_overwrite_public_import(environment):
    resources, imports, registry, state, create = environment
    row = create()
    data = CONTENT['config.json']
    with pytest.raises(AppError) as caught:
        registry.upload(row['id'], 'config.json', io.BytesIO(data), len(data), hashlib.sha256(data).hexdigest())
    assert caught.value.status == 409
    assert imports.cancel(row['id'])['state'] == 'cancelled'


def test_worker_shutdown_returns_work_to_queue(environment):
    resources, imports, registry, state, create = environment
    row = create()
    stop = threading.Event()
    state['callback'] = lambda path: stop.set()
    assert imports.run_once(stop) is True
    assert registry.get(row['id'])['import']['state'] == 'queued'
    state['callback'] = None
    imports.run_once()
    assert registry.get(row['id'])['state'] == 'available'


def test_lost_verified_object_is_downloaded_again(environment):
    resources, imports, registry, state, create = environment
    row = create()
    state['fail'] = 'model.safetensors'
    imports.run_once()
    row = registry.get(row['id'])
    file = next(f for f in row['files'] if f['path'] == 'config.json')
    resources.store.remove_object(row['bucket'], file['object_key'])
    imports.retry(row['id'])
    state['fail'] = None
    imports.run_once()
    assert registry.get(row['id'])['state'] == 'available'
    assert state['downloads'].count('config.json') == 2


def test_repair_removes_the_superseded_corrupt_object(environment):
    resources, imports, registry, state, create = environment
    row = create()
    state['fail'] = 'model.safetensors'
    imports.run_once()
    row = registry.get(row['id'])
    old = next(f for f in row['files'] if f['path'] == 'config.json')
    resources.store.put_object(row['bucket'], old['object_key'], io.BytesIO(b'corrupt'), 7)
    imports.retry(row['id'])
    state['fail'] = None
    imports.run_once()
    assert registry.get(row['id'])['state'] == 'available'
    imports.run_once()
    assert list(resources.store.list_objects(row['bucket'], prefix=old['object_key'])) == []


def test_cleanup_failure_does_not_block_import_and_recovers(environment, monkeypatch):
    from modelforge.infrastructure.minio import create_store
    resources, imports, registry, state, create = environment
    row = create()
    state['fail'] = 'model.safetensors'
    imports.run_once()
    row = registry.get(row['id'])
    old = next(f for f in row['files'] if f['path'] == 'config.json')
    resources.store.put_object(row['bucket'], old['object_key'], io.BytesIO(b'corrupt'), 7)
    imports.retry(row['id'])
    state['fail'] = None
    imports.run_once()
    unreachable = create_store(resources.settings.model_copy(update={'minio_endpoint': '127.0.0.1:1'}))
    remove = resources.store.remove_object
    def blocked(bucket, key):
        if key == old['object_key']:
            return unreachable.remove_object(bucket, key)
        return remove(bucket, key)
    monkeypatch.setattr(resources.store, 'remove_object', blocked)
    try:
        second = create()
        assert imports.run_once() is True
        assert registry.get(second['id'])['state'] == 'available'
        assert imports.cleanup_status(row['id'])['state'] == 'pending'
        assert list(resources.store.list_objects(row['bucket'], prefix=old['object_key']))
        monkeypatch.setattr(resources.store, 'remove_object', remove)
        imports.run_once()
        assert imports.cleanup_status(row['id'])['state'] == 'complete'
        assert list(resources.store.list_objects(row['bucket'], prefix=old['object_key'])) == []
    finally:
        monkeypatch.setattr(resources.store, 'remove_object', remove)
        unreachable._http.clear()


def test_second_worker_cannot_claim_during_active_import(environment):
    resources, imports, registry, state, create = environment
    row = create()
    entered, release = threading.Event(), threading.Event()
    def pause(path):
        if not entered.is_set():
            entered.set()
            assert release.wait(10), 'Test worker was not released'
    state['callback'] = pause
    thread = threading.Thread(target=imports.run_once)
    thread.start()
    try:
        assert entered.wait(5)
        assert imports.run_once() is False
        assert registry.get(row['id'])['import']['state'] == 'running'
    finally:
        release.set()
        thread.join(15)
    assert not thread.is_alive()
    assert registry.get(row['id'])['state'] == 'available'


def test_failed_cleanup_batch_does_not_starve_later_removable_object(environment, monkeypatch):
    from modelforge.infrastructure.minio import create_store
    resources, imports, registry, state, create = environment
    unreachable = create_store(resources.settings.model_copy(update={'minio_endpoint': '127.0.0.1:1'}))
    put, get, remove = resources.store.put_object, resources.store.get_object, resources.store.remove_object
    keys, denied, versions = [], set(), []
    def put_with_failed_readback(bucket, key, *args, **kwargs):
        result = put(bucket, key, *args, **kwargs)
        keys.append(key)
        denied.add(key)
        return result
    def failed_readback(bucket, key, *args, **kwargs):
        return unreachable.get_object(bucket, key, *args, **kwargs)
    def selective_remove(bucket, key, *args, **kwargs):
        if key in denied:
            return unreachable.remove_object(bucket, key, *args, **kwargs)
        return remove(bucket, key, *args, **kwargs)
    monkeypatch.setattr(resources.store, 'put_object', put_with_failed_readback)
    monkeypatch.setattr(resources.store, 'get_object', failed_readback)
    monkeypatch.setattr(resources.store, 'remove_object', selective_remove)
    try:
        for _ in range(21):
            row = create()
            versions.append(row['id'])
            assert imports.run_once() is True
            assert registry.get(row['id'])['import']['state'] == 'failed'
        monkeypatch.setattr(resources.store, 'get_object', get)
        denied.remove(keys[-1])
        for _ in range(3):
            imports.run_once()
        assert imports.cleanup_status(versions[-1])['state'] == 'complete'
        assert list(resources.store.list_objects(resources.settings.minio_bucket, prefix=keys[-1])) == []
        assert imports.cleanup_status(versions[0])['state'] == 'pending'
    finally:
        monkeypatch.setattr(resources.store, 'put_object', put)
        monkeypatch.setattr(resources.store, 'get_object', get)
        monkeypatch.setattr(resources.store, 'remove_object', remove)
        for _ in range(3):
            imports.run_once()
        unreachable._http.clear()


def test_disconnected_worker_cannot_overwrite_replacement_attempt(environment):
    resources, imports, registry, state, create = environment
    row = create()
    entered = [threading.Event(), threading.Event()]
    release = [threading.Event(), threading.Event()]
    mutex = threading.Lock()
    calls, errors = [], []
    def pause(path):
        with mutex:
            index = len(calls)
            calls.append(path)
        if index < 2:
            entered[index].set()
            assert release[index].wait(15), 'Test worker was not released'
    def execute():
        try:
            imports.run_once()
        except Exception as error:
            errors.append(error)
    state['callback'] = pause
    old, replacement = threading.Thread(target=execute), threading.Thread(target=execute)
    try:
        old.start()
        assert entered[0].wait(5)
        with resources.pool.connection() as connection:
            holders = connection.execute("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=742193601 AND granted").fetchall()
            assert len(holders) == 1
            assert holders[0]['pid'] != connection.info.backend_pid
            assert connection.execute('SELECT pg_terminate_backend(%s) AS killed', (holders[0]['pid'],)).fetchone()['killed']
        replacement.start()
        assert entered[1].wait(5)
        assert registry.get(row['id'])['import']['attempt_count'] == 2
        release[0].set()
        old.join(5)
        assert not old.is_alive()
        assert registry.get(row['id'])['import']['state'] == 'running'
        release[1].set()
        replacement.join(10)
        assert not replacement.is_alive()
        assert registry.get(row['id'])['state'] == 'available'
        assert errors == []
    finally:
        for event in release:
            event.set()
        old.join(15)
        if replacement.ident:
            replacement.join(15)


def test_http_import_cancel_retry_and_delete(environment, monkeypatch):
    from fastapi.testclient import TestClient
    from modelforge.entrypoints.api import app
    resources, imports, registry, state, create = environment
    monkeypatch.setattr(app.state, 'resources', resources, raising=False)
    client = TestClient(app)
    response = client.post('/api/v1/models/modelscope-imports', json={
        'name': 'HTTP fixture', 'repository': 'Qwen/Qwen3-0.6B', 'revision': COMMIT})
    assert response.status_code == 201
    identifier = response.json()['id']
    url = '/api/v1/model-versions/' + identifier
    try:
        assert client.get(url).json()['import']['state'] == 'queued'
        assert client.post(url + '/complete').status_code == 409
        assert client.delete(url).json()['error']['code'] == 'model_busy'
        assert client.post(url + '/cancel').json()['state'] == 'cancelled'
        assert client.post(url + '/retry-import').json()['import']['state'] == 'queued'
        imports.run_once()
        assert client.get(url).json()['state'] == 'available'
        assert client.post(url + '/retry-import').status_code == 409
        assert client.delete(url).status_code == 204
        assert client.get(url).status_code == 404
    finally:
        try:
            imports.cancel(identifier)
        except AppError:
            pass
        try:
            registry.delete(identifier)
        except AppError as error:
            if error.status != 404:
                raise


def test_late_write_after_version_deletion_is_tracked_and_removed(environment):
    from psycopg.conninfo import make_conninfo
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
    from modelforge.modules.models import ModelImports
    import uuid
    resources, imports, registry, state, create = environment
    row = create()
    old = Resources.open(resources.settings)
    old.source_http.close()
    old.source_http = resources.source_http
    old.pool.close()
    tag = 'test_late_write_' + uuid.uuid4().hex
    old.pool = ConnectionPool(make_conninfo(old.settings.conninfo(), application_name=tag),
        min_size=0, max_size=4, open=True, kwargs={'row_factory': dict_row})
    written, release, replacing, resume = [threading.Event() for _ in range(4)]
    keys, failures = [], []
    real = resources.store
    class DelayedStore:
        def __getattr__(self, name):
            return getattr(real, name)
        def put_object(self, bucket, key, stream, size, **kwargs):
            keys.append(key)
            written.set()
            assert release.wait(15)
            return real.put_object(bucket, key, stream, size, **kwargs)
    old.store = DelayedStore()
    def pause(path):
        if written.is_set():
            replacing.set()
            assert resume.wait(15)
    state['callback'] = pause
    def execute(subject):
        try:
            subject.run_once()
        except Exception as error:
            failures.append(type(error).__name__)
    first = threading.Thread(target=execute, args=(ModelImports(old),))
    second = threading.Thread(target=execute, args=(imports,))
    try:
        first.start()
        assert written.wait(5)
        with resources.pool.connection() as connection:
            sessions = connection.execute('SELECT pid FROM pg_stat_activity WHERE application_name=%s', (tag,)).fetchall()
            assert sessions
            for session in sessions:
                connection.execute('SELECT pg_terminate_backend(%s)', (session['pid'],))
        second.start()
        assert replacing.wait(5)
        imports.cancel(row['id'])
        resume.set()
        second.join(10)
        assert not second.is_alive()
        assert registry.get(row['id'])['state'] == 'cancelled'
        result = registry.delete(row['id'])
        assert result['storage_cleanup'] == 'pending'
        release.set()
        first.join(10)
        assert not first.is_alive()
        assert list(real.list_objects(row['bucket'], prefix=keys[0])) == []
        assert imports.cleanup_status(row['id'])['state'] == 'complete'
    finally:
        release.set(); resume.set()
        first.join(20)
        if second.ident:
            second.join(20)
        state['callback'] = None
        for key in keys:
            real.remove_object(row['bucket'], key)
        old.source_http = None
        old.pool.close()
