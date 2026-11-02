import os
from types import SimpleNamespace
os.environ.setdefault("MF_PG_PASSWORD", "test-only")
os.environ.setdefault("MF_MINIO_ACCESS_KEY", "test-only")
os.environ.setdefault("MF_MINIO_SECRET_KEY", "test-only-secret")
from fastapi.testclient import TestClient
from modelforge.entrypoints.api import app
from modelforge.entrypoints.worker import app as worker
from modelforge.errors import AppError


def test_liveness_is_process_only():
    # No lifespan means no pool or store; liveness must remain dependency-free.
    response = TestClient(app).get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["service"] == "api"
    assert response.headers["X-Request-ID"].startswith("req_")


def test_worker_probe_scope():
    response = TestClient(worker).get("/health/live")
    assert response.json()["scope"] == "process_only"


def test_validation_contract_omits_input():
    response = TestClient(app).get("/api/v1/files/not-a-uuid", headers={"X-Request-ID": "test-request-01"})
    assert response.status_code == 422
    body = response.json()
    assert body["request_id"] == "test-request-01"
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"][0]["path"] == "path.file_id"
    assert "input" not in body["error"]["details"][0]


def test_not_found_uses_same_envelope():
    response = TestClient(app).get("/no-such-route")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_invalid_request_id_is_replaced():
    response = TestClient(app).get("/api/v1/health/live", headers={"X-Request-ID": "x" * 65})
    assert response.headers["X-Request-ID"] != "x" * 65


def test_dataset_limits_contract_reports_configuration(monkeypatch):
    settings = SimpleNamespace(
        dataset_file_limit_bytes=100,
        dataset_sample_limit=200,
        dataset_line_limit_bytes=300,
        dataset_validation_error_limit=40,
        dataset_preview_samples=20,
        dataset_limits_version="test",
        dataset_limits_locked=False,
    )
    monkeypatch.setattr(app.state, "resources", SimpleNamespace(settings=settings), raising=False)
    response = TestClient(app).get("/api/v1/datasets/limits")
    assert response.status_code == 200
    assert response.json() == {
        "file_limit_bytes": 100,
        "sample_limit": 200,
        "line_limit_bytes": 300,
        "validation_error_limit": 40,
        "preview_samples": 20,
        "configuration_version": "test",
        "locked": False,
    }


def test_model_limits_contract_reports_configuration(monkeypatch):
    from modelforge.settings import Settings
    settings = Settings(model_file_limit_bytes=17, model_total_limit_bytes=31,
                        model_file_count_limit=5, model_limits_version='test-models', model_limits_locked=False)
    monkeypatch.setattr(app.state, 'resources', SimpleNamespace(settings=settings), raising=False)
    response = TestClient(app).get('/api/v1/models/limits')
    assert response.status_code == 200
    assert response.json() == {'file_limit_bytes': 17, 'total_limit_bytes': 31,
        'file_count_limit': 5, 'configuration_version': 'test-models', 'locked': False,
        'resume_granularity': 'file'}


def test_runtime_baseline_contract_reports_locks_and_open_gaps(monkeypatch):
    from modelforge.settings import Settings
    settings = Settings(dataset_limits_locked=False, model_limits_locked=False)
    monkeypatch.setattr(app.state, "resources", SimpleNamespace(settings=settings), raising=False)
    response = TestClient(app).get("/api/v1/runtime/baseline")
    assert response.status_code == 200
    body = response.json()
    assert body["id"].endswith("partial-20261102-r1")
    assert len(body["sha256"]) == 64
    assert body["model"]["architecture"] == "qwen3"
    assert body["training"]["runtime_lock_id"]
    assert body["inference"]["runtime_lock_id"]
    assert body["capacity"]["dataset"]["file_limit_bytes"] == 100 * 1024 * 1024
    assert body["capacity"]["dataset"]["sample_limit"] == 100_000
    assert body["capacity"]["model"]["file_limit_bytes"] == 20 * 1024**3
    assert body["capacity"]["model"]["total_limit_bytes"] == 100 * 1024**3
    assert body["capacity"]["dataset"]["locked"] is False
    assert "training_peak_memory_pending" in body["closure_gaps"]


def test_unexpected_errors_are_sanitized():
    from fastapi import FastAPI
    from modelforge.errors import configure_errors
    isolated = FastAPI()
    configure_errors(isolated)
    @isolated.get("/fault")
    def fail():
        raise RuntimeError("password=never-leak")
    response = TestClient(isolated, raise_server_exceptions=False).get("/fault")
    assert response.status_code == 500
    assert "never-leak" not in response.text
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
