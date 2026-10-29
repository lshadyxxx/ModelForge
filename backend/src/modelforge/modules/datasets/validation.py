"""messages JSONL validation and deterministic DatasetVersion splitting."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import random
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any


@dataclass(frozen=True)
class DatasetLimits:
    max_bytes: int = 100 * 1024 * 1024
    max_samples: int = 100_000
    max_line_bytes: int = 1 * 1024 * 1024
    max_errors: int = 100
    preview_samples: int = 20


@dataclass(frozen=True)
class ValidationResult:
    samples: list[dict[str, Any]]
    preview: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    sha256: str
    size_bytes: int
    line_count: int

    @property
    def valid(self) -> bool:
        return not self.errors and bool(self.samples)


def _error(line: int, path: str, message: str) -> dict[str, Any]:
    return {"line": line, "path": path, "message": message}


def _validate_sample(value: Any, line: int) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return None, [_error(line, "$", "每行必须是 JSON 对象")]
    unknown_sample_keys = sorted(set(value) - {"messages"})
    if unknown_sample_keys:
        errors.extend(_error(line, f"$.{key}", "不支持的字段") for key in unknown_sample_keys)
    messages = value.get("messages")
    if not isinstance(messages, list) or not messages:
        return None, [_error(line, "messages", "必须是非空数组")]
    roles = {"system", "user", "assistant"}
    normalized: list[dict[str, str]] = []
    for index, message in enumerate(messages):
        path = f"messages[{index}]"
        if not isinstance(message, dict):
            errors.append(_error(line, path, "消息必须是对象"))
            continue
        unknown_message_keys = sorted(set(message) - {"role", "content"})
        errors.extend(_error(line, f"{path}.{key}", "不支持的字段") for key in unknown_message_keys)
        role, content = message.get("role"), message.get("content")
        if not isinstance(role, str) or role not in roles:
            errors.append(_error(line, f"{path}.role", "只支持 system、user、assistant"))
        if not isinstance(content, str) or not content.strip():
            errors.append(_error(line, f"{path}.content", "必须是非空文本"))
        elif any(0xD800 <= ord(character) <= 0xDFFF for character in content):
            errors.append(_error(line, f"{path}.content", "不支持 Unicode 代理字符"))
        if isinstance(role, str) and isinstance(content, str) and content.strip() and role in roles:
            if not any(0xD800 <= ord(character) <= 0xDFFF for character in content):
                normalized.append({"role": role, "content": content})
    system_positions = [index for index, message in enumerate(messages)
                        if isinstance(message, dict) and message.get("role") == "system"]
    if len(system_positions) > 1:
        errors.append(_error(line, "messages", "system 消息最多只能有一条且必须位于开头"))
    elif system_positions and system_positions[0] != 0:
        errors.append(_error(line, "messages", "system 消息必须位于开头"))
    if not any(message["role"] == "user" for message in normalized):
        errors.append(_error(line, "messages", "至少需要一条 user 消息"))
    if not any(message["role"] == "assistant" for message in normalized):
        errors.append(_error(line, "messages", "至少需要一条 assistant 消息"))
    elif normalized[-1]["role"] != "assistant":
        errors.append(_error(line, "messages", "最后一条消息必须是 assistant"))
    if errors:
        return None, errors
    return {"line": line, "messages": normalized}, []


def validate_messages_jsonl(data: bytes, limits: DatasetLimits = DatasetLimits()) -> ValidationResult:
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > limits.max_bytes:
        return ValidationResult([], [], [_error(0, "$", f"文件超过 {limits.max_bytes} bytes 限制")], digest, len(data), 0)
    samples: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    physical_lines = data.splitlines(keepends=True)
    for line_number, raw_line in enumerate(physical_lines, 1):
        if len(raw_line.rstrip(b"\r\n")) > limits.max_line_bytes:
            errors.append(_error(line_number, "$", f"物理行超过 {limits.max_line_bytes} bytes 限制"))
            if len(errors) >= limits.max_errors:
                break
            continue
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line.decode("utf-8"))
        except UnicodeDecodeError:
            errors.append(_error(line_number, "$", "文件必须是 UTF-8"))
            continue
        except json.JSONDecodeError as exc:
            errors.append(_error(line_number, "$", f"JSON 无效：{exc.msg}"))
            continue
        sample, sample_errors = _validate_sample(value, line_number)
        if sample_errors:
            errors.extend(sample_errors)
        elif sample is not None:
            samples.append(sample)
            if len(samples) > limits.max_samples:
                errors.append(_error(line_number, "$", f"有效样本超过 {limits.max_samples} 条限制"))
                break
        if len(errors) >= limits.max_errors:
            break
    if not samples and not errors:
        errors.append(_error(0, "$", "至少需要一条非空 JSONL 记录"))
    return ValidationResult(samples, samples[: limits.preview_samples], errors[: limits.max_errors], digest, len(data), len(physical_lines))


def build_split(samples: list[dict[str, Any]], ratio: float = 0.1, seed: int = 42) -> dict[str, Any]:
    try:
        requested_ratio = Decimal(str(ratio))
    except (InvalidOperation, ValueError):
        raise ValueError("验证比例必须是数字") from None
    if not requested_ratio.is_finite():
        raise ValueError("验证比例必须是有限数字")
    if not Decimal("0.05") <= requested_ratio <= Decimal("0.30"):
        raise ValueError("验证比例必须在 5% 到 30% 之间")
    if requested_ratio != requested_ratio.quantize(Decimal("0.000001")):
        raise ValueError("验证比例最多支持 6 位小数")
    ratio = float(requested_ratio)
    if len(samples) < 2:
        raise ValueError("至少需要 2 条有效样本才能划分训练集和验证集")
    validation_count = max(1, round(len(samples) * ratio))
    validation_count = min(validation_count, len(samples) - 1)
    groups: dict[str, list[int]] = defaultdict(list)
    for index, sample in enumerate(samples):
        canonical = json.dumps(sample["messages"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        groups[hashlib.sha256(canonical).hexdigest()].append(index)
    if len(groups) < 2:
        raise ValueError("无法在不拆分相同内容组的情况下形成独立训练集和验证集")
    grouped_indices = list(groups.values())
    random.Random(seed).shuffle(grouped_indices)
    grouped_indices.sort(key=len)
    target_cap = min(len(samples) - 1, validation_count + min(map(len, grouped_indices)))

    # Small group sets are solved exactly so a large duplicate group may still
    # be selected when it is the closest valid split (for example [2, 8] for
    # ten samples at the default 10% request). Large files use the bounded
    # greedy fallback to keep split creation linear in the number of groups.
    selected_group_indices: tuple[int, ...] | None = None
    if len(grouped_indices) <= 2048 and target_cap <= 20_000:
        reachable: dict[int, tuple[int, ...]] = {0: ()}
        for group_index, group in enumerate(grouped_indices):
            size = len(group)
            for total, chosen in list(reachable.items()):
                candidate = total + size
                if candidate > target_cap or candidate >= len(samples) or candidate in reachable:
                    continue
                reachable[candidate] = chosen + (group_index,)
            if validation_count in reachable:
                break
        best_total = min(
            reachable,
            key=lambda total: (abs(total - validation_count), total > validation_count, total),
        )
        if best_total:
            selected_group_indices = reachable[best_total]
    else:
        selected: list[int] = []
        selected_group_indices_list: list[int] = []
        remaining = validation_count
        for group_index, group in enumerate(grouped_indices):
            if remaining <= 0:
                break
            if len(group) > remaining or len(selected) + len(group) >= len(samples):
                continue
            selected.extend(group)
            selected_group_indices_list.append(group_index)
            remaining -= len(group)
        if selected:
            selected_group_indices = tuple(selected_group_indices_list)

    if not selected_group_indices:
        # The exact path above normally handles this case. Keep a deterministic
        # fallback for large inputs where the bounded greedy pass found no
        # under-target group.
        smallest = min(enumerate(grouped_indices), key=lambda item: len(item[1]))
        if len(smallest[1]) >= len(samples):
            raise ValueError("无法在保留训练样本的情况下形成验证集")
        selected_group_indices = (smallest[0],)

    selected = [item for index in selected_group_indices for item in grouped_indices[index]]
    if not selected or len(selected) >= len(samples):
        raise ValueError("无法在保留训练样本的情况下形成验证集")
    validation_indices = sorted(selected)
    validation_set = set(validation_indices)
    train_indices = [index for index in range(len(samples)) if index not in validation_set]
    train_lines = [samples[index]["line"] for index in train_indices]
    validation_lines = [samples[index]["line"] for index in validation_indices]
    actual_ratio = len(validation_indices) / len(samples)
    manifest = {
        "seed": seed,
        "requested_ratio": ratio,
        "ratio": actual_ratio,
        "actual_ratio": actual_ratio,
        "sample_count": len(samples),
        "validation_count": len(validation_indices),
        "train_lines": train_lines,
        "validation_lines": validation_lines,
    }
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest["sha256"] = hashlib.sha256(encoded).hexdigest()
    return manifest
