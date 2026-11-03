"""Typed directory projections: visibility is not compatibility or a GPU lease."""
from datetime import datetime, timezone
import math
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

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
    cpu: int | None = Field(default=None, gt=0, le=1024)
    memory_mb: int | None = Field(default=None, gt=0, le=10485760, multiple_of=1024)
    cpu_platform: Literal["Intel/Auto", "Amd/Auto", "Auto"]
    image_id: str = Field(min_length=1, max_length=120)
    charge_type: Literal["Month", "Day", "Dynamic", "Postpay", "Spot"]
    disks: list[Disk] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def exact_quote_fields_are_paired(self):
        if (self.cpu is None) != (self.memory_mb is None):
            raise ValueError("cpu and memory_mb must be supplied together")
        return self


class PriceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    region: str = Field(min_length=1, max_length=64)
    zone: str = Field(min_length=1, max_length=64)
    gpu_type: str = Field(min_length=1, max_length=120)
    cpu: int = Field(gt=0, le=1024)
    memory_mb: int = Field(gt=0, le=10485760, multiple_of=1024)
    image_id: str | None = Field(default=None, min_length=1, max_length=120)
    charge_type: Literal["Month", "Day", "Dynamic", "Postpay", "Spot"] = "Postpay"
    disks: list[Disk] = Field(default_factory=list, max_length=10)
    quantity: int = Field(default=1, gt=0, le=1000)


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
    def __init__(self, resources, provider=None):
        self.provider = provider or UCloud(resources.settings, resources.source_http)

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

    @staticmethod
    def _money(value, field):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(field)
        amount = float(value)
        if not math.isfinite(amount) or amount < 0:
            raise ValueError(field)
        return round(amount, 6)

    def price(
        self,
        *,
        region: str,
        zone: str,
        gpu_type: str,
        cpu: int,
        memory_mb: int,
        charge_type: str = "Postpay",
        image_id: str | None = None,
        disks: list[dict] | None = None,
        quantity: int = 1,
    ):
        """Read the official discounted user price; never reserve or create."""
        parameters = {
            "Region": region,
            "Zone": zone,
            "GpuType": gpu_type,
            "Gpu": 1,
            "Cpu": cpu,
            "Memory": memory_mb,
            "ChargeType": charge_type,
            "Quantity": quantity,
        }
        if image_id:
            parameters["CompShareImageId"] = image_id
        if disks:
            parameters["Disks"] = disks

        response = self.provider.query("GetCompShareInstanceUserPrice", parameters)
        details = response.get("PriceDetails")
        originals = response.get("OriginalPriceDetails", [])
        if (
            not isinstance(details, list)
            or not details
            or not isinstance(originals, list)
        ):
            raise AppError(
                502,
                "cloud_price_unavailable",
                "优云未返回可验证的价格明细。",
            )

        selected = next(
            (
                row
                for row in details
                if isinstance(row, dict) and row.get("ChargeType") == charge_type
            ),
            None,
        )
        original = next(
            (
                row
                for row in originals
                if isinstance(row, dict) and row.get("ChargeType") == charge_type
            ),
            None,
        )
        if selected is None:
            raise AppError(
                502,
                "cloud_price_unavailable",
                "优云未返回所选计费模式的报价。",
            )

        try:
            breakdown = {
                "instance": self._money(selected.get("Instance", 0), "Instance"),
                "system_disks": self._money(
                    selected.get("SystemDisks", 0), "SystemDisks"
                ),
                "data_disks": self._money(selected.get("Disks", 0), "Disks"),
                "image": self._money(
                    selected.get("CompShareImage", 0), "CompShareImage"
                ),
            }
            original_breakdown = None
            if original is not None:
                original_breakdown = {
                    "instance": self._money(
                        original.get("Instance", 0), "Original.Instance"
                    ),
                    "system_disks": self._money(
                        original.get("SystemDisks", 0), "Original.SystemDisks"
                    ),
                    "data_disks": self._money(
                        original.get("Disks", 0), "Original.Disks"
                    ),
                    "image": self._money(
                        original.get("CompShareImage", 0), "Original.CompShareImage"
                    ),
                }
        except ValueError:
            raise AppError(
                502,
                "cloud_price_unavailable",
                "优云价格字段无效，无法安全展示费用。",
            ) from None

        hourly = round(sum(breakdown.values()), 6)
        return {
            "state": "available",
            "code": "quote_observed",
            "label": "官方报价",
            "description": "优云官方折后报价，按所选计费单位展示；不含未披露费用。",
            "source": "ucloud",
            "currency": "CNY",
            "hourly": hourly if charge_type in {"Postpay", "Dynamic", "Spot"} else None,
            "amount": hourly,
            "unit": (
                "hour"
                if charge_type in {"Postpay", "Dynamic", "Spot"}
                else "day"
                if charge_type == "Day"
                else "month"
            ),
            "charge_type": charge_type,
            "quantity": quantity,
            "breakdown": breakdown,
            "original_amount": (
                round(sum(original_breakdown.values()), 6)
                if original_breakdown is not None
                else None
            ),
            "original_breakdown": original_breakdown,
            "discount_type": selected.get("InstanceDiscountType"),
            "observed_at": datetime.now(timezone.utc).isoformat(),
        }

    def price_for_spec(self, spec, *, quantity: int = 1):
        """Price an exact lifecycle snapshot using the same wire fields as creation."""
        from .instances import InstanceSpec

        exact = InstanceSpec.model_validate(spec.model_dump(warnings=False))
        return self.price(
            region=exact.region,
            zone=exact.zone,
            gpu_type=exact.gpu_type,
            cpu=exact.cpu,
            memory_mb=exact.memory_mb,
            charge_type=exact.charge_type,
            image_id=exact.image_id,
            disks=[
                {
                    "IsBoot": True,
                    "Type": exact.boot_disk_type,
                    "Size": exact.boot_disk_gb,
                }
            ],
            quantity=quantity,
        )


def unavailable_price(code: str = "quote_unavailable", description: str | None = None):
    return {
        "state": "unavailable",
        "code": "quote_unavailable",
        "label": "报价不可用",
        "description": description
        or "未取得可验证的官方报价，无法推断金额。",
        "source": "unavailable",
        "currency": None,
        "hourly": None,
        "amount": None,
        "unit": None,
        "charge_type": None,
        "quantity": None,
        "breakdown": None,
        "original_amount": None,
        "original_breakdown": None,
        "discount_type": None,
        "observed_at": None,
        "error_code": code,
    }
