"""Validate the live compatibility contract without creating cloud resources."""
from __future__ import annotations

import argparse
import json
import re
import sys

import httpx


HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def validate(payload, *, require_complete=False):
    checks = []

    def check(name, condition, detail=None):
        checks.append({"name": name, "passed": bool(condition), "detail": detail})

    check("schema", payload.get("schema") == 1, payload.get("schema"))
    check("baseline_sha256", isinstance(payload.get("sha256"), str)
          and bool(HEX_SHA256.fullmatch(payload["sha256"])))
    check("baseline_status", payload.get("status") in {"partial", "complete"}, payload.get("status"))

    model = payload.get("model") if isinstance(payload.get("model"), dict) else {}
    training = payload.get("training") if isinstance(payload.get("training"), dict) else {}
    inference = payload.get("inference") if isinstance(payload.get("inference"), dict) else {}
    conversation = inference.get("conversation") if isinstance(inference.get("conversation"), dict) else {}
    capacity = payload.get("capacity") if isinstance(payload.get("capacity"), dict) else {}
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {}
    training_hardware = training.get("hardware") if isinstance(training.get("hardware"), dict) else {}
    inference_hardware = inference.get("hardware") if isinstance(inference.get("hardware"), dict) else {}

    fingerprints = model.get("allowed_fingerprints", [])
    check("model_allowlist", isinstance(fingerprints, list) and bool(fingerprints)
          and all(isinstance(value, str) and HEX_SHA256.fullmatch(value) for value in fingerprints))
    check("training_lock_id", isinstance(training.get("runtime_lock_id"), str)
          and bool(training["runtime_lock_id"]))
    check("training_lock_sha256", isinstance(training.get("runtime_lock_sha256"), str)
          and bool(HEX_SHA256.fullmatch(training["runtime_lock_sha256"])))
    check("inference_lock_id", isinstance(inference.get("runtime_lock_id"), str)
          and bool(inference["runtime_lock_id"]))
    check("inference_lock_sha256", isinstance(inference.get("runtime_lock_sha256"), str)
          and bool(HEX_SHA256.fullmatch(inference["runtime_lock_sha256"])))
    hardware_fields = (
        "region",
        "zone",
        "gpu_type",
        "cpu",
        "memory_mb",
        "image_id",
        "cpu_platform",
        "charge_type",
        "boot_disk_gb",
        "boot_disk_type",
        "device_memory_bytes",
    )
    check("training_hardware_complete",
          all(field in training_hardware for field in hardware_fields), training_hardware)
    check("inference_hardware_complete",
          all(field in inference_hardware for field in hardware_fields), inference_hardware)
    runtime_fields = ("region", "zone", "gpu_type", "image_id", "device_memory_bytes")
    check("shared_runtime_hardware",
          all(training_hardware.get(field) == inference_hardware.get(field) for field in runtime_fields),
          {field: (training_hardware.get(field), inference_hardware.get(field))
           for field in runtime_fields})
    check("loaded_memory_fits_device",
          isinstance(inference.get("loaded_device_memory_bytes"), int)
          and isinstance(inference_hardware.get("device_memory_bytes"), int)
          and 0 < inference["loaded_device_memory_bytes"] <= inference_hardware["device_memory_bytes"],
          {"loaded": inference.get("loaded_device_memory_bytes"),
           "device": inference_hardware.get("device_memory_bytes")})
    check("adapter_fingerprints", all(
        isinstance(evidence.get(field), str) and bool(HEX_SHA256.fullmatch(evidence[field]))
        for field in ("adapter_best_fingerprint", "adapter_final_fingerprint")
    ), {field: evidence.get(field) for field in
        ("adapter_best_fingerprint", "adapter_final_fingerprint")})

    max_model_len = model.get("max_model_len")
    max_tokens_default = conversation.get("max_tokens_default")
    max_tokens_limit = conversation.get("max_tokens_limit")
    check("conversation_fits_model", isinstance(max_model_len, int) and max_model_len > 0
          and isinstance(max_tokens_default, int) and max_tokens_default > 0
          and isinstance(max_tokens_limit, int) and max_tokens_default <= max_tokens_limit < max_model_len)

    capacity_integers = {
        "dataset": {
            "file_limit_bytes": True,
            "sample_limit": True,
            "line_limit_bytes": True,
            "validation_error_limit": False,
            "preview_samples": False,
        },
        "model": {
            "file_limit_bytes": True,
            "total_limit_bytes": True,
            "file_count_limit": True,
        },
    }
    embedded_limits = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    for scope in ("dataset", "model"):
        values = capacity.get(scope) if isinstance(capacity.get(scope), dict) else {}
        source = (
            embedded_limits.get(scope)
            if isinstance(embedded_limits.get(scope), dict)
            else {}
        )
        check(f"{scope}_capacity_present", bool(values), values)
        check(f"{scope}_capacity_lock_flag", isinstance(values.get("locked"), bool), values.get("locked"))
        check(
            f"{scope}_capacity_lock_flag_matches_baseline",
            values.get("locked") == source.get("locked"),
            {"capacity": values.get("locked"), "limits": source.get("locked")},
        )
        check(
            f"{scope}_capacity_configuration_version",
            isinstance(values.get("configuration_version"), str)
            and bool(values["configuration_version"]),
            values.get("configuration_version"),
        )
        check(
            f"{scope}_capacity_configuration_version_matches_baseline",
            values.get("configuration_version") == source.get("configuration_version"),
            {
                "capacity": values.get("configuration_version"),
                "limits": source.get("configuration_version"),
            },
        )
        for field, must_be_positive in capacity_integers[scope].items():
            value = values.get(field)
            check(
                f"{scope}_{field}",
                type(value) is int and value >= (1 if must_be_positive else 0),
                value,
            )
            check(
                f"{scope}_{field}_matches_baseline",
                value == source.get(field),
                {"capacity": value, "limits": source.get(field)},
            )

    gaps = payload.get("closure_gaps")
    check("closure_gaps_list", isinstance(gaps, list), gaps)
    if payload.get("status") == "partial":
        check("closure_gaps_declared", bool(gaps), gaps)
        check("training_peak_gap_declared", "training_peak_memory_pending" in (gaps or []), gaps)
        check("capacity_gap_declared",
              "dataset_and_model_capacity_limits_not_boundary_tested" in (gaps or []), gaps)
    elif payload.get("status") == "complete":
        check("closure_gaps_empty", gaps == [], gaps)

    if require_complete:
        check("complete_status", payload.get("status") == "complete", payload.get("status"))
        check("dataset_capacity_locked", capacity.get("dataset", {}).get("locked") is True, capacity)
        check("model_capacity_locked", capacity.get("model", {}).get("locked") is True, capacity)
        check("training_peak_measured",
              evidence.get("training_peak_memory") == "measured", evidence)
        check("capacity_evidence_locked",
              evidence.get("capacity_limits") == "locked", evidence)

    failures = [item for item in checks if not item["passed"]]
    return {
        "passed": not failures,
        "mode": "complete" if require_complete else "partial",
        "baseline_id": payload.get("id"),
        "baseline_sha256": payload.get("sha256"),
        "status": payload.get("status"),
        "checks": checks,
        "failures": failures,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8102")
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        with httpx.Client(timeout=10, trust_env=False) as client:
            response = client.get(args.api.rstrip("/") + "/api/v1/runtime/baseline")
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        print(json.dumps({"passed": False, "error": type(error).__name__}, ensure_ascii=False))
        return 1
    report = validate(payload, require_complete=args.require_complete)
    encoded = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(encoded)
    print(encoded, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
