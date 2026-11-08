"""Deterministic historical comparison for training diagnosis.

The engine has no I/O and never calls a model. It is the only component
allowed to choose the primary metric, classify a signal or set confidence.
"""
from __future__ import annotations

import math
from typing import Any

from .contracts import (
    BaselineEvidenceProjection,
    BaselineSelection,
    ComparabilityStatus,
    ComparisonConfidence,
    ComparisonGroup,
    ComparisonResult,
    Confounder,
    DeliverySignal,
    EvidencePack,
    EvidencePackV2,
    GateResult,
    MetricDelta,
    ModelEffect,
    ParameterChange,
    TrainingSignal,
)


POLICY_VERSION = 'training-comparison-policy-v1'
RELATIVE_EVAL_EPSILON = 0.02

COMPARISON_EVIDENCE_IDS = (
    'E-COMPARE-METRIC-BEST-EVAL',
    'E-COMPARE-METRIC-FINAL-EVAL',
    'E-COMPARE-PARAMETERS',
    'E-COMPARE-CONFOUNDERS',
    'E-COMPARE-CONCLUSION',
)

_PARAMETER_CLASSIFICATION = {
    'learning_rate': 'optimization',
    'lora_rank': 'optimization',
    'lora_alpha': 'optimization',
    'lora_dropout': 'optimization',
    'scheduler': 'optimization',
    'warmup_ratio': 'optimization',
    'epochs': 'budget',
    'batch_size': 'budget',
    'gradient_accumulation': 'budget',
    'cutoff_len': 'input_processing',
    'template': 'input_processing',
    'seed': 'stochasticity',
}

_DELIVERY_RANK = {
    'not_deliverable': 0,
    'artifact_deliverable_model_unverified': 1,
    'ready_for_release_review': 2,
}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    return value


def _float(value: Any) -> float | None:
    number = _number(value)
    return float(number) if number is not None else None


def _facts(pack: EvidencePack | EvidencePackV2 | BaselineEvidenceProjection) -> dict[str, Any]:
    return _as_dict(getattr(pack, 'facts', None))


def _snapshot(facts: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(facts.get('snapshot'))


def comparison_group(facts: dict[str, Any]) -> ComparisonGroup:
    snapshot = _snapshot(facts)
    base = _as_dict(snapshot.get('base'))
    dataset = _as_dict(snapshot.get('dataset'))
    return ComparisonGroup(
        base_fingerprint=str(base.get('fingerprint') or ''),
        dataset_sha256=str(dataset.get('sha256') or ''),
        dataset_split_sha256=str(dataset.get('split_sha256') or ''),
    )


def parameter_changes(
    baseline_facts: dict[str, Any],
    subject_facts: dict[str, Any],
) -> list[ParameterChange]:
    baseline = _as_dict(_snapshot(baseline_facts).get('config'))
    subject = _as_dict(_snapshot(subject_facts).get('config'))
    changes: list[ParameterChange] = []
    for field, classification in _PARAMETER_CLASSIFICATION.items():
        baseline_value = baseline.get(field)
        subject_value = subject.get(field)
        if baseline_value == subject_value:
            continue
        changes.append(ParameterChange(
            field=field,
            baseline_value=baseline_value,
            subject_value=subject_value,
            classification=classification,
        ))
    return changes


def _metric_counts(facts: dict[str, Any]) -> dict[str, int]:
    metrics = _as_dict(facts.get('metrics'))
    counts = _as_dict(metrics.get('counts'))
    return {
        key: int(counts.get(key) or 0)
        for key in ('train', 'eval', 'learning_rate')
    }


def _adapter(facts: dict[str, Any], role: str) -> dict[str, Any] | None:
    adapters = _as_dict(facts.get('adapters'))
    adapter = adapters.get(role)
    return adapter if isinstance(adapter, dict) else None


def _adapter_eval(facts: dict[str, Any], role: str) -> float | None:
    adapter = _adapter(facts, role)
    if adapter is None or adapter.get('state') != 'available':
        return None
    metrics = _as_dict(adapter.get('metrics'))
    return _float(metrics.get('eval_loss'))


def _available_adapter_roles(facts: dict[str, Any]) -> set[str]:
    return {
        role
        for role in ('best', 'final')
        if (_adapter(facts, role) or {}).get('state') == 'available'
    }


def _eval_count(facts: dict[str, Any]) -> int:
    count = _metric_counts(facts)['eval']
    if count:
        return count
    return int(any(
        _adapter_eval(facts, role) is not None
        for role in ('best', 'final')
    ))


def _runtime(facts: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(facts.get('runtime'))


def _memory(facts: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(facts.get('memory'))


def _logs(facts: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(facts.get('logs'))


def _token_overflow_count(facts: dict[str, Any]) -> int | None:
    token = _as_dict(facts.get('token_preflight'))
    if not token:
        return None
    overflow = token.get('overflow')
    if isinstance(overflow, list):
        return len(overflow)
    value = token.get('overflow_count')
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None


def _latest_eval(facts: dict[str, Any]) -> float | None:
    metrics = _as_dict(facts.get('metrics'))
    latest = _as_dict(metrics.get('latest_eval'))
    return _float(latest.get('eval_loss'))


def _lowest_eval(facts: dict[str, Any]) -> float | None:
    metrics = _as_dict(facts.get('metrics'))
    lowest = _as_dict(metrics.get('lowest_eval'))
    return _float(lowest.get('eval_loss'))


def _final_train(facts: dict[str, Any]) -> float | None:
    metrics = _as_dict(facts.get('metrics'))
    point = _as_dict(metrics.get('last_train'))
    return _float(point.get('loss'))


def _gpu_identity(facts: dict[str, Any]) -> str | None:
    runtime = _runtime(facts)
    snapshot = _snapshot(facts)
    instance = _as_dict(snapshot.get('instance'))
    for value in (
        runtime.get('gpu'),
        instance.get('gpu_type'),
        instance.get('gpu_name'),
        instance.get('gpu'),
    ):
        if isinstance(value, str) and value:
            return value
    return None


def _image_identity(facts: dict[str, Any]) -> str | None:
    profile = _as_dict(_snapshot(facts).get('training_image_profile'))
    for key in ('id', 'profiles_sha256', 'image_id'):
        value = profile.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _adapter_role_for_eval(facts: dict[str, Any]) -> str | None:
    for role in ('best', 'final'):
        if _adapter_eval(facts, role) is not None:
            return role
    return None


def _confounders(
    subject_facts: dict[str, Any],
    baseline_facts: dict[str, Any],
    changes: list[ParameterChange],
) -> list[Confounder]:
    result: list[Confounder] = []

    def add(
        code: str,
        text: str,
        *,
        field: str | None = None,
        baseline_value: Any = None,
        subject_value: Any = None,
    ):
        result.append(Confounder(
            code=code,
            field=field,
            baseline_value=baseline_value,
            subject_value=subject_value,
            text=text,
        ))

    subject_runtime = _runtime(subject_facts)
    baseline_runtime = _runtime(baseline_facts)
    subject_lock = (
        subject_runtime.get('lock_sha256')
        or subject_runtime.get('lock_id')
    )
    baseline_lock = (
        baseline_runtime.get('lock_sha256')
        or baseline_runtime.get('lock_id')
    )
    if subject_lock != baseline_lock and (
        subject_lock is not None or baseline_lock is not None
    ):
        add(
            'runtime_lock_changed',
            'Runtime lock 不一致，运行环境不是严格同一版本。',
            field='runtime.lock',
            baseline_value=baseline_lock,
            subject_value=subject_lock,
        )

    subject_image = _image_identity(subject_facts)
    baseline_image = _image_identity(baseline_facts)
    if subject_image != baseline_image and (
        subject_image is not None or baseline_image is not None
    ):
        add(
            'training_image_changed',
            '训练镜像 profile 不一致，运行环境存在混杂。',
            field='snapshot.training_image_profile',
            baseline_value=baseline_image,
            subject_value=subject_image,
        )

    subject_gpu = _gpu_identity(subject_facts)
    baseline_gpu = _gpu_identity(baseline_facts)
    if subject_gpu != baseline_gpu and (
        subject_gpu is not None or baseline_gpu is not None
    ):
        add(
            'gpu_changed',
            'GPU 型号不一致，不能把结果变化归因给训练参数。',
            field='runtime.gpu',
            baseline_value=baseline_gpu,
            subject_value=subject_gpu,
        )

    changed_fields = {item.field for item in changes}
    if 'template' in changed_fields:
        add(
            'template_changed',
            '对话模板发生变化，监督输入并非完全相同。',
            field='config.template',
        )
    if 'seed' in changed_fields:
        add(
            'seed_changed',
            '随机种子发生变化，不能排除随机波动。',
            field='config.seed',
        )
    if 'cutoff_len' in changed_fields:
        add(
            'cutoff_changed',
            '截断长度发生变化，Token 化与监督内容可能不同。',
            field='config.cutoff_len',
        )
    non_seed = [
        item for item in changes
        if item.field != 'seed'
    ]
    if len(non_seed) > 1:
        add(
            'multiple_parameters_changed',
            '多项训练参数共同变化，不能将结果归因给单一参数。',
            field='config',
        )

    subject_roles = _available_adapter_roles(subject_facts)
    baseline_roles = _available_adapter_roles(baseline_facts)
    if subject_roles and baseline_roles and subject_roles != baseline_roles:
        add(
            'adapter_role_mismatch',
            '两次运行的可用 Adapter role 不一致，交付状态不能直接等价。',
            field='adapters',
            baseline_value=sorted(baseline_roles),
            subject_value=sorted(subject_roles),
        )

    subject_eval = _eval_count(subject_facts)
    baseline_eval = _eval_count(baseline_facts)
    if baseline_eval == 0:
        add(
            'baseline_metrics_missing',
            '历史基线没有可读 Eval Loss，无法形成训练信号。',
            field='adapters.metrics.eval_loss',
        )
    if subject_eval == 0:
        add(
            'subject_metrics_missing',
            '当前运行没有可读 Eval Loss，无法形成训练信号。',
            field='adapters.metrics.eval_loss',
        )
    if 0 < subject_eval < 2 or 0 < baseline_eval < 2:
        add(
            'eval_coverage_low',
            '至少一侧只有 1 个 Eval 采样点，只能给出低置信度判断。',
            field='metrics.counts.eval',
            baseline_value=baseline_eval,
            subject_value=subject_eval,
        )
    return result


def _regressions(
    subject_facts: dict[str, Any],
    subject_gate: GateResult,
    baseline_facts: dict[str, Any],
    baseline_gate: GateResult,
) -> list[dict[str, Any]]:
    regressions: list[dict[str, Any]] = []

    def add(code: str, text: str, baseline_value: Any, subject_value: Any):
        regressions.append({
            'code': code,
            'text': text,
            'baseline_value': baseline_value,
            'subject_value': subject_value,
        })

    if (
        subject_gate.health_status == 'blocked'
        and baseline_gate.health_status != 'blocked'
    ):
        add('health_blocked', '当前训练健康度新增阻断。', baseline_gate.health_status, subject_gate.health_status)

    subject_mismatch = len(_runtime(subject_facts).get('mismatches') or [])
    baseline_mismatch = len(_runtime(baseline_facts).get('mismatches') or [])
    if subject_mismatch > baseline_mismatch:
        add('runtime_mismatch', '当前运行新增 Runtime mismatch。', baseline_mismatch, subject_mismatch)

    subject_ready = _runtime(subject_facts).get('ready')
    baseline_ready = _runtime(baseline_facts).get('ready')
    if subject_ready is False and baseline_ready is not False:
        add('runtime_not_ready', '当前 Runtime 从可用变为未 ready。', baseline_ready, subject_ready)

    subject_overflow = _token_overflow_count(subject_facts)
    baseline_overflow = _token_overflow_count(baseline_facts)
    if (
        subject_overflow is not None
        and baseline_overflow is not None
        and subject_overflow > baseline_overflow
    ):
        add('token_overflow_increased', 'Token 溢出数量增加。', baseline_overflow, subject_overflow)

    subject_sampler_error = bool(_memory(subject_facts).get('sampler_error'))
    baseline_sampler_error = bool(_memory(baseline_facts).get('sampler_error'))
    if subject_sampler_error and not baseline_sampler_error:
        add('memory_sampler_error', '当前显存采样出现新错误。', baseline_sampler_error, subject_sampler_error)

    subject_log_gap = bool(_logs(subject_facts).get('gap'))
    baseline_log_gap = bool(_logs(baseline_facts).get('gap'))
    if subject_log_gap and not baseline_log_gap:
        add('logs_gap', '当前训练日志新增缺口。', baseline_log_gap, subject_log_gap)

    subject_blocking = sum(
        1 for item in subject_gate.conflicts if item.blocking
    )
    baseline_blocking = sum(
        1 for item in baseline_gate.conflicts if item.blocking
    )
    if subject_blocking > baseline_blocking:
        add('blocking_conflict', '当前证据新增阻断性冲突。', baseline_blocking, subject_blocking)
    return regressions


def _metric_delta(
    name: str,
    subject_value: float | int | None,
    baseline_value: float | int | None,
    *,
    evidence_ids: list[str],
    unit_relative: bool = True,
) -> MetricDelta:
    absolute: float | int | None = None
    relative: float | None = None
    if subject_value is not None and baseline_value is not None:
        absolute = subject_value - baseline_value
        if unit_relative and float(baseline_value) != 0:
            relative = float(absolute) / float(baseline_value)
    return MetricDelta(
        name=name,
        subject_value=subject_value,
        baseline_value=baseline_value,
        absolute_delta=absolute,
        relative_delta=relative,
        better_direction='lower',
        evidence_ids=list(dict.fromkeys(evidence_ids)),
    )


def _training_signal(
    eval_signal: TrainingSignal,
    regressions: list[dict[str, Any]],
) -> TrainingSignal:
    if eval_signal == 'inconclusive':
        return 'inconclusive'
    if eval_signal == 'worsened':
        return 'worsened'
    if regressions:
        return 'mixed'
    return eval_signal


def _delivery_signal(
    subject_gate: GateResult,
    baseline_gate: GateResult,
) -> DeliverySignal:
    baseline = baseline_gate.delivery_status
    subject = subject_gate.delivery_status
    if baseline not in _DELIVERY_RANK or subject not in _DELIVERY_RANK:
        return 'inconclusive'
    if baseline == subject:
        return 'same'
    return (
        'improved'
        if _DELIVERY_RANK[subject] > _DELIVERY_RANK[baseline]
        else 'worsened'
    )


def _confidence(
    *,
    status: ComparabilityStatus,
    eval_signal: TrainingSignal,
    subject_facts: dict[str, Any],
    baseline_facts: dict[str, Any],
    changes: list[ParameterChange],
    confounders: list[Confounder],
    regressions: list[dict[str, Any]],
    role_mismatch: bool,
) -> ComparisonConfidence:
    if status in {'no_baseline', 'not_comparable'} or eval_signal == 'inconclusive':
        return 'none'
    subject_eval = _eval_count(subject_facts)
    baseline_eval = _eval_count(baseline_facts)
    minimum = min(subject_eval, baseline_eval)
    non_seed = [item for item in changes if item.field != 'seed']
    environment_codes = {
        'runtime_lock_changed',
        'training_image_changed',
        'gpu_changed',
        'template_changed',
    }
    environment_changed = any(
        item.code in environment_codes for item in confounders
    )
    if (
        status == 'strict'
        and minimum >= 3
        and len(non_seed) == 1
        and not environment_changed
        and not role_mismatch
    ):
        return 'high'
    blocking_regressions = [
        item for item in regressions
        if item.get('code') in {
            'health_blocked',
            'runtime_mismatch',
            'blocking_conflict',
        }
    ]
    if (
        minimum >= 2
        and len(non_seed) <= 2
        and not blocking_regressions
        and not role_mismatch
    ):
        return 'medium'
    return 'low'


class ComparisonEngine:
    """Compute an auditable comparison without SQL, LLM or side effects."""

    policy_version = POLICY_VERSION

    def compare(
        self,
        subject_pack: EvidencePack | EvidencePackV2,
        subject_gate: GateResult,
        *,
        baseline: BaselineEvidenceProjection | None = None,
        selection: BaselineSelection | None = None,
    ) -> ComparisonResult:
        subject_facts = _facts(subject_pack)
        group = comparison_group(subject_facts)
        selection = selection or BaselineSelection(
            mode='none',
            selection_rule='none',
        )
        if baseline is None or selection.mode == 'none':
            result = ComparisonResult(
                policy_version=self.policy_version,
                group=group,
                selection=(
                    selection
                    if baseline is None
                    else BaselineSelection(mode='none', selection_rule='none')
                ),
                comparability_status='no_baseline',
                confidence='none',
                training_signal='inconclusive',
                delivery_signal='inconclusive',
                model_effect=ModelEffect(
                    status='unverified',
                    reason='no_comparable_downstream_evaluation',
                    note='没有可比基线，也没有同一独立评测集上的可比较分数。',
                ),
                reason_codes=['comparison_not_requested_or_unavailable'],
                evidence_ids=['E-ATTEMPT', 'E-METRICS'],
            )
            return result.with_digest()

        baseline_facts = _facts(baseline)
        baseline_group = comparison_group(baseline_facts)
        if baseline_group != group:
            result = ComparisonResult(
                policy_version=self.policy_version,
                group=group,
                selection=selection,
                comparability_status='not_comparable',
                confidence='none',
                training_signal='inconclusive',
                delivery_signal='inconclusive',
                model_effect=ModelEffect(
                    status='unverified',
                    reason='no_comparable_downstream_evaluation',
                    note='基座、数据集或 split 不满足硬可比条件。',
                ),
                reason_codes=['hard_key_mismatch'],
                evidence_ids=['E-ATTEMPT', 'E-BASE-ATTEMPT'],
            )
            return result.with_digest()

        changes = parameter_changes(baseline_facts, subject_facts)
        confounders = _confounders(subject_facts, baseline_facts, changes)
        status: ComparabilityStatus = (
            'conditional' if confounders else 'strict'
        )
        regressions = _regressions(
            subject_facts,
            subject_gate,
            baseline_facts,
            baseline.gate,
        )

        subject_role = _adapter_role_for_eval(subject_facts)
        baseline_role = _adapter_role_for_eval(baseline_facts)
        role_mismatch = bool(
            subject_role
            and baseline_role
            and subject_role != baseline_role
        )
        subject_eval = (
            _adapter_eval(subject_facts, subject_role)
            if subject_role else _lowest_eval(subject_facts)
        )
        baseline_eval = (
            _adapter_eval(baseline_facts, baseline_role)
            if baseline_role else _lowest_eval(baseline_facts)
        )
        eval_signal: TrainingSignal = 'inconclusive'
        relative: float | None = None
        if subject_eval is not None and baseline_eval is not None:
            relative = (
                (float(subject_eval) - float(baseline_eval))
                / float(baseline_eval)
                if float(baseline_eval) != 0
                else None
            )
            if relative is not None and abs(relative) <= RELATIVE_EVAL_EPSILON:
                eval_signal = 'flat'
            elif float(subject_eval) < float(baseline_eval):
                eval_signal = 'improved'
            else:
                eval_signal = 'worsened'

        training_signal = _training_signal(eval_signal, regressions)
        delivery_signal = _delivery_signal(subject_gate, baseline.gate)
        confidence = _confidence(
            status=status,
            eval_signal=training_signal,
            subject_facts=subject_facts,
            baseline_facts=baseline_facts,
            changes=changes,
            confounders=confounders,
            regressions=regressions,
            role_mismatch=role_mismatch,
        )

        adapter_subject_ids = [
            f'E-ADAPTER-{(subject_role or "best").upper()}',
            'E-METRICS',
        ]
        adapter_baseline_ids = [
            f'E-BASE-ADAPTER-{(baseline_role or "best").upper()}',
            'E-BASE-METRICS',
        ]
        deltas = [
            _metric_delta(
                'best_eval_loss',
                _adapter_eval(subject_facts, 'best'),
                _adapter_eval(baseline_facts, 'best'),
                evidence_ids=[
                    'E-COMPARE-METRIC-BEST-EVAL',
                    'E-METRICS',
                    'E-BASE-METRICS',
                    'E-ADAPTER-BEST',
                    'E-BASE-ADAPTER-BEST',
                ],
            ),
            _metric_delta(
                'final_eval_loss',
                _adapter_eval(subject_facts, 'final'),
                _adapter_eval(baseline_facts, 'final'),
                evidence_ids=[
                    'E-COMPARE-METRIC-FINAL-EVAL',
                    'E-METRICS',
                    'E-BASE-METRICS',
                    'E-ADAPTER-FINAL',
                    'E-BASE-ADAPTER-FINAL',
                ],
            ),
            _metric_delta(
                'latest_eval_loss',
                _latest_eval(subject_facts),
                _latest_eval(baseline_facts),
                evidence_ids=['E-METRICS', 'E-BASE-METRICS'],
            ),
            _metric_delta(
                'lowest_eval_loss',
                _lowest_eval(subject_facts),
                _lowest_eval(baseline_facts),
                evidence_ids=['E-METRICS', 'E-BASE-METRICS'],
            ),
            _metric_delta(
                'final_train_loss',
                _final_train(subject_facts),
                _final_train(baseline_facts),
                evidence_ids=['E-METRICS', 'E-BASE-METRICS'],
            ),
            _metric_delta(
                'token_overflow_count',
                _token_overflow_count(subject_facts),
                _token_overflow_count(baseline_facts),
                evidence_ids=['E-TOKEN', 'E-BASE-TOKEN'],
                unit_relative=False,
            ),
        ]

        reason_codes = [
            'hard_key_match',
            (
                'relative_eval_change_within_epsilon'
                if eval_signal == 'flat' else
                f'training_signal_{training_signal}'
            ),
        ]
        reason_codes.extend(item.code for item in confounders)
        reason_codes.extend(item['code'] for item in regressions)
        reason_codes = list(dict.fromkeys(reason_codes))
        comparison_evidence_ids = list(COMPARISON_EVIDENCE_IDS)

        result = ComparisonResult(
            policy_version=self.policy_version,
            group=group,
            selection=selection,
            comparability_status=status,
            confidence=confidence,
            training_signal=training_signal,
            delivery_signal=delivery_signal,
            model_effect=ModelEffect(
                status='unverified',
                reason='no_comparable_downstream_evaluation',
                note=(
                    '首版没有同一测试集 digest、同一指标定义和可比较分数的'
                    '两次独立评测记录，因此不判断真实模型效果。'
                ),
            ),
            primary_adapter_role=(
                subject_role
                if subject_role and subject_role == baseline_role
                else None
            ),
            metric_deltas=deltas,
            parameter_changes=changes,
            confounders=confounders,
            regressions=regressions,
            reason_codes=reason_codes,
            evidence_ids=list(dict.fromkeys(
                comparison_evidence_ids
                + adapter_subject_ids
                + adapter_baseline_ids
                + ['E-TOKEN', 'E-BASE-TOKEN']
                + (['E-ATTEMPT', 'E-BASE-ATTEMPT'])
            )),
        )
        return result.with_digest()

    def preview(
        self,
        subject_facts: dict[str, Any],
        baseline_facts: dict[str, Any],
    ) -> tuple[ComparabilityStatus, int, list[str]]:
        changes = parameter_changes(baseline_facts, subject_facts)
        confounders = _confounders(subject_facts, baseline_facts, changes)
        status: ComparabilityStatus = (
            'conditional' if confounders else 'strict'
        )
        return (
            status,
            len(changes),
            [item.code for item in confounders],
        )
