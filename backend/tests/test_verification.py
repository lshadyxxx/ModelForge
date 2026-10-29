"""Contract regressions with isolated substitutes; not real storage acceptance."""
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path
import hashlib
import json
import uuid
import httpx
import pytest
from minio.error import S3Error
from modelforge import verification as subject

HTTP_CLIENT = httpx.Client


@pytest.fixture
def probe(monkeypatch):
    state = SimpleNamespace(row=None, data=None, uploads=0, closed=False)
    class Connection:
        def execute(self, query, parameters):
            return self
        def fetchone(self):
            return state.row
    class Pool:
        @contextmanager
        def connection(self):
            yield Connection()
    class Store:
        def stat_object(self, bucket, key):
            if state.data is not None:
                return object()
            raise S3Error(code="NoSuchKey", message="absent", resource=key, request_id="test", host_id="test", response=None)
    resources = SimpleNamespace(settings=SimpleNamespace(minio_bucket="test"), pool=Pool(), store=Store(), close=lambda: setattr(state, "closed", True))
    def handle(request):
        if request.method == "POST":
            state.uploads += 1
            state.data = request.content
            state.row = {"id": str(uuid.uuid4()), "bucket": "test", "object_key": "files/test",
                         "size_bytes": len(state.data), "sha256": hashlib.sha256(state.data).hexdigest(), "state": "available"}
            return httpx.Response(201, json=state.row)
        if request.method == "DELETE":
            state.row, state.data = None, None
            return httpx.Response(204)
        return httpx.Response(200, content=state.data)
    client_type = HTTP_CLIENT
    monkeypatch.setattr(subject.httpx, "Client", lambda **kwargs: client_type(**kwargs, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(subject.Resources, "open", lambda settings: resources)
    monkeypatch.setattr(subject, "get_settings", lambda: object())
    monkeypatch.setattr(subject, "read_object", lambda *args: state.data)
    return state


def test_api_id_receipt_survives_prepare_verify_cleanup(probe, tmp_path, capsys):
    path = tmp_path / "receipt.json"
    subject.run("prepare", path, "http://test", "roundtrip")
    receipt = json.loads(path.read_text())
    assert receipt["file_id"] == probe.row["id"]
    assert receipt["run_id"] == "roundtrip"
    assert probe.data == subject.payload("roundtrip")
    subject.run("verify", path, "http://test", None)
    assert not path.exists()
    assert probe.row is None and probe.data is None
    reports = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert reports[-1]["checks"]["metadata_deleted"] == "pass"


def test_failure_reports_safe_actual_stage(probe, tmp_path, monkeypatch, capsys):
    path = tmp_path / "receipt.json"
    subject.run("prepare", path, "http://test", "broken")
    probe.row = None
    capsys.readouterr()
    monkeypatch.setattr("sys.argv", ["verification", "verify", "--receipt", str(path), "--base-url", "http://test"])
    with pytest.raises(SystemExit) as error:
        subject.main()
    assert error.value.code == 1
    report = json.loads(capsys.readouterr().err.splitlines()[-1])
    assert report["stage"] == "postgres_metadata"
    assert report["message"] == "PostgreSQL metadata missing"
    assert path.exists()


def test_receipt_write_failure_preserves_cleanup_identity(probe, tmp_path, monkeypatch, capsys):
    path = tmp_path / "receipt.json"
    original = Path.open
    class FailingReceipt:
        def __init__(self, handle):
            self.handle = handle
            self.writes = 0
        def write(self, value):
            self.writes += 1
            if self.writes == 2:
                raise OSError("password=never-leak")
            return self.handle.write(value)
        def __getattr__(self, name):
            return getattr(self.handle, name)
    def open_receipt(self, *args, **kwargs):
        handle = original(self, *args, **kwargs)
        return FailingReceipt(handle) if self == path and (args[0] if args else kwargs.get("mode")) == "x" else handle
    monkeypatch.setattr(Path, "open", open_receipt)
    monkeypatch.setattr("sys.argv", ["verification", "prepare", "--receipt", str(path), "--base-url", "http://test"])
    with pytest.raises(SystemExit) as error:
        subject.main()
    assert error.value.code == 1 and probe.uploads == 1
    raw = capsys.readouterr().err
    messages = [json.loads(line) for line in raw.splitlines()]
    recovery = messages[0]["recovery_receipt"]
    assert recovery["file_id"] == probe.row["id"]
    assert messages[-1]["stage"] == "receipt_persist"
    assert "never-leak" not in raw
    # Recovery output is sufficient for the documented cleanup mode.
    path.write_text(json.dumps(recovery), encoding="utf-8")
    subject.run("cleanup", path, "http://test", None)
    assert probe.row is None and probe.data is None and not path.exists()


def test_existing_receipt_prevents_another_upload(probe, tmp_path):
    path = tmp_path / "receipt.json"
    path.write_text("existing")
    with pytest.raises(subject.VerificationFailure) as error:
        subject.run("prepare", path, "http://test", "duplicate")
    assert error.value.stage == "receipt_prepare"
    assert probe.uploads == 0 and path.read_text() == "existing"


def test_cleanup_retry_checks_both_stores_after_404(probe, tmp_path, monkeypatch):
    path = tmp_path / "receipt.json"
    subject.run("prepare", path, "http://test", "cleanup-retry")
    probe.row, probe.data = None, None
    # HTTP already deleted the file during an earlier attempt.
    client_type = HTTP_CLIENT
    monkeypatch.setattr(subject.httpx, "Client", lambda **kwargs: client_type(**kwargs, transport=httpx.MockTransport(lambda request: httpx.Response(404))))
    subject.run("cleanup", path, "http://test", None)
    assert not path.exists()


def test_rejected_upload_persists_cleanup_identity(probe, tmp_path, monkeypatch):
    path = tmp_path / "rejected.json"
    identity = str(uuid.uuid4())
    def handle(request):
        if request.method == "POST":
            return httpx.Response(503, json={"error": {"details": {"file_id": identity}}})
        if request.method == "GET":
            return httpx.Response(404)
        return httpx.Response(204)
    monkeypatch.setattr(subject.httpx, "Client", lambda **kwargs: HTTP_CLIENT(**kwargs, transport=httpx.MockTransport(handle)))
    with pytest.raises(subject.VerificationFailure):
        subject.run("prepare", path, "http://test", "rejected")
    receipt = json.loads(path.read_text())
    assert receipt["file_id"] == identity
    assert receipt["state"] == "upload_failed"
    subject.run("cleanup", path, "http://test", None)
    assert not path.exists()


def test_unknown_upload_requires_explicit_reset_preserving_evidence(probe, tmp_path, monkeypatch, capsys):
    path = tmp_path / "unknown.json"
    def disconnected(request):
        raise httpx.ReadTimeout("password=never-leak")
    monkeypatch.setattr(subject.httpx, "Client", lambda **kwargs: HTTP_CLIENT(**kwargs, transport=httpx.MockTransport(disconnected)))
    with pytest.raises(subject.VerificationFailure):
        subject.run("prepare", path, "http://test", "unknown")
    assert json.loads(path.read_text())["state"] == "upload_pending"
    monkeypatch.setattr("sys.argv", ["verification", "reset-pending", "--receipt", str(path)])
    subject.main()
    assert not path.exists()
    archives = list(tmp_path.glob("unknown.json.unresolved-*"))
    assert len(archives) == 1
    assert json.loads(archives[0].read_text())["state"] == "upload_pending"
    report = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert report["result"] == "pending_archived"
    assert report["remote_cleanup_confirmed"] is False
