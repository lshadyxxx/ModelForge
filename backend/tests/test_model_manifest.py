"""Public model manifest rules, with no model execution."""
import pytest
from modelforge.errors import AppError
from modelforge.modules.models.manifest import ModelFile, validate_manifest


def test_duplicate_paths_cannot_define_two_different_files():
    files = [ModelFile(path='config.json', size_bytes=2, sha256='a'*64),
             ModelFile(path='config.json', size_bytes=3, sha256='b'*64)]
    with pytest.raises(AppError) as caught:
        validate_manifest(files, max_files=10, max_file_bytes=100, max_total_bytes=100)
    assert caught.value.code == 'model_manifest_invalid'


def test_prefix_file_conflict_is_rejected():
    files = [ModelFile(path='weights', size_bytes=1, sha256='a'*64),
             ModelFile(path='weights/part.bin', size_bytes=1, sha256='a'*64)]
    with pytest.raises(AppError):
        validate_manifest(files, max_files=10, max_file_bytes=100, max_total_bytes=100)


def test_manifest_enforces_declared_capacity_before_upload():
    with pytest.raises(AppError) as caught:
        validate_manifest([ModelFile(path='weights.bin', size_bytes=101, sha256='a'*64)],
                          max_files=10, max_file_bytes=100, max_total_bytes=1000)
    assert caught.value.status == 413


@pytest.mark.parametrize('files,max_files,max_total', [([], 10, 100),
    ([ModelFile(path='a', size_bytes=2, sha256='a'*64)], 0, 100),
    ([ModelFile(path='a', size_bytes=2, sha256='a'*64)], 10, 1),
    ([ModelFile(path='a', size_bytes=2)], 10, 100)])
def test_empty_excessive_or_unhashed_manifest_is_rejected(files, max_files, max_total):
    with pytest.raises(AppError):
        validate_manifest(files, max_files=max_files, max_file_bytes=100, max_total_bytes=max_total)


@pytest.mark.parametrize('path', ['../a', '/a', 'a//b', 'a/./b', 'a\\b', 'C:/a', 'a/../b', 'a\x00b', 'a\ud800'])
def test_unsafe_relative_paths_are_rejected(path):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ModelFile(path=path, size_bytes=1, sha256='a'*64)


def test_manifest_accounts_for_the_complete_minio_key_prefix():
    with pytest.raises(AppError) as caught:
        validate_manifest([ModelFile(path='x'*929, size_bytes=1, sha256='a'*64)],
                          max_files=10, max_file_bytes=100, max_total_bytes=100)
    assert caught.value.code == 'model_manifest_invalid'
    accepted = validate_manifest([ModelFile(path='x'*928, size_bytes=1, sha256='a'*64)],
                                max_files=10, max_file_bytes=100, max_total_bytes=100)
    assert len(accepted) == 1
