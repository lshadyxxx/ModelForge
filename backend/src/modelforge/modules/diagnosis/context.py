"""Build a bounded, redacted prompt context from frozen evidence."""
from __future__ import annotations

import json
from typing import Any

from .contracts import EvidencePack, GateResult, ValidationIssue


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


def build_context(
    pack: EvidencePack,
    gate: GateResult,
    *,
    repair_issues: list[ValidationIssue] | None = None,
    previous_candidate: dict[str, Any] | None = None,
) -> str:
    facts = pack.facts if isinstance(pack.facts, dict) else {}
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
    trials = facts.get('inference_trials')
    acceptance = facts.get('inference_acceptance')
    snapshot = facts.get('snapshot') if isinstance(facts.get('snapshot'), dict) else {}
    config = snapshot.get('config') if isinstance(snapshot.get('config'), dict) else {}
    base = snapshot.get('base') if isinstance(snapshot.get('base'), dict) else {}
    dataset = snapshot.get('dataset') if isinstance(snapshot.get('dataset'), dict) else {}

    boundaries = [
        'task metric、throughput、gradient norm、逐样本 loss、重复率、语言分布均未上报',
        '不得根据 Train/Eval Loss 推断业务效果或模型可用性',
    ]
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

    context = {
        'schema': 'diagnosis-prompt-context-v1',
        'attempt': facts.get('attempt'),
        'inputs': {
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
        },
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
        'inference_trials': trials[:20] if isinstance(trials, list) else trials,
        'inference_acceptance': acceptance,
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
        'evidence_refs': [
            {
                'id': item.id,
                'kind': item.kind,
                'source_locator': item.source_locator,
                'field_path': item.field_path,
                'coverage': item.coverage,
                'unavailable_reason': item.unavailable_reason,
                'observed_at': item.observed_at.isoformat() if item.observed_at else None,
                'source_digest': item.source_digest,
                'excerpt': item.excerpt,
            }
            for item in pack.evidence
        ],
        'allowed_evidence_ids': [item.id for item in pack.evidence],
        'gate': gate.model_dump(mode='json'),
        'boundaries': boundaries,
    }
    if repair_issues:
        context['repair_issues'] = [
            item.model_dump(mode='json') for item in repair_issues
        ]
        context['previous_candidate'] = previous_candidate
    return json.dumps(context, ensure_ascii=False, separators=(',', ':'))
