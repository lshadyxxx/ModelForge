"""Public repository HTTP boundary; fixture bytes do not prove model loading."""
import hashlib
import io

import httpx
import pytest

from modelforge.errors import AppError
from modelforge.modules.models.modelscope import ModelScope

COMMIT = '09b42cad3d112e832108974449ccb5e8e0f5b5d1'
DATA = b'{"model_type":"qwen3"}'


def entry(path='config.json', data=DATA):
    return {'Path': path, 'Size': len(data), 'Type': 'blob',
            'Sha256': hashlib.sha256(data).hexdigest(), 'Revision': 'b' * 40, 'IsLFS': False}


def client(handler):
    return ModelScope(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False))


def test_snapshot_pins_requested_commit_and_preserves_file_identity():
    def serve(request):
        assert request.url.params['Revision'] == COMMIT
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    snapshot = client(serve).snapshot('Qwen/Qwen3-0.6B', COMMIT)
    assert snapshot['revision'] == COMMIT
    assert snapshot['files'][0]['path'] == 'config.json'
    assert snapshot['files'][0]['source_revision'] == 'b' * 40


@pytest.mark.parametrize('revision', ['', 'master', 'abc123', '../master', 'a' * 41])
def test_mutable_or_ambiguous_revision_is_rejected_before_http(revision):
    def unexpected(request):
        pytest.fail('Invalid input must not reach the repository')
    with pytest.raises(AppError) as caught:
        client(unexpected).snapshot('Qwen/Qwen3-0.6B', revision)
    assert caught.value.code == 'model_source_invalid'


@pytest.mark.parametrize('repo', ['a', '../a', 'a/b/c', 'https://evil.test/a', 'a/b?x=1', 'a/..'])
def test_only_repository_ids_are_accepted(repo):
    with pytest.raises(AppError):
        client(lambda r: pytest.fail('Unsafe repository reached HTTP')).snapshot(repo, COMMIT)


@pytest.mark.parametrize('change,code', [
    ({'Success': False}, 'model_source_unavailable'),
    ({'Data': {'Files': [entry()] * 3000}}, 'manifest_incomplete'),
    ({'Data': {'Files': [entry('../escape')]}}, 'model_manifest_invalid'),
    ({'Data': {'Files': [{**entry(), 'Sha256': None}]}}, 'model_manifest_invalid'),
])
def test_failed_incomplete_or_unverifiable_manifest_is_not_imported(change, code):
    payload = {'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}} | change
    with pytest.raises(AppError) as caught:
        client(lambda r: httpx.Response(200, json=payload)).snapshot('Qwen/Qwen3-0.6B', COMMIT)
    assert caught.value.code == code


def test_download_follows_approved_cdn_and_verifies_real_bytes():
    seen = []
    def serve(request):
        seen.append(request.url.host)
        if request.url.host == 'modelscope.cn':
            assert request.url.params['Revision'] == COMMIT
            return httpx.Response(302, headers={'Location': 'https://cdn-lfs-cn-1.modelscope.cn/weight?Signature=secret'})
        return httpx.Response(200, content=DATA)
    output, progress = io.BytesIO(), []
    source = client(serve)
    source.download('Qwen/Qwen3-0.6B', COMMIT,
                    {'path': 'config.json', 'size_bytes': len(DATA), 'sha256': hashlib.sha256(DATA).hexdigest()},
                    output, progress.append)
    assert output.getvalue() == DATA
    assert progress[-1] == len(DATA)
    assert seen == ['modelscope.cn', 'cdn-lfs-cn-1.modelscope.cn']


@pytest.mark.parametrize('target', ['http://modelscope.cn/file', 'https://127.0.0.1/secret',
    'https://other.modelscope.cn/file', 'https://modelscope.cn:444/file', 'https://user:password@modelscope.cn/file'])
def test_unapproved_redirect_is_rejected_without_requesting_target(target):
    seen = []
    def serve(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={'Location': target})
    with pytest.raises(AppError) as caught:
        client(serve).download('Qwen/Qwen3-0.6B', COMMIT,
            {'path': 'config.json', 'size_bytes': len(DATA), 'sha256': hashlib.sha256(DATA).hexdigest()},
            io.BytesIO(), lambda n: None)
    assert caught.value.code == 'model_source_redirect_rejected'
    assert len(seen) == 1


@pytest.mark.parametrize('content', [b'x' * len(DATA), DATA + b'excess', DATA[:-1]])
def test_size_or_checksum_mismatch_prevents_success(content):
    with pytest.raises(AppError) as caught:
        client(lambda r: httpx.Response(200, content=content)).download('Qwen/Qwen3-0.6B', COMMIT,
            {'path': 'config.json', 'size_bytes': len(DATA), 'sha256': hashlib.sha256(DATA).hexdigest()},
            io.BytesIO(), lambda n: None)
    assert caught.value.code == 'model_checksum_mismatch'


def test_numeric_upstream_path_is_a_manifest_error_not_an_internal_error():
    payload = {'Code': 200, 'Success': True, 'Data': {'Files': [{**entry(), 'Path': 123}]}}
    with pytest.raises(AppError) as caught:
        client(lambda r: httpx.Response(200, json=payload)).snapshot('Qwen/Qwen3-0.6B', COMMIT)
    assert caught.value.code == 'model_manifest_invalid'


def test_cancellation_is_checked_before_buffering_a_megabyte():
    class Cancelled(Exception):
        pass
    received, consumed = [], []
    class SmallChunks(httpx.SyncByteStream):
        def __iter__(self):
            for _ in range(20):
                consumed.append(1)
                yield b'x' * 1024
    def checkpoint(size):
        received.append(size)
        if size:
            raise Cancelled()
    output = io.BytesIO()
    with pytest.raises(Cancelled):
        client(lambda r: httpx.Response(200, stream=SmallChunks())).download(
            'Qwen/Qwen3-0.6B', COMMIT,
            {'path': 'weight', 'size_bytes': 20480, 'sha256': 'a'*64}, output, checkpoint)
    assert len(consumed) == 1
    assert output.tell() == 1024
