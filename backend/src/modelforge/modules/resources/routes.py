"""Read-only CompShare directories and lease-gated compute environment commands."""
from typing import Annotated, Literal
import uuid

from fastapi import APIRouter, Header, Query, Request
from modelforge.errors import AppError

from .catalog import Catalog, CapacityRequest, PriceRequest, unavailable_price
from .compute_environments import (
    ComputeEnvironments,
    CreateEnvironmentRequest,
    DeleteEnvironmentRequest,
    EnvironmentListResponse,
    EnvironmentMutationResponse,
    EnvironmentView,
)

router = APIRouter(prefix="/api/v1/resources/ucloud", tags=["cloud-catalog"])
compute_router = APIRouter(
    prefix="/api/v1/resources/compute",
    tags=["compute-environments"],
)
Text = Annotated[str, Query(min_length=1, max_length=120)]
OptionalText = Annotated[str | None, Query(min_length=1, max_length=120)]
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key")]
EnvironmentStateFilter = Literal[
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


def params(**values):
    return {key: value for key, value in values.items() if value is not None}


@router.get("/configuration")
def configuration(request: Request):
    s = request.app.state.resources.settings
    configured = bool(s.ucloud_public_key and s.ucloud_private_key)
    write_enabled = configured and s.ucloud_write_enabled
    return {
        "configured": configured,
        "default_region": s.ucloud_region,
        "mode": "read_write" if write_enabled else "read_only",
        "write_enabled": write_enabled,
        "reason": None if write_enabled else (
            "未配置优云凭据；计算环境写入保持关闭。"
            if not configured
            else "后端功能开关 MF_UCLOUD_WRITE_ENABLED 未开启，计算环境写入保持关闭。"
        ),
    }


@router.get("/zones")
def zones(request: Request, region: OptionalText = None):
    return Catalog(request.app.state.resources).read("zones", params(Region=region))


@router.get("/specs")
def specs(request: Request, region: Text, zone: OptionalText = None,
          gpu_type: OptionalText = None, instance_type: Literal["uhost", "spot"] = "uhost"):
    return Catalog(request.app.state.resources).read("specs", params(Region=region,
        Zone=zone, MachineTypes=[gpu_type] if gpu_type else None, InstanceType=instance_type))


@router.get("/images")
def images(request: Request, region: Text, zone: OptionalText = None,
           name: OptionalText = None, image_type: Literal["System", "App"] = "System",
           offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return Catalog(request.app.state.resources).read("images", params(Region=region,
        Zone=zone, Name=name, ImageType=image_type, Offset=offset, Limit=limit))


@router.get("/models")
def models(request: Request, region: Text, name: OptionalText = None, tags: OptionalText = None):
    return Catalog(request.app.state.resources).read("models", params(Region=region, name=name, tags=tags))


@router.post("/capacity")
def capacity(body: CapacityRequest, request: Request):
    catalog = Catalog(request.app.state.resources)
    result = catalog.read("capacity", {
        "Region": body.region, "Zone": body.zone, "GpuType": body.gpu_type,
        "MachineType": "G", "MinimalCpuPlatform": body.cpu_platform,
        "CompShareImageId": body.image_id, "ChargeType": body.charge_type,
        "Disks": [disk.model_dump() for disk in body.disks]})
    if body.cpu is None or body.memory_mb is None:
        result["quote"] = unavailable_price(
            "quote_selection_incomplete",
            "未提供精确 CPU 与内存，未查询费用。",
        )
    else:
        try:
            result["quote"] = catalog.price(
                region=body.region,
                zone=body.zone,
                gpu_type=body.gpu_type,
                cpu=body.cpu,
                memory_mb=body.memory_mb,
                charge_type=body.charge_type,
                image_id=body.image_id,
                disks=[disk.model_dump() for disk in body.disks],
            )
        except AppError as error:
            result["quote"] = unavailable_price(
                error.code,
                "精确库存已查询，但官方报价不可用；不会推断金额或启用费用估算。",
            )
    return result


@router.post("/price")
def price(body: PriceRequest, request: Request):
    return Catalog(request.app.state.resources).price(
        region=body.region,
        zone=body.zone,
        gpu_type=body.gpu_type,
        cpu=body.cpu,
        memory_mb=body.memory_mb,
        charge_type=body.charge_type,
        image_id=body.image_id,
        disks=[disk.model_dump() for disk in body.disks],
        quantity=body.quantity,
    )


@router.get("/instances")
def instances(request: Request, region: OptionalText = None, zone: OptionalText = None,
              instance_id: OptionalText = None, offset: int = Query(0, ge=0),
              limit: int = Query(20, ge=1, le=100)):
    return Catalog(request.app.state.resources).read("instances", params(Region=region,
        Zone=zone, UHostIds=[instance_id] if instance_id else None, Offset=offset, Limit=limit))


@router.get("/monitor")
def monitor(request: Request, region: Text, instance_id: Text, zone: OptionalText = None):
    return Catalog(request.app.state.resources).read("monitor", params(Region=region,
        Zone=zone, UHostIds=[instance_id]))


def compute_service(request: Request) -> ComputeEnvironments:
    injected = getattr(request.app.state, "compute_environments_service", None)
    if injected is not None:
        return injected
    resources = request.app.state.resources
    lifecycle = getattr(request.app.state, "compute_lifecycle", None)
    if lifecycle is None:
        from modelforge.bootstrap import remote_services

        lifecycle = remote_services(resources).lifecycle
    return ComputeEnvironments(resources, lifecycle)


def require_compute_write(request: Request):
    if not request.app.state.resources.settings.ucloud_write_enabled:
        raise AppError(
            403,
            "compute_write_disabled",
            "后端功能开关 MF_UCLOUD_WRITE_ENABLED 未开启，未发送云端写命令。",
        )


@compute_router.get(
    "/environments",
    response_model=EnvironmentListResponse,
    summary="List managed environments and read-only provider instances",
)
def compute_environments(
    request: Request,
    region: OptionalText = None,
    zone: OptionalText = None,
    state: EnvironmentStateFilter | None = None,
    management: Literal["environment", "workflow", "unmanaged"] | None = None,
    query: OptionalText = None,
    include_deleted: bool = False,
):
    return compute_service(request).list(
        region,
        zone,
        state=state,
        management=management,
        query=query,
        include_deleted=include_deleted,
    )


@compute_router.post(
    "/environments",
    response_model=EnvironmentMutationResponse,
    status_code=201,
    summary="Create a compute environment from an exact validated specification",
)
def create_compute_environment(
    body: CreateEnvironmentRequest,
    request: Request,
    idempotency_key: IdempotencyKey = None,
):
    require_compute_write(request)
    return compute_service(request).create(body, idempotency_key)


@compute_router.get(
    "/environments/{environment_id}",
    response_model=EnvironmentView,
    summary="Read one environment with provider observations and monitor data",
)
def compute_environment(
    environment_id: uuid.UUID,
    request: Request,
    include_monitor: bool = True,
):
    return compute_service(request).get(
        environment_id, include_monitor=include_monitor
    )


@compute_router.post(
    "/environments/{environment_id}/start",
    response_model=EnvironmentMutationResponse,
    summary="Request a stopped environment start",
)
def start_compute_environment(
    environment_id: uuid.UUID,
    request: Request,
    idempotency_key: IdempotencyKey = None,
):
    require_compute_write(request)
    return compute_service(request).start(environment_id, idempotency_key)


@compute_router.post(
    "/environments/{environment_id}/stop",
    response_model=EnvironmentMutationResponse,
    summary="Request a running environment stop",
)
def stop_compute_environment(
    environment_id: uuid.UUID,
    request: Request,
    idempotency_key: IdempotencyKey = None,
):
    require_compute_write(request)
    return compute_service(request).stop(environment_id, idempotency_key)


@compute_router.delete(
    "/environments/{environment_id}",
    response_model=EnvironmentMutationResponse,
    summary="Delete an environment after exact-name and data-loss confirmation",
)
def delete_compute_environment(
    environment_id: uuid.UUID,
    body: DeleteEnvironmentRequest,
    request: Request,
    idempotency_key: IdempotencyKey = None,
):
    require_compute_write(request)
    return compute_service(request).delete(
        environment_id, body, idempotency_key
    )


@compute_router.post(
    "/environments/{environment_id}/reconcile",
    response_model=EnvironmentMutationResponse,
    summary="Reconcile provider state and continue an accepted command",
)
def reconcile_compute_environment(
    environment_id: uuid.UUID,
    request: Request,
    idempotency_key: IdempotencyKey = None,
):
    require_compute_write(request)
    return compute_service(request).reconcile(
        environment_id, idempotency_key
    )
