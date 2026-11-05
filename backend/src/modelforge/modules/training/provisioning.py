"""Managed training resource facts and the small provider-facing state machine."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

from modelforge.errors import AppError
from modelforge.infrastructure.first_boot import FirstBoot, temporary_password, password_sha256
from modelforge.modules.resources import Catalog, GpuLeases, InstanceSpec
from modelforge.runtimes.runtime_lock import training_runtime_lock


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _sha(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


class TrainingProvisioning:
    """The managed path is deliberately separate from manual binding."""

    def __init__(self, resources, lifecycle, first_boot: FirstBoot | None = None):
        self.resources = resources
        self.pool = resources.pool
        self.lifecycle = lifecycle
        self.provider = getattr(lifecycle, "provider", None)
        self.first_boot = first_boot or FirstBoot(resources.settings, lifecycle)
        self.leases = GpuLeases(self.pool)
        self.catalog = Catalog(resources, self.provider) if self.provider is not None else Catalog(resources)

    def row(self, attempt_id) -> dict | None:
        with self.pool.connection() as c:
            return c.execute(
                "SELECT * FROM training_provisioning WHERE attempt_id=%s",
                (attempt_id,),
            ).fetchone()

    def _update(self, attempt_id, **fields):
        allowed = {
            "project_id", "request_disposition", "provider_state", "provider_observed_at",
            "cost_guard_state", "cost_guard_deadline", "cost_guard_set_at",
            "credential_state", "temporary_password_sha256", "bootstrap_profile",
            "host_key_fingerprint", "endpoint_epoch", "runtime_state",
            "artifact_state", "artifact_verified_at", "last_error_code",
        }
        if not fields or not fields.keys() <= allowed:
            raise ValueError("Invalid provisioning fact")
        names = ",".join(name + "=%s" for name in fields)
        with self.pool.connection() as c:
            c.execute(
                "UPDATE training_provisioning SET " + names + ",updated_at=clock_timestamp() WHERE attempt_id=%s",
                (*fields.values(), attempt_id),
            )
        return self.row(attempt_id)

    def _set_attempt_instance(self, attempt_id, instance_id):
        with self.pool.connection() as c:
            c.execute(
                "UPDATE training_attempts SET instance_id=%s,updated_at=now() WHERE id=%s",
                (instance_id, attempt_id),
            )

    def _snapshot(self, attempt_id):
        with self.pool.connection() as c:
            row = c.execute(
                """SELECT a.*,t.snapshot FROM training_attempts a
                   JOIN training_tasks t ON t.id=a.task_id WHERE a.id=%s""",
                (attempt_id,),
            ).fetchone()
        if not row:
            raise AppError(404, "not_found", "Training Attempt not found")
        return row

    def ensure_intent(self, attempt_id, token):
        row = self._snapshot(attempt_id)
        if row["execution_mode"] != "managed":
            raise AppError(409, "attempt_execution_mode_locked", "This Attempt is not managed")
        snapshot = row["snapshot"]
        profile = snapshot.get("training_image_profile")
        if not isinstance(profile, dict) or not profile.get("image_id"):
            raise AppError(409, "training_image_profile_unsupported", "Managed Attempt has no approved image profile")
        fingerprint = _sha({
            "attempt_id": str(attempt_id),
            "reservation_id": str(token.reservation_id),
            "spec": snapshot["instance"],
            "profile_id": profile.get("id"),
            "image_id": profile.get("image_id"),
        })
        with self.pool.connection() as c:
            c.execute(
                """INSERT INTO training_provisioning(
                    attempt_id,reservation_id,provider_profile,training_image_profile_id,
                    training_image_profile_sha256,image_id,image_group_id,request_fingerprint)
                   VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT(attempt_id) DO NOTHING""",
                (
                    attempt_id, token.reservation_id, profile["provider_profile"],
                    profile["id"], profile["profiles_sha256"], profile["image_id"],
                    profile.get("image_group_id"), fingerprint,
                ),
            )
        return self.row(attempt_id)

    def _check_image(self, region: str, zone: str, profile: dict):
        if self.provider is None:
            return
        if profile.get("image_type") == "Custom":
            action = "DescribeCompShareCustomImages"
            parameters = {
                "Region": region,
                "CompShareImageId": profile["image_id"],
                "Offset": 0,
                "Limit": 20,
            }
        else:
            action = "DescribeCompShareImages"
            parameters = {
                "Region": region,
                "Zone": zone,
                "CompShareImageId": profile["image_id"],
            }
        try:
            response = self.provider.query(action, parameters)
        except AppError:
            raise
        rows = response.get("ImageSet")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise AppError(502, "cloud_invalid_response", "训练镜像状态无法核对")
        matching = [row for row in rows if row.get("CompShareImageId") == profile["image_id"]]
        if not matching or not any(
            str(row.get("Status") or "").lower() == "available"
            for row in matching
        ):
            raise AppError(409, "training_image_unavailable", "训练镜像不存在或当前不可用")

    def _price_guard(self, spec: InstanceSpec):
        quote = self.catalog.price_for_spec(spec)
        hourly = quote.get("hourly")
        if type(hourly) not in (int, float) or hourly < 0:
            raise AppError(409, "quote_unavailable", "无法取得可核对的单卡训练报价")
        settings = self.resources.settings
        if hourly > settings.ucloud_training_max_hourly_cny:
            raise AppError(409, "budget_exceeded", "单卡训练报价超过已授权的小时上限")
        estimate = hourly * settings.ucloud_training_window_minutes / 60
        if estimate > settings.ucloud_training_budget_cny:
            raise AppError(409, "budget_exceeded", "本次训练窗口估算超过预算上限")
        return {"hourly_cny": hourly, "window_estimate_cny": round(estimate, 6)}

    def _project_id(self) -> str:
        if self.provider is None:
            raise AppError(503, "project_id_unavailable", "云供应商读取器不可用")
        response = self.provider.query("GetProjectList", {})
        rows = response.get("ProjectSet")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise AppError(502, "project_id_unavailable", "无法核对优云项目身份")
        configured = self.resources.settings.ucloud_project_id
        candidates = [
            row.get("ProjectId") for row in rows
            if isinstance(row.get("ProjectId"), str) and row.get("ProjectId")
            and (configured is None or row.get("ProjectId") == configured)
        ]
        if configured:
            if not candidates:
                raise AppError(409, "project_id_unavailable", "配置的 ProjectId 不在当前账号项目中")
            return configured
        defaults = [
            row["ProjectId"] for row in rows
            if row.get("ProjectId") and row.get("IsDefault") is True
        ]
        if len(defaults) == 1:
            return defaults[0]
        if len(candidates) == 1:
            return candidates[0]
        raise AppError(409, "project_id_unavailable", "账号没有唯一可确认的默认项目")

    def _provider_state(self, result):
        observation = result.get("observation") if isinstance(result, dict) else None
        if not observation:
            return "unknown"
        state = observation.get("State")
        return {
            "Running": "running",
            "Stopped": "stopped",
            "Stopping": "stopping",
            "Starting": "pending",
            "Pending": "pending",
            "Deleted": "deleted",
        }.get(state, "pending")

    def _apply_lease_state(self, attempt_id, result):
        lease = result["lease"]
        instance_id = lease.get("provider_instance_id")
        observation = result.get("observation")
        provider_state = self._provider_state(result) if observation else lease.get("instance_state", "unknown")
        fields = {
            "provider_state": provider_state,
            "provider_observed_at": datetime.now(timezone.utc).isoformat(),
        }
        if instance_id:
            fields["request_disposition"] = "confirmed"
            self._set_attempt_instance(attempt_id, instance_id)
        if observation:
            fields["provider_state"] = self._provider_state(result)
        self._update(attempt_id, **fields)
        return instance_id

    def ensure_instance(self, attempt_id, token):
        row = self._snapshot(attempt_id)
        snapshot = row["snapshot"]
        spec = InstanceSpec(**snapshot["instance"])
        profile = snapshot.get("training_image_profile")
        if not isinstance(profile, dict):
            raise AppError(409, "training_image_profile_unsupported", "Managed Attempt has no image profile")
        facts = self.ensure_intent(attempt_id, token)
        if facts["request_disposition"] == "rejected":
            raise AppError(409, "provisioning_rejected", "创建请求已被拒绝，未重发")
        if facts["request_disposition"] == "conflict":
            raise AppError(409, "cloud_instance_conflict", "创建候选不唯一，需要人工核对")
        lease = self.leases.get(token.reservation_id)
        if lease["create_state"] == "not_requested" and facts["request_disposition"] == "not_requested":
            self._check_image(spec.region, spec.zone, profile)
            quote = self._price_guard(spec)
            project_id = self._project_id()
            password = temporary_password()
            self._update(
                attempt_id,
                credential_state="temp_password",
                temporary_password_sha256=password_sha256(password),
                cost_guard_state="pending",
                project_id=project_id,
                last_error_code=None,
            )
            try:
                result = self.lifecycle.create(
                    token, spec, login_password=password, project_id=project_id,
                )
            except AppError as error:
                if error.code in {"cloud_timeout", "cloud_unavailable", "cloud_api_error", "cloud_invalid_response"}:
                    self._update(attempt_id, request_disposition="unknown", last_error_code=error.code)
                    return {"state": "unknown", "safe_error_code": error.code, "quote": quote}
                if error.code in {"cloud_out_of_stock", "cloud_incompatible", "cloud_selection_unavailable"}:
                    self._update(attempt_id, request_disposition="rejected", last_error_code=error.code)
                raise
            self._update(
                attempt_id,
                request_disposition="requested",
                last_error_code=None,
            )
            return self._apply_lease_state(attempt_id, result)
        if facts["request_disposition"] == "not_requested" and lease["create_state"] == "requested":
            self._update(attempt_id, request_disposition="unknown")
        try:
            result = self.lifecycle.reconcile(token)
        except AppError as error:
            if error.code in {"cloud_instance_conflict"}:
                self._update(attempt_id, request_disposition="conflict", last_error_code=error.code)
            raise
        instance_id = self._apply_lease_state(attempt_id, result)
        if instance_id:
            observed = self.lifecycle.observe(token)
            if observed.get("absent"):
                self._update(attempt_id, request_disposition="unknown", provider_state="not_found")
                return {"state": "unknown", "instance_id": instance_id}
            self._apply_lease_state(attempt_id, observed)
        return {"state": "confirmed" if instance_id else "requested", "instance_id": instance_id}

    def guard_cost(self, attempt_id, token):
        facts = self.row(attempt_id)
        if not facts:
            raise AppError(409, "provisioning_missing", "Managed provisioning facts are missing")
        if facts["cost_guard_state"] == "set":
            return {"state": "set", "deadline": facts["cost_guard_deadline"]}
        lease = self.leases.get(token.reservation_id)
        if lease["provider_instance_id"] is None:
            raise AppError(409, "cloud_instance_not_bound", "Reserve an instance before setting the cost guard")
        project_id = self._project_id()
        snapshot = self._snapshot(attempt_id)["snapshot"]
        spec = InstanceSpec(**snapshot["instance"])
        settings = self.resources.settings
        target = datetime.now(timezone.utc) + timedelta(minutes=settings.ucloud_training_window_minutes)
        minimum = datetime.now(timezone.utc) + timedelta(seconds=300)
        target = max(target, minimum)
        try:
            self.provider.update_stop_scheduler({
                "Region": spec.region,
                "Zone": spec.zone,
                "ProjectId": project_id,
                "UHostId": lease["provider_instance_id"],
                "SchedulerStopTime": int(target.timestamp()),
            })
        except AppError as error:
            self._update(attempt_id, cost_guard_state="failed", project_id=project_id,
                         last_error_code="cost_guard_unavailable")
            raise AppError(503, "cost_guard_unavailable", "费用保护未就绪，已阻止训练。") from error
        self._update(
            attempt_id,
            project_id=project_id,
            cost_guard_state="set",
            cost_guard_deadline=target.isoformat(),
            cost_guard_set_at=datetime.now(timezone.utc).isoformat(),
            last_error_code=None,
        )
        return {"state": "set", "deadline": target.isoformat(), "project_id": project_id}

    def clear_cost_guard(self, attempt_id, token):
        facts = self.row(attempt_id)
        if not facts or facts["cost_guard_state"] != "set" or self.provider is None:
            return {"state": "not_set"}
        lease = self.leases.get(token.reservation_id)
        if lease["provider_instance_id"] is None:
            return {"state": "not_set"}
        snapshot = self._snapshot(attempt_id)["snapshot"]
        spec = InstanceSpec(**snapshot["instance"])
        try:
            self.provider.delete_stop_scheduler({
                "Region": spec.region,
                "Zone": spec.zone,
                "ProjectId": facts["project_id"],
                "UHostId": lease["provider_instance_id"],
            })
        except AppError:
            return {"state": "failed"}
        self._update(attempt_id, cost_guard_state="cleared", cost_guard_set_at=None)
        return {"state": "cleared"}

    def bootstrap(self, attempt_id, token):
        facts = self.row(attempt_id)
        if not facts:
            raise AppError(409, "provisioning_missing", "Managed provisioning facts are missing")
        result = self.first_boot.bootstrap(
            token,
            attempt_id=str(attempt_id),
            temporary_sha256=facts.get("temporary_password_sha256"),
        )
        if result.get("state") == "pending":
            return result
        self._update(
            attempt_id,
            credential_state=result["credential_state"],
            bootstrap_profile="ed25519-key-only-v1",
            host_key_fingerprint=result.get("host_key_fingerprint"),
            endpoint_epoch=result.get("endpoint_epoch", 1),
            last_error_code=None,
        )
        return result

    def ensure_runtime(self, attempt_id, token, channel):
        facts = self.row(attempt_id)
        if not facts:
            raise AppError(409, "provisioning_missing", "Managed provisioning facts are missing")
        lease = self.leases.get(token.reservation_id)
        instance_id = lease["provider_instance_id"]
        if not instance_id:
            raise AppError(409, "cloud_instance_not_bound", "Runtime requires a confirmed instance")
        try:
            report = channel.runtime_check(
                instance_id,
                str(attempt_id),
                training_runtime_lock(),
            )
        except AppError as error:
            if error.code != "gpu_runtime_not_ready":
                self._update(attempt_id, runtime_state="preflight_mismatch")
                raise
            profile = facts["provider_profile"]
            self._update(attempt_id, runtime_state="installing")
            try:
                self.first_boot.ensure_runtime(instance_id, profile)
            except AppError:
                self._update(attempt_id, runtime_state="preflight_mismatch", last_error_code="runtime_install_failed")
                raise
            report = channel.runtime_check(
                instance_id,
                str(attempt_id),
                training_runtime_lock(),
            )
        if not report.get("ready"):
            self._update(attempt_id, runtime_state="preflight_mismatch", last_error_code="gpu_runtime_incompatible")
            raise AppError(409, "gpu_runtime_incompatible", "The instance runtime does not match the verified training lock")
        self._update(attempt_id, runtime_state="preflight_ready", last_error_code=None)
        return report

    def mark_artifact(self, attempt_id, state: str, *, verified: bool = False):
        if state not in {"pending", "uploading", "verified", "failed"}:
            raise ValueError("Invalid artifact state")
        self._update(
            attempt_id,
            artifact_state=state,
            artifact_verified_at=(datetime.now(timezone.utc).isoformat() if verified else None),
        )

    def remove_endpoint(self, attempt_id, token):
        """Remove only the generated endpoint and key material after deletion."""
        try:
            lease = self.leases.get(token.reservation_id)
            instance_id = lease.get("provider_instance_id")
            if instance_id:
                self.first_boot.registry.remove(instance_id, delete_material=True)
        except (AppError, OSError):
            # Endpoint cleanup is best effort after the provider deletion is
            # confirmed; the lease and deletion facts remain authoritative.
            return
class RemoteJobs:
    def __init__(self, pool):
        self.pool = pool

    def get(self, attempt_id):
        with self.pool.connection() as c:
            return c.execute(
                "SELECT * FROM training_remote_jobs WHERE attempt_id=%s",
                (attempt_id,),
            ).fetchone()

    def ensure(self, attempt_id, instance_id, argv, inputs):
        argv_hash = _sha(list(argv))
        manifest_hash = _sha(inputs)
        with self.pool.connection() as c:
            c.execute(
                """INSERT INTO training_remote_jobs(
                    attempt_id,instance_id,launch_state,remote_dir,argv_hash,input_manifest_hash)
                   VALUES(%s,%s,'not_started',%s,%s,%s)
                   ON CONFLICT(attempt_id) DO NOTHING""",
                (attempt_id, instance_id, str(attempt_id), argv_hash, manifest_hash),
            )
            existing = c.execute(
                "SELECT * FROM training_remote_jobs WHERE attempt_id=%s",
                (attempt_id,),
            ).fetchone()
            if (
                existing
                and (
                    existing["instance_id"] != instance_id
                    or existing["argv_hash"] != argv_hash
                    or existing["input_manifest_hash"] != manifest_hash
                )
            ):
                raise AppError(
                    409,
                    "remote_job_conflict",
                    "Remote job inputs changed after the launch receipt was frozen",
                )
        return self.get(attempt_id)

    def launch_requested(self, attempt_id):
        with self.pool.connection() as c:
            c.execute(
                """UPDATE training_remote_jobs SET launch_state='launch_requested',
                   observed_at=clock_timestamp()
                   WHERE attempt_id=%s AND launch_state='not_started'""",
                (attempt_id,),
            )
        return self.get(attempt_id)

    def observed(self, attempt_id, status):
        state = status.get("state") if isinstance(status, dict) else "unknown"
        if state == "running":
            fields = {"launch_state": "running"}
        elif state == "exited" and status.get("group_exited") is True and type(status.get("exit_code")) is int:
            fields = {
                "launch_state": "exited",
                "exit_code": status["exit_code"],
                "cancelled": bool(status.get("cancelled")),
                "group_exited": True,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        elif state in {"unknown", "launching"}:
            fields = {"launch_state": "unknown"}
        elif state == "not_started":
            fields = {"launch_state": "not_started"}
        else:
            fields = {"launch_state": "unknown"}
        names = ",".join(name + "=%s" for name in fields)
        with self.pool.connection() as c:
            c.execute(
                "UPDATE training_remote_jobs SET " + names +
                ",observed_at=clock_timestamp() WHERE attempt_id=%s",
                (*fields.values(), attempt_id),
            )
        return self.get(attempt_id)
