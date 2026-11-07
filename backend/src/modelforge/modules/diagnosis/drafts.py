"""Unsubmitted training-draft projection for accepted report experiments."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from modelforge.errors import AppError


_PATCH_KEYS = {
    'epochs',
    'num_train_epochs',
    'learning_rate',
    'cutoff_len',
    'batch_size',
    'per_device_train_batch_size',
    'gradient_accumulation',
    'gradient_accumulation_steps',
    'lora_rank',
    'lora_alpha',
    'lora_dropout',
    'scheduler',
    'warmup_ratio',
    'seed',
    'template',
}

_ALIASES = {
    'num_train_epochs': 'epochs',
    'per_device_train_batch_size': 'batch_size',
    'gradient_accumulation_steps': 'gradient_accumulation',
}


def build_training_draft(
    report: dict[str, Any],
    *,
    experiment_id: str,
    base_config: dict[str, Any],
) -> dict[str, Any]:
    experiment = next(
        (
            item
            for item in report.get('next_experiments', [])
            if item.get('id') == experiment_id
        ),
        None,
    )
    if experiment is None:
        raise AppError(404, 'not_found', 'Suggested experiment not found')
    patch = experiment.get('config_patch')
    if not isinstance(patch, dict) or not patch:
        raise AppError(
            422,
            'draft_patch_unavailable',
            '该建议没有可应用的配置草稿。',
        )
    unknown = sorted(set(patch) - _PATCH_KEYS)
    if unknown:
        raise AppError(
            422,
            'draft_patch_not_allowed',
            '建议包含不允许写入训练草稿的字段。',
            {'fields': unknown},
        )
    config = deepcopy(base_config)
    normalized: dict[str, Any] = {}
    for key, value in patch.items():
        target = _ALIASES.get(key, key)
        normalized[target] = value
        config[target] = value
    return {
        'status': 'unsubmitted_draft',
        'report_id': report['id'],
        'attempt_id': report['attempt_id'],
        'experiment_id': experiment_id,
        'base_attempt_config': deepcopy(base_config),
        'config_patch': normalized,
        'draft_config': config,
        'notice': '仅生成未提交草稿；不会回写历史 Attempt、创建 GPU 或提交训练。',
    }
