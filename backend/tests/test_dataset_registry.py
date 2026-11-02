from contextlib import contextmanager
import hashlib
import io
import json
from types import SimpleNamespace
import uuid

import pytest
from minio.error import S3Error
from modelforge.errors import AppError
from modelforge.modules.datasets.registry import DatasetRegistry


def _source():
    return b"".join(
        f'{{"messages":[{{"role":"user","content":"q-{index}"}},{{"role":"assistant","content":"a-{index}"}}]}}\n'.encode()
        for index in range(10)
    )


class _Result:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class _Connection:
    def __init__(self, row, *, fail_update=False):
        self.row = row
        self.fail_update = fail_update
        self.deleted_versions = []
        self.deleted_datasets = []

    def execute(self, query, parameters):
        if query.startswith("SELECT v.*"):
            return _Result(self.row)
        if query.startswith("SELECT reference_type"):
            return _Result()
        if query.startswith("SELECT id, version_number, created_at"):
            return _Result()
        if query.startswith("UPDATE dataset_versions SET state='deleting'"):
            self.row["state"] = "deleting"
            return _Result()
        if query.startswith("DELETE FROM dataset_versions"):
            self.deleted_versions.append(parameters[0])
            return _Result()
        if query.startswith("DELETE FROM datasets d"):
            self.deleted_datasets.append(parameters[0])
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

    def stat_object(self, bucket, key):
        if key.rsplit("/", 1)[-1] in self.objects:
            return None
        raise S3Error(None, "NoSuchKey", "missing", None, None, None)


class _DeriveStore:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, bucket, key):
        return _Body(self.objects[key])

    def put_object(self, bucket, key, stream, length, content_type):
        self.objects[key] = stream.read()

    def remove_object(self, bucket, key):
        self.objects.pop(key, None)


class _DeriveConnection(_Connection):
    def __init__(self, base):
        self.base = base
        self.derived = None
        self.next_version = 2

    def execute(self, query, parameters):
        if query.startswith("SELECT v.*"):
            if parameters[0] == self.base["id"]:
                return _Result(self.base)
            return _Result(self.derived)
        if query.startswith("SELECT id FROM datasets"):
            return _Result({"id": self.base["dataset_id"]})
        if query.startswith("SELECT id, sha256, derived_from_version_id, state"):
            if self.derived is None:
                return _Result()
            return _Result({
                "id": self.derived["id"],
                "sha256": self.derived["sha256"],
                "derived_from_version_id": self.derived["derived_from_version_id"],
                "state": self.derived["state"],
            })
        if query.startswith("SELECT COALESCE(MAX(version_number)"):
            return _Result({"next_version": self.next_version})
        if query.startswith("INSERT INTO dataset_versions"):
            (
                version_id,
                dataset_id,
                version_number,
                bucket,
                object_key,
                size_bytes,
                sha256,
                line_count,
                sample_count,
                validation_errors,
                preview,
                derived_from_version_id,
                derivation_request_id,
            ) = parameters
            self.derived = {
                "id": version_id,
                "dataset_id": dataset_id,
                "dataset_name": self.base["dataset_name"],
                "version_number": version_number,
                "bucket": bucket,
                "object_key": object_key,
                "size_bytes": size_bytes,
                "sha256": sha256,
                "line_count": line_count,
                "sample_count": sample_count,
                "state": "pending",
                "validation_errors": validation_errors,
                "preview": preview,
                "split_object_key": None,
                "split_sha256": None,
                "split_ratio": None,
                "split_requested_ratio": None,
                "split_seed": None,
                "derived_from_version_id": derived_from_version_id,
                "derivation_request_id": derivation_request_id,
            }
            return _Result()
        if query.startswith("UPDATE dataset_versions SET state"):
            self.derived["state"] = parameters[0]
            return _Result()
        if query.startswith("SELECT reference_type"):
            return _Result()
        if query.startswith("SELECT id, version_number, created_at"):
            return _Result()
        raise AssertionError(f"unexpected query: {query}")


class _DerivedDeleteConnection(_DeriveConnection):
    def __init__(self, base, derived_versions):
        super().__init__(base)
        self.derived_versions = derived_versions

    def execute(self, query, parameters):
        if query.startswith("SELECT id, version_number, created_at"):
            return _Result(rows=self.derived_versions)
        return super().execute(query, parameters)


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
        "line_count": len(source.splitlines()),
        "sample_count": len(source.splitlines()),
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


def _derive_registry(source=None):
    source = _source() if source is None else source
    base_id = uuid.uuid4()
    dataset_id = uuid.uuid4()
    base = {
        "id": base_id,
        "dataset_id": dataset_id,
        "dataset_name": "test",
        "bucket": "modelforge",
        "object_key": f"datasets/{dataset_id}/versions/{base_id}/source.jsonl",
        "size_bytes": len(source),
        "sha256": hashlib.sha256(source).hexdigest(),
        "line_count": 10,
        "sample_count": 10,
        "state": "published",
        "split_object_key": None,
        "split_sha256": None,
        "split_ratio": None,
        "split_requested_ratio": None,
        "split_seed": None,
        "derived_from_version_id": None,
    }
    store = _DeriveStore({base["object_key"]: source})
    connection = _DeriveConnection(base)
    registry = DatasetRegistry(SimpleNamespace(
        pool=_Pool(connection),
        store=store,
        settings=SimpleNamespace(
            minio_bucket="modelforge",
            dataset_file_limit_bytes=100 * 1024 * 1024,
            dataset_sample_limit=100_000,
            dataset_line_limit_bytes=1024 * 1024,
            dataset_validation_error_limit=100,
            dataset_preview_samples=20,
        ),
    ))
    return registry, base, store


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


def test_sample_page_exposes_physical_lines_and_continuation():
    registry, version_id, store = _registry()
    registry.split(version_id)
    split = json.loads(store.objects["split.json"])

    page = registry.samples(version_id, offset=2, limit=3)

    assert page["sample_count"] == 10
    assert page["line_count"] == 10
    assert page["offset"] == 2
    assert page["next_offset"] == 5
    assert [sample["line"] for sample in page["samples"]] == [3, 4, 5]
    assert [sample["raw"] for sample in page["samples"]] == [
        line.decode("utf-8") for line in _source().splitlines()[2:5]
    ]
    assert [sample["split"] for sample in page["samples"]] == [
        "validation" if line in split["validation_lines"] else "train"
        for line in [3, 4, 5]
    ]


def test_final_sample_page_has_no_continuation():
    registry, version_id, _ = _registry()

    page = registry.samples(version_id, offset=8, limit=5)

    assert [sample["line"] for sample in page["samples"]] == [9, 10]
    assert page["next_offset"] is None


def test_derived_version_rejects_out_of_range_line_before_writing():
    registry, base, store = _derive_registry()
    with pytest.raises(AppError) as caught:
        registry.derive(
            base["id"],
            uuid.uuid4(),
            base["sha256"],
            11,
            [{"role": "user", "content": "q"}],
        )
    assert caught.value.status == 422
    assert caught.value.details[0]["path"] == "line"
    assert list(store.objects) == [base["object_key"]]


def test_derived_version_keeps_base_object_and_records_exact_source():
    registry, base, store = _derive_registry()
    messages = [
        {"role": "user", "content": "edited question"},
        {"role": "assistant", "content": "edited answer"},
    ]

    derived = registry.derive(base["id"], uuid.uuid4(), base["sha256"], 2, messages)

    assert derived["version_number"] == 2
    assert derived["derived_from_version_id"] == base["id"]
    assert derived["state"] == "draft"
    assert store.objects[base["object_key"]] == _source()
    changed = store.objects[derived["object_key"]]
    assert changed.splitlines(keepends=True)[0] == _source().splitlines(keepends=True)[0]
    assert changed.splitlines(keepends=True)[2] == _source().splitlines(keepends=True)[2]
    assert b"edited question" in changed
    assert b"edited answer" in changed


def test_derived_version_rejects_stale_base_identity_before_writing():
    registry, base, store = _derive_registry()

    with pytest.raises(AppError) as caught:
        registry.derive(
            base["id"],
            uuid.uuid4(),
            "0" * 64,
            1,
            [{"role": "assistant", "content": "edited"}],
        )

    assert caught.value.status == 409
    assert caught.value.code == "dataset_changed"
    assert list(store.objects) == [base["object_key"]]


def test_derived_version_retry_with_same_request_returns_the_same_version():
    registry, base, store = _derive_registry()
    request_id = uuid.uuid4()
    messages = [
        {"role": "user", "content": "edited question"},
        {"role": "assistant", "content": "edited answer"},
    ]

    first = registry.derive(base["id"], request_id, base["sha256"], 2, messages)
    second = registry.derive(base["id"], request_id, base["sha256"], 2, messages)

    assert second["id"] == first["id"]
    assert second["version_number"] == first["version_number"]
    assert len(store.objects) == 2


def test_derived_version_request_id_rejects_different_content():
    registry, base, store = _derive_registry()
    request_id = uuid.uuid4()
    first_messages = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
    ]
    registry.derive(base["id"], request_id, base["sha256"], 2, first_messages)

    with pytest.raises(AppError) as caught:
        registry.derive(
            base["id"],
            request_id,
            base["sha256"],
            2,
            [
                {"role": "user", "content": "different question"},
                {"role": "assistant", "content": "different answer"},
            ],
        )

    assert caught.value.status == 409
    assert caught.value.code == "derivation_request_conflict"
    assert len(store.objects) == 2


def test_derived_version_preserves_bare_cr_physical_lines():
    source = (
        b'{"messages":[{"role":"user","content":"q1"},{"role":"assistant","content":"a1"}]}\r'
        b'{"messages":[{"role":"user","content":"q2"},{"role":"assistant","content":"a2"}]}\r'
    )
    registry, base, store = _derive_registry(source=source)

    derived = registry.derive(
        base["id"],
        uuid.uuid4(),
        base["sha256"],
        1,
        [
            {"role": "user", "content": "changed"},
            {"role": "assistant", "content": "answer"},
        ],
    )

    changed = store.objects[derived["object_key"]]
    assert changed.count(b"\r") == 2
    assert b'"content":"changed"' in changed
    assert source.splitlines(keepends=True)[1] in changed


def test_source_version_cannot_be_deleted_while_a_derived_version_exists():
    registry, base, store = _derive_registry()
    derived_id = uuid.uuid4()
    registry.pool.connection_state = _DerivedDeleteConnection(base, [{
        "id": derived_id,
        "version_number": 2,
        "created_at": None,
    }])

    with pytest.raises(AppError) as caught:
        registry.delete(base["id"])

    assert caught.value.status == 409
    assert caught.value.code == "conflict"
    assert caught.value.details["derived_versions"] == [{
        "version_id": str(derived_id),
        "version_number": 2,
        "created_at": None,
    }]
    assert base["state"] == "published"
    assert store.objects[base["object_key"]] == _source()


def test_deleting_the_last_version_removes_the_empty_dataset_parent():
    registry, version_id, store = _registry()
    connection = registry.pool.connection_state
    dataset_id = connection.row["dataset_id"]

    registry.delete(version_id)

    assert connection.deleted_versions == [version_id]
    assert connection.deleted_datasets == [dataset_id]
    assert store.objects == {}
