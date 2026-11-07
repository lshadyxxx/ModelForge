"""Deterministic training-health and delivery gates.

The gate engine has no I/O. It is the only component allowed to decide the
health and delivery status copied into an advisory report.
"""
from __future__ import annotations

from typing import Any, Iterable

from .contracts import (
    EvidencePack,
    GateReason,
    GateResult,
)


POLICY_VERSION = 'training-diagnosis-gate-v1'

_COVERAGE_ORDER = {
    'available': 0,
    'not_applicable': 1,
    'not_reached': 2,
    'missing': 3,
    'unavailable': 4,
    'conflict': 5,
}


def _worst_status(pack: EvidencePack, kind: str) -> str | None:
    statuses = [
        item.status
        for item in pack.coverage
        if item.category == kind
    ]
    if not statuses:
        return None
    return max(statuses, key=lambda status: _COVERAGE_ORDER.get(status, 99))


def _coverage_ids(pack: EvidencePack, kind: str) -> list[str]:
    return [
        evidence_id
        for item in pack.coverage
        if item.category == kind
        for evidence_id in item.evidence_ids
    ]


def _reason(
    code: str,
    text: str,
    evidence_ids: Iterable[str] = (),
) -> GateReason:
    return GateReason(
        code=code,
        text=text,
        evidence_ids=list(dict.fromkeys(evidence_ids)),
    )


def _adapter_available(adapter: Any) -> bool:
    return (
        isinstance(adapter, dict)
        and bool(adapter.get('id'))
        and adapter.get('state') == 'available'
    )


def _acceptance_matches(adapter: dict[str, Any], records: Any) -> bool:
    if not isinstance(records, list):
        return False
    adapter_id = adapter.get('id')
    fingerprint = adapter.get('fingerprint')
    if not adapter_id or not fingerprint:
        return False
    accepted_results = {'pass', 'passed', 'accepted', 'verified'}
    matching = [
        record for record in records
        if isinstance(record, dict)
        and record.get('adapter_id') == adapter_id
        and record.get('adapter_fingerprint') == fingerprint
    ]
    if not matching:
        return False
    matching.sort(
        key=lambda item: str(item.get('accepted_at') or ''),
        reverse=True,
    )
    return str(matching[0].get('result', '')).lower() in accepted_results


class GateEngine:
    """Evaluate one evidence pack using a versioned, deterministic policy."""

    policy_version = POLICY_VERSION

    def evaluate(self, pack: EvidencePack) -> GateResult:
        health_reasons: list[GateReason] = []
        delivery_reasons: list[GateReason] = []
        blocking_conflict = any(item.blocking for item in pack.conflicts)
        attempt_ids = _coverage_ids(pack, 'attempt')
        metrics_ids = _coverage_ids(pack, 'metrics')
        token_ids = _coverage_ids(pack, 'token_preflight')
        runtime_ids = _coverage_ids(pack, 'runtime')
        memory_ids = _coverage_ids(pack, 'memory')
        logs_ids = _coverage_ids(pack, 'logs')
        adapter_ids = _coverage_ids(pack, 'adapter')
        acceptance_ids = _coverage_ids(pack, 'inference_acceptance')

        if blocking_conflict:
            health_status = 'blocked'
            health_reasons.extend(
                _reason(
                    'evidence_conflict',
                    conflict.description,
                    [conflict.left_ref, conflict.right_ref],
                )
                for conflict in pack.conflicts
                if conflict.blocking
            )
        elif pack.attempt_state in {'failed', 'cancelled'}:
            health_status = 'unknown'
            health_reasons.append(_reason(
                'not_training_health_conclusion',
                (
                    'Attempt 已失败，当前证据不足以判定训练过程健康度。'
                    if pack.attempt_state == 'failed'
                    else 'Attempt 已取消，不能把未完成过程判定为训练失败或低质量。'
                ),
                attempt_ids,
            ))
        else:
            health_status, health_reasons = self._success_health(
                pack,
                metrics_ids=metrics_ids,
                token_ids=token_ids,
                runtime_ids=runtime_ids,
                memory_ids=memory_ids,
                logs_ids=logs_ids,
                attempt_ids=attempt_ids,
            )

        delivery_status, delivery_reasons = self._delivery(
            pack,
            attempt_ids=attempt_ids,
            adapter_ids=adapter_ids,
            acceptance_ids=acceptance_ids,
        )

        evidence_ids = list(dict.fromkeys(
            item.id for item in pack.evidence
        ))
        result = GateResult(
            policy_version=self.policy_version,
            health_status=health_status,
            delivery_status=delivery_status,
            health_reasons=health_reasons,
            delivery_reasons=delivery_reasons,
            coverage=pack.coverage,
            conflicts=pack.conflicts,
            evidence_ids=evidence_ids,
        )
        return result.with_digest()

    def _success_health(
        self,
        pack: EvidencePack,
        *,
        metrics_ids: list[str],
        token_ids: list[str],
        runtime_ids: list[str],
        memory_ids: list[str],
        logs_ids: list[str],
        attempt_ids: list[str],
    ) -> tuple[str, list[GateReason]]:
        reasons: list[GateReason] = []
        partial = False
        attention = False
        facts = pack.facts if isinstance(pack.facts, dict) else {}
        metrics_status = _worst_status(pack, 'metrics')
        runtime_status = _worst_status(pack, 'runtime')
        logs_status = _worst_status(pack, 'logs')
        if (
            metrics_status != 'available'
            and runtime_status != 'available'
            and logs_status != 'available'
        ):
            return 'unknown', [_reason(
                'training_evidence_insufficient',
                '缺少可读取的指标、运行报告与日志，无法评估训练健康度。',
                metrics_ids + runtime_ids + logs_ids,
            )]
        metrics = facts.get('metrics') if isinstance(facts.get('metrics'), dict) else {}
        counts = metrics.get('counts') if isinstance(metrics.get('counts'), dict) else {}
        train_count = counts.get('train') if isinstance(counts.get('train'), int) else 0
        eval_count = counts.get('eval') if isinstance(counts.get('eval'), int) else 0
        lr_count = counts.get('learning_rate') if isinstance(counts.get('learning_rate'), int) else 0
        runtime = facts.get('runtime') if isinstance(facts.get('runtime'), dict) else {}
        token_preflight = (
            facts.get('token_preflight')
            if isinstance(facts.get('token_preflight'), dict)
            else {}
        )
        memory = facts.get('memory') if isinstance(facts.get('memory'), dict) else {}

        attempt = facts.get('attempt') if isinstance(facts.get('attempt'), dict) else {}
        if attempt.get('exit_code') not in (None, 0):
            return 'blocked', [_reason(
                'successful_exit_conflict',
                'Attempt 标记为成功，但退出码不是 0。',
                attempt_ids,
            )]

        if runtime.get('mismatches'):
            return 'blocked', [_reason(
                'runtime_mismatch',
                '运行时报告包含兼容性冲突，训练健康结论被阻断。',
                runtime_ids,
            )]

        if metrics_status in {'missing', 'unavailable', 'conflict'}:
            partial = True
            reasons.append(_reason(
                'metrics_not_usable',
                '训练指标缺失或不可读，不能形成完整健康结论。',
                metrics_ids,
            ))
        elif train_count < 2:
            partial = True
            reasons.append(_reason(
                'train_series_insufficient',
                'Train Loss 采样不足，无法观察训练过程趋势。',
                metrics_ids,
            ))
        else:
            reasons.append(_reason(
                'train_series_present',
                f'已观测 {train_count} 个 Train Loss 采样点。',
                metrics_ids,
            ))

        if eval_count < 2:
            partial = True
            reasons.append(_reason(
                'eval_series_partial',
                (
                    '仅有一个 Eval Loss 观测点时，不能判断过拟合或稳定泛化趋势。'
                    if eval_count == 1
                    else '没有 Eval Loss 观测点，无法判断验证集趋势。'
                ),
                metrics_ids,
            ))
        elif eval_count >= 2:
            reasons.append(_reason(
                'eval_series_present',
                f'已观测 {eval_count} 个 Eval Loss 采样点，可观察验证趋势。',
                metrics_ids,
            ))

        if lr_count == 0:
            partial = True
            reasons.append(_reason(
                'learning_rate_not_reported',
                '未上报 Learning Rate，无法核对学习率调度轨迹。',
                metrics_ids,
            ))

        token_status = _worst_status(pack, 'token_preflight')
        if token_status != 'available':
            partial = True
            reasons.append(_reason(
                'token_preflight_not_reported',
                'Token 预检未上报，不能判定是否存在超长样本溢出。',
                token_ids,
            ))
        else:
            overflow = token_preflight.get('overflow')
            overflow_count = (
                len(overflow)
                if isinstance(overflow, list)
                else token_preflight.get('overflow_count')
            )
            status = str(token_preflight.get('status', '')).lower()
            if isinstance(overflow_count, int) and overflow_count > 0:
                attention = True
                reasons.append(_reason(
                    'token_overflow_observed',
                    f'Token 预检观测到 {overflow_count} 个溢出样本，需要核对截断策略与数据质量。',
                    token_ids,
                ))
            elif status in {'failed', 'blocked', 'overflow'}:
                attention = True
                reasons.append(_reason(
                    'token_preflight_attention',
                    'Token 预检状态提示存在需要处理的输入风险。',
                    token_ids,
                ))
            else:
                reasons.append(_reason(
                    'token_preflight_passed',
                    'Token 预检已上报且未发现明确溢出阻断。',
                    token_ids,
                ))

        if runtime_status != 'available':
            partial = True
            reasons.append(_reason(
                'runtime_report_not_usable',
                '运行报告缺失或不可读，无法完整核对运行时健康度。',
                runtime_ids,
            ))
        elif runtime.get('ready') is False:
            attention = True
            reasons.append(_reason(
                'runtime_not_ready',
                '运行报告未标记 ready，需要核对训练运行时。',
                runtime_ids,
            ))

        if _worst_status(pack, 'memory') == 'available':
            sampler_error = memory.get('sampler_error')
            if sampler_error:
                attention = True
                reasons.append(_reason(
                    'memory_sampler_error',
                    'GPU 显存采样器报告错误；已取得的峰值只代表部分观测。',
                    memory_ids,
                ))
            else:
                reasons.append(_reason(
                    'memory_snapshot_present',
                    '已取得 GPU 显存峰值快照；它不是实时曲线或 OOM 证明。',
                    memory_ids,
                ))
        else:
            partial = True
            reasons.append(_reason(
                'memory_peak_not_reported',
                'GPU 显存峰值未上报，无法评估峰值余量。',
                memory_ids,
            ))

        if logs_status != 'available':
            partial = True
            reasons.append(_reason(
                'logs_not_usable',
                '训练日志缺失或不可读，无法完成日志异常核对。',
                logs_ids,
            ))
        else:
            logs = facts.get('logs') if isinstance(facts.get('logs'), dict) else {}
            if logs.get('gap'):
                attention = True
                reasons.append(_reason(
                    'logs_gap',
                    '训练日志存在缺口，日志核对不完整。',
                    logs_ids,
                ))
            else:
                reasons.append(_reason(
                    'logs_available',
                    '训练日志片段可读取；报告只引用脱敏摘要。',
                    logs_ids,
                ))

        if attention and not partial:
            return 'attention', reasons
        if partial:
            return 'partial', reasons
        return 'healthy', reasons

    def _delivery(
        self,
        pack: EvidencePack,
        *,
        attempt_ids: list[str],
        adapter_ids: list[str],
        acceptance_ids: list[str],
    ) -> tuple[str, list[GateReason]]:
        if pack.attempt_state != 'succeeded':
            return 'not_deliverable', [_reason(
                'attempt_not_succeeded',
                '非成功 Attempt 不发布部分 Adapter，当前没有可交付产物。',
                attempt_ids,
            )]

        facts = pack.facts if isinstance(pack.facts, dict) else {}
        adapters = facts.get('adapters')
        if not isinstance(adapters, dict):
            return 'unknown', [_reason(
                'adapter_state_unavailable',
                '无法读取 Best/Final Adapter 状态，不能判断可交付性。',
                adapter_ids,
            )]

        best = adapters.get('best')
        final = adapters.get('final')
        best_ok = _adapter_available(best)
        final_ok = _adapter_available(final)
        if not best_ok or not final_ok:
            missing = [
                role.upper()
                for role, present in (('best', best_ok), ('final', final_ok))
                if not present
            ]
            return 'not_deliverable', [_reason(
                'adapter_roles_incomplete',
                f"Best/Final Adapter 未达到 2/2 可用：缺失或不可用 {', '.join(missing)}。",
                adapter_ids,
            )]

        reasons = [_reason(
            'adapter_roles_available',
            'Best 与 Final Adapter 均已登记为 available，并完成正式存储校验。',
            adapter_ids,
        )]
        acceptance = facts.get('inference_acceptance')
        matched = any(
            _acceptance_matches(adapter, acceptance)
            for adapter in (best, final)
            if isinstance(adapter, dict)
        )
        if matched:
            reasons.append(_reason(
                'independent_inference_acceptance_present',
                '当前 Adapter 存在匹配的独立推理验收记录，可进入发布评审，但不等于生产可用。',
                acceptance_ids,
            ))
            return 'ready_for_release_review', reasons

        reasons.append(_reason(
            'independent_inference_acceptance_missing',
            '产物可下发，但当前 Adapter 尚无独立推理验收；模型可用性未验证。',
            adapter_ids,
        ))
        return 'artifact_deliverable_model_unverified', reasons
