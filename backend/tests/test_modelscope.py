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


def pkt(data):
    return f'{len(data) + 4:04x}'.encode() + data


def advertisement(commit=COMMIT, branch='master', extra=b''):
    return (pkt(b'# service=git-upload-pack\n') + b'0000'
            + pkt(f'{commit} HEAD\0multi_ack symref=HEAD:refs/heads/{branch} object-format=sha1\n'.encode())
            + pkt(f'{commit} refs/heads/{branch}\n'.encode()) + extra + b'0000')


@pytest.mark.parametrize('revision', ['', None, 'HEAD', 'release/v1', 'refs/heads/release/v1'])
def test_default_revision_is_resolved_before_reading_fixed_manifest(revision):
    branch = 'release/v1' if revision and 'release/v1' in revision else 'master'
    seen = []
    def serve(request):
        seen.append(request.url)
        if request.url.path.endswith('/info/refs'):
            assert request.url.path == '/models/Qwen/Qwen3-0.6B.git/info/refs'
            assert dict(request.url.params) == {'service': 'git-upload-pack'}
            assert 'Git-Protocol' not in request.headers
            assert request.headers['User-Agent'] == 'git/2.0 (ModelForge; refs-only)'
            return httpx.Response(200, content=advertisement(branch=branch), headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
        assert request.url.params['Revision'] == COMMIT
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    try:
        snapshot = client(serve).snapshot('Qwen/Qwen3-0.6B', revision)
    except AppError as error:
        pytest.fail(f'Default revision was rejected: {error.code}')
    assert snapshot['revision'] == COMMIT
    assert snapshot['requested_revision'] == revision
    assert snapshot['resolved_ref'] == 'refs/heads/' + branch
    assert len(seen) == 2


@pytest.mark.parametrize('revision,code', [('absent', 'model_revision_not_found'),
    ('master', 'model_revision_ambiguous'), ('v1.0', 'model_revision_not_found')])
def test_missing_tags_and_ambiguous_short_names_never_read_manifest(revision, code):
    refs = advertisement(extra=pkt(f'{COMMIT} refs/tags/master\n'.encode())
                         + pkt(f'{COMMIT} refs/tags/v1.0\n'.encode()))
    def serve(request):
        assert request.url.path.endswith('/info/refs')
        return httpx.Response(200, content=refs, headers={
            'Content-Type': 'application/x-git-upload-pack-advertisement'})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B', revision)
    assert caught.value.code == code


def test_explicit_branch_disambiguates_tag_with_same_name():
    def serve(request):
        if request.url.path.endswith('/info/refs'):
            return httpx.Response(200, content=advertisement(extra=
                pkt(f'{"c" * 40} refs/tags/master\n'.encode())), headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
        assert request.url.params['Revision'] == COMMIT
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    assert client(serve).snapshot('Qwen/Qwen3-0.6B', 'refs/heads/master')['revision'] == COMMIT


@pytest.mark.parametrize('body', [
    advertisement()[:-4], advertisement() + b'trailing', b'not a packet',
    pkt(b'# service=git-upload-pack\n') + b'0000' + pkt(b'version 2\n') + b'0000',
    advertisement().replace(b'symref=HEAD:', b'symref=FAIL:'),
    advertisement(extra=pkt(f'{COMMIT} refs/heads/master\n'.encode())),
    advertisement(extra=pkt(f'{COMMIT} HEAD\n'.encode())),
    advertisement(commit='0' * 40), advertisement(commit='G' * 40),
    advertisement().replace(b'object-format=sha1', b'object-format=sha2'),
    advertisement(extra=pkt(f'{COMMIT} refs/heads/bad\x00name\n'.encode())),
    advertisement(extra=pkt(f'{COMMIT} refs/heads/../escape\n'.encode())),
    advertisement(extra=pkt(f'{COMMIT} refs/tags/main.lock\n'.encode())),
    advertisement(extra=pkt(f'{COMMIT} refs/heads/main?x\n'.encode())),
    advertisement().replace(b'multi_ack', b'multi_ack multi_ack'),
    pkt(b'# service=git-upload-pack\n') + b'0000' + b'0000',
    advertisement().replace(f'{COMMIT} refs/heads/master'.encode(), f'{"c" * 40} refs/heads/master'.encode()),
    b'x' * (1024**2 + 1),
])
def test_unverifiable_advertisement_never_reads_manifest(body):
    def serve(request):
        assert request.url.path.endswith('/info/refs')
        return httpx.Response(200, content=body, headers={
            'Content-Type': 'application/x-git-upload-pack-advertisement'})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == 'model_revision_unverifiable'


@pytest.mark.parametrize('branch', ['../escape', 'main.lock', 'main?x'])
def test_invalid_advertised_default_branch_never_reads_manifest(branch):
    seen = []
    def serve(request):
        seen.append(request.url)
        if request.url.path.endswith('/info/refs'):
            return httpx.Response(200, content=advertisement(branch=branch), headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == 'model_revision_unverifiable'
    assert len(seen) == 1


@pytest.mark.parametrize('status,content_type,code', [(302, 'text/html', 'model_source_unavailable'),
    (421, 'text/plain', 'model_source_unavailable'), (503, 'text/plain', 'model_source_unavailable'),
    (200, 'text/html', 'model_revision_unverifiable')])
def test_discovery_does_not_follow_redirects_or_accept_error_pages(status, content_type, code):
    seen = []
    def serve(request):
        seen.append(request.url)
        return httpx.Response(status, content=advertisement(), headers={
            'Content-Type': content_type, 'Location': 'https://127.0.0.1/secret'})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == code
    assert len(seen) == 1


def test_download_still_rejects_mutable_revision_before_http():
    with pytest.raises(AppError) as caught:
        client(lambda r: pytest.fail('Mutable download reached HTTP')).download(
            'Qwen/Qwen3-0.6B', 'master', {}, io.BytesIO(), lambda _: None)
    assert caught.value.code == 'model_source_invalid'


def test_control_bytes_in_discovery_capabilities_never_read_manifest():
    def serve(request):
        assert request.url.path.endswith('/info/refs')
        return httpx.Response(200, content=advertisement().replace(
            b'multi_ack', b'multi_a\x01k'), headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == 'model_revision_unverifiable'


@pytest.mark.parametrize('extra', [
    pkt(f'{COMMIT} refs/tags/missing^{{}}\n'.encode()),
    pkt(f'{COMMIT} refs/tags/v1^{{}}\n'.encode()) + pkt(f'{COMMIT} refs/tags/v1\n'.encode()),
    pkt(f'{COMMIT} refs/tags/v1\n'.encode()) + pkt(f'{COMMIT} refs/tags/v2\n'.encode())
    + pkt(f'{COMMIT} refs/tags/v1^{{}}\n'.encode()),
])
def test_orphan_or_out_of_order_peeled_ref_never_reads_manifest(extra):
    body = advertisement(extra=extra)
    seen = []
    def serve(request):
        seen.append(request.url.path)
        if request.url.path.endswith('/info/refs'):
            return httpx.Response(200, content=body, headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == 'model_revision_unverifiable'
    assert len(seen) == 1


def test_named_branch_rejects_unsafe_head_symref_before_manifest():
    seen = []
    def serve(request):
        seen.append(request.url.path)
        if request.url.path.endswith('/info/refs'):
            body = (pkt(b'# service=git-upload-pack\n') + b'0000'
                    + pkt(f'{COMMIT} HEAD\0multi_ack symref=HEAD:refs/heads/../escape object-format=sha1\n'.encode())
                    + pkt(f'{COMMIT} refs/heads/master\n'.encode()) + b'0000')
            return httpx.Response(200, content=body, headers={
                    'Content-Type': 'application/x-git-upload-pack-advertisement'})
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B', 'master')
    assert caught.value.code == 'model_revision_unverifiable'
    assert len(seen) == 1


def test_default_branch_rejects_unsafe_other_symref_before_manifest():
    seen = []
    body = (pkt(b'# service=git-upload-pack\n') + b'0000'
            + pkt(f'{COMMIT} HEAD\0multi_ack symref=HEAD:refs/heads/master symref=refs/heads/a:refs/heads/../escape\n'.encode())
            + pkt(f'{COMMIT} refs/heads/master\n'.encode()) + b'0000')
    def serve(request):
        seen.append(request.url.path)
        if request.url.path.endswith('/info/refs'):
            return httpx.Response(200, content=body, headers={
                'Content-Type': 'application/x-git-upload-pack-advertisement'})
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    with pytest.raises(AppError) as caught:
        client(serve).snapshot('Qwen/Qwen3-0.6B')
    assert caught.value.code == 'model_revision_unverifiable'
    assert len(seen) == 1


def test_snapshot_pins_requested_commit_and_preserves_file_identity():
    def serve(request):
        assert request.url.params['Revision'] == COMMIT
        return httpx.Response(200, json={'Code': 200, 'Success': True, 'Data': {'Files': [entry()]}})
    snapshot = client(serve).snapshot('Qwen/Qwen3-0.6B', COMMIT)
    assert snapshot['revision'] == COMMIT
    assert snapshot['files'][0]['path'] == 'config.json'
    assert snapshot['files'][0]['source_revision'] == 'b' * 40


@pytest.mark.parametrize('revision', ['abc123', '../master', 'a' * 41, 'refs/tags/v1', ' master',
    'master ', 'release//v1', 'release/v1.lock', '-branch', '.', 'branch.', 'x?token=secret',
    'a\nb', 'a' * 256])
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
