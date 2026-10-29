import json

import pytest

from modelforge.modules.datasets.validation import DatasetLimits, build_split, validate_messages_jsonl


def sample(role="assistant", content="answer"):
    return {"messages": [{"role": "user", "content": "question"}, {"role": role, "content": content}]}


def test_valid_single_and_multi_turn_messages_preview():
    payload = b"\n".join([
        json.dumps(sample(), ensure_ascii=False).encode(),
        json.dumps({"messages": [{"role": "system", "content": "policy"}, {"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]}).encode(),
    ])
    result = validate_messages_jsonl(payload)
    assert result.valid
    assert [item["line"] for item in result.samples] == [1, 2]
    assert result.preview == result.samples


def test_invalid_json_role_and_missing_assistant_report_physical_line_and_path():
    payload = b'{"messages":[{"role":"user","content":"q"}]}\n{"messages":[{"role":"tool","content":"x"}]}\n{"messages":[{"role":[],"content":"x"}]}\nnot-json\n'
    result = validate_messages_jsonl(payload)
    assert not result.valid
    assert any(error["line"] == 1 and error["path"] == "messages" for error in result.errors)
    assert any(error["line"] == 2 and error["path"] == "messages[0].role" for error in result.errors)
    assert any(error["line"] == 3 and error["path"] == "messages[0].role" for error in result.errors)
    assert any(error["line"] == 4 and error["path"] == "$" for error in result.errors)


def test_unknown_sample_and_message_fields_are_rejected():
    payload = json.dumps({
        "messages": [{"role": "user", "content": "q", "tool_calls": []}, {"role": "assistant", "content": "a"}],
        "preference": "dpo",
    }).encode()
    result = validate_messages_jsonl(payload)
    assert not result.valid
    assert any(error["path"] == "$.preference" for error in result.errors)
    assert any(error["path"] == "messages[0].tool_calls" for error in result.errors)


def test_limits_reject_oversized_line_and_sample_count():
    payload = (json.dumps(sample()) + "\n" + json.dumps(sample()) + "\n").encode()
    result = validate_messages_jsonl(payload, DatasetLimits(max_line_bytes=10))
    assert any(error["line"] == 1 for error in result.errors)
    result = validate_messages_jsonl(payload, DatasetLimits(max_samples=1))
    assert any("超过 1 条" in error["message"] for error in result.errors)


def test_whitespace_only_jsonl_reports_file_level_error():
    result = validate_messages_jsonl(b" \n\t\n")
    assert not result.valid
    assert result.errors == [{"line": 0, "path": "$", "message": "至少需要一条非空 JSONL 记录"}]


def test_surrogate_codepoint_is_rejected_as_invalid_text():
    result = validate_messages_jsonl(b'{"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"\\ud800"}]}\n')
    assert not result.valid
    assert any(error["path"] == "messages[1].content" for error in result.errors)


def test_split_is_deterministic_disjoint_and_keeps_both_sides():
    samples = [{"line": index, "messages": [{"role": "user", "content": str(index)}]} for index in range(1, 11)]
    first = build_split(samples, ratio=0.2, seed=42)
    second = build_split(samples, ratio=0.2, seed=42)
    assert first == second
    assert set(first["train_lines"]).isdisjoint(first["validation_lines"])
    assert set(first["train_lines"]) | set(first["validation_lines"]) == set(range(1, 11))
    assert len(first["validation_lines"]) == 2
    assert first["requested_ratio"] == 0.2
    assert first["actual_ratio"] == 0.2


def test_split_keeps_duplicate_content_in_one_side():
    samples = [
        {"line": 1, "messages": [{"role": "user", "content": "same"}, {"role": "assistant", "content": "answer"}]},
        {"line": 2, "messages": [{"role": "user", "content": "same"}, {"role": "assistant", "content": "answer"}]},
        {"line": 3, "messages": [{"role": "user", "content": "different"}, {"role": "assistant", "content": "answer"}]},
        {"line": 4, "messages": [{"role": "user", "content": "other"}, {"role": "assistant", "content": "answer"}]},
    ]
    result = build_split(samples, ratio=0.3, seed=42)
    assert {1, 2}.issubset(set(result["train_lines"])) or {1, 2}.issubset(set(result["validation_lines"]))


def test_split_rejects_all_duplicate_content():
    samples = [{"line": 1, "messages": [{"role": "user", "content": "same"}]}, {"line": 2, "messages": [{"role": "user", "content": "same"}]}]
    with pytest.raises(ValueError):
        build_split(samples)


def test_split_chooses_small_duplicate_group_near_requested_ratio():
    repeated = [{"line": index, "messages": [{"role": "user", "content": "same"}]} for index in range(1, 20)]
    samples = repeated + [{"line": 20, "messages": [{"role": "user", "content": "unique"}]}]
    result = build_split(samples, ratio=0.1, seed=42)
    assert result["validation_lines"] == [20]
    assert result["actual_ratio"] == 0.05


@pytest.mark.parametrize(
    ("group_sizes", "expected_validation_count"),
    [([2, 8], 2), ([6, 7, 7], 6)],
)
def test_split_chooses_closest_feasible_duplicate_group(group_sizes, expected_validation_count):
    samples = []
    line = 1
    for group_index, size in enumerate(group_sizes):
        for _ in range(size):
            samples.append({"line": line, "messages": [{"role": "user", "content": str(group_index)}]})
            line += 1
    result = build_split(samples, ratio=0.1, seed=42)
    assert len(result["validation_lines"]) == expected_validation_count
    assert set(result["train_lines"]).isdisjoint(result["validation_lines"])


def test_split_rejects_ratio_precision_that_cannot_be_replayed():
    samples = [{"line": index, "messages": [{"role": "user", "content": str(index)}]} for index in range(1, 11)]
    with pytest.raises(ValueError, match="6 位小数"):
        build_split(samples, ratio=0.1234567)


@pytest.mark.parametrize("ratio", [0.01, 0.31, float("nan")])
def test_split_rejects_out_of_range_ratio(ratio):
    with pytest.raises(ValueError):
        build_split([{"line": 1}, {"line": 2}], ratio=ratio)
