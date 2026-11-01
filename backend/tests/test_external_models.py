"""External base identity through read-only files and public model use cases."""
import hashlib
import json
from pathlib import Path

import pytest

from modelforge.infrastructure.model_probe import ProbeError, collect_directory

CONTENT = {"config.json": b'{"model_type":"fixture-only"}',
           "tokenizer.json": b'{}', "model.safetensors": b'fixture-not-a-real-model',
           "nested/README.md": b'fixture notes'}


def directory(root):
    root.mkdir(parents=True, exist_ok=True)
    for name, data in CONTENT.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


def test_probe_hashes_every_file_without_changing_source(tmp_path):
    root = directory(tmp_path / 'public')
    report = collect_directory(root)
    assert {row['path']: (row['size_bytes'], row['sha256']) for row in report['files']} == {
        path: (len(data), hashlib.sha256(data).hexdigest()) for path, data in CONTENT.items()}
    assert report['metadata']['config.json'] == CONTENT['config.json'].decode()
    assert {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()} == CONTENT


@pytest.mark.parametrize('kind', ['missing', 'empty', 'symlink-file', 'symlink-dir'])
def test_probe_rejects_incomplete_or_indirect_directories(tmp_path, kind):
    root = tmp_path / 'public'
    if kind != 'missing':
        root.mkdir()
    if kind.startswith('symlink'):
        directory(tmp_path / 'elsewhere')
        try:
            (root / 'linked').symlink_to(tmp_path / 'elsewhere' / ('config.json' if kind == 'symlink-file' else ''),
                                      target_is_directory=kind == 'symlink-dir')
        except OSError:
            pytest.skip('Host does not allow test symlinks')
    with pytest.raises(ProbeError):
        collect_directory(root)


@pytest.mark.parametrize('limits', [{'max_files': 3}, {'max_total_bytes': 1}, {'max_metadata_bytes': 1}])
def test_probe_never_returns_a_truncated_identity(tmp_path, limits):
    with pytest.raises(ProbeError):
        collect_directory(directory(tmp_path / 'public'), **limits)


def test_probe_rejects_a_file_changed_during_hashing(tmp_path, monkeypatch):
    root = directory(tmp_path / 'public')
    original = hashlib.sha256
    def changing_hash(*args, **kwargs):
        (root / 'config.json').write_bytes(b'{"model_type":"changed"}')
        return original(*args, **kwargs)
    monkeypatch.setattr(hashlib, 'sha256', changing_hash)
    with pytest.raises(ProbeError):
        collect_directory(root)


@pytest.mark.parametrize('missing', ['config.json', 'tokenizer.json', 'model.safetensors'])
def test_identity_refuses_missing_required_files(tmp_path, missing):
    from modelforge.modules.models.external import report_identity
    from modelforge.errors import AppError
    root = directory(tmp_path / 'public')
    (root / missing).unlink()
    with pytest.raises(AppError) as caught:
        report_identity(collect_directory(root))
    assert caught.value.code == 'external_base_invalid'


def test_identity_refuses_config_not_matching_the_hashed_bytes(tmp_path):
    from modelforge.modules.models.external import report_identity
    from modelforge.errors import AppError
    report = collect_directory(directory(tmp_path / 'public'))
    report['metadata']['config.json'] = '{"model_type":"different"}'
    with pytest.raises(AppError) as caught:
        report_identity(report)
    assert caught.value.code == 'external_base_invalid'


def test_sharded_identity_matches_independent_canonical_manifest(tmp_path):
    from modelforge.modules.models.external import report_identity
    root = directory(tmp_path / 'public')
    (root / 'model.safetensors').rename(root / 'part-1.safetensors')
    (root / 'part-2.safetensors').write_bytes(b'other shard')
    (root / 'model.safetensors.index.json').write_text(json.dumps({'weight_map': {
        'layer1': 'part-1.safetensors', 'layer2': 'part-2.safetensors'}}), encoding='utf-8')
    report = collect_directory(root)
    result = report_identity(report)
    expected = sorted([{'path': p.relative_to(root).as_posix(), 'size_bytes':p.stat().st_size,
                        'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                       for p in root.rglob('*') if p.is_file()], key=lambda f:f['path'])
    canonical = json.dumps(expected, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    assert result['files'] == expected
    assert result['fingerprint'] == hashlib.sha256(canonical).hexdigest()
    report['files'].reverse()
    assert report_identity(report)['fingerprint'] == result['fingerprint']
    (root / 'part-2.safetensors').unlink()
    from modelforge.errors import AppError
    with pytest.raises(AppError):
        report_identity(collect_directory(root))


@pytest.mark.parametrize('config', [
    '{"model_type":"fixture","value":NaN}',
    '{"model_type":"fixture","value":Infinity}',
    '{"model_type":"first","model_type":"second"}',
    json.dumps({'model_type':'fixture','value':chr(0)}),
    json.dumps({'model_type':'fixture','value':chr(0xd800)}),
])
def test_identity_rejects_ambiguous_or_nonpersistable_configuration(tmp_path, config):
    from modelforge.modules.models.external import report_identity
    from modelforge.errors import AppError
    root = directory(tmp_path / 'public')
    (root / 'config.json').write_text(config, encoding='utf-8')
    with pytest.raises(AppError) as caught:
        report_identity(collect_directory(root))
    assert caught.value.code == 'external_base_invalid'


@pytest.mark.parametrize('index', ['model.safetensors.index.json', 'pytorch_model.bin.index.json'])
@pytest.mark.parametrize('target', ['config.json', 'tokenizer.json', 'model.safetensors.index.json'])
def test_identity_rejects_index_targets_that_are_not_weight_files(tmp_path, target, index):
    from modelforge.modules.models.external import report_identity
    from modelforge.errors import AppError
    root = directory(tmp_path / 'public')
    (root / 'model.safetensors').unlink()
    (root / index).write_text(
        json.dumps({'weight_map': {'layer': target}}), encoding='utf-8')
    with pytest.raises(AppError) as caught:
        report_identity(collect_directory(root))
    assert caught.value.code == 'external_base_invalid'


@pytest.mark.skipif(__import__('os').name == 'nt', reason='Requires Linux descriptor traversal')
def test_probe_rejects_ancestor_replaced_after_initial_inspection(tmp_path, monkeypatch):
    ancestor = tmp_path / 'A'
    root = directory(ancestor / 'public')
    alternate = directory(tmp_path / 'B' / 'public')
    (alternate / 'model.safetensors').write_bytes(b'redirected-model')
    original_lstat = Path.lstat
    changed = False
    def swap(path, *args, **kwargs):
        nonlocal changed
        result = original_lstat(path, *args, **kwargs)
        if path == ancestor and not changed:
            changed = True
            ancestor.rename(tmp_path / 'A_saved')
            ancestor.symlink_to(alternate.parent, target_is_directory=True)
        return result
    monkeypatch.setattr(Path, 'lstat', swap)
    with pytest.raises(ProbeError):
        collect_directory(root)
    assert changed


@pytest.mark.skipif(__import__('os').name == 'nt', reason='Requires Linux descriptor traversal')
def test_probe_rejects_nested_directory_replaced_before_open(tmp_path, monkeypatch):
    import os
    root = directory(tmp_path / 'public')
    alternate = tmp_path / 'alternate'
    alternate.mkdir()
    (alternate / 'README.md').write_bytes(b'redirected')
    real_stat = os.stat
    changed = False
    def swap(path, *args, **kwargs):
        nonlocal changed
        result = real_stat(path, *args, **kwargs)
        if path == 'nested' and kwargs.get('follow_symlinks') is False and not changed:
            changed = True
            (root / 'nested').rename(root / 'saved')
            (root / 'nested').symlink_to(alternate, target_is_directory=True)
        return result
    monkeypatch.setattr(os, 'stat', swap)
    monkeypatch.setattr(os, 'supports_dir_fd', os.supports_dir_fd | {swap})
    with pytest.raises(ProbeError):
        collect_directory(root)
    assert changed


def test_pytorch_sharded_structure_is_supported(tmp_path):
    from modelforge.modules.models.external import report_identity
    root = directory(tmp_path / 'public')
    (root / 'model.safetensors').rename(root / 'weights-1.bin')
    (root / 'pytorch_model.bin.index.json').write_text(
        json.dumps({'weight_map': {'layer': 'weights-1.bin'}}), encoding='utf-8')
    assert report_identity(collect_directory(root))['format_summary']['model_type'] == 'fixture-only'
