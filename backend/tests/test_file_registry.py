"""Unit failure ordering only; these substitutes are not storage acceptance."""
from contextlib import contextmanager
from types import SimpleNamespace
import hashlib
import io
import uuid
import pytest
from minio.error import S3Error
from modelforge.errors import AppError
from modelforge.modules.models import FileRegistry


class Connection:
    def __init__(self, row):
        self.row = row
        self.events = []
    def execute(self, query, parameters):
        self.events.append((query, parameters))
        if query.startswith("UPDATE"):
            self.row["state"] = parameters[0]
        return self
    def fetchone(self):
        return self.row


class Pool:
    def __init__(self, row):
        self.connection_state = Connection(row)
    @contextmanager
    def connection(self):
        yield self.connection_state


class Store:
    def __init__(self, fail_put=False, corrupt=False, keep_after_delete=False):
        self.fail_put, self.corrupt, self.keep_after_delete = fail_put, corrupt, keep_after_delete
    def put_object(self, bucket, key, stream, length, content_type):
        if self.fail_put:
            raise RuntimeError("storage failure")
        self.data = stream.read()
    def get_object(self, bucket, key):
        class Body(io.BytesIO):
            def release_conn(self):
                pass
        return Body(b"corrupted" if self.corrupt else self.data)
    def remove_object(self, bucket, key):
        pass
    def stat_object(self, bucket, key):
        if self.keep_after_delete:
            return object()
        raise S3Error(code="NoSuchKey", message="not found", resource=key, request_id="request", host_id="host", response=None)


def registry(store):
    data = b"verified-content"
    row = {"id": uuid.uuid4(), "bucket": "modelforge", "object_key": "test/key",
           "state": "pending", "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
           "content_type": "application/octet-stream"}
    pool = Pool(row)
    return FileRegistry(SimpleNamespace(pool=pool, store=store, settings=SimpleNamespace(minio_bucket="modelforge"))), pool, data


def test_upload_becomes_available_after_readback_only():
    subject, pool, data = registry(Store())
    result = subject.upload(data, "application/octet-stream")
    assert result["state"] == "available"
    assert pool.connection_state.events[0][0].startswith("INSERT")


@pytest.mark.parametrize("store", [Store(fail_put=True), Store(corrupt=True)])
def test_failed_or_corrupt_upload_never_publishes(store):
    subject, pool, data = registry(store)
    with pytest.raises(AppError) as caught:
        subject.upload(data, "application/octet-stream")
    assert caught.value.status == 503
    assert "file_id" in caught.value.details
    assert pool.connection_state.row["state"] == "upload_failed"
    assert all(values[0] != "available" for query, values in pool.connection_state.events if query.startswith("UPDATE"))


def test_pending_content_returns_conflict_without_reading_store():
    subject, pool, data = registry(Store())
    with pytest.raises(AppError) as caught:
        subject.download(pool.connection_state.row["id"])
    assert caught.value.status == 409


def test_delete_preserves_metadata_when_object_still_exists():
    subject, pool, data = registry(Store(keep_after_delete=True))
    with pytest.raises(AppError):
        subject.delete(pool.connection_state.row["id"])
    assert pool.connection_state.row["state"] == "delete_failed"
    assert not any(query.startswith("DELETE") for query, values in pool.connection_state.events)


def test_delete_metadata_only_after_confirming_object_absence():
    subject, pool, data = registry(Store())
    subject.delete(pool.connection_state.row["id"])
    assert pool.connection_state.events[-1][0].startswith("DELETE")
