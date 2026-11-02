"""Validated runtime compatibility contract shared by API and Worker boundaries."""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from modelforge.errors import AppError
from .runtime_lock import (
    inference_runtime_lock,
    inference_runtime_lock_sha256,
    reset_runtime_lock_cache,
    training_runtime_lock,
    training_runtime_lock_sha256,
)

_BASELINE_PATH = Path(__file__).with_name("compatibility-baseline.json")


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class HardwareRule(_StrictModel):
    region: str = Field(min_length=1, max_length=64)
    zone: str = Field(min_length=1, max_length=64)
    gpu_type: str = Field(min_length=1, max_length=120)
    cpu: int = Field(gt=0, le=1024)
    memory_mb: int = Field(gt=0, le=10485760)
    image_id: str = Field(min_length=1, max_length=120)
    cpu_platform: Literal["Auto", "Intel/Auto", "Amd/Auto"]
    charge_type: Literal["Month", "Day", "Postpay"]
    boot_disk_gb: int = Field(gt=0, le=1000000)
    boot_disk_type: Literal["CLOUD_SSD", "CLOUD_RSSD"]
    device_memory_bytes: int = Field(gt=0)


class ModelRule(_StrictModel):
    display_name: str = Field(min_length=1, max_length=120)
    architecture: str = Field(min_length=1, max_length=120)
    allowed_fingerprints: list[str] = Field(min_length=1)
    max_model_len: int = Field(gt=0)

    @field_validator("allowed_fingerprints")
    @classmethod
    def valid_fingerprints(cls, values):
        if len(values) != len(set(values)) or any(
            len(value) != 64 or any(character not in "0123456789abcdef" for character in value)
            for value in values
        ):
            raise ValueError("fingerprints must be unique lowercase SHA-256 values")
        return values


class TrainingPreset(_StrictModel):
    epochs: int = Field(ge=1, le=100)
    learning_rate: float = Field(gt=0, le=0.01, allow_inf_nan=False)
    cutoff_len: int = Field(ge=128, le=32768)
    batch_size: int = Field(ge=1, le=8)
    gradient_accumulation: int = Field(ge=1, le=128)
    lora_rank: int = Field(ge=1)
    lora_alpha: int = Field(ge=1, le=256)
    lora_dropout: float = Field(ge=0, le=0.5, allow_inf_nan=False)
    scheduler: str = Field(min_length=1, max_length=32)
    warmup_ratio: float = Field(ge=0, le=0.3, allow_inf_nan=False)
    template: str = Field(min_length=1, max_length=120)
    seed: int = Field(ge=0, le=2147483647)


class TrainingRule(_StrictModel):
    runtime_lock_id: str = Field(min_length=1, max_length=200)
    runtime_lock_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    hardware: HardwareRule
    verified_preset: TrainingPreset


class InferenceConfig(_StrictModel):
    lora_rank: int = Field(ge=1)
    max_model_len: int = Field(gt=0)
    template: str = Field(min_length=1, max_length=120)


class ConversationRule(_StrictModel):
    max_messages: int = Field(ge=1)
    max_content_chars_per_message: int = Field(ge=1)
    max_total_content_chars: int = Field(ge=1)
    max_tokens_default: int = Field(ge=1)
    max_tokens_limit: int = Field(ge=1)

    @field_validator("max_total_content_chars")
    @classmethod
    def total_content_capacity(cls, value, info):
        per_message = info.data.get("max_content_chars_per_message")
        if per_message is not None and value < per_message:
            raise ValueError("max_total_content_chars must cover one maximum-sized message")
        return value

    @field_validator("max_tokens_limit")
    @classmethod
    def default_within_limit(cls, value, info):
        default = info.data.get("max_tokens_default")
        if default is not None and default > value:
            raise ValueError("max_tokens_default must not exceed max_tokens_limit")
        return value


class InferenceRule(_StrictModel):
    runtime_lock_id: str = Field(min_length=1, max_length=200)
    runtime_lock_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    hardware: HardwareRule
    config: InferenceConfig
    gpu_memory_utilization: float = Field(gt=0, le=1, allow_inf_nan=False)
    loaded_device_memory_bytes: int = Field(gt=0)
    conversation: ConversationRule

    @field_validator("loaded_device_memory_bytes")
    @classmethod
    def fits_hardware(cls, value, info):
        hardware = info.data.get("hardware")
        if hardware is not None and value > hardware.device_memory_bytes:
            raise ValueError("loaded device memory exceeds device capacity")
        return value


class DatasetLimitEvidence(_StrictModel):
    configuration_version: str = Field(min_length=1, max_length=120)
    locked: bool
    file_limit_bytes: int = Field(gt=0)
    sample_limit: int = Field(gt=0)
    line_limit_bytes: int = Field(gt=0)
    validation_error_limit: int = Field(ge=0)
    preview_samples: int = Field(ge=0)
    largest_observed_version_id: str
    largest_observed_file_bytes: int = Field(ge=0)
    largest_observed_samples: int | None = Field(default=None, ge=0)


class ModelLimitEvidence(_StrictModel):
    configuration_version: str = Field(min_length=1, max_length=120)
    locked: bool
    file_limit_bytes: int = Field(gt=0)
    total_limit_bytes: int = Field(gt=0)
    file_count_limit: int = Field(gt=0)
    largest_observed_version_id: str
    largest_observed_file_bytes: int = Field(ge=0)
    largest_observed_total_bytes: int | None = Field(default=None, ge=0)
    largest_observed_file_count: int | None = Field(default=None, ge=0)


class LimitsRule(_StrictModel):
    dataset: DatasetLimitEvidence
    model: ModelLimitEvidence


class EvidenceRule(_StrictModel):
    training_attempt_id: str = Field(min_length=1)
    training_exit_code: int = Field(ge=0)
    trained_steps: int = Field(gt=0)
    average_train_loss: float = Field(allow_inf_nan=False)
    eval_loss: float = Field(allow_inf_nan=False)
    adapter_best_id: str = Field(min_length=1)
    adapter_best_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    adapter_final_id: str = Field(min_length=1)
    adapter_final_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    inference_trial_id: str = Field(min_length=1)
    training_peak_memory: Literal["pending", "measured"]
    capacity_limits: Literal["protected_not_locked", "locked"]


class BlockedCombination(_StrictModel):
    code: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)


class CompatibilityBaseline(_StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        populate_by_name=True,
    )
    schema_version: int = Field(alias="schema")
    id: str = Field(min_length=1, max_length=200)
    status: Literal["partial", "complete"]
    generated_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    model: ModelRule
    training: TrainingRule
    inference: InferenceRule
    limits: LimitsRule
    evidence: EvidenceRule
    closure_gaps: list[str]
    blocked_combinations: list[BlockedCombination] = Field(min_length=1)


@lru_cache
def _bytes():
    try:
        return _BASELINE_PATH.read_bytes()
    except OSError:
        raise RuntimeError("runtime_baseline_invalid") from None


def _load():
    try:
        raw = _bytes()
        baseline = CompatibilityBaseline.model_validate_json(raw)
        if baseline.schema_version != 1 or baseline.status not in {"partial", "complete"}:
            raise ValueError("unsupported baseline schema or status")
        training_lock = training_runtime_lock()
        inference_lock = inference_runtime_lock()
        if (baseline.training.runtime_lock_id != training_lock["id"]
                or baseline.training.runtime_lock_sha256 != training_runtime_lock_sha256()
                or baseline.inference.runtime_lock_id != inference_lock["id"]
                or baseline.inference.runtime_lock_sha256 != inference_runtime_lock_sha256()):
            raise ValueError("runtime lock identity mismatch")
        if baseline.training.verified_preset.template != baseline.inference.config.template:
            raise ValueError("training and inference templates differ")
        if baseline.training.verified_preset.cutoff_len != baseline.inference.config.max_model_len:
            raise ValueError("training and inference model lengths differ")
        if baseline.training.verified_preset.lora_rank != baseline.inference.config.lora_rank:
            raise ValueError("training and inference LoRA ranks differ")
        if baseline.inference.conversation.max_tokens_limit >= baseline.model.max_model_len:
            raise ValueError("generation limit must leave prompt capacity")
        training_hardware = baseline.training.hardware
        inference_hardware = baseline.inference.hardware
        shared_hardware = ("region", "zone", "gpu_type", "image_id", "device_memory_bytes")
        if any(getattr(training_hardware, field) != getattr(inference_hardware, field)
               for field in shared_hardware):
            raise ValueError("training and inference runtime hardware identities differ")
        blocked_codes = [entry.code for entry in baseline.blocked_combinations]
        if len(blocked_codes) != len(set(blocked_codes)):
            raise ValueError("blocked combination codes must be unique")
        if len(baseline.closure_gaps) != len(set(baseline.closure_gaps)):
            raise ValueError("closure gaps must be unique")
        if baseline.evidence.training_exit_code != 0:
            raise ValueError("the verified training exit code must be zero")

        training_peak_pending = baseline.evidence.training_peak_memory == "pending"
        capacity_pending = baseline.evidence.capacity_limits == "protected_not_locked"
        if training_peak_pending != ("training_peak_memory_pending" in baseline.closure_gaps):
            raise ValueError("training peak evidence and closure gaps disagree")
        if capacity_pending != (
                "dataset_and_model_capacity_limits_not_boundary_tested" in baseline.closure_gaps
        ):
            raise ValueError("capacity evidence and closure gaps disagree")
        if baseline.limits.dataset.locked != baseline.limits.model.locked:
            raise ValueError("dataset and model capacity lock flags differ")
        dataset = baseline.limits.dataset
        if dataset.largest_observed_file_bytes > dataset.file_limit_bytes:
            raise ValueError("observed dataset file exceeds the bound capacity")
        if (dataset.largest_observed_samples is not None
                and dataset.largest_observed_samples > dataset.sample_limit):
            raise ValueError("observed dataset sample count exceeds the bound capacity")
        model = baseline.limits.model
        if model.largest_observed_file_bytes > model.file_limit_bytes:
            raise ValueError("observed model file exceeds the bound capacity")
        if (model.largest_observed_total_bytes is not None
                and model.largest_observed_total_bytes > model.total_limit_bytes):
            raise ValueError("observed model total exceeds the bound capacity")
        if (model.largest_observed_file_count is not None
                and model.largest_observed_file_count > model.file_count_limit):
            raise ValueError("observed model file count exceeds the bound capacity")
        limits_locked = dataset.locked and model.locked
        if limits_locked != (baseline.evidence.capacity_limits == "locked"):
            raise ValueError("capacity lock flags and evidence disagree")
        if baseline.status == "complete":
            if baseline.closure_gaps:
                raise ValueError("a complete baseline cannot retain closure gaps")
            if training_peak_pending or capacity_pending:
                raise ValueError("a complete baseline requires measured evidence")
        elif not baseline.closure_gaps:
            raise ValueError("a partial baseline must declare its closure gaps")
        return baseline
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError,
            KeyError, TypeError, RuntimeError):
        raise RuntimeError("runtime_baseline_invalid") from None


@lru_cache
def compatibility_baseline() -> CompatibilityBaseline:
    return _load()


def compatibility_baseline_sha256() -> str:
    try:
        return hashlib.sha256(_bytes()).hexdigest()
    except OSError:
        raise RuntimeError("runtime_baseline_invalid") from None


def reset_compatibility_baseline_cache():
    compatibility_baseline.cache_clear()
    _bytes.cache_clear()
    reset_runtime_lock_cache()


def public_compatibility_baseline(settings) -> dict[str, Any]:
    baseline = compatibility_baseline()
    if (
        baseline.limits.dataset.configuration_version != settings.dataset_limits_version
        or baseline.limits.dataset.locked != settings.dataset_limits_locked
        or baseline.limits.dataset.file_limit_bytes != settings.dataset_file_limit_bytes
        or baseline.limits.dataset.sample_limit != settings.dataset_sample_limit
        or baseline.limits.dataset.line_limit_bytes != settings.dataset_line_limit_bytes
        or baseline.limits.dataset.validation_error_limit != settings.dataset_validation_error_limit
        or baseline.limits.dataset.preview_samples != settings.dataset_preview_samples
        or baseline.limits.model.configuration_version != settings.model_limits_version
        or baseline.limits.model.locked != settings.model_limits_locked
        or baseline.limits.model.file_limit_bytes != settings.model_file_limit_bytes
        or baseline.limits.model.total_limit_bytes != settings.model_total_limit_bytes
        or baseline.limits.model.file_count_limit != settings.model_file_count_limit
    ):
        raise RuntimeError("runtime_baseline_invalid")
    payload = baseline.model_dump(mode="json", by_alias=True)
    payload["sha256"] = compatibility_baseline_sha256()
    payload["capacity"] = {
        "dataset": {
            "file_limit_bytes": baseline.limits.dataset.file_limit_bytes,
            "sample_limit": baseline.limits.dataset.sample_limit,
            "line_limit_bytes": baseline.limits.dataset.line_limit_bytes,
            "validation_error_limit": baseline.limits.dataset.validation_error_limit,
            "preview_samples": baseline.limits.dataset.preview_samples,
            "configuration_version": baseline.limits.dataset.configuration_version,
            "locked": baseline.limits.dataset.locked,
        },
        "model": {
            "file_limit_bytes": baseline.limits.model.file_limit_bytes,
            "total_limit_bytes": baseline.limits.model.total_limit_bytes,
            "file_count_limit": baseline.limits.model.file_count_limit,
            "configuration_version": baseline.limits.model.configuration_version,
            "locked": baseline.limits.model.locked,
        },
    }
    return payload


def _runtime_error(code: str, message: str, mismatches: list[dict[str, Any]]):
    raise AppError(422, code, message, {
        "baseline_id": compatibility_baseline().id,
        "baseline_sha256": compatibility_baseline_sha256(),
        "mismatches": mismatches,
    })


def _model_mismatches(model: dict[str, Any], baseline: CompatibilityBaseline) -> list[dict[str, Any]]:
    summary = model.get("format_summary")
    summary = summary if isinstance(summary, dict) else {}
    architecture = summary.get("model_type")
    fingerprint = model.get("manifest_sha256") or model.get("fingerprint")
    mismatches = []
    if architecture != baseline.model.architecture:
        mismatches.append({
            "field": "model.architecture",
            "expected": baseline.model.architecture,
            "actual": architecture,
        })
    if fingerprint not in baseline.model.allowed_fingerprints:
        mismatches.append({
            "field": "model.fingerprint",
            "expected": baseline.model.allowed_fingerprints,
            "actual": fingerprint,
        })
    return mismatches


def _hardware_mismatches(instance: Any, expected: HardwareRule) -> list[dict[str, Any]]:
    values = instance.model_dump() if hasattr(instance, "model_dump") else dict(instance)
    mismatches = []
    for field, wanted in expected.model_dump().items():
        if field == "device_memory_bytes":
            continue
        actual = values.get(field)
        if actual != wanted:
            mismatches.append({"field": f"instance.{field}", "expected": wanted, "actual": actual})
    return mismatches


def _training_mismatches(config: Any, expected: TrainingPreset) -> list[dict[str, Any]]:
    values = config.model_dump() if hasattr(config, "model_dump") else dict(config)
    wanted = expected.model_dump()
    mismatches = []
    for field, value in wanted.items():
        if field == "seed":
            continue
        actual = values.get(field)
        if isinstance(value, float) or isinstance(actual, float):
            matches = (isinstance(actual, (int, float)) and not isinstance(actual, bool)
                       and math.isfinite(actual) and math.isclose(float(actual), value, rel_tol=0, abs_tol=1e-12))
        else:
            matches = actual == value
        if not matches:
            mismatches.append({"field": f"config.{field}", "expected": value, "actual": actual})
    return mismatches


def training_compatibility(model: dict[str, Any], config: Any, instance: Any) -> dict[str, Any]:
    baseline = compatibility_baseline()
    model_mismatches = _model_mismatches(model, baseline)
    if model_mismatches:
        code = ("runtime_model_unsupported"
                if any(item["field"] == "model.architecture" for item in model_mismatches)
                else "runtime_model_version_unsupported")
        _runtime_error(code, "The selected base model is outside the verified runtime baseline", model_mismatches)
    config_mismatches = _training_mismatches(config, baseline.training.verified_preset)
    if config_mismatches:
        _runtime_error("runtime_parameters_unsupported",
                       "The selected training parameters are outside the verified runtime preset",
                       config_mismatches)
    hardware_mismatches = _hardware_mismatches(instance, baseline.training.hardware)
    if hardware_mismatches:
        _runtime_error("runtime_hardware_unsupported",
                       "The selected instance is outside the verified training hardware and image",
                       hardware_mismatches)
    return {
        "baseline_id": baseline.id,
        "baseline_sha256": compatibility_baseline_sha256(),
        "model_architecture": baseline.model.architecture,
        "model_fingerprint": model.get("manifest_sha256"),
        "training_runtime_lock_id": baseline.training.runtime_lock_id,
        "training_runtime_lock_sha256": baseline.training.runtime_lock_sha256,
        "training_preset": baseline.training.verified_preset.model_dump(),
        "hardware": baseline.training.hardware.model_dump(),
    }


def inference_compatibility(adapter: dict[str, Any], instance: Any) -> dict[str, Any]:
    baseline = compatibility_baseline()
    adapter_id = str(adapter.get("id")) if adapter.get("id") is not None else None
    adapter_fingerprint = adapter.get("fingerprint")
    snapshot = adapter.get("snapshot")
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    base = snapshot.get("base")
    base = base if isinstance(base, dict) else {}
    config = snapshot.get("config")
    config = config if isinstance(config, dict) else {}
    mismatches = []
    fingerprint = base.get("fingerprint")
    if fingerprint not in baseline.model.allowed_fingerprints:
        mismatches.append({
            "field": "adapter.base.fingerprint",
            "expected": baseline.model.allowed_fingerprints,
            "actual": fingerprint,
        })
    expected_config = {
        "template": baseline.inference.config.template,
        "cutoff_len": baseline.inference.config.max_model_len,
        "lora_rank": baseline.inference.config.lora_rank,
    }
    for field, expected in expected_config.items():
        actual = config.get(field)
        if actual != expected:
            mismatches.append({"field": f"adapter.config.{field}", "expected": expected, "actual": actual})
    pinned = snapshot.get("compatibility")
    if isinstance(pinned, dict):
        if pinned.get("baseline_id") != baseline.id:
            mismatches.append({
                "field": "adapter.baseline_id",
                "expected": baseline.id,
                "actual": pinned.get("baseline_id"),
            })
        if pinned.get("baseline_sha256") != compatibility_baseline_sha256():
            mismatches.append({
                "field": "adapter.baseline_sha256",
                "expected": compatibility_baseline_sha256(),
                "actual": pinned.get("baseline_sha256"),
            })
        if pinned.get("model_fingerprint") != fingerprint:
            mismatches.append({
                "field": "adapter.model_fingerprint",
                "expected": fingerprint,
                "actual": pinned.get("model_fingerprint"),
            })
    else:
        legacy_adapters = {
            baseline.evidence.adapter_best_id: baseline.evidence.adapter_best_fingerprint,
            baseline.evidence.adapter_final_id: baseline.evidence.adapter_final_fingerprint,
        }
        if adapter_id not in legacy_adapters or adapter_fingerprint != legacy_adapters[adapter_id]:
            mismatches.append({
                "field": "adapter.baseline_id",
                "expected": sorted(legacy_adapters),
                "actual": adapter_id,
            })
    if mismatches:
        if any(item["field"] == "adapter.base.fingerprint" for item in mismatches):
            code = "runtime_model_version_unsupported"
        elif any(
            item["field"] in {
                "adapter.baseline_id", "adapter.baseline_sha256", "adapter.model_fingerprint"
            }
            for item in mismatches
        ):
            code = "runtime_baseline_changed"
        else:
            code = "runtime_parameters_unsupported"
        _runtime_error(code, "The selected Adapter is outside the verified inference baseline", mismatches)
    hardware_mismatches = _hardware_mismatches(instance, baseline.inference.hardware)
    if hardware_mismatches:
        _runtime_error("runtime_hardware_unsupported",
                       "The selected instance is outside the verified inference hardware and image",
                       hardware_mismatches)
    return {
        "baseline_id": baseline.id,
        "baseline_sha256": compatibility_baseline_sha256(),
        "model_fingerprint": fingerprint,
        "adapter_fingerprint": adapter_fingerprint,
        "inference_runtime_lock_id": baseline.inference.runtime_lock_id,
        "inference_runtime_lock_sha256": baseline.inference.runtime_lock_sha256,
        "config": baseline.inference.config.model_dump(),
        "hardware": baseline.inference.hardware.model_dump(),
    }
