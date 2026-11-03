"""Independent compute environments with auditable, idempotent lifecycle commands."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any, Literal
import uuid

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from modelforge.errors import AppError

from .catalog import Catalog
from .instances import InstanceSpec
from .leases import GpuLeases, LeaseToken


EnvironmentState = Literal[
    "creating",
    "starting",
    "running",
    "stopping",
    "stopped",
    "deleting",
    "cleanup_failed",
    "failed",
    "unavailable",
    "unknown",
    "deleted",
]
ALL_STATES = (
    "creating",
    "starting",
    "running",
    "stopping",
    "stopped",
    "deleting",
    "cleanup_failed",
    "failed",
    "unavailable",
    "unknown",
    "deleted",
)
CommandState = Literal["accepted", "succeeded", "failed"]
Management = Literal["environment", "workflow", "unmanaged"]

_UNCHANGED = object()
_ACTIVE_TRAINING_STATES = {
    "queued",
    "waiting_instance",
    "preparing",
    "running",
    "syncing",
    "cleanup",
}
_ACTIVE_INFERENCE_STATES = {
    "queued",
    "waiting_instance",
    "preparing",
    "ready",
    "stopping",
}


class CreateEnvironmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str = Field(min_length=1, max_length=120, pattern=r"\S")
    resource_owner: str = Field(
        default="personal-workspace",
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9_.:-]+$",
    )
    spec: InstanceSpec


class DeleteEnvironmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    confirm_name: str = Field(min_length=1, max_length=120)
    acknowledge_data_loss: bool
    cleanup_policy: Literal["discard", "outputs_persisted"] = "discard"


class PriceBreakdownView(BaseModel):
    instance: float
    system_disks: float
    data_disks: float
    image: float


class PricingView(BaseModel):
    state: Literal["available", "unavailable"]
    code: str
    label: str
    description: str
    source: Literal["ucloud", "unavailable"] = "unavailable"
    currency: Literal["CNY"] | None = None
    amount: float | None = None
    hourly: float | None = None
    unit: Literal["hour", "day", "month"] | None = None
    charge_type: str | None = None
    quantity: int | None = None
    breakdown: PriceBreakdownView | None = None
    original_amount: float | None = None
    discount_type: int | None = None
    observed_at: datetime | None = None
    error_code: str | None = None

    @classmethod
    def unavailable(cls, error_code: str, description: str):
        return cls(
            state="unavailable",
            code="quote_unavailable",
            label="报价不可用",
            description=description,
            error_code=error_code,
        )


class CapabilityView(BaseModel):
    start: bool
    stop: bool
    delete: bool
    reconcile: bool
    monitor: bool
    price: bool = False


class FreshnessView(BaseModel):
    state: Literal["fresh", "stale", "unknown", "unavailable"]
    observed_at: datetime | None = None
    max_age_seconds: int = 300
    error_code: str | None = None


class EventView(BaseModel):
    source: Literal["platform", "provider", "lease"]
    action: str
    detail: dict[str, Any] = Field(default_factory=dict)
    recorded_at: datetime


class AssociationView(BaseModel):
    kind: Literal["training", "inference"]
    id: uuid.UUID
    label: str
    state: str
    active: bool


class EnvironmentSpecView(BaseModel):
    """Selected specification for managed environments; observed facts for others."""

    region: str | None = None
    zone: str | None = None
    gpu_type: str | None = None
    gpu_count: int | None = None
    cpu: int | None = None
    memory_mb: int | None = None
    image_id: str | None = None
    cpu_platform: str | None = None
    charge_type: str | None = None
    boot_disk_gb: int | None = None
    boot_disk_type: str | None = None

    @classmethod
    def from_instance_spec(cls, spec: InstanceSpec) -> "EnvironmentSpecView":
        return cls(gpu_count=1, **spec.model_dump())


class EnvironmentView(BaseModel):
    id: uuid.UUID | None = None
    name: str
    resource_owner: str
    managed: bool
    management: Management
    spec: EnvironmentSpecView
    state: EnvironmentState
    provider_state: str | None = None
    provider_instance_id: str | None = None
    lease_id: uuid.UUID | None = None
    lease: dict[str, Any] | None = None
    associations: list[AssociationView] = Field(default_factory=list)
    events: list[EventView] = Field(default_factory=list)
    monitor: dict[str, Any] | None = None
    freshness: FreshnessView
    capabilities: CapabilityView
    pricing: PricingView = Field(default_factory=PricingView)
    warnings: list[str] = Field(default_factory=list)
    last_error_code: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None


class CommandView(BaseModel):
    id: uuid.UUID
    action: Literal["create", "start", "stop", "delete", "reconcile"]
    state: CommandState
    error_code: str | None = None
    created_at: datetime
    updated_at: datetime


class EnvironmentMutationResponse(BaseModel):
    environment: EnvironmentView
    command: CommandView


class EnvironmentListResponse(BaseModel):
    items: list[EnvironmentView]
    summary: dict[str, int]
    source: dict[str, Any]
    observed_at: datetime
    filters: dict[str, Any]


def _canonical(value) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _digest(value) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _provider_state(value: str | None) -> EnvironmentState:
    normalized = (value or "").strip().lower()
    if normalized in {"running", "started", "active"}:
        return "running"
    if normalized in {"starting", "booting", "pending"}:
        return "starting"
    if normalized in {"stopping", "shutting_down"}:
        return "stopping"
    if normalized in {"stopped", "shutdown"}:
        return "stopped"
    if normalized in {"terminating", "deleting"}:
        return "deleting"
    if normalized in {"failed", "error"}:
        return "failed"
    if normalized in {"unavailable", "not_found", "terminated", "deleted"}:
        return "unavailable"
    return "unknown"


class ComputeEnvironments:
    """Owns compute environment identity; provider effects remain lease-gated."""

    def __init__(self, resources, lifecycle):
        self.resources = resources
        self.lifecycle = lifecycle
        self.pool = resources.pool
        self.leases = GpuLeases(self.pool)

    @staticmethod
    def _identifier(value) -> uuid.UUID:
        try:
            return uuid.UUID(str(value))
        except (ValueError, TypeError, AttributeError):
            raise AppError(
                422, "validation_error", "Environment identity must be a UUID"
            ) from None

    @staticmethod
    def _key(value: str | None) -> str:
        if not value:
            raise AppError(
                422,
                "compute_idempotency_required",
                "Idempotency-Key is required for every write command",
            )
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value):
            raise AppError(
                422,
                "validation_error",
                "Idempotency-Key contains unsupported characters",
            )
        return value

    @staticmethod
    def _model(model, value):
        try:
            if isinstance(value, BaseModel):
                value = value.model_dump()
            return model.model_validate(value)
        except ValidationError as error:
            details = [
                {
                    "path": ".".join(map(str, item["loc"])),
                    "message": item["msg"],
                }
                for item in error.errors(include_url=False)
            ]
            raise AppError(
                422, "validation_error", "Request validation failed", details
            ) from None
        except (TypeError, ValueError):
            raise AppError(
                422, "validation_error", "Request validation failed"
            ) from None

    @staticmethod
    def _claim_request(connection, key, action, payload, environment_id=None):
        digest = _digest(payload)
        row = connection.execute(
            """INSERT INTO compute_environment_requests(
                   id,idempotency_key,action,environment_id,request_sha256)
               VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (idempotency_key) DO NOTHING
               RETURNING *""",
            (uuid.uuid4(), key, action, environment_id, digest),
        ).fetchone()
        if row is not None:
            return row, True
        existing = connection.execute(
            "SELECT * FROM compute_environment_requests WHERE idempotency_key=%s",
            (key,),
        ).fetchone()
        if (
            existing is None
            or existing["action"] != action
            or existing["request_sha256"] != digest
            or (
                environment_id is not None
                and existing["environment_id"] != environment_id
            )
        ):
            raise AppError(
                409,
                "compute_idempotency_conflict",
                "Idempotency-Key was already used for another command",
            )
        return existing, False

    @staticmethod
    def _finish_command(connection, command_id, state, error_code=None):
        connection.execute(
            """UPDATE compute_environment_requests
               SET state=%s,error_code=%s,updated_at=clock_timestamp()
               WHERE id=%s""",
            (state, error_code, command_id),
        )

    def _command(self, command_id) -> CommandView:
        with self.pool.connection() as connection:
            row = connection.execute(
                "SELECT * FROM compute_environment_requests WHERE id=%s",
                (command_id,),
            ).fetchone()
        if row is None:
            raise AppError(
                404,
                "compute_command_not_found",
                "Compute environment command not found",
            )
        return CommandView.model_validate(row)

    @contextmanager
    def _environment_command_lock(self, environment_id):
        """Serialize mutations for one environment while allowing other IDs to proceed."""
        with self.pool.connection() as connection:
            acquired = connection.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS acquired",
                (str(environment_id),),
            ).fetchone()["acquired"]
            if not acquired:
                raise AppError(
                    409,
                    "compute_request_in_progress",
                    "Another compute environment command is already running",
                )
            try:
                yield
            finally:
                # The lock connection owns no business writes; clear any failed
                # transaction before issuing the session-level unlock.
                connection.rollback()
                connection.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s,0))",
                    (str(environment_id),),
                )

    def _environment_row(self, identifier, *, connection=None, lock=False):
        identifier = self._identifier(identifier)
        suffix = " FOR UPDATE" if lock else ""
        query = "SELECT * FROM compute_environments WHERE id=%s" + suffix
        if connection is not None:
            row = connection.execute(query, (identifier,)).fetchone()
        else:
            with self.pool.connection() as own:
                row = own.execute(query, (identifier,)).fetchone()
        if row is None:
            raise AppError(
                404,
                "compute_environment_not_found",
                "Compute environment not found",
            )
        return row

    @staticmethod
    def _lease_token(lease: dict) -> LeaseToken:
        return LeaseToken(
            uuid.UUID(str(lease["id"])),
            lease["owner_kind"],
            uuid.UUID(str(lease["owner_id"])),
            lease["generation"],
        )

    def _environment_lease(self, row) -> dict | None:
        lease_id = row["lease_id"]
        if lease_id is None:
            with self.pool.connection() as connection:
                candidate = connection.execute(
                    """SELECT id FROM gpu_reservations
                       WHERE owner_kind='environment' AND owner_id=%s
                       ORDER BY created_at DESC LIMIT 1""",
                    (row["id"],),
                ).fetchone()
            if candidate is None:
                return None
            lease_id = candidate["id"]
        try:
            lease = self.leases.get(lease_id)
        except AppError as error:
            if error.code == "gpu_reservation_not_found":
                return None
            raise
        if (
            lease["owner_kind"] != "environment"
            or uuid.UUID(str(lease["owner_id"])) != row["id"]
        ):
            raise AppError(
                409,
                "compute_environment_lease_conflict",
                "Environment lease ownership does not match",
            )
        return lease

    def _event(
        self,
        connection,
        environment_id,
        action,
        *,
        source="platform",
        detail=None,
    ):
        connection.execute(
            """INSERT INTO compute_environment_events(
                   environment_id,source,action,detail)
               VALUES (%s,%s,%s,%s)""",
            (environment_id, source, action, Jsonb(detail or {})),
        )

    def _apply_environment_update(
        self,
        connection,
        environment_id,
        *,
        state,
        provider_instance_id,
        provider_state,
        observed_at,
        error_code,
        cleanup_policy,
        event_action,
        event_source,
        event_detail,
    ):
        changes: dict[str, Any] = {}
        if state is not _UNCHANGED:
            changes["state"] = state
            changes["deleted_at"] = _utcnow() if state == "deleted" else None
        if provider_instance_id is not _UNCHANGED:
            changes["provider_instance_id"] = provider_instance_id
        if provider_state is not _UNCHANGED:
            changes["provider_state"] = provider_state
        if observed_at is not _UNCHANGED:
            changes["provider_state_observed_at"] = observed_at
        if error_code is not _UNCHANGED:
            changes["last_error_code"] = error_code
        if cleanup_policy is not _UNCHANGED:
            changes["cleanup_policy"] = cleanup_policy

        fields = ["updated_at=clock_timestamp()"]
        values: list[Any] = []
        for name, value in changes.items():
            fields.append(name + "=%s")
            values.append(value)
        row = connection.execute(
            "UPDATE compute_environments SET "
            + ",".join(fields)
            + " WHERE id=%s RETURNING *",
            (*values, environment_id),
        ).fetchone()
        if row is None:
            raise AppError(
                404,
                "compute_environment_not_found",
                "Compute environment not found",
            )
        if event_action:
            self._event(
                connection,
                environment_id,
                event_action,
                source=event_source,
                detail=event_detail,
            )
        return row

    def _update_environment(
        self,
        environment_id,
        *,
        state=_UNCHANGED,
        provider_instance_id=_UNCHANGED,
        provider_state=_UNCHANGED,
        observed_at=_UNCHANGED,
        error_code=_UNCHANGED,
        cleanup_policy=_UNCHANGED,
        event_action=None,
        event_source="platform",
        event_detail=None,
        connection=None,
    ):
        arguments = dict(
            state=state,
            provider_instance_id=provider_instance_id,
            provider_state=provider_state,
            observed_at=observed_at,
            error_code=error_code,
            cleanup_policy=cleanup_policy,
            event_action=event_action,
            event_source=event_source,
            event_detail=event_detail,
        )
        if connection is not None:
            return self._apply_environment_update(
                connection, environment_id, **arguments
            )
        with self.pool.connection() as own:
            return self._apply_environment_update(own, environment_id, **arguments)

    def _reconciled_state(self, row, provider_state: EnvironmentState):
        current = row["state"]
        if row["cleanup_policy"] is not None and current != "deleted":
            if current in {"deleting", "cleanup_failed"}:
                return current
            if current == "unknown":
                return "unknown"
            return "deleting"
        if current == "starting":
            if provider_state == "running":
                return "running"
            if provider_state in {"starting", "unknown"}:
                return "starting"
            if provider_state in {"stopped", "failed", "unavailable"}:
                return provider_state
        if current == "stopping":
            if provider_state == "stopped":
                return "stopped"
            if provider_state in {"running", "stopping", "unknown"}:
                return "stopping"
            if provider_state in {"failed", "unavailable"}:
                return provider_state
        return provider_state

    def _observe(self, row):
        lease = self._environment_lease(row)
        if lease is None or lease["state"] != "held" or lease["create_state"] != "bound":
            return row, None, None
        try:
            result = self.lifecycle.observe(self._lease_token(lease))
        except AppError as error:
            return row, None, error

        observation = result.get("observation")
        if observation is not None:
            provider_state = observation.get("State")
            normalized = _provider_state(provider_state)
            state = self._reconciled_state(row, normalized)
            changed = (
                row["provider_state"] != provider_state
                or row["provider_instance_id"] != observation.get("UHostId")
            )
            updated = self._update_environment(
                row["id"],
                state=state,
                provider_instance_id=observation.get("UHostId"),
                provider_state=provider_state,
                observed_at=_utcnow(),
                error_code=None,
                event_action="provider_state_observed" if changed else None,
                event_source="provider",
                event_detail={"provider_state": provider_state},
            )
            return updated, observation, None

        if result.get("absent") is True:
            updated = self._update_environment(
                row["id"],
                state=(
                    "unknown"
                    if row["cleanup_policy"] is not None and row["state"] == "unknown"
                    else "unavailable"
                    if row["cleanup_policy"] is None
                    else row["state"]
                ),
                provider_state=None,
                observed_at=_utcnow(),
                error_code="cloud_instance_not_found",
                event_action="provider_instance_absent",
                event_source="provider",
                event_detail={"provider_instance_id": row["provider_instance_id"]},
            )
            return updated, None, None
        return row, None, None

    def _associations(self, provider_instance_id):
        if not provider_instance_id:
            return []
        with self.pool.connection() as connection:
            training = connection.execute(
                """SELECT a.id,t.name,a.number,a.state
                   FROM training_attempts a
                   JOIN training_tasks t ON t.id=a.task_id
                   WHERE a.instance_id=%s
                   ORDER BY a.updated_at DESC
                   LIMIT 20""",
                (provider_instance_id,),
            ).fetchall()
            trials = connection.execute(
                """SELECT id,state
                   FROM inference_trials
                   WHERE instance_id=%s
                   ORDER BY updated_at DESC
                   LIMIT 20""",
                (provider_instance_id,),
            ).fetchall()
        items = [
            AssociationView(
                kind="training",
                id=item["id"],
                label=f"Attempt #{item['number']} - {item['name']}",
                state=item["state"],
                active=item["state"] in _ACTIVE_TRAINING_STATES,
            )
            for item in training
        ]
        items.extend(
            AssociationView(
                kind="inference",
                id=item["id"],
                label="Inference trial " + str(item["id"])[:8],
                state=item["state"],
                active=item["state"] in _ACTIVE_INFERENCE_STATES,
            )
            for item in trials
        )
        return items

    def _lease_by_provider(self, provider_instance_id):
        if not provider_instance_id:
            return None
        with self.pool.connection() as connection:
            row = connection.execute(
                """SELECT id
                   FROM gpu_reservations
                   WHERE provider_instance_id=%s
                   ORDER BY created_at DESC
                   LIMIT 1""",
                (provider_instance_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            return self.leases.get(row["id"])
        except AppError:
            return None

    def _events(self, environment_id, lease):
        events: list[EventView] = []
        if environment_id is not None:
            with self.pool.connection() as connection:
                local = connection.execute(
                    """SELECT source,action,detail,recorded_at
                       FROM compute_environment_events
                       WHERE environment_id=%s
                       ORDER BY id""",
                    (environment_id,),
                ).fetchall()
            events.extend(
                EventView(
                    source=item["source"],
                    action=item["action"],
                    detail=item["detail"],
                    recorded_at=item["recorded_at"],
                )
                for item in local
            )
        if lease:
            for item in lease.get("events", []):
                recorded_at = _parse_datetime(item.get("recorded_at"))
                if recorded_at is None:
                    continue
                events.append(
                    EventView(
                        source="lease",
                        action=item["action"],
                        detail={"reservation_id": str(lease["id"])},
                        recorded_at=recorded_at,
                    )
                )
        return sorted(events, key=lambda item: item.recorded_at)

    def _monitor(self, row):
        if not row["provider_instance_id"]:
            return None
        spec = InstanceSpec.model_validate(row["spec"])
        try:
            result = Catalog(self.resources, self.lifecycle.provider).read(
                "monitor",
                {
                    "Region": spec.region,
                    "Zone": spec.zone,
                    "UHostIds": [row["provider_instance_id"]],
                },
            )
        except AppError as error:
            return {
                "state": "unavailable",
                "error_code": error.code,
                "fetched_at": None,
                "items": [],
            }
        return {
            "state": result["state"],
            "error_code": None,
            "fetched_at": result["fetched_at"],
            "items": result["items"],
        }

    @staticmethod
    def _capabilities(
        row,
        lease,
        associations,
        *,
        managed=True,
        management="environment",
    ):
        if not managed:
            return CapabilityView(
                start=False,
                stop=False,
                delete=False,
                reconcile=False,
                monitor=False,
            )
        active_task = any(item.active for item in associations)
        held = bool(lease and lease.get("state") == "held")
        bound = bool(lease and lease.get("create_state") == "bound")
        deleting = row["cleanup_policy"] is not None
        return CapabilityView(
            price=management == "environment" and row["state"] != "deleted",
            start=(
                management == "environment"
                and held
                and bound
                and not deleting
                and row["state"] == "stopped"
            ),
            stop=(
                management == "environment"
                and held
                and bound
                and not deleting
                and row["state"] == "running"
            ),
            delete=management == "environment" and row["state"] != "deleted" and not active_task,
            reconcile=management == "environment" and row["state"] != "deleted",
            monitor=management == "environment" and bound,
        )

    def _pricing(self, row):
        if row is None:
            return PricingView.unavailable(
                "quote_selection_incomplete",
                "未纳管实例缺少创建参数，无法查询准确官方报价。",
            )
        try:
            spec = InstanceSpec.model_validate(row["spec"])
            quote = Catalog(self.resources, self.lifecycle.provider).price_for_spec(
                spec
            )
            return PricingView.model_validate(quote)
        except (AppError, ValidationError, TypeError, ValueError) as error:
            code = getattr(error, "code", "quote_unavailable")
            return PricingView.unavailable(
                code,
                "官方报价当前不可用；不显示估算金额，也不推断费用。",
            )

    def _view(self, row, *, monitor=False, source_error=None):
        lease = self._environment_lease(row)
        associations = self._associations(row["provider_instance_id"])
        observed = row["provider_state_observed_at"]
        if source_error:
            freshness = FreshnessView(
                state="unavailable",
                observed_at=observed,
                error_code=getattr(source_error, "code", None),
            )
        elif observed is None:
            freshness = FreshnessView(state="unknown")
        else:
            freshness = FreshnessView(
                state=(
                    "fresh"
                    if _utcnow() - observed <= timedelta(seconds=300)
                    else "stale"
                ),
                observed_at=observed,
            )
        warnings = []
        if row["state"] in {"unknown", "unavailable", "cleanup_failed", "failed"}:
            warnings.append("Environment state requires review.")
        if lease is None or lease.get("state") == "released":
            warnings.append("No active GPU lease is attached to this environment.")
        return EnvironmentView(
            id=row["id"],
            name=row["name"],
            resource_owner=row["resource_owner"],
            managed=True,
            management="environment",
            spec=EnvironmentSpecView.from_instance_spec(
                InstanceSpec.model_validate(row["spec"])
            ),
            state=row["state"],
            provider_state=row["provider_state"],
            provider_instance_id=row["provider_instance_id"],
            lease_id=lease["id"] if lease else row["lease_id"],
            lease=lease,
            associations=associations,
            events=self._events(row["id"], lease),
            monitor=self._monitor(row) if monitor else None,
            freshness=freshness,
            capabilities=self._capabilities(row, lease, associations),
            pricing=self._pricing(row),
            warnings=warnings,
            last_error_code=row["last_error_code"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    def _command_response(self, environment_id, command_id, *, monitor=False):
        row = self._environment_row(environment_id)
        return EnvironmentMutationResponse(
            environment=self._view(row, monitor=monitor),
            command=self._command(command_id),
        )

    def _reserve_environment(self, row):
        if row["lease_id"] is not None:
            lease = self.leases.get(row["lease_id"])
            return lease, self._lease_token(lease)
        token = self.leases.reserve("environment", row["id"])
        try:
            with self.pool.connection() as connection:
                connection.execute(
                    """UPDATE compute_environments
                       SET lease_id=%s,updated_at=clock_timestamp()
                       WHERE id=%s""",
                    (token.reservation_id, row["id"]),
                )
                self._event(
                    connection,
                    row["id"],
                    "lease_reserved",
                    detail={"reservation_id": str(token.reservation_id)},
                )
        except Exception:
            try:
                self.leases.release(token)
            except AppError:
                pass
            raise
        return self.leases.get(token.reservation_id), token

    @staticmethod
    def _uncertain(error: AppError):
        return error.code in {
            "cloud_timeout",
            "cloud_unavailable",
            "cloud_api_error",
            "cloud_invalid_response",
            "cloud_rate_limited",
        }

    def _fail_action(self, command_id, action, error_code):
        with self.pool.connection() as connection:
            command = connection.execute(
                """SELECT environment_id
                   FROM compute_environment_requests
                   WHERE id=%s""",
                (command_id,),
            ).fetchone()
            self._finish_command(connection, command_id, "failed", error_code)
            if command and command["environment_id"] is not None:
                self._event(
                    connection,
                    command["environment_id"],
                    action + "_command_failed",
                    detail={"error_code": error_code},
                )

    @staticmethod
    def _command_error(error, environment_id, command_id):
        details = dict(error.details or {})
        details.update(
            {
                "environment_id": str(environment_id),
                "command_id": str(command_id),
            }
        )
        return AppError(error.status, error.code, error.message, details)

    def create(self, body, idempotency_key):
        body = self._model(CreateEnvironmentRequest, body)
        name = body.name.strip()
        key = self._key(idempotency_key)
        payload = {
            "name": name,
            "resource_owner": body.resource_owner,
            "spec": body.spec.model_dump(mode="json"),
        }
        environment_id = None
        request = None
        with self.pool.connection() as connection:
            request, created = self._claim_request(
                connection, key, "create", payload
            )
            if not created:
                if request["environment_id"] is None:
                    raise AppError(
                        409,
                        "compute_request_in_progress",
                        "The same create request is still being committed",
                    )
                environment_id = request["environment_id"]
            else:
                environment_id = uuid.uuid4()
                try:
                    connection.execute(
                        """INSERT INTO compute_environments(
                               id,name,resource_owner,spec,state)
                           VALUES (%s,%s,%s,%s,'creating')""",
                        (
                            environment_id,
                            name,
                            body.resource_owner,
                            Jsonb(body.spec.model_dump(mode="json")),
                        ),
                    )
                except pg_errors.UniqueViolation:
                    raise AppError(
                        409,
                        "compute_environment_name_conflict",
                        "An active environment with this resource owner and name already exists",
                    ) from None
                connection.execute(
                    """UPDATE compute_environment_requests
                       SET environment_id=%s,updated_at=clock_timestamp()
                       WHERE id=%s""",
                    (environment_id, request["id"]),
                )
                self._event(connection, environment_id, "create_requested")

        if not created:
            return self._command_response(environment_id, request["id"])

        row = self._environment_row(environment_id)
        try:
            try:
                quote = Catalog(
                    self.resources, self.lifecycle.provider
                ).price_for_spec(body.spec)
            except AppError:
                raise AppError(
                    503,
                    "cloud_price_unavailable",
                    "创建前无法确认官方报价，未发送云端创建命令。",
                ) from None
            with self.pool.connection() as connection:
                self._event(
                    connection,
                    environment_id,
                    "price_verified",
                    detail={
                        "amount": quote["amount"],
                        "currency": quote["currency"],
                        "unit": quote["unit"],
                        "charge_type": quote["charge_type"],
                        "observed_at": quote["observed_at"],
                    },
                )
            _, token = self._reserve_environment(row)
            result = self.lifecycle.create(token, body.spec)
            lease = result.get("lease") or self.leases.get(token.reservation_id)
            provider_instance_id = lease.get("provider_instance_id")
            row = self._update_environment(
                environment_id,
                provider_instance_id=provider_instance_id,
                error_code=None,
                event_action="instance_bound" if provider_instance_id else None,
                event_detail=(
                    {"provider_instance_id": provider_instance_id}
                    if provider_instance_id
                    else None
                ),
            )
            row, observation, observation_error = self._observe(row)
            if observation_error is not None:
                self._update_environment(
                    environment_id,
                    state="unknown",
                    error_code=observation_error.code,
                    event_action="create_observation_failed",
                    event_detail={"error_code": observation_error.code},
                )
                command_state = "accepted"
                command_error = observation_error.code
            elif observation is not None:
                command_state = "succeeded"
                command_error = None
            else:
                command_state = "accepted"
                command_error = row["last_error_code"]
            with self.pool.connection() as connection:
                self._finish_command(
                    connection, request["id"], command_state, command_error
                )
            return self._command_response(environment_id, request["id"])
        except AppError as error:
            lease = None
            try:
                lease = self._environment_lease(row)
            except AppError:
                pass
            uncertain = bool(
                lease
                and lease.get("create_state") in {"requested", "bound"}
            ) or self._uncertain(error)
            if uncertain:
                self._update_environment(
                    environment_id,
                    state="unknown",
                    error_code=error.code,
                    event_action="create_outcome_unknown",
                    event_detail={"error_code": error.code},
                )
                with self.pool.connection() as connection:
                    self._finish_command(
                        connection, request["id"], "accepted", error.code
                    )
                return self._command_response(environment_id, request["id"])

            if (
                lease
                and lease.get("state") == "held"
                and lease.get("create_state") == "not_requested"
            ):
                try:
                    self.leases.release(self._lease_token(lease))
                except AppError:
                    uncertain = True
            if uncertain:
                self._update_environment(
                    environment_id,
                    state="unknown",
                    error_code=error.code,
                    event_action="create_cleanup_unverified",
                    event_detail={"error_code": error.code},
                )
                with self.pool.connection() as connection:
                    self._finish_command(
                        connection, request["id"], "accepted", error.code
                    )
                return self._command_response(environment_id, request["id"])
            self._update_environment(
                environment_id,
                state="failed",
                error_code=error.code,
                event_action="create_failed",
                event_detail={"error_code": error.code},
            )
            with self.pool.connection() as connection:
                self._finish_command(
                    connection, request["id"], "failed", error.code
                )
            raise self._command_error(
                error, environment_id, request["id"]
            ) from None

    def list(
        self,
        region=None,
        zone=None,
        *,
        state=None,
        management=None,
        query=None,
        include_deleted=False,
    ):
        with self.pool.connection() as connection:
            rows = connection.execute(
                """SELECT *
                   FROM compute_environments
                   ORDER BY created_at DESC
                   LIMIT 500"""
            ).fetchall()
        items: list[EnvironmentView] = []
        for row in rows:
            if not include_deleted and state != "deleted" and row["state"] == "deleted":
                continue
            if region and row["spec"].get("region") != region:
                continue
            if zone and row["spec"].get("zone") != zone:
                continue
            if state and row["state"] != state:
                continue
            if row["state"] == "deleted":
                error = None
                current = row
            else:
                current, _, error = self._observe(row)
            view = self._view(current, source_error=error)
            if management and view.management != management:
                continue
            if query and query.casefold() not in (
                view.name
                + " "
                + (view.provider_instance_id or "")
                + " "
                + view.resource_owner
            ).casefold():
                continue
            items.append(view)

        if management == "environment":
            inventory = []
            source = {
                "state": "not_requested",
                "fetched_at": None,
                "errors": [],
                "regions": [],
                "pricing": "official_quote",
            }
        else:
            inventory, source = self._provider_inventory(region, zone)
        managed_ids = {
            item.provider_instance_id for item in items if item.provider_instance_id
        }
        for instance in inventory:
            if instance["UHostId"] in managed_ids:
                continue
            if region and instance.get("Region") != region:
                continue
            if zone and instance.get("Zone") != zone:
                continue
            associations = self._associations(instance["UHostId"])
            lease = self._lease_by_provider(instance["UHostId"])
            item_management = (
                "workflow" if associations or lease is not None else "unmanaged"
            )
            if management and item_management != management:
                continue
            view = self._unmanaged_view(
                instance,
                associations,
                lease,
                item_management,
                source,
            )
            if state and view.state != state:
                continue
            if query and query.casefold() not in (
                view.name + " " + view.provider_instance_id
            ).casefold():
                continue
            items.append(view)

        counts = {name: 0 for name in ALL_STATES}
        for item in items:
            counts[item.state] = counts.get(item.state, 0) + 1
        summary = {
            "total": len(items),
            "managed": sum(item.managed for item in items),
            "unmanaged": sum(not item.managed for item in items),
            "running": counts.get("running", 0),
            "stopped": counts.get("stopped", 0),
            "attention": sum(
                counts.get(name, 0)
                for name in ("failed", "unavailable", "unknown", "cleanup_failed")
            ),
            "gpu_leases_held": sum(
                bool(item.lease and item.lease.get("state") == "held")
                for item in items
            ),
        }
        return EnvironmentListResponse(
            items=items,
            summary=summary,
            source=source,
            observed_at=_utcnow(),
            filters={
                "region": region,
                "zone": zone,
                "state": state,
                "management": management,
                "query": query,
                "include_deleted": include_deleted,
            },
        )

    def get(self, identifier, *, include_monitor=True):
        row = self._environment_row(identifier)
        if row["state"] == "deleted":
            return self._view(row, monitor=False)
        row, _, error = self._observe(row)
        return self._view(
            row, monitor=include_monitor, source_error=error
        )

    def start(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        with self._environment_command_lock(identifier):
            return self._start_serialized(identifier, idempotency_key)

    def _start_serialized(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        key = self._key(idempotency_key)
        payload = {"environment_id": str(identifier), "action": "start"}
        with self.pool.connection() as connection:
            request, created = self._claim_request(
                connection, key, "start", payload, identifier
            )
            if not created:
                return self._command_response(identifier, request["id"])
            row = self._environment_row(
                identifier, connection=connection, lock=True
            )
            if row["state"] == "deleted":
                raise AppError(
                    409,
                    "compute_environment_deleted",
                    "The environment is already deleted",
                )
            if row["cleanup_policy"] is not None:
                raise AppError(
                    409,
                    "compute_environment_cleanup_started",
                    "An environment awaiting cleanup cannot be started",
                )

        row, _, error = self._observe(row)
        if error is not None:
            self._fail_action(request["id"], "start", error.code)
            raise self._command_error(error, identifier, request["id"]) from None
        if row["state"] == "running":
            with self.pool.connection() as connection:
                self._finish_command(connection, request["id"], "succeeded")
            return self._command_response(identifier, request["id"])
        if row["state"] != "stopped":
            self._fail_action(
                request["id"], "start", "compute_environment_transition_conflict"
            )
            raise AppError(
                409,
                "compute_environment_transition_conflict",
                "Only a stopped environment can be started",
                {
                    "environment_id": str(identifier),
                    "command_id": str(request["id"]),
                },
            )

        lease = self._environment_lease(row)
        if lease is None or lease.get("state") != "held":
            self._fail_action(
                request["id"], "start", "compute_environment_lease_missing"
            )
            raise AppError(
                409,
                "compute_environment_lease_missing",
                "The environment has no active GPU lease",
                {
                    "environment_id": str(identifier),
                    "command_id": str(request["id"]),
                },
            )
        self._update_environment(
            identifier,
            state="starting",
            error_code=None,
            event_action="start_requested",
        )
        try:
            self.lifecycle.start(self._lease_token(lease))
        except AppError as error:
            if self._uncertain(error):
                self._update_environment(
                    identifier,
                    state="unknown",
                    error_code=error.code,
                    event_action="start_outcome_unknown",
                    event_detail={"error_code": error.code},
                )
                with self.pool.connection() as connection:
                    self._finish_command(
                        connection, request["id"], "accepted", error.code
                    )
                return self._command_response(identifier, request["id"])
            self._fail_action(request["id"], "start", error.code)
            self._update_environment(
                identifier,
                state=(
                    "unknown"
                    if error.code in {
                        "cloud_instance_not_found",
                        "cloud_instance_transition_conflict",
                    }
                    else "stopped"
                ),
                error_code=error.code,
                event_action="start_failed",
                event_detail={"error_code": error.code},
            )
            raise self._command_error(
                error, identifier, request["id"]
            ) from None

        self._update_environment(
            identifier,
            state="starting",
            error_code=None,
            event_action="start_accepted",
        )
        updated, _, observation_error = self._observe(
            self._environment_row(identifier)
        )
        command_state = (
            "succeeded"
            if updated["state"] == "running"
            else "accepted"
        )
        command_error = (
            observation_error.code if observation_error is not None else None
        )
        with self.pool.connection() as connection:
            self._finish_command(
                connection, request["id"], command_state, command_error
            )
        return self._command_response(identifier, request["id"])

    def stop(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        with self._environment_command_lock(identifier):
            return self._stop_serialized(identifier, idempotency_key)

    def _stop_serialized(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        key = self._key(idempotency_key)
        payload = {"environment_id": str(identifier), "action": "stop"}
        with self.pool.connection() as connection:
            request, created = self._claim_request(
                connection, key, "stop", payload, identifier
            )
            if not created:
                return self._command_response(identifier, request["id"])
            row = self._environment_row(
                identifier, connection=connection, lock=True
            )
            if row["state"] == "deleted":
                raise AppError(
                    409,
                    "compute_environment_deleted",
                    "The environment is already deleted",
                )
            if row["cleanup_policy"] is not None:
                raise AppError(
                    409,
                    "compute_environment_cleanup_started",
                    "An environment awaiting cleanup cannot be stopped",
                )

        row, _, error = self._observe(row)
        if error is not None:
            self._fail_action(request["id"], "stop", error.code)
            raise self._command_error(error, identifier, request["id"]) from None
        if row["state"] == "stopped":
            with self.pool.connection() as connection:
                self._finish_command(connection, request["id"], "succeeded")
            return self._command_response(identifier, request["id"])
        if row["state"] != "running":
            self._fail_action(
                request["id"], "stop", "compute_environment_transition_conflict"
            )
            raise AppError(
                409,
                "compute_environment_transition_conflict",
                "Only a running environment can be stopped",
                {
                    "environment_id": str(identifier),
                    "command_id": str(request["id"]),
                },
            )

        lease = self._environment_lease(row)
        if lease is None or lease.get("state") != "held":
            self._fail_action(
                request["id"], "stop", "compute_environment_lease_missing"
            )
            raise AppError(
                409,
                "compute_environment_lease_missing",
                "The environment has no active GPU lease",
                {
                    "environment_id": str(identifier),
                    "command_id": str(request["id"]),
                },
            )
        self._update_environment(
            identifier,
            state="stopping",
            error_code=None,
            event_action="stop_requested",
        )
        try:
            self.lifecycle.stop(self._lease_token(lease))
        except AppError as error:
            if self._uncertain(error):
                self._update_environment(
                    identifier,
                    state="unknown",
                    error_code=error.code,
                    event_action="stop_outcome_unknown",
                    event_detail={"error_code": error.code},
                )
                with self.pool.connection() as connection:
                    self._finish_command(
                        connection, request["id"], "accepted", error.code
                    )
                return self._command_response(identifier, request["id"])
            self._fail_action(request["id"], "stop", error.code)
            self._update_environment(
                identifier,
                state=(
                    "unknown"
                    if error.code in {
                        "cloud_instance_not_found",
                        "cloud_instance_transition_conflict",
                    }
                    else "running"
                ),
                error_code=error.code,
                event_action="stop_failed",
                event_detail={"error_code": error.code},
            )
            raise self._command_error(
                error, identifier, request["id"]
            ) from None

        self._update_environment(
            identifier,
            state="stopping",
            error_code=None,
            event_action="stop_accepted",
        )
        updated, _, observation_error = self._observe(
            self._environment_row(identifier)
        )
        command_state = (
            "succeeded"
            if updated["state"] == "stopped"
            else "accepted"
        )
        command_error = (
            observation_error.code if observation_error is not None else None
        )
        with self.pool.connection() as connection:
            self._finish_command(
                connection, request["id"], command_state, command_error
            )
        return self._command_response(identifier, request["id"])

    def delete(self, identifier, body, idempotency_key):
        identifier = self._identifier(identifier)
        with self._environment_command_lock(identifier):
            return self._delete_serialized(
                identifier, body, idempotency_key
            )

    def _delete_serialized(self, identifier, body, idempotency_key):
        identifier = self._identifier(identifier)
        body = self._model(DeleteEnvironmentRequest, body)
        key = self._key(idempotency_key)
        payload = {
            "environment_id": str(identifier),
            **body.model_dump(mode="json"),
        }
        with self.pool.connection() as connection:
            request, created = self._claim_request(
                connection, key, "delete", payload, identifier
            )
            if not created:
                return self._command_response(identifier, request["id"])
            row = self._environment_row(
                identifier, connection=connection, lock=True
            )
            if row["name"] != body.confirm_name:
                raise AppError(
                    422,
                    "compute_environment_delete_confirmation_required",
                    "confirm_name must exactly match the environment name",
                )
            if body.acknowledge_data_loss is not True:
                raise AppError(
                    422,
                    "compute_environment_delete_confirmation_required",
                    "Explicit data-loss acknowledgement is required",
                )
            if row["state"] == "deleted":
                self._finish_command(connection, request["id"], "succeeded")
                deleted = True
            else:
                deleted = False
                associations = self._associations(row["provider_instance_id"])
                if any(item.active for item in associations):
                    raise AppError(
                        409,
                        "compute_environment_active_task",
                        "An active training or inference task is associated with this environment",
                    )
                if (
                    row["cleanup_policy"] is not None
                    and row["cleanup_policy"] != body.cleanup_policy
                ):
                    raise AppError(
                        409,
                        "compute_environment_cleanup_policy_conflict",
                        "A different cleanup policy was already fixed for this environment",
                    )
                self._update_environment(
                    identifier,
                    state="deleting",
                    cleanup_policy=body.cleanup_policy,
                    error_code=None,
                    event_action="delete_requested",
                    event_detail={"cleanup_policy": body.cleanup_policy},
                    connection=connection,
                )
        if deleted:
            return self._command_response(identifier, request["id"])

        try:
            released = self._drive_delete(
                identifier, body.cleanup_policy
            )
        except AppError as error:
            uncertain = self._uncertain(error)
            lease = self._environment_lease(self._environment_row(identifier))
            cleanup_failed = bool(
                lease and lease.get("cleanup_state") == "failed"
            ) or error.code in {
                "instance_delete_failed",
                "gpu_cleanup_unverified",
                "gpu_process_unverified",
                "gpu_outputs_unverified",
                "gpu_release_unverified",
            }
            state = "cleanup_failed" if cleanup_failed else "unknown"
            self._update_environment(
                identifier,
                state=state,
                error_code=error.code,
                event_action="delete_failed",
                event_detail={"error_code": error.code},
            )
            command_state = "accepted" if uncertain else "failed"
            with self.pool.connection() as connection:
                self._finish_command(
                    connection, request["id"], command_state, error.code
                )
            if uncertain:
                return self._command_response(identifier, request["id"])
            raise self._command_error(
                error, identifier, request["id"]
            ) from None
        with self.pool.connection() as connection:
            self._finish_command(
                connection,
                request["id"],
                "succeeded" if released else "accepted",
            )
        return self._command_response(identifier, request["id"])

    def _mark_deleted(self, row):
        if row["state"] == "deleted":
            return True
        with self.pool.connection() as connection:
            self._update_environment(
                row["id"],
                state="deleted",
                error_code=None,
                event_action="deleted_confirmed",
                event_detail={"provider_instance_id": row["provider_instance_id"]},
                connection=connection,
            )
            connection.execute(
                """UPDATE compute_environment_requests
                   SET state='succeeded',error_code=NULL,
                       updated_at=clock_timestamp()
                   WHERE environment_id=%s
                     AND action='delete'
                     AND state='accepted'""",
                (row["id"],),
            )
        return True

    def _drive_delete(self, identifier, policy):
        row = self._environment_row(identifier)
        lease = self._environment_lease(row)
        if lease is None or lease["state"] == "released":
            return self._mark_deleted(row)
        token = self._lease_token(lease)
        if lease["create_state"] == "not_requested":
            self.leases.release(token)
            return self._mark_deleted(row)
        if lease["create_state"] == "requested":
            try:
                self.lifecycle.reconcile(token)
            except AppError as error:
                self._update_environment(
                    identifier,
                    state="unknown",
                    error_code="cloud_instance_creation_unverified",
                    event_action="delete_waiting_for_binding",
                    event_detail={"error_code": error.code},
                )
                if self._uncertain(error):
                    return False
                raise
            lease = self.leases.get(lease["id"])
            if lease["create_state"] != "bound":
                self._update_environment(
                    identifier,
                    state="unknown",
                    error_code="cloud_instance_creation_unverified",
                    event_action="delete_waiting_for_binding",
                    event_detail={
                        "error_code": "cloud_instance_creation_unverified"
                    },
                )
                return False
            token = self._lease_token(lease)

        try:
            result = self.lifecycle.cleanup(token, policy)
        except AppError:
            latest = self.leases.get(lease["id"])
            state = (
                "cleanup_failed"
                if latest.get("cleanup_state") == "failed"
                else "unknown"
            )
            self._update_environment(
                identifier,
                state=state,
                error_code=latest.get("cleanup_error_code"),
            )
            raise
        if result["lease"]["state"] == "released":
            return self._mark_deleted(row)

        try:
            reconciled = self.lifecycle.reconcile(token)
        except AppError as error:
            if error.code == "cloud_invalid_response":
                self._update_environment(
                    identifier,
                    state="unknown",
                    error_code=error.code,
                )
            raise
        lease = reconciled["lease"]
        if lease["state"] == "released":
            return self._mark_deleted(row)
        state = (
            "cleanup_failed"
            if lease.get("cleanup_state") == "failed"
            else "deleting"
        )
        self._update_environment(
            identifier,
            state=state,
            error_code=lease.get("cleanup_error_code"),
        )
        return False

    def reconcile(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        with self._environment_command_lock(identifier):
            return self._reconcile_serialized(
                identifier, idempotency_key
            )

    def _reconcile_serialized(self, identifier, idempotency_key):
        identifier = self._identifier(identifier)
        key = self._key(idempotency_key)
        payload = {"environment_id": str(identifier), "action": "reconcile"}
        with self.pool.connection() as connection:
            request, created = self._claim_request(
                connection, key, "reconcile", payload, identifier
            )
            if not created:
                return self._command_response(identifier, request["id"])
            self._environment_row(
                identifier, connection=connection, lock=True
            )

        row = self._environment_row(identifier)
        if row["state"] == "deleted":
            with self.pool.connection() as connection:
                self._finish_command(connection, request["id"], "succeeded")
            return self._command_response(identifier, request["id"])
        lease = self._environment_lease(row)
        command_error = None
        try:
            if row["cleanup_policy"] is not None:
                released = self._drive_delete(
                    identifier, row["cleanup_policy"]
                )
                state = "succeeded" if released else "accepted"
            elif lease is not None and lease["create_state"] == "requested":
                result = self.lifecycle.reconcile(self._lease_token(lease))
                lease = result["lease"]
                row = self._update_environment(
                    identifier,
                    provider_instance_id=lease.get("provider_instance_id"),
                    error_code=None,
                )
                row, _, error = self._observe(row)
                command_error = error.code if error is not None else None
                state = (
                    "succeeded"
                    if lease["create_state"] == "bound" and error is None
                    else "accepted"
                )
            else:
                row, _, error = self._observe(row)
                command_error = error.code if error is not None else None
                state = "succeeded" if error is None else "accepted"
        except AppError as error:
            uncertain = self._uncertain(error)
            state = "accepted" if uncertain else "failed"
            self._update_environment(
                identifier,
                state=(
                    "cleanup_failed"
                    if row["cleanup_policy"] is not None
                    and error.code in {
                        "instance_delete_failed",
                        "gpu_cleanup_unverified",
                        "gpu_process_unverified",
                        "gpu_outputs_unverified",
                        "gpu_release_unverified",
                    }
                    else "unknown"
                    if uncertain
                    else row["state"]
                ),
                error_code=error.code,
                event_action="reconcile_failed",
                event_detail={"error_code": error.code},
            )
            with self.pool.connection() as connection:
                self._finish_command(
                    connection, request["id"], state, error.code
                )
            if state == "accepted":
                return self._command_response(identifier, request["id"])
            raise self._command_error(
                error, identifier, request["id"]
            ) from None
        with self.pool.connection() as connection:
            self._finish_command(
                connection, request["id"], state, command_error
            )
        return self._command_response(identifier, request["id"])

    def _provider_inventory(self, region=None, zone=None):
        catalog = Catalog(self.resources, self.lifecycle.provider)
        errors = []
        fetched = []
        regions = []
        if region:
            regions = [region]
        else:
            with self.pool.connection() as connection:
                rows = connection.execute(
                    """SELECT DISTINCT spec->>'region' AS region
                       FROM compute_environments
                       WHERE state != 'deleted'"""
                ).fetchall()
            regions = [row["region"] for row in rows if row["region"]]
            configured = getattr(self.resources.settings, "ucloud_region", None)
            if configured:
                regions.append(configured)
            if not regions:
                try:
                    zones = catalog.read("zones", {})
                    regions = sorted(
                        {
                            item["Region"]
                            for item in zones["items"]
                            if item.get("Region")
                        }
                    )
                except AppError as error:
                    errors.append(
                        {"code": error.code, "message": error.message}
                    )

        instances = {}
        for item_region in sorted(set(regions)):
            offset = 0
            total = None
            while total is None or offset < total:
                try:
                    result = catalog.read(
                        "instances",
                        {
                            "Region": item_region,
                            "Offset": offset,
                            "Limit": 100,
                        },
                    )
                except AppError as error:
                    errors.append(
                        {"code": error.code, "message": error.message}
                    )
                    break
                total = result["total"]
                fetched.append(result["fetched_at"])
                for item in result["items"]:
                    instances[item["UHostId"]] = item
                if not result["items"]:
                    break
                offset += len(result["items"])

        source_state = (
            "unavailable"
            if errors and not fetched
            else "stale"
            if errors
            else "ready"
        )
        source = {
            "state": source_state,
            "fetched_at": max(fetched) if fetched else None,
            "errors": errors,
            "regions": sorted(set(regions)),
            "pricing": "official_quote",
        }
        return list(instances.values()), source

    def _unmanaged_view(
        self, instance, associations, lease, management, source
    ):
        observed_at = _parse_datetime(source.get("fetched_at"))
        freshness_state = (
            "unavailable"
            if source["state"] == "unavailable"
            else "stale"
            if source["state"] == "stale"
            else "fresh"
        )
        warning = (
            "Managed by a ModelForge workflow; use that workflow for lifecycle actions."
            if management == "workflow"
            else "Provider instance is not managed by a compute environment; this view is read-only."
        )
        return EnvironmentView(
            id=None,
            name=instance["Name"],
            resource_owner="provider-account",
            managed=False,
            management=management,
            spec=EnvironmentSpecView(
                region=instance.get("Region"),
                zone=instance.get("Zone"),
                gpu_type=instance.get("GpuType") or None,
                gpu_count=instance.get("GPU"),
                cpu=instance.get("CPU"),
                memory_mb=instance.get("Memory"),
                image_id=instance.get("CompShareImageId") or None,
            ),
            state=_provider_state(instance["State"]),
            provider_state=instance["State"],
            provider_instance_id=instance["UHostId"],
            lease_id=uuid.UUID(str(lease["id"])) if lease else None,
            lease=lease,
            associations=associations,
            events=self._events(None, lease),
            monitor=None,
            freshness=FreshnessView(
                state=freshness_state,
                observed_at=observed_at,
                error_code=(source.get("errors") or [{}])[0].get("code"),
            ),
            capabilities=self._capabilities(
                None,
                lease,
                associations,
                managed=False,
                management=management,
            ),
            pricing=PricingView.unavailable(
                "quote_selection_incomplete",
                "未纳管实例缺少完整创建参数，无法查询准确官方报价。",
            ),
            warnings=[warning],
        )
