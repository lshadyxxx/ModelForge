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


def test_dataset_sample_pagination_rejects_unbounded_limit():
    response = TestClient(app).get(
        "/api/v1/dataset-versions/00000000-0000-0000-0000-000000000001/samples?limit=201"
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_derived_dataset_contract_requires_base_sha_and_valid_roles():
    version_id = "00000000-0000-0000-0000-000000000001"
    response = TestClient(app).post(
        f"/api/v1/dataset-versions/{version_id}/derived",
        json={
            "request_id": "00000000-0000-0000-0000-000000000002",
            "expected_sha256": "not-a-sha",
            "line": 1,
            "messages": [{"role": "tool", "content": "invalid"}],
        },
    )
    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert any("request_id" in item["path"] for item in details) is False
    assert any("expected_sha256" in item["path"] for item in details)
    assert any("messages.0.role" in item["path"] for item in details)


def test_derived_dataset_contract_requires_idempotency_request_id():
    version_id = "00000000-0000-0000-0000-000000000001"
    response = TestClient(app).post(
        f"/api/v1/dataset-versions/{version_id}/derived",
        json={
            "expected_sha256": "0" * 64,
            "line": 1,
            "messages": [{"role": "assistant", "content": "valid"}],
        },
    )
    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert any("request_id" in item["path"] for item in details)


def test_model_limits_contract_reports_configuration(monkeypatch):
    from modelforge.settings import Settings
    settings = Settings(model_file_limit_bytes=17, model_total_limit_bytes=31,
                        model_file_count_limit=5, model_limits_version='test-models', model_limits_locked=False)
    monkeypatch.setattr(app.state, 'resources', SimpleNamespace(settings=settings), raising=False)
    response = TestClient(app).get('/api/v1/models/limits')
    assert response.status_code == 200
    assert response.json() == {'file_limit_bytes': 17, 'total_limit_bytes': 31,
        'file_count_limit': 5, 'configuration_version': 'test-models', 'locked': False,
        'resume_granularity': 'file', 'modelscope_resume_granularity': 'byte'}


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
    assert body["evidence"]["training_peak_memory"] == "measured"
    assert body["evidence"]["training_peak_device_used_bytes"] == 2_580_545_536
    assert body["evidence"]["training_peak_sample_count"] == 92
    assert "training_peak_memory_pending" not in body["closure_gaps"]


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


def test_ai_diagnosis_availability_defaults_to_disabled(monkeypatch):
    settings = SimpleNamespace(
        ai_enabled=False,
        ai_model=None,
    )
    monkeypatch.setattr(
        app.state,
        "resources",
        SimpleNamespace(settings=settings),
        raising=False,
    )
    response = TestClient(app).get("/api/v1/training/diagnosis/config")
    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "model_configured": False,
        "scope": "terminal_attempt_only",
        "trigger": "manual",
        "ai_role": "advisory_diagnosis_not_gate",
    }


def _diagnosis_route_stub(monkeypatch, **methods):
    from modelforge.modules.diagnosis import routes as diagnosis_routes

    class Stub:
        pass

    for name, value in methods.items():
        setattr(Stub, name, value)
    monkeypatch.setattr(
        diagnosis_routes,
        "use_cases",
        lambda request: Stub(),
    )


def test_diagnosis_create_without_body_defaults_to_auto(monkeypatch):
    attempt_id = "11111111-1111-1111-1111-111111111111"
    captured = {}

    def create(self, value, *, comparison_mode, baseline_attempt_id):
        captured.update(
            attempt_id=value,
            comparison_mode=comparison_mode,
            baseline_attempt_id=baseline_attempt_id,
        )
        return {
            "job_id": "22222222-2222-2222-2222-222222222222",
            "attempt_id": str(value),
            "state": "queued",
        }

    _diagnosis_route_stub(monkeypatch, create=create)
    response = TestClient(app).post(
        f"/api/v1/training/attempts/{attempt_id}/diagnosis-reports"
    )
    assert response.status_code == 202
    assert captured["comparison_mode"] == "auto"
    assert captured["baseline_attempt_id"] is None


def test_diagnosis_create_explicit_passes_baseline(monkeypatch):
    attempt_id = "11111111-1111-1111-1111-111111111111"
    baseline_id = "33333333-3333-3333-3333-333333333333"
    captured = {}

    def create(self, value, *, comparison_mode, baseline_attempt_id):
        captured.update(
            attempt_id=value,
            comparison_mode=comparison_mode,
            baseline_attempt_id=baseline_attempt_id,
        )
        return {"state": "queued"}

    _diagnosis_route_stub(monkeypatch, create=create)
    response = TestClient(app).post(
        f"/api/v1/training/attempts/{attempt_id}/diagnosis-reports",
        json={
            "comparison_mode": "explicit",
            "baseline_attempt_id": baseline_id,
        },
    )
    assert response.status_code == 202
    assert str(captured["attempt_id"]) == attempt_id
    assert captured["comparison_mode"] == "explicit"
    assert str(captured["baseline_attempt_id"]) == baseline_id


def test_diagnosis_create_rejects_invalid_baseline_combinations(monkeypatch):
    attempt_id = "11111111-1111-1111-1111-111111111111"
    baseline_id = "33333333-3333-3333-3333-333333333333"
    _diagnosis_route_stub(
        monkeypatch,
        create=lambda *args, **kwargs: {"state": "queued"},
    )
    client = TestClient(app)

    missing = client.post(
        f"/api/v1/training/attempts/{attempt_id}/diagnosis-reports",
        json={"comparison_mode": "explicit"},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "validation_error"

    unexpected = client.post(
        f"/api/v1/training/attempts/{attempt_id}/diagnosis-reports",
        json={
            "comparison_mode": "auto",
            "baseline_attempt_id": baseline_id,
        },
    )
    assert unexpected.status_code == 422
    assert unexpected.json()["error"]["code"] == "validation_error"


def test_diagnosis_candidates_route_forwards_subject_and_limit(monkeypatch):
    attempt_id = "11111111-1111-1111-1111-111111111111"
    captured = {}

    def comparison_candidates(self, value, *, limit):
        captured.update(attempt_id=value, limit=limit)
        return {
            "subject_attempt_id": str(value),
            "group": {
                "base_fingerprint": "b" * 64,
                "dataset_sha256": "d" * 64,
                "dataset_split_sha256": "s" * 64,
            },
            "suggested_baseline_attempt_id": None,
            "candidates": [],
        }

    _diagnosis_route_stub(
        monkeypatch,
        comparison_candidates=comparison_candidates,
    )
    response = TestClient(app).get(
        f"/api/v1/training/attempts/{attempt_id}"
        "/diagnosis-comparison-candidates?limit=7"
    )
    assert response.status_code == 200
    assert str(captured["attempt_id"]) == attempt_id
    assert captured["limit"] == 7
