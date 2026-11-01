"""Typed directory projections: visibility is not compatibility or a GPU lease."""
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from modelforge.errors import AppError
from modelforge.infrastructure.ucloud import UCloud


class Projection(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)


class Zone(Projection):
    Region: str
    Zone: str
    Describe: str
    IsPod: bool


class Combination(Projection):
    Cpu: int
    Memory: list[int]
    MinimalCpuPlatform: list[str] = Field(default_factory=list)


class MachineSize(Projection):
    Gpu: int
    Collection: list[Combination]


class GraphicsMemory(Projection):
    Value: int
    Rate: int | None = None


class DiskType(Projection):
    Name: str
    InstantResize: bool | None = None
    MinimalSize: int | None = None
    MaximalSize: int | None = None


class DiskGroup(Projection):
    Name: str
    BootDisk: list[DiskType] = Field(default_factory=list)
    DataDisk: list[DiskType] = Field(default_factory=list)


class InstanceType(Projection):
    Name: str
    Zone: str
    Status: str
    Description: str = ""
    MachineSizes: list[MachineSize]
    GraphicsMemory: GraphicsMemory
    CpuPlatforms: dict[str, list[str]] = Field(default_factory=dict)
    Disks: list[DiskGroup] = Field(default_factory=list)


class Image(Projection):
    CompShareImageId: str
    Name: str
    ImageType: str
    Status: str
    Author: str = ""
    Tags: list[str] = Field(default_factory=list)
    Description: str = ""

    @field_validator("Tags", mode="before")
    @classmethod
    def normalize_null_tags(cls, value):
        return [] if value is None else value


class PublicModel(Projection):
    Name: str
    Path: str
    Tag: str = ""
    Size: str
    CreateTime: int | None = None


class Capacity(Projection):
    Gpu: int
    Cpu: int
    Mem: int
    ResourceEnough: bool


class Instance(Projection):
    UHostId: str
    Name: str
    State: str
    Zone: str
    Region: str
    CPU: int
    Memory: int
    GPU: int
    GpuType: str = ""
    CompShareImageId: str = ""
    # Password, FileBrowserPassword, SSH command, networks and URLs are excluded.


class Point(Projection):
    Timestamp: int
    Value: float


class Series(Projection):
    Values: list[Point]


class Metric(Projection):
    MetricKey: str
    Results: list[Series]


class Monitor(Projection):
    UHostId: str
    Metrics: list[Metric]


class Disk(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    IsBoot: bool
    Type: str = Field(min_length=1, max_length=64)
    Size: int = Field(gt=0, le=1_000_000)


class CapacityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    region: str = Field(min_length=1, max_length=64)
    zone: str = Field(min_length=1, max_length=64)
    gpu_type: str = Field(min_length=1, max_length=120)
    cpu_platform: Literal["Intel/Auto", "Amd/Auto", "Auto"]
    image_id: str = Field(min_length=1, max_length=120)
    charge_type: Literal["Month", "Day", "Dynamic", "Postpay", "Spot"]
    disks: list[Disk] = Field(min_length=1, max_length=10)


CONTRACTS = {
    "zones": ("DescribeCompShareSupportZone", "ZoneInfo", Zone),
    "specs": ("DescribeAvailableCompShareInstanceTypes", "AvailableInstanceTypes", InstanceType),
    "images": ("DescribeCompShareImages", "ImageSet", Image),
    "models": ("DescribeModelRepositoryModels", "Models", PublicModel),
    "capacity": ("CheckCompShareResourceCapacity", "Specs", Capacity),
    "instances": ("DescribeCompShareInstance", "UHostSet", Instance),
    "monitor": ("GetCompShareInstanceMonitor", "List", Monitor),
}


class Catalog:
    def __init__(self, resources):
        self.provider = UCloud(resources.settings, resources.source_http)

    def read(self, kind: str, parameters: dict):
        action, key, projection = CONTRACTS[kind]
        response = self.provider.query(action, parameters)
        try:
            source = response["Data"] if kind == "monitor" else response
            rows = source[key]
            if not isinstance(rows, list):
                raise ValueError()
            items = [projection.model_validate(row).model_dump() for row in rows]
            total = response["TotalCount"] if kind in ("images", "instances") else len(items)
            if type(total) is not int or total < len(items) or total < 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError, ValidationError):
            raise AppError(502, "cloud_invalid_response", "优云目录字段无效，请稍后重试。") from None
        state = "empty" if total == 0 else "ready"
        if kind == "capacity" and items and not any(row["ResourceEnough"] for row in items):
            state = "out_of_stock"
        return {"items": items, "total": total, "state": state,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": "ucloud", "filters": parameters, "compatibility": "unverified"}

    def validate_selection(self, spec):
        """A current exact capacity check; never creates or reserves a paid instance."""
        from .instances import InstanceSpec
        spec=InstanceSpec.model_validate(spec.model_dump(warnings=False))
        result=self.read('capacity',{'Region':spec.region,'Zone':spec.zone,'GpuType':spec.gpu_type,
            'MachineType':'G','MinimalCpuPlatform':spec.cpu_platform,'CompShareImageId':spec.image_id,
            'ChargeType':spec.charge_type,'Disks':[{'IsBoot':True,'Type':spec.boot_disk_type,'Size':spec.boot_disk_gb}]})
        if not any(row['Gpu']==1 and row['Cpu']==spec.cpu and row['Mem']*1024==spec.memory_mb
                   and row['ResourceEnough'] for row in result['items']):
            raise AppError(409,'cloud_selection_unavailable','Selected exact single-GPU specification is unavailable; refresh the catalog')
        return spec
