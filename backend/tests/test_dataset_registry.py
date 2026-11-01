from contextlib import contextmanager
import hashlib
import io
from types import SimpleNamespace
import uuid

import pytest
from modelforge.errors import AppError
from modelforge.modules.datasets.registry import DatasetRegistry


def _source():
    return b"".join(
        f'{{"messages":[{{"role":"user","content":"q-{index}"}},{{"role":"assistant","content":"a-{index}"}}]}}\n'.encode()
        for index in range(10)
    )


class _Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row

    def fetchall(self):
        return []


class _Connection:
    def __init__(self, row, *, fail_update=False):
        self.row = row
        self.fail_update = fail_update

    def execute(self, query, parameters):
        if query.startswith("SELECT v.*"):
            return _Result(self.row)
        if query.startswith("SELECT reference_type"):
            return _Result()
        if query.startswith("UPDATE dataset_versions SET split_object_key"):
            if self.fail_update:
                raise RuntimeError("database update failed")
            self.row.update({
                "split_object_key": parameters[0],
                "split_sha256": parameters[1],
                "split_requested_ratio": parameters[2],
                "split_ratio": parameters[3],
                "split_seed": parameters[4],
            })
            return _Result()
        raise AssertionError(f"unexpected query: {query}")


class _Pool:
    def __init__(self, connection):
        self.connection_state = connection

    @contextmanager
    def connection(self):
        yield self.connection_state


class _Body(io.BytesIO):
    def release_conn(self):
        pass


class _Store:
    def __init__(self, source, *, corrupt_split=False, fail_remove=False, fail_put_after_write=False):
        self.objects = {"source.jsonl": source}
        self.corrupt_split = corrupt_split
        self.fail_remove = fail_remove
        self.fail_put_after_write = fail_put_after_write

    def get_object(self, bucket, key):
        if key.endswith("split.json") and self.corrupt_split:
            return _Body(b"corrupt")
        return _Body(self.objects[key.rsplit("/", 1)[-1]])

    def put_object(self, bucket, key, stream, length, content_type):
        self.objects[key.rsplit("/", 1)[-1]] = stream.read()
        if self.fail_put_after_write:
            raise RuntimeError("write response lost")

    def remove_object(self, bucket, key):
        if self.fail_remove:
            raise RuntimeError("cleanup failed")
        self.objects.pop(key.rsplit("/", 1)[-1], None)


def _registry(*, corrupt_split=False, fail_update=False, fail_remove=False, fail_put_after_write=False, source=None):
    source = _source() if source is None else source
    version_id = uuid.uuid4()
    row = {
        "id": version_id,
        "dataset_id": uuid.uuid4(),
        "dataset_name": "test",
        "bucket": "modelforge",
        "object_key": f"datasets/test/versions/{version_id}/source.jsonl",
        "size_bytes": len(source),
        "sha256": hashlib.sha256(source).hexdigest(),
        "state": "draft",
        "split_object_key": None,
        "split_sha256": None,
        "split_ratio": None,
        "split_requested_ratio": None,
        "split_seed": None,
    }
    store = _Store(source, corrupt_split=corrupt_split, fail_remove=fail_remove, fail_put_after_write=fail_put_after_write)
    # The source key is looked up by its final path component in this test store.
    store.objects["source.jsonl"] = source
    return DatasetRegistry(SimpleNamespace(
        pool=_Pool(_Connection(row, fail_update=fail_update)),
        store=store,
        settings=SimpleNamespace(
            minio_bucket="modelforge",
            dataset_file_limit_bytes=100 * 1024 * 1024,
            dataset_sample_limit=100_000,
            dataset_line_limit_bytes=1024 * 1024,
            dataset_validation_error_limit=100,
            dataset_preview_samples=20,
        ),
    )), version_id, store


def test_split_readback_mismatch_returns_dependency_error_and_cleans_object():
    registry, version_id, store = _registry(corrupt_split=True)
    with pytest.raises(AppError) as caught:
        registry.split(version_id)
    assert caught.value.status == 503
    assert caught.value.details["cleanup_required"] is False
    assert not any(key.endswith("split.json") for key in store.objects)


def test_split_update_failure_preserves_cleanup_identity_when_remove_fails():
    registry, version_id, store = _registry(fail_update=True, fail_remove=True)
    with pytest.raises(AppError) as caught:
        registry.split(version_id)
    assert caught.value.status == 503
    assert caught.value.details["cleanup_required"] is True
    assert caught.value.details["object_key"].endswith("split.json")
    assert any(key.endswith("split.json") for key in store.objects)


def test_split_write_response_failure_still_attempts_cleanup():
    registry, version_id, store = _registry(fail_put_after_write=True)
    with pytest.raises(AppError) as caught:
        registry.split(version_id)
    assert caught.value.status == 503
    assert caught.value.details["cleanup_required"] is False
    assert not any(key.endswith("split.json") for key in store.objects)


def test_split_retry_returns_same_enriched_response_shape():
    registry, version_id, _ = _registry()
    first = registry.split(version_id)
    second = registry.split(version_id)
    assert first.keys() == second.keys()
    assert "references" in second


def test_get_exposes_saved_split_counts_and_target_separately():
    registry, version_id, store = _registry()
    registry.split(version_id, ratio=0.3)
    detail = registry.get(version_id)
    assert detail.get("split") == {
        "sample_count": 10, "train_count": 7, "validation_count": 3,
        "requested_ratio": 0.3, "actual_ratio": 0.3, "seed": 42,
    }


def test_small_split_detail_keeps_actual_counts_separate_from_requested_ratio():
    source = bytes([10]).join(_source().splitlines()[:3]) + bytes([10])
    registry, version_id, _ = _registry(source=source)
    registry.split(version_id)
    detail = registry.get(version_id)
    assert detail["split"]["train_count"] == 2
    assert detail["split"]["validation_count"] == 1
    assert detail["split"]["requested_ratio"] == 0.1
    assert detail["split"]["actual_ratio"] == 1 / 3


def test_get_rejects_corrupted_saved_split_instead_of_inventing_counts():
    registry, version_id, store = _registry()
    registry.split(version_id)
    store.corrupt_split = True
    with pytest.raises(AppError) as caught:
        registry.get(version_id)
    assert caught.value.status == 503
    assert caught.value.code == "dependency_unavailable"


def test_get_unsplit_version_has_no_split_summary():
    registry, version_id, _ = _registry()
    assert registry.get(version_id)["split"] is None
