"""Read-only CompShare directories. No create/start/stop/delete route."""
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from .catalog import Catalog, CapacityRequest

router = APIRouter(prefix="/api/v1/resources/ucloud", tags=["cloud-catalog"])
Text = Annotated[str, Query(min_length=1, max_length=120)]
OptionalText = Annotated[str | None, Query(min_length=1, max_length=120)]


def params(**values):
    return {key: value for key, value in values.items() if value is not None}


@router.get("/configuration")
def configuration(request: Request):
    s = request.app.state.resources.settings
    return {"configured": bool(s.ucloud_public_key and s.ucloud_private_key),
        "default_region": s.ucloud_region, "mode": "read_only"}


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
    return Catalog(request.app.state.resources).read("capacity", {
        "Region": body.region, "Zone": body.zone, "GpuType": body.gpu_type,
        "MachineType": "G", "MinimalCpuPlatform": body.cpu_platform,
        "CompShareImageId": body.image_id, "ChargeType": body.charge_type,
        "Disks": [disk.model_dump() for disk in body.disks]})


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
