"""Managed training guards: fake provider only, never live cloud evidence."""
import base64
import hashlib
import io
import json
import os
import time
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from modelforge.bootstrap import Resources
from modelforge.errors import AppError
from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import Adapters, ModelFile, ModelRegistry
from modelforge.modules.resources import GpuLeases, InstanceLifecycle
from modelforge.modules.training import CreateTask, Training, TrainingWorker
from modelforge.modules.training.provisioning import TrainingProvisioning
from modelforge.runtimes.executors import LlamaFactoryExecutor
from modelforge.settings import Settings

from test_execution_workflows import Channel


if os.getenv("MF_TEST_WORKFLOW_INTEGRATION") == "1" and (
    os.getenv("MF_TEST_ISOLATED_STORES") != "1"
    or not os.getenv("MF_PG_DATABASE", "").startswith("modelforge_test_")
):
    raise pytest.UsageError("Managed workflow tests require disposable stores")

pytestmark = pytest.mark.skipif(
    os.getenv("MF_TEST_WORKFLOW_INTEGRATION") != "1",
    reason="Requires isolated PostgreSQL/MinIO",
)

TRAIN_SPEC = {
    "region": "cn-bj2",
    "zone": "cn-bj2-03",
    "gpu_type": "4090",
    "cpu": 14,
    "memory_mb": 65536,
    "image_id": "compshareImage-1fc8fjody17l",
    "cpu_platform": "Amd/Auto",
    "charge_type": "Postpay",
    "boot_disk_gb": 100,
    "boot_disk_type": "CLOUD_SSD",
}


class ManagedProvider:
    """Small in-process provider: no network, no credentials, no paid calls."""

    def __init__(self):
        self.instance_id = "fixture-managed-instance"
        self.state = "Running"
        self.label = None
        self.create_calls = 0
        self.create_error = None
        self.scheduler_error = None
        self.terminate_error = None
        self.duplicate_candidates = False
        self.writes = []
        self.create_parameters = None

    def query(self, action, parameters):
        if action == "DescribeCompShareImages":
            return {
                "ImageSet": [{
                    "CompShareImageId": parameters["CompShareImageId"],
                    "Status": "Available",
                }],
            }
        if action == "CheckCompShareResourceCapacity":
            return {
                "Specs": [{
                    "Gpu": 1,
                    "Cpu": parameters["Disks"][0]["Size"] and TRAIN_SPEC["cpu"],
                    "Mem": TRAIN_SPEC["memory_mb"] // 1024,
                    "ResourceEnough": True,
                }],
            }
        if action == "GetProjectList":
            return {"ProjectSet": [{"ProjectId": "org-fixture", "IsDefault": True}]}
        if action == "DescribeCompShareInstance":
            if self.state == "Deleted":
                return {"UHostSet": [], "TotalCount": 0}
            row = self._row()
            if parameters.get("UHostIds"):
                selected = [row] if self.instance_id in parameters["UHostIds"] else []
                return {"UHostSet": selected, "TotalCount": len(selected)}
            selected = [row, {**row, "UHostId": "fixture-managed-copy"}] if self.duplicate_candidates else [row]
            return {"UHostSet": selected, "TotalCount": len(selected)}
        raise AssertionError(("unexpected query", action, parameters))

    def _row(self):
        return {
            "UHostId": self.instance_id,
            "Name": self.label or "mf-fixture",
            "State": self.state,
            "CreateTime": int(time.time()) + 1,
            "Region": TRAIN_SPEC["region"],
            "Zone": TRAIN_SPEC["zone"],
            "GpuType": TRAIN_SPEC["gpu_type"],
            "GPU": 1,
            "CPU": TRAIN_SPEC["cpu"],
            "Memory": TRAIN_SPEC["memory_mb"],
            "CompShareImageId": TRAIN_SPEC["image_id"],
        }

    def create(self, parameters):
        self.create_calls += 1
        self.create_parameters = parameters
        self.label = parameters["Name"]
        if self.create_error:
            raise self.create_error
        return {"UHostIds": [self.instance_id]}

    def update_stop_scheduler(self, parameters):
        if self.scheduler_error:
            raise self.scheduler_error
        self.writes.append("schedule")
        return {"UHostId": parameters["UHostId"]}

    def delete_stop_scheduler(self, parameters):
        self.writes.append("unschedule")
        return {"UHostId": parameters["UHostId"]}

    def stop(self, parameters):
        self.writes.append("stop")
        self.state = "Stopped"
        return {"UHostId": parameters["UHostId"]}

    def terminate(self, parameters):
        if self.terminate_error:
            raise self.terminate_error
        self.writes.append("terminate")
        self.state = "Deleted"
        return {"UHostId": parameters["UHostId"], "InRecycle": "No"}

    def start(self, parameters):
        self.state = "Running"
        return {"UHostId": parameters["UHostId"]}

    def reset_password(self, parameters):
        self.writes.append("reset_password")
        return {"UHostId": parameters["UHostId"]}


class FixtureFirstBoot:
    def __init__(self):
        self.bootstrap_calls = 0
        self.runtime_calls = 0
        self.failure = None
        self.credential_state = "rotated"
        self.registry = SimpleNamespace(remove=lambda *args, **kwargs: None)

    def bootstrap(self, token, *, attempt_id, temporary_sha256=None):
        self.bootstrap_calls += 1
        if self.failure:
            raise self.failure
        return {
            "state": "ready",
            "credential_state": self.credential_state,
            "host_key_fingerprint": "SHA256:fixture",
            "endpoint_epoch": 1,
        }

    def ensure_runtime(self, instance_id, provider_profile):
        self.runtime_calls += 1
        return {"installed": True, "runtime_source": "fixture"}


@pytest.fixture
def managed_env(monkeypatch):
    monkeypatch.setattr(
        "modelforge.modules.resources.Catalog.validate_selection",
        lambda self, spec: spec,
    )
    monkeypatch.setattr(
        "modelforge.runtimes.compatibility._model_mismatches",
        lambda *args, **kwargs: [],
    )
    monkeypatch.setattr(
        "modelforge.runtimes.compatibility._training_mismatches",
        lambda *args, **kwargs: [],
    )
    resources = Resources.open(Settings())
    resources.pool.wait()
    resources.settings.ucloud_public_key = SecretStr("fixture-public")
    resources.settings.ucloud_private_key = SecretStr("fixture-private")
    resources.settings.ucloud_write_enabled = True
    resources.settings.ucloud_project_id = None
    with resources.pool.connection() as connection:
        connection.execute(
            "TRUNCATE training_tasks,gpu_slots,gpu_reservations,models,datasets CASCADE"
        )
        connection.execute("INSERT INTO gpu_slots(id) VALUES(1)")

    dataset = DatasetRegistry(resources)
    data = b"\n".join(
        json.dumps(
            {
                "messages": [
                    {"role": "user", "content": str(index)},
                    {"role": "assistant", "content": "answer" + str(index)},
                ]
            }
        ).encode()
        for index in range(20)
    )
    version = dataset.create(data, "managed workflow fixture")
    dataset.publish(version["id"])
    files = {
        "config.json": b'{"model_type":"qwen3","architectures":["Qwen3ForCausalLM"]}',
        "tokenizer_config.json": b"{}",
        "tokenizer.json": b"{}",
        "model.safetensors": b"fixture-weight",
    }
    registry = ModelRegistry(resources)
    manifest = [
        ModelFile(
            path=path,
            size_bytes=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )
        for path, content in files.items()
    ]
    model = registry.create("fixture base", manifest)
    for path, content in files.items():
        registry.upload(
            model["id"],
            path,
            io.BytesIO(content),
            len(content),
            hashlib.sha256(content).hexdigest(),
        )
    registry.complete(model["id"])
    body = CreateTask(
        name="managed fixture task",
        dataset_version_id=version["id"],
        base_model_version_id=model["id"],
        instance=TRAIN_SPEC,
        config={"template": "qwen3_nothink"},
        execution_mode="managed",
        training_image_profile_id="base-image-a-prime",
    )
    provider = ManagedProvider()
    channel = Channel()
    lifecycle = InstanceLifecycle(GpuLeases(resources.pool), provider)
    try:
        yield resources, body, provider, channel, lifecycle
    finally:
        resources.close()


def managed_worker(env):
    resources, _, _, channel, lifecycle = env
    first_boot = FixtureFirstBoot()
    provisioning = TrainingProvisioning(
        resources,
        lifecycle,
        first_boot=first_boot,
    )
    provisioning._price_guard = lambda spec: {
        "hourly_cny": 2.15,
        "window_estimate_cny": 2.69,
    }
    worker = TrainingWorker(
        resources,
        channel,
        lifecycle,
        LlamaFactoryExecutor(),
        provisioning=provisioning,
    )
    return worker, first_boot, provisioning


def begin_managed(env):
    resources, body, provider, channel, lifecycle = env
    training = Training(resources)
    attempt = training.create(body)
    worker, first_boot, provisioning = managed_worker(env)
    worker.run_once()
    return attempt, training, worker, first_boot, provisioning


def test_managed_creation_requires_matching_published_profile(managed_env):
    resources, body, *_ = managed_env
    training = Training(resources)
    payload = body.model_dump()

    accepted = training.create(body)
    assert accepted["execution_mode"] == "managed"
    assert accepted["snapshot"]["training_image_profile"]["id"] == "base-image-a-prime"
    assert accepted["snapshot"]["schema"] == 2

    with pytest.raises(AppError) as caught:
        training.create(
            CreateTask(
                **{
                    **payload,
                    "name": "mismatched image profile",
                    "training_image_profile_id": "training-base-b",
                }
            )
        )
    assert caught.value.code == "training_image_profile_mismatch"

    with pytest.raises(AppError) as caught:
        training.create(
            CreateTask(
                **{
                    **payload,
                    "name": "manual with profile",
                    "execution_mode": "manual",
                }
            )
        )
    assert caught.value.code == "manual_image_profile_not_allowed"


def test_managed_worker_provisions_runs_cleans_and_redacts(managed_env):
    resources, _, provider, channel, _ = managed_env
    attempt, training, worker, first_boot, _ = begin_managed(managed_env)

    started = training.get(attempt["id"])
    assert started["state"] == "running"
    assert started["stage"] == "training"
    assert started["instance_id"] == provider.instance_id
    assert provider.create_calls == 1
    assert provider.writes[:1] == ["schedule"]
    assert first_boot.bootstrap_calls == 1
    assert channel.starts == 1

    # A Worker restart must reuse durable provisioning and remote-job facts.
    restarted, _, _ = managed_worker(managed_env)
    restarted.run_once()
    assert provider.create_calls == 1
    assert training.get(attempt["id"])["state"] == "running"

    channel.success()
    for _ in range(7):
        worker.run_once()
    final = training.get(attempt["id"])
    assert final["state"] == "succeeded"
    assert final["provisioning"]["artifact_state"] == "verified"
    assert len(Adapters(resources).list()) == 2
    assert provider.writes[-2:] == ["stop", "terminate"]
    assert GpuLeases(resources.pool).current() is None

    password = base64.b64decode(provider.create_parameters["Password"]).decode()
    projected = json.dumps(final, ensure_ascii=False, default=str)
    assert password not in projected
    assert "ssh_login_command" not in projected
    assert "private_key" not in projected
    assert "temporary_password_sha256" not in projected


def test_create_unknown_is_not_resent_and_duplicate_candidates_fail_closed(managed_env):
    resources, _, provider, _, _ = managed_env
    provider.create_error = AppError(502, "cloud_timeout", "fixture timeout")
    attempt, training, worker, _, provisioning = begin_managed(managed_env)

    first = training.get(attempt["id"])
    assert first["state"] == "preparing"
    assert provisioning.row(attempt["id"])["request_disposition"] == "unknown"
    assert provider.create_calls == 1

    provider.duplicate_candidates = True
    worker.run_once()
    facts = provisioning.row(attempt["id"])
    assert facts["request_disposition"] == "conflict"
    assert provider.create_calls == 1
    assert training.get(attempt["id"])["state"] == "cleanup"

    for _ in range(2):
        worker.run_once()
    assert provider.create_calls == 1
    assert GpuLeases(resources.pool).current() is not None


def test_cost_guard_failure_blocks_training_and_reclaims(managed_env):
    resources, _, provider, channel, _ = managed_env
    provider.scheduler_error = AppError(503, "cloud_api_error", "fixture scheduler down")
    attempt, training, worker, _, _ = begin_managed(managed_env)

    blocked = training.get(attempt["id"])
    assert blocked["error_code"] == "cost_guard_unavailable"
    assert channel.starts == 0
    for _ in range(5):
        worker.run_once()
    assert training.get(attempt["id"])["state"] == "failed"
    assert provider.writes[-2:] == ["stop", "terminate"]
    assert GpuLeases(resources.pool).current() is None


def test_bootstrap_failure_blocks_training_and_reclaims(managed_env):
    resources, _, provider, channel, _ = managed_env
    training = Training(resources)
    attempt = training.create(managed_env[1])
    worker, first_boot, _ = managed_worker(managed_env)
    first_boot.failure = AppError(
        503,
        "bootstrap_transport_failed",
        "fixture bootstrap failed",
    )
    worker.run_once()
    current = training.get(attempt["id"])
    assert current["state"] == "cleanup"
    assert current["error_code"] == "bootstrap_transport_failed"
    assert channel.starts == 0
    for _ in range(5):
        worker.run_once()
    assert training.get(attempt["id"])["state"] == "failed"
    assert provider.writes[-2:] == ["stop", "terminate"]
    assert GpuLeases(resources.pool).current() is None


def test_runtime_mismatch_blocks_training(managed_env):
    resources, _, provider, channel, _ = managed_env
    # A fresh fixture has no provisioned attempt; failure happens on first tick.
    training = Training(resources)
    attempt = training.create(managed_env[1])
    worker, _, _ = managed_worker(managed_env)
    channel.runtime_ready = False
    worker.run_once()
    current = training.get(attempt["id"])
    assert current["error_code"] == "gpu_runtime_incompatible"
    assert channel.starts == 0
    assert provider.writes[0] == "schedule"


def test_nonzero_exit_never_publishes_adapter(managed_env):
    resources, _, _, channel, _ = managed_env
    attempt, training, worker, _, provisioning = begin_managed(managed_env)
    channel.status = {
        "state": "exited",
        "exit_code": 1,
        "group_exited": True,
        "cancelled": False,
    }
    channel.files["process.log"] = b"training failed"
    for _ in range(6):
        worker.run_once()
    final = training.get(attempt["id"])
    assert final["state"] == "failed"
    assert final["error_code"] == "training_failed"
    assert provisioning.row(attempt["id"])["artifact_state"] == "failed"
    assert Adapters(resources).list() == []


def test_artifact_store_failure_retains_instance_and_lease(managed_env, monkeypatch):
    resources, _, provider, channel, _ = managed_env
    attempt, training, worker, _, _ = begin_managed(managed_env)
    channel.success()

    def unavailable(*args, **kwargs):
        raise AppError(503, "fixture_store_down", "fixture store down")

    monkeypatch.setattr(resources.store, "put_object", unavailable)
    worker.run_once()
    current = training.get(attempt["id"])
    assert current["state"] == "syncing"
    assert current["error_code"] == "fixture_store_down"
    assert provider.writes[-1:] == ["schedule"]
    assert GpuLeases(resources.pool).current() is not None


def test_cleanup_ack_failure_keeps_instance_and_lease(managed_env):
    resources, _, provider, channel, _ = managed_env
    attempt, training, worker, _, _ = begin_managed(managed_env)
    channel.success()
    # Exit observation and artifact persistence.
    worker.run_once()
    assert training.get(attempt["id"])["state"] == "cleanup"
    # First cleanup tick stops the instance but must not release its lease.
    worker.run_once()
    assert "stop" in provider.writes
    assert GpuLeases(resources.pool).current() is not None
    provider.terminate_error = AppError(
        502,
        "cloud_invalid_response",
        "fixture terminate acknowledgement missing",
    )
    worker.run_once()
    lease = GpuLeases(resources.pool).current()
    assert lease is not None
    assert lease["cleanup_state"] == "failed"
    assert training.get(attempt["id"])["state"] == "cleanup"
