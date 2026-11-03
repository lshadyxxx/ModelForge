"""Compute environment contracts with a synthetic provider and disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import os
import threading
from types import SimpleNamespace
from urllib.parse import parse_qs
import uuid

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from modelforge.errors import AppError, configure_errors
from modelforge.infrastructure.postgres import create_pool
from modelforge.infrastructure.ucloud import UCloudInstances
from modelforge.modules.resources import GpuLeases, InstanceLifecycle, InstanceSpec
from modelforge.modules.resources.compute_environments import (
    ComputeEnvironments,
    CreateEnvironmentRequest,
    DeleteEnvironmentRequest,
)
from modelforge.modules.resources.routes import compute_router
from modelforge.settings import Settings


RESET_SQL = """TRUNCATE
    compute_environment_events,
    compute_environment_requests,
    compute_environments,
    training_log_chunks,
    inference_trials,
    adapter_versions,
    training_attempts,
    training_tasks,
    ucloud_instance_intents,
    gpu_lease_events,
    gpu_slots,
    gpu_reservations
  RESTART IDENTITY CASCADE"""


SPEC = {
    "region": "fixture-region",
    "zone": "fixture-zone",
    "gpu_type": "fixture-gpu",
    "cpu": 8,
    "memory_mb": 32768,
    "image_id": "fixture-image",
    "cpu_platform": "Auto",
    "charge_type": "Postpay",
    "boot_disk_gb": 100,
    "boot_disk_type": "CLOUD_SSD",
}


def test_compute_environment_openapi_is_visible():
    app = FastAPI()
    configure_errors(app)
    app.include_router(compute_router)
    paths = app.openapi()["paths"]
    base = "/api/v1/resources/compute/environments"
    assert set(paths[base]) == {"get", "post"}
    assert set(paths[base + "/{environment_id}"]) == {"get", "delete"}
    assert "post" in paths[base + "/{environment_id}/start"]
    assert "post" in paths[base + "/{environment_id}/stop"]
    assert "post" in paths[base + "/{environment_id}/reconcile"]
    create_parameters = paths[base]["post"].get("parameters", [])
    assert any(
        item.get("name") == "Idempotency-Key" and item.get("in") == "header"
        for item in create_parameters
    )


def test_missing_idempotency_header_uses_domain_error():
    class RejectingService:
        def create(self, body, idempotency_key):
            assert idempotency_key is None
            raise AppError(
                422,
                "compute_idempotency_required",
                "Idempotency-Key is required for every write command",
            )

    app = FastAPI()
    configure_errors(app)
    app.include_router(compute_router)
    app.state.resources = SimpleNamespace(
        settings=SimpleNamespace(ucloud_write_enabled=True)
    )
    app.state.compute_environments_service = RejectingService()
    response = TestClient(app).post(
        "/api/v1/resources/compute/environments",
        json={
            "name": "alpha",
            "resource_owner": "fixture-owner",
            "spec": SPEC,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "compute_idempotency_required"


def test_compute_write_gate_blocks_every_mutation_when_disabled():
    class MustNotRun:
        def create(self, body, idempotency_key):
            raise AssertionError("write service must not run while the gate is closed")

    app = FastAPI()
    configure_errors(app)
    app.include_router(compute_router)
    app.state.resources = SimpleNamespace(
        settings=SimpleNamespace(ucloud_write_enabled=False)
    )
    app.state.compute_environments_service = MustNotRun()
    client = TestClient(app)

    response = client.post(
        "/api/v1/resources/compute/environments",
        headers={"Idempotency-Key": "gate-create-001"},
        json={
            "name": "alpha",
            "resource_owner": "fixture-owner",
            "spec": SPEC,
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "compute_write_disabled"


if os.getenv("MF_TEST_COMPUTE_INTEGRATION") == "1":
    if (
        os.getenv("MF_TEST_ISOLATED_STORES") != "1"
        or not os.getenv("MF_PG_DATABASE", "").startswith("modelforge_test_")
    ):
        raise pytest.UsageError(
            "Compute environment tests require an explicitly disposable database"
        )

requires_database = pytest.mark.skipif(
    os.getenv("MF_TEST_COMPUTE_INTEGRATION") != "1",
    reason="Requires disposable PostgreSQL",
)


def instance(label, instance_id="fixture-instance", **overrides):
    row = {
        "UHostId": instance_id,
        "Name": label,
        "State": "Running",
        "Region": SPEC["region"],
        "Zone": SPEC["zone"],
        "CPU": SPEC["cpu"],
        "Memory": SPEC["memory_mb"],
        "GPU": 1,
        "GpuType": SPEC["gpu_type"],
        "CompShareImageId": SPEC["image_id"],
        "CreateTime": int(datetime.now(timezone.utc).timestamp()),
    }
    return {**row, **overrides}


@pytest.fixture
def compute_environment():
    settings = Settings(
        ucloud_public_key="public-test-only",
        ucloud_private_key="private-test-only",
        ucloud_region=SPEC["region"],
    )
    pool = create_pool(settings)
    pool.open(wait=True)
    with pool.connection() as connection:
        connection.execute("SET LOCAL statement_timeout = 0")
        connection.execute(RESET_SQL)
        connection.execute("INSERT INTO gpu_slots(id) VALUES (1)")

    state = {
        "calls": [],
        "instances": {},
        "labels": {},
        "create_timeout": False,
        "price_unavailable": False,
        "terminate_timeout": False,
        "terminate_invalid": False,
        "start_gate": None,
        "next_instance": 0,
    }

    def handler(request):
        wire = {
            key: values[0]
            for key, values in parse_qs(request.content.decode()).items()
        }
        action = wire["Action"]
        state["calls"].append((action, wire))

        if action == "CheckCompShareResourceCapacity":
            data = {
                "Specs": [
                    {
                        "Gpu": 1,
                        "Cpu": SPEC["cpu"],
                        "Mem": SPEC["memory_mb"] // 1024,
                        "ResourceEnough": True,
                    }
                ]
            }
        elif action == "GetCompShareInstanceUserPrice":
            data = (
                {"PriceDetails": []}
                if state["price_unavailable"]
                else {
                    "PriceDetails": [
                        {
                            "ChargeType": "Postpay",
                            "Instance": 1.25,
                            "SystemDisks": 0.25,
                        }
                    ],
                    "OriginalPriceDetails": [
                        {
                            "ChargeType": "Postpay",
                            "Instance": 1.5,
                            "SystemDisks": 0.25,
                        }
                    ],
                }
            )
        elif action == "CreateCompShareInstance":
            state["next_instance"] += 1
            instance_id = "fixture-instance-" + str(state["next_instance"])
            label = wire["Name"]
            state["labels"][label] = instance_id
            state["instances"][instance_id] = instance(label, instance_id)
            if state["create_timeout"]:
                raise httpx.ReadTimeout("synthetic timeout", request=request)
            data = {"UHostIds": [instance_id]}
        elif action == "DescribeCompShareInstance":
            rows = list(state["instances"].values())
            requested = wire.get("UHostIds.0")
            if requested:
                rows = [
                    row for row in rows if row["UHostId"] == requested
                ]
            offset = int(wire.get("Offset", "0"))
            limit = int(wire.get("Limit", "100"))
            data = {
                "TotalCount": len(rows),
                "UHostSet": rows[offset : offset + limit],
            }
        elif action == "GetCompShareInstanceMonitor":
            data = {
                "Data": {
                    "List": [
                        {
                            "UHostId": wire.get("UHostIds.0"),
                            "Metrics": [],
                        }
                    ]
                }
            }
        elif action == "StartCompShareInstance":
            if state["start_gate"] is not None:
                entered, release = state["start_gate"]
                entered.set()
                assert release.wait(timeout=5)
            row = state["instances"].get(wire["UHostId"])
            if row is None:
                data = {"UHostId": "missing"}
            else:
                row["State"] = "Running"
                data = {"UHostId": wire["UHostId"]}
        elif action == "StopCompShareInstance":
            row = state["instances"].get(wire["UHostId"])
            if row is None:
                data = {"UHostId": "missing"}
            else:
                row["State"] = "Stopped"
                data = {"UHostId": wire["UHostId"]}
        elif action == "TerminateCompShareInstance":
            if state["terminate_timeout"]:
                raise httpx.ReadTimeout("synthetic timeout", request=request)
            if state["terminate_invalid"]:
                data = {"UHostId": "other-instance", "InRecycle": "No"}
            else:
                state["instances"].pop(wire["UHostId"], None)
                data = {"UHostId": wire["UHostId"], "InRecycle": "No"}
        else:
            raise AssertionError("Unexpected synthetic provider action: " + action)
        return httpx.Response(
            200,
            json={
                "Action": action + "Response",
                "RetCode": 0,
                **data,
            },
        )

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        trust_env=False,
    )
    provider = UCloudInstances(settings, client)
    resources = SimpleNamespace(
        pool=pool,
        settings=settings,
        source_http=None,
    )
    lifecycle = InstanceLifecycle(GpuLeases(pool), provider)
    service = ComputeEnvironments(resources, lifecycle)
    try:
        yield SimpleNamespace(
            service=service,
            lifecycle=lifecycle,
            provider=provider,
            resources=resources,
            pool=pool,
            state=state,
        )
    finally:
        client.close()
        with pool.connection() as connection:
            connection.execute("SET LOCAL statement_timeout = 0")
            connection.execute(RESET_SQL)
            connection.execute("INSERT INTO gpu_slots(id) VALUES (1)")
        pool.close()


def create_body(name="alpha"):
    return CreateEnvironmentRequest(
        name=name,
        resource_owner="fixture-owner",
        spec=InstanceSpec(**SPEC),
    )


def delete_body(name="alpha", **overrides):
    return DeleteEnvironmentRequest(
        confirm_name=name,
        acknowledge_data_loss=True,
        cleanup_policy="discard",
        **overrides,
    )


def mutation_count(state):
    return sum(
        action
        in {
            "CreateCompShareInstance",
            "StartCompShareInstance",
            "StopCompShareInstance",
            "TerminateCompShareInstance",
        }
        for action, _ in state["calls"]
    )


@requires_database
def test_migration_installs_environment_owner_and_start_fact(
    compute_environment,
):
    fixture = compute_environment
    with fixture.pool.connection() as connection:
        owner_constraint = connection.execute(
            """SELECT pg_get_constraintdef(oid) AS definition
               FROM pg_constraint
               WHERE conrelid='gpu_reservations'::regclass
                 AND conname='gpu_reservations_owner_kind_check'"""
        ).fetchone()["definition"]
        start_requested = connection.execute(
            """SELECT is_nullable,column_default
               FROM information_schema.columns
               WHERE table_name='ucloud_instance_intents'
                 AND column_name='start_requested'"""
        ).fetchone()
        cleanup_policy = connection.execute(
            """SELECT is_nullable
               FROM information_schema.columns
               WHERE table_name='compute_environments'
                 AND column_name='cleanup_policy'"""
        ).fetchone()
        partial_index = connection.execute(
            """SELECT indexdef
               FROM pg_indexes
               WHERE tablename='compute_environments'
                 AND indexname='compute_environments_active_name_idx'"""
        ).fetchone()["indexdef"]
    assert "'environment'" in owner_constraint
    assert start_requested["is_nullable"] == "NO"
    assert start_requested["column_default"] == "false"
    assert cleanup_policy["is_nullable"] == "YES"
    assert "WHERE (deleted_at IS NULL)" in partial_index


@requires_database
def test_create_idempotency_replays_without_a_second_provider_mutation(
    compute_environment,
):
    fixture = compute_environment
    service = fixture.service
    body = create_body()
    first = service.create(body, "create-alpha-001")
    assert first.environment.state == "running"
    assert first.environment.managed is True
    assert first.environment.pricing.state == "available"
    assert first.environment.pricing.hourly == 1.5
    assert first.environment.pricing.currency == "CNY"
    assert first.environment.freshness.state == "fresh"
    assert first.environment.capabilities.stop is True
    assert first.command.state == "succeeded"
    calls_after_first = mutation_count(fixture.state)

    replay = service.create(body, "create-alpha-001")
    assert replay.environment.id == first.environment.id
    assert replay.command.id == first.command.id
    assert mutation_count(fixture.state) == calls_after_first

    with pytest.raises(AppError) as caught:
        service.create(create_body("different-name"), "create-alpha-001")
    assert caught.value.code == "compute_idempotency_conflict"


@requires_database
def test_create_stops_before_cloud_mutation_when_official_price_is_missing(
    compute_environment,
):
    fixture = compute_environment
    fixture.state["price_unavailable"] = True
    with pytest.raises(AppError) as caught:
        fixture.service.create(create_body("no-price"), "create-no-price")
    assert caught.value.code == "cloud_price_unavailable"
    assert not any(
        action == "CreateCompShareInstance"
        for action, _ in fixture.state["calls"]
    )
    with fixture.pool.connection() as connection:
        row = connection.execute(
            "SELECT state,last_error_code FROM compute_environments WHERE name=%s",
            ("no-price",),
        ).fetchone()
    assert row["state"] == "failed"
    assert row["last_error_code"] == "cloud_price_unavailable"


@requires_database
def test_stop_and_start_are_observed_and_idempotent(compute_environment):
    fixture = compute_environment
    service = fixture.service
    created = service.create(create_body(), "create-start-stop")
    environment_id = created.environment.id

    stopped = service.stop(environment_id, "stop-alpha-001")
    assert stopped.environment.state == "stopped"
    assert stopped.environment.capabilities.start is True
    assert stopped.command.state == "succeeded"
    stop_calls = sum(
        action == "StopCompShareInstance"
        for action, _ in fixture.state["calls"]
    )
    service.stop(environment_id, "stop-alpha-001")
    assert (
        sum(
            action == "StopCompShareInstance"
            for action, _ in fixture.state["calls"]
        )
        == stop_calls
    )

    started = service.start(environment_id, "start-alpha-001")
    assert started.environment.state == "running"
    assert started.environment.capabilities.stop is True
    assert started.command.state == "succeeded"
    assert fixture.state["calls"][-1][0] in {
        "StartCompShareInstance",
        "DescribeCompShareInstance",
        "GetCompShareInstanceMonitor",
        "GetCompShareInstanceUserPrice",
    }

    detail = service.get(environment_id)
    sources = {event.source for event in detail.events}
    assert {"platform", "provider", "lease"} <= sources


@requires_database
def test_concurrent_commands_for_one_environment_do_not_dispatch_twice(
    compute_environment,
):
    fixture = compute_environment
    service = fixture.service
    created = service.create(create_body("concurrent"), "create-concurrent")
    service.stop(created.environment.id, "stop-concurrent")
    entered = threading.Event()
    release = threading.Event()
    fixture.state["start_gate"] = (entered, release)
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                service.start,
                created.environment.id,
                "start-concurrent-001",
            )
            assert entered.wait(timeout=5)
            with pytest.raises(AppError) as caught:
                service.start(
                    created.environment.id,
                    "start-concurrent-002",
                )
            assert caught.value.code == "compute_request_in_progress"
            release.set()
            started = future.result(timeout=10)
    finally:
        release.set()
        fixture.state["start_gate"] = None
    assert started.environment.state == "running"
    assert (
        sum(
            action == "StartCompShareInstance"
            for action, _ in fixture.state["calls"]
        )
        == 1
    )


@requires_database
def test_lost_create_ack_stays_accepted_and_reconciles(compute_environment):
    fixture = compute_environment
    fixture.state["create_timeout"] = True
    first = fixture.service.create(create_body(), "create-timeout-001")
    assert first.command.state == "accepted"
    assert first.command.error_code == "cloud_timeout"
    assert first.environment.state == "unknown"
    assert (
        sum(
            action == "CreateCompShareInstance"
            for action, _ in fixture.state["calls"]
        )
        == 1
    )

    fixture.state["create_timeout"] = False
    reconciled = fixture.service.reconcile(
        first.environment.id, "reconcile-timeout-001"
    )
    assert reconciled.environment.state == "running"
    assert reconciled.command.state == "succeeded"
    assert (
        sum(
            action == "CreateCompShareInstance"
            for action, _ in fixture.state["calls"]
        )
        == 1
    )


@requires_database
def test_delete_requires_confirmation_blocks_active_work_and_cleans_up(
    compute_environment,
):
    fixture = compute_environment
    service = fixture.service
    created = service.create(create_body(), "create-delete-001")
    environment_id = created.environment.id
    provider_instance_id = created.environment.provider_instance_id

    with pytest.raises(AppError) as caught:
        service.delete(
            environment_id,
            delete_body("wrong"),
            "delete-wrong-name",
        )
    assert caught.value.code == "compute_environment_delete_confirmation_required"

    task_id = uuid.uuid4()
    attempt_id = uuid.uuid4()
    with fixture.pool.connection() as connection:
        connection.execute(
            """INSERT INTO training_tasks(
                   id,name,snapshot,snapshot_sha256)
               VALUES (%s,%s,'{}'::jsonb,%s)""",
            (task_id, "Synthetic task", "0" * 64),
        )
        connection.execute(
            """INSERT INTO training_attempts(
                   id,task_id,number,state,instance_id)
               VALUES (%s,%s,1,'running',%s)""",
            (attempt_id, task_id, provider_instance_id),
        )

    with pytest.raises(AppError) as caught:
        service.delete(
            environment_id,
            delete_body(),
            "delete-active-task",
        )
    assert caught.value.code == "compute_environment_active_task"

    with fixture.pool.connection() as connection:
        connection.execute(
            "UPDATE training_attempts SET state='succeeded' WHERE id=%s",
            (attempt_id,),
        )
    requested = service.delete(
        environment_id,
        delete_body(),
        "delete-active-task",
    )
    assert requested.command.state == "accepted"
    assert requested.environment.state == "deleting"

    reconciled = service.reconcile(
        environment_id, "reconcile-delete-001"
    )
    assert reconciled.environment.state == "deleted"
    assert reconciled.environment.capabilities.delete is False
    assert reconciled.command.state == "succeeded"
    assert fixture.state["instances"] == {}

    with fixture.pool.connection() as connection:
        command_states = connection.execute(
            """SELECT state
               FROM compute_environment_requests
               WHERE environment_id=%s AND action='delete'
               ORDER BY created_at""",
            (environment_id,),
        ).fetchall()
    assert command_states
    assert all(row["state"] == "succeeded" for row in command_states)


@requires_database
def test_uncertain_termination_is_retried_without_losing_identity(
    compute_environment,
):
    fixture = compute_environment
    service = fixture.service
    created = service.create(create_body("retry-delete"), "create-retry-delete")
    environment_id = created.environment.id
    provider_instance_id = created.environment.provider_instance_id

    service.stop(environment_id, "stop-retry-delete")
    fixture.state["terminate_invalid"] = True
    failed = service.delete(
        environment_id,
        delete_body("retry-delete"),
        "delete-retry-001",
    )
    assert failed.command.state == "accepted"
    assert failed.environment.state == "cleanup_failed"
    assert provider_instance_id in fixture.state["instances"]

    fixture.state["terminate_invalid"] = False
    reconciled = service.reconcile(
        environment_id, "reconcile-retry-delete"
    )
    assert reconciled.environment.state == "deleted"
    assert reconciled.command.state == "succeeded"
    assert provider_instance_id not in fixture.state["instances"]


@requires_database
def test_absent_managed_instance_is_unavailable_not_optimistically_running(
    compute_environment,
):
    fixture = compute_environment
    created = fixture.service.create(
        create_body("missing-instance"), "create-missing"
    )
    fixture.state["instances"].pop(
        created.environment.provider_instance_id
    )
    detail = fixture.service.get(created.environment.id)
    assert detail.state == "unavailable"
    assert detail.last_error_code == "cloud_instance_not_found"
    assert detail.freshness.state == "fresh"
    assert detail.capabilities.stop is False


@requires_database
def test_list_keeps_unmanaged_provider_instances_read_only(
    compute_environment,
):
    fixture = compute_environment
    fixture.service.create(create_body("managed-alpha"), "create-list-001")
    fixture.state["instances"]["external-instance"] = instance(
        "external-alpha", "external-instance"
    )

    result = fixture.service.list(region=SPEC["region"])
    external = next(
        item
        for item in result.items
        if item.provider_instance_id == "external-instance"
    )
    assert external.managed is False
    assert external.management == "unmanaged"
    assert external.capabilities.start is False
    assert external.capabilities.stop is False
    assert external.capabilities.delete is False
    assert external.spec.charge_type is None
    assert external.spec.boot_disk_gb is None
    assert external.pricing.state == "not_integrated"
    assert external.freshness.state == "fresh"
    assert result.summary["unmanaged"] == 1
    assert result.source["pricing"] == "official_quote"
