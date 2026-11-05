import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from modelforge.errors import AppError
from modelforge.modules.resources import InstanceSpec
from modelforge.modules.serving.use_cases import Chat
from modelforge.modules.training import TrainingConfig
from modelforge.runtimes import compatibility
from modelforge.runtimes.compatibility import (
    EvidenceRule,
    compatibility_baseline,
    compatibility_baseline_sha256,
    inference_compatibility,
    public_compatibility_baseline,
    public_training_image_profiles,
    reset_compatibility_baseline_cache,
    training_image_profile,
    training_compatibility,
)
from modelforge.runtimes.runtime_lock import (
    inference_runtime_lock_sha256,
    training_runtime_lock_sha256,
)

TRAIN_INSTANCE = InstanceSpec(
    region="cn-bj2",
    zone="cn-bj2-03",
    gpu_type="4090",
    cpu=14,
    memory_mb=65536,
    image_id="compshareImage-1fc8fjody17l",
    cpu_platform="Amd/Auto",
    charge_type="Postpay",
    boot_disk_gb=100,
    boot_disk_type="CLOUD_SSD",
)
INFERENCE_INSTANCE = TRAIN_INSTANCE.model_copy(update={"cpu_platform": "Auto"})
MODEL = {
    "manifest_sha256": "ffeb1654eaf9f55ac1ece9d1396c006cb17ff6d18f2d21a120fd0cef28a0166a",
    "format_summary": {"model_type": "qwen3"},
}
CONFIG = TrainingConfig(template="qwen3_nothink")
ADAPTER = {
    "id": "29fe9ea2-e11c-5dee-900d-73cc256d9b70",
    "fingerprint": "780954de248533a08a91f7efc61c491192bdc00ac1d15fc4a2dc76519965fb7b",
    "snapshot": {
        "base": {
            "fingerprint": MODEL["manifest_sha256"],
        },
        "config": {
            "template": "qwen3_nothink",
            "cutoff_len": 512,
            "lora_rank": 8,
        },
    },
}


def capacity_settings(baseline):
    return SimpleNamespace(
        dataset_file_limit_bytes=baseline.limits.dataset.file_limit_bytes,
        dataset_sample_limit=baseline.limits.dataset.sample_limit,
        dataset_line_limit_bytes=baseline.limits.dataset.line_limit_bytes,
        dataset_validation_error_limit=baseline.limits.dataset.validation_error_limit,
        dataset_preview_samples=baseline.limits.dataset.preview_samples,
        dataset_limits_version=baseline.limits.dataset.configuration_version,
        dataset_limits_locked=baseline.limits.dataset.locked,
        model_file_limit_bytes=baseline.limits.model.file_limit_bytes,
        model_total_limit_bytes=baseline.limits.model.total_limit_bytes,
        model_file_count_limit=baseline.limits.model.file_count_limit,
        model_limits_version=baseline.limits.model.configuration_version,
        model_limits_locked=baseline.limits.model.locked,
    )


def test_versioned_baseline_cross_checks_current_runtime_locks():
    baseline = compatibility_baseline()
    assert baseline.id == "qwen3-0.6b-rtx4090-cn-bj2-partial-20261102-r1"
    assert baseline.status == "partial"
    assert baseline.training.runtime_lock_sha256 == training_runtime_lock_sha256()
    assert baseline.inference.runtime_lock_sha256 == inference_runtime_lock_sha256()
    assert len(compatibility_baseline_sha256()) == 64
    assert baseline.evidence.training_peak_memory == "measured"
    assert baseline.evidence.training_peak_attempt_id == "fbbe9980-1b83-44b9-9880-422efb4a1f4d"
    assert baseline.evidence.training_peak_device_used_bytes == 2_580_545_536
    assert baseline.evidence.training_peak_torch_allocated_bytes == 1_659_389_440
    assert baseline.evidence.training_peak_torch_reserved_bytes == 1_686_110_208
    assert baseline.evidence.training_peak_sample_count == 92
    assert baseline.evidence.training_peak_sample_interval_ms == 250
    assert "training_peak_memory_pending" not in baseline.closure_gaps
    assert baseline.limits.dataset.file_limit_bytes == 100 * 1024 * 1024
    assert baseline.limits.dataset.sample_limit == 100_000
    assert baseline.limits.model.file_limit_bytes == 20 * 1024**3
    assert baseline.limits.model.total_limit_bytes == 100 * 1024**3
    assert baseline.limits.model.file_count_limit == 10_000
    assert baseline.limits.dataset.largest_observed_file_bytes <= baseline.limits.dataset.file_limit_bytes
    assert baseline.limits.model.largest_observed_total_bytes <= baseline.limits.model.total_limit_bytes


def test_training_image_profiles_publish_the_verified_b_route():
    profiles = public_training_image_profiles()
    assert profiles["baseline_sha256"] == compatibility_baseline_sha256()
    assert training_image_profile("base-image-a-prime").status == "available"
    b_profile = training_image_profile("training-base-b")
    assert b_profile.status == "available"
    assert b_profile.image_id == "compshareImage-1xc89j1np56m"
    assert b_profile.image_type == "Custom"
    assert b_profile.runtime_source == "prebuilt"
    assert b_profile.image_group_id is None
    with pytest.raises(AppError) as caught:
        training_image_profile("not-a-profile")
    assert caught.value.code == "training_image_profile_unsupported"


def test_b_profile_requires_its_own_custom_image_and_runtime_source():
    profile = training_image_profile("training-base-b")
    matched = TRAIN_INSTANCE.model_copy(update={"image_id": profile.image_id})
    identity = training_compatibility(MODEL, CONFIG, matched, image_profile=profile)
    assert identity["training_image_profile_id"] == "training-base-b"
    assert identity["training_image_id"] == "compshareImage-1xc89j1np56m"
    assert identity["training_image_type"] == "Custom"
    assert identity["training_runtime_source"] == "prebuilt"

    with pytest.raises(AppError) as caught:
        training_compatibility(MODEL, CONFIG, TRAIN_INSTANCE, image_profile=profile)
    assert caught.value.code == "training_image_profile_mismatch"


def test_measured_training_peak_must_be_complete_and_consistent():
    measured = compatibility_baseline().evidence.model_dump()
    incomplete = {**measured, "training_peak_torch_reserved_bytes": None}
    with pytest.raises(ValidationError):
        EvidenceRule(**incomplete)
    inconsistent = {
        **measured,
        "training_peak_torch_allocated_bytes": 2_000,
        "training_peak_torch_reserved_bytes": 1_000,
    }
    with pytest.raises(ValidationError):
        EvidenceRule(**inconsistent)
    pending = {
        **measured,
        "training_peak_memory": "pending",
    }
    with pytest.raises(ValidationError):
        EvidenceRule(**pending)


def test_training_accepts_only_the_measured_complete_combination():
    identity = training_compatibility(MODEL, CONFIG, TRAIN_INSTANCE)
    assert identity["model_fingerprint"] == MODEL["manifest_sha256"]
    assert identity["training_runtime_lock_sha256"] == training_runtime_lock_sha256()
    assert identity["baseline_sha256"] == compatibility_baseline_sha256()


def test_training_blocks_unknown_architecture_before_hardware_checks():
    model = {**MODEL, "format_summary": {"model_type": "llama"}}
    with pytest.raises(AppError) as caught:
        training_compatibility(model, CONFIG, TRAIN_INSTANCE)
    assert caught.value.code == "runtime_model_unsupported"
    assert caught.value.details["mismatches"][0]["field"] == "model.architecture"


def test_training_blocks_changed_content_even_for_same_architecture():
    model = {**MODEL, "manifest_sha256": "0" * 64}
    with pytest.raises(AppError) as caught:
        training_compatibility(model, CONFIG, TRAIN_INSTANCE)
    assert caught.value.code == "runtime_model_version_unsupported"
    assert caught.value.details["mismatches"][0]["field"] == "model.fingerprint"


def test_training_blocks_unmeasured_parameters_and_hardware():
    with pytest.raises(AppError) as caught:
        training_compatibility(
            MODEL, TrainingConfig(template="qwen3_nothink", cutoff_len=1024), TRAIN_INSTANCE
        )
    assert caught.value.code == "runtime_parameters_unsupported"
    changed = TRAIN_INSTANCE.model_copy(update={"gpu_type": "A100"})
    with pytest.raises(AppError) as caught:
        training_compatibility(MODEL, CONFIG, changed)
    assert caught.value.code == "runtime_hardware_unsupported"
    changed = TRAIN_INSTANCE.model_copy(update={"cpu_platform": "Auto"})
    with pytest.raises(AppError) as caught:
        training_compatibility(MODEL, CONFIG, changed)
    assert caught.value.code == "runtime_hardware_unsupported"
    assert caught.value.details["mismatches"] == [{
        "field": "instance.cpu_platform",
        "expected": "Amd/Auto",
        "actual": "Auto",
    }]


def test_inference_requires_same_base_preset_and_hardware():
    identity = inference_compatibility(ADAPTER, INFERENCE_INSTANCE)
    assert identity["model_fingerprint"] == MODEL["manifest_sha256"]
    assert identity["inference_runtime_lock_sha256"] == inference_runtime_lock_sha256()
    changed = {
        **ADAPTER,
        "snapshot": {
            **ADAPTER["snapshot"],
            "config": {**ADAPTER["snapshot"]["config"], "lora_rank": 16},
        },
    }
    with pytest.raises(AppError) as caught:
        inference_compatibility(changed, INFERENCE_INSTANCE)
    assert caught.value.code == "runtime_parameters_unsupported"


def test_older_baseline_pin_is_rejected():
    changed = {
        **ADAPTER,
        "snapshot": {
            **ADAPTER["snapshot"],
            "compatibility": {"baseline_id": "old", "baseline_sha256": "0" * 64},
        },
    }
    with pytest.raises(AppError) as caught:
        inference_compatibility(changed, INFERENCE_INSTANCE)
    assert caught.value.code == "runtime_baseline_changed"


def test_unpinned_adapter_is_limited_to_the_evidenced_legacy_pair():
    unknown = {**ADAPTER, "id": "00000000-0000-0000-0000-000000000000"}
    with pytest.raises(AppError) as caught:
        inference_compatibility(unknown, INFERENCE_INSTANCE)
    assert caught.value.code == "runtime_baseline_changed"
    changed = {**ADAPTER, "fingerprint": "0" * 64}
    with pytest.raises(AppError) as caught:
        inference_compatibility(changed, INFERENCE_INSTANCE)
    assert caught.value.code == "runtime_baseline_changed"


def test_changed_adapter_base_is_reported_as_a_model_version_mismatch():
    changed = {
        **ADAPTER,
        "snapshot": {
            **ADAPTER["snapshot"],
            "base": {"fingerprint": "0" * 64},
        },
    }
    with pytest.raises(AppError) as caught:
        inference_compatibility(changed, INFERENCE_INSTANCE)
    assert caught.value.code == "runtime_model_version_unsupported"


def test_conversation_limits_come_from_the_runtime_baseline():
    limits = compatibility_baseline().inference.conversation
    assert Chat(messages=[{"role": "user", "content": "hello"}]).max_tokens == limits.max_tokens_default
    with pytest.raises(ValueError):
        Chat(messages=[{"role": "user", "content": "x"}], max_tokens=limits.max_tokens_limit + 1)


def test_public_baseline_reports_integrity_bound_capacity_without_claiming_lock():
    baseline = compatibility_baseline()
    payload = public_compatibility_baseline(capacity_settings(baseline))
    assert payload["schema"] == 1
    assert payload["capacity"]["dataset"]["file_limit_bytes"] == baseline.limits.dataset.file_limit_bytes
    assert payload["capacity"]["dataset"]["sample_limit"] == baseline.limits.dataset.sample_limit
    assert payload["capacity"]["model"]["file_limit_bytes"] == baseline.limits.model.file_limit_bytes
    assert payload["capacity"]["model"]["total_limit_bytes"] == baseline.limits.model.total_limit_bytes
    assert payload["capacity"]["dataset"]["locked"] is False
    assert payload["closure_gaps"]


@pytest.mark.parametrize(
    "field",
    [
        "dataset_file_limit_bytes",
        "dataset_sample_limit",
        "dataset_line_limit_bytes",
        "dataset_validation_error_limit",
        "dataset_preview_samples",
        "dataset_limits_version",
        "dataset_limits_locked",
        "model_file_limit_bytes",
        "model_total_limit_bytes",
        "model_file_count_limit",
        "model_limits_version",
        "model_limits_locked",
    ],
)
def test_public_baseline_fails_closed_when_any_capacity_setting_drifts(field):
    baseline = compatibility_baseline()
    settings = capacity_settings(baseline)
    value = getattr(settings, field)
    setattr(settings, field, not value if isinstance(value, bool) else f"{value}-drift")
    with pytest.raises(RuntimeError, match="runtime_baseline_invalid"):
        public_compatibility_baseline(settings)


def test_cached_baseline_and_digest_cannot_diverge_after_a_file_change(tmp_path, monkeypatch):
    original_payload = compatibility_baseline().model_dump(mode="json", by_alias=True)
    temporary = tmp_path / "compatibility-baseline.json"
    temporary.write_text(json.dumps(original_payload), encoding="utf-8")
    monkeypatch.setattr(compatibility, "_BASELINE_PATH", temporary)
    reset_compatibility_baseline_cache()
    original_digest = compatibility_baseline_sha256()

    changed = {**original_payload, "generated_at": "2026-11-03"}
    temporary.write_text(json.dumps(changed), encoding="utf-8")
    assert compatibility_baseline().generated_at == original_payload["generated_at"]
    assert compatibility_baseline_sha256() == original_digest

    reset_compatibility_baseline_cache()
    assert compatibility_baseline().generated_at == "2026-11-03"
    assert compatibility_baseline_sha256() != original_digest
    reset_compatibility_baseline_cache()
