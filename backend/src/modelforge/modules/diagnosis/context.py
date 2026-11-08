"""Build a bounded, redacted prompt context from frozen evidence."""
from __future__ import annotations

import json
from typing import Any

from .contracts import (
    BaselineEvidenceProjection,
    ComparisonResult,
    EvidencePack,
    EvidencePackV2,
    GateResult,
    ValidationIssue,
)


def _points(value: Any, limit: int = 80) -> list[Any]:
    if not isinstance(value, list):
        return []
    return value[:limit]


def _adapter_projection(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    allowed = {
        'id',
        'role',
        'state',
        'fingerprint',
        'created_at',
        'metrics',
    }
    return {key: value.get(key) for key in allowed if key in value}


def _inputs(snapshot: Any) -> dict[str, Any]:
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    base = snapshot.get('base') if isinstance(snapshot.get('base'), dict) else {}
    dataset = (
        snapshot.get('dataset')
        if isinstance(snapshot.get('dataset'), dict)
        else {}
    )
    config = (
        snapshot.get('config')
        if isinstance(snapshot.get('config'), dict)
        else {}
    )
    return {
        'base': {
            key: base.get(key)
            for key in ('id', 'name', 'fingerprint', 'source_kind')
            if key in base
        },
        'dataset': {
            key: dataset.get(key)
            for key in ('id', 'name', 'sample_count', 'sha256', 'split_sha256')
            if key in dataset
        },
        'config': config,
    }


def _facts_context(facts: Any) -> dict[str, Any]:
    facts = facts if isinstance(facts, dict) else {}
    metrics = facts.get('metrics') if isinstance(facts.get('metrics'), dict) else {}
    runtime = facts.get('runtime') if isinstance(facts.get('runtime'), dict) else {}
    memory = facts.get('memory') if isinstance(facts.get('memory'), dict) else {}
    token = (
        facts.get('token_preflight')
        if isinstance(facts.get('token_preflight'), dict)
        else {}
    )
    manifest = facts.get('manifest') if isinstance(facts.get('manifest'), dict) else {}
    logs = facts.get('logs') if isinstance(facts.get('logs'), dict) else {}
    adapters = facts.get('adapters') if isinstance(facts.get('adapters'), dict) else {}
    snapshot = facts.get('snapshot') if isinstance(facts.get('snapshot'), dict) else {}
    return {
        'attempt': facts.get('attempt'),
        'inputs': _inputs(snapshot),
        'metrics': {
            'counts': metrics.get('counts'),
            'train_points': _points(metrics.get('points')),
            'latest_eval': metrics.get('latest_eval'),
            'lowest_eval': metrics.get('lowest_eval'),
        },
        'token_preflight': token,
        'runtime': {
            key: runtime.get(key)
            for key in (
                'phase',
                'ready',
                'lock_id',
                'lock_sha256',
                'gpu',
                'python',
                'cuda',
                'mismatches',
            )
            if key in runtime
        },
        'memory': memory,
        'manifest': {
            'diagnostic_gap': manifest.get('diagnostic_gap'),
            'code': manifest.get('code'),
            'files': [
                {
                    key: item.get(key)
                    for key in ('path', 'size', 'sha256')
                    if key in item
                }
                for item in (manifest.get('files') or [])[:40]
                if isinstance(item, dict)
            ],
        },
        'logs': {
            'chunks_received': logs.get('chunks_received'),
            'gap': logs.get('gap'),
            'excerpt': logs.get('excerpt'),
        },
        'adapters': {
            'best': _adapter_projection(adapters.get('best')),
            'final': _adapter_projection(adapters.get('final')),
        },
        'inference_trials': (
            facts.get('inference_trials')[:20]
            if isinstance(facts.get('inference_trials'), list)
            else facts.get('inference_trials')
        ),
        'inference_acceptance': facts.get('inference_acceptance'),
    }


def _evidence_ref(item, scope: str) -> dict[str, Any]:
    return {
        'id': item.id,
        'kind': item.kind,
        'scope': scope,
        'source_locator': item.source_locator,
        'field_path': item.field_path,
        'coverage': item.coverage,
        'unavailable_reason': item.unavailable_reason,
        'observed_at': item.observed_at.isoformat() if item.observed_at else None,
        'source_digest': item.source_digest,
        'excerpt': item.excerpt,
    }


def build_context(
    pack: EvidencePack | EvidencePackV2,
    gate: GateResult,
    *,
    repair_issues: list[ValidationIssue] | None = None,
    previous_candidate: dict[str, Any] | None = None,
    comparison: ComparisonResult | None = None,
    baseline_gate: GateResult | None = None,
) -> str:
    facts = pack.facts if isinstance(pack.facts, dict) else {}
    comparison = (
        comparison
        or (
            pack.comparison.comparison_result
            if isinstance(pack, EvidencePackV2) and pack.comparison is not None
            else None
        )
    )
    baseline: BaselineEvidenceProjection | None = (
        pack.comparison.baseline
        if isinstance(pack, EvidencePackV2) and pack.comparison is not None
        else None
    )
    baseline_gate = baseline_gate or (baseline.gate if baseline is not None else None)

    boundaries = [
        'task metric、throughput、gradient norm、逐样本 loss、重复率、语言分布均未上报',
        '不得根据 Train/Eval Loss 推断业务效果或模型可用性',
    ]
    acceptance = facts.get('inference_acceptance')
    if not acceptance:
        boundaries.append('当前没有当前 Adapter 的独立推理验收记录')
    if gate.delivery_status == 'artifact_deliverable_model_unverified':
        boundaries.append(
            '产物可下发不等于模型可用；当前 Best/Final 没有匹配当前 Adapter '
            'ID 与 fingerprint 的独立推理验收'
        )
        if acceptance:
            boundaries.append(
                '即使 inference_acceptance 中存在其他 Adapter 的记录，也不能把'
                '该验收转移给当前 Best/Final，不能声称推理验收通过'
            )
    if comparison is None or comparison.comparability_status == 'no_baseline':
        boundaries.append('没有可比历史基线，不得生成“比上次更好/更差”的事实断言')
    else:
        boundaries.append(
            '训练信号与交付信号来自确定性 ComparisonEngine；模型效果固定为 '
            'unverified，除非存在同一测试集、同一指标和可比较分数的独立评测'
        )
        boundaries.append(
            '所有比较差值只能引用 comparison 中预计算的值，不能自行计算百分比'
        )
        if comparison.model_effect.status == 'unverified':
            boundaries.append('不得写“模型效果更好”“微调成功”“可以上线”')
        if comparison.confidence == 'low':
            boundaries.append('低置信度时不得写“稳定改善”或“明确提升”')
        if any(
            item.code == 'multiple_parameters_changed'
            for item in comparison.confounders
        ):
            boundaries.append('多个参数共同变化，不得归因给单一参数')

    subject_refs = [
        _evidence_ref(item, 'subject') for item in pack.evidence
    ]
    baseline_refs = (
        [_evidence_ref(item, 'baseline') for item in baseline.evidence]
        if baseline is not None else []
    )
    comparison_refs = [
        _evidence_ref(item, 'comparison')
        for item in pack.evidence
        if item.kind == 'comparison'
    ]
    allowed_evidence_ids = list(dict.fromkeys(
        item['id'] for item in subject_refs + baseline_refs + comparison_refs
    ))

    context = {
        'schema': 'diagnosis-prompt-context-v2',
        'attempt': _facts_context(facts),
        'baseline': (
            {
                **_facts_context(baseline.facts),
                'gate': baseline.gate.model_dump(mode='json'),
                'source_revision': baseline.source_revision.model_dump(mode='json'),
            }
            if baseline is not None else None
        ),
        'baseline_gate': (
            baseline_gate.model_dump(mode='json')
            if baseline_gate is not None else None
        ),
        'comparison': (
            comparison.model_dump(mode='json')
            if comparison is not None else None
        ),
        'current_adapter_acceptance': {
            'matched': gate.delivery_status == 'ready_for_release_review',
            'note': (
                'current_adapter_acceptance_matched'
                if gate.delivery_status == 'ready_for_release_review'
                else 'current_adapter_acceptance_not_matched'
            ),
        },
        'coverage': [
            item.model_dump(mode='json') for item in pack.coverage
        ],
        'baseline_coverage': (
            [item.model_dump(mode='json') for item in baseline.coverage]
            if baseline is not None else []
        ),
        'evidence_refs': subject_refs + baseline_refs + comparison_refs,
        'allowed_evidence_ids': allowed_evidence_ids,
        'gate': gate.model_dump(mode='json'),
        'boundaries': boundaries,
    }
    if repair_issues:
        context['repair_issues'] = [
            item.model_dump(mode='json') for item in repair_issues
        ]
        context['previous_candidate'] = previous_candidate
    return json.dumps(context, ensure_ascii=False, separators=(',', ':'))
