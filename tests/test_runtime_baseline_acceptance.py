import copy
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "acceptance_runtime_baseline", ROOT / "scripts" / "acceptance-runtime-baseline.py"
)
acceptance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acceptance)


def payload():
    source = json.loads(
        (ROOT / "backend/src/modelforge/runtimes/compatibility-baseline.json").read_text(
            encoding="utf-8"
        )
    )
    source["sha256"] = "a" * 64
    dataset_limits = source["limits"]["dataset"]
    model_limits = source["limits"]["model"]
    source["capacity"] = {
        "dataset": {
            "configuration_version": dataset_limits["configuration_version"],
            "locked": dataset_limits["locked"],
            "file_limit_bytes": dataset_limits["file_limit_bytes"],
            "sample_limit": dataset_limits["sample_limit"],
            "line_limit_bytes": dataset_limits["line_limit_bytes"],
            "validation_error_limit": dataset_limits["validation_error_limit"],
            "preview_samples": dataset_limits["preview_samples"],
        },
        "model": {
            "configuration_version": model_limits["configuration_version"],
            "locked": model_limits["locked"],
            "file_limit_bytes": model_limits["file_limit_bytes"],
            "total_limit_bytes": model_limits["total_limit_bytes"],
            "file_count_limit": model_limits["file_count_limit"],
        },
    }
    return source


def passing_complete_payload():
    complete = copy.deepcopy(payload())
    complete["status"] = "complete"
    complete["closure_gaps"] = []
    complete["evidence"]["training_peak_memory"] = "measured"
    complete["evidence"]["capacity_limits"] = "locked"
    complete["limits"]["dataset"]["locked"] = True
    complete["limits"]["model"]["locked"] = True
    complete["capacity"]["dataset"]["locked"] = True
    complete["capacity"]["model"]["locked"] = True
    return complete


def test_partial_contract_acceptance_requires_declared_gaps():
    report = acceptance.validate(payload())
    assert report["passed"] is True


def test_complete_contract_acceptance_allows_no_closure_gaps():
    report = acceptance.validate(passing_complete_payload(), require_complete=True)
    assert report["passed"] is True


def test_complete_contract_rejects_retained_closure_gaps():
    complete = passing_complete_payload()
    complete["closure_gaps"] = ["training_peak_memory_pending"]
    report = acceptance.validate(complete, require_complete=True)
    assert report["passed"] is False
    assert any(item["name"] == "closure_gaps_empty" for item in report["failures"])


def test_partial_contract_rejects_capacity_that_diverges_from_the_baseline():
    partial = payload()
    partial["capacity"]["dataset"]["sample_limit"] += 1
    report = acceptance.validate(partial)
    assert report["passed"] is False
    assert any(
        item["name"] == "dataset_sample_limit_matches_baseline"
        for item in report["failures"]
    )


def test_partial_contract_rejects_capacity_lock_flag_that_diverges_from_the_baseline():
    partial = payload()
    partial["capacity"]["dataset"]["locked"] = not partial["capacity"]["dataset"]["locked"]
    report = acceptance.validate(partial)
    assert report["passed"] is False
    assert any(
        item["name"] == "dataset_capacity_lock_flag_matches_baseline"
        for item in report["failures"]
    )


def test_partial_contract_rejects_capacity_version_that_diverges_from_the_baseline():
    partial = payload()
    partial["capacity"]["model"]["configuration_version"] += "-drift"
    report = acceptance.validate(partial)
    assert report["passed"] is False
    assert any(
        item["name"] == "model_capacity_configuration_version_matches_baseline"
        for item in report["failures"]
    )


def test_partial_contract_rejects_a_measured_peak_that_is_still_declared_as_pending():
    partial = payload()
    partial["closure_gaps"].append("training_peak_memory_pending")
    report = acceptance.validate(partial)
    assert report["passed"] is False
    assert any(item["name"] == "training_peak_gap_absent" for item in report["failures"])


def test_partial_contract_rejects_incomplete_measured_peak_evidence():
    partial = payload()
    partial["evidence"]["training_peak_torch_reserved_bytes"] = None
    report = acceptance.validate(partial)
    assert report["passed"] is False
    assert any(item["name"] == "training_peak_evidence_complete" for item in report["failures"])
