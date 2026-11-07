"""Deterministic golden-set evaluation for advisory diagnosis reports."""
from __future__ import annotations

import argparse
import copy
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from .context import build_context
from .contracts import (
    CandidateReport,
    Claim,
    EvidenceConflict,
    EvidenceCoverage,
    EvidencePack,
    EvidenceRef,
    Finding,
    Limitation,
    SourceRevision,
    digest,
)
from .gates import GateEngine
from .validator import ReportValidator


NOW = datetime(2026, 11, 7, 0, 0, tzinfo=timezone.utc)
ATTEMPT_ID = uuid.UUID('fbc8a03d-27e3-4ef2-8253-c23ac8a599ac')


@dataclass(frozen=True)
class GoldenCase:
    id: str
    title: str
    facts: dict[str, Any]
    state: str
    expected_health: str
    expected_delivery: str
    forbidden_probe: str | None = None


@dataclass(frozen=True)
class NegativeValidatorCase:
    id: str
    source_case_id: str
    text: str


def _base_facts() -> dict[str, Any]:
    return {
        'attempt': {
            'id': str(ATTEMPT_ID),
            'task_id': '74a0cd14-39e8-4a1a-b5c6-65c08c91bf7a',
            'number': 1,
            'state': 'succeeded',
            'outcome': 'succeeded',
            'error_code': None,
            'exit_code': 0,
            'updated_at': NOW.isoformat(),
        },
        'snapshot': {
            'config': {
                'epochs': 1,
                'learning_rate': 0.0002,
                'cutoff_len': 512,
                'batch_size': 1,
                'gradient_accumulation': 8,
            },
            'base': {'id': 'base-qwen3', 'name': 'Qwen3-0.6B'},
            'dataset': {'id': 'dataset-1', 'sample_count': 24},
        },
        'metrics': {
            'points': [
                {'step': 1, 'loss': 2.5, 'learning_rate': 0.00002},
                {
                    'step': 22,
                    'loss': 0.31,
                    'eval_loss': 0.2148,
                    'learning_rate': 0.00008,
                },
            ],
            'counts': {'train': 22, 'eval': 1, 'learning_rate': 22},
            'first_train': {'step': 1, 'loss': 2.5, 'learning_rate': 0.00002},
            'last_train': {
                'step': 22,
                'loss': 0.31,
                'eval_loss': 0.2148,
                'learning_rate': 0.00008,
            },
            'latest_eval': {'step': 22, 'eval_loss': 0.2148},
            'lowest_eval': {'step': 22, 'eval_loss': 0.2148},
        },
        'token_preflight': {
            'samples': [{'split': 'train', 'tokens': 41, 'source_line': 1}],
            'overflow': [],
        },
        'runtime': {
            'ready': True,
            'lock_id': 'ucloud-cuda13.2-llamafactory-0.9.5-qwen3',
            'mismatches': [],
        },
        'memory': {
            'status': 'measured',
            'device_peak_used_bytes': 2580545536,
            'sampler_error': None,
        },
        'manifest': {'files': [{'path': 'trainer_state.json'}]},
        'provisioning': {
            'runtime_state': 'preflight_ready',
            'artifact_state': 'verified',
        },
        'logs': {
            'chunks_received': 6,
            'gap': False,
            'excerpt': 'training completed',
        },
        'adapters': {
            'best': {
                'id': 'adapter-best',
                'role': 'best',
                'state': 'available',
                'fingerprint': 'a' * 64,
            },
            'final': {
                'id': 'adapter-final',
                'role': 'final',
                'state': 'available',
                'fingerprint': 'b' * 64,
            },
        },
        'inference_trials': [],
        'inference_acceptance': [],
    }


def _variant(mutator: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    facts = copy.deepcopy(_base_facts())
    mutator(facts)
    return facts


def _failed_facts(state: str = 'failed') -> dict[str, Any]:
    facts = _base_facts()
    facts['attempt'] = {
        **facts['attempt'],
        'state': state,
        'outcome': state,
        'exit_code': None if state == 'failed' else 0,
        'error_code': (
            'bootstrap_key_install_failed' if state == 'failed' else None
        ),
    }
    facts['metrics'] = {
        'points': [],
        'counts': {'train': 0, 'eval': 0, 'learning_rate': 0},
        'first_train': None,
        'last_train': None,
        'latest_eval': None,
        'lowest_eval': None,
    }
    facts['token_preflight'] = None
    facts['runtime'] = None
    facts['memory'] = None
    facts['manifest'] = None
    facts['provisioning'] = {'error_code': 'bootstrap_key_install_failed'}
    facts['logs'] = None
    facts['adapters'] = None
    return facts


def _cancelled_facts() -> dict[str, Any]:
    facts = _failed_facts('cancelled')
    facts['runtime'] = {
        'ready': True,
        'lock_id': 'ucloud-cuda13.2-llamafactory-0.9.5-qwen3',
        'mismatches': [],
    }
    facts['manifest'] = {
        'files': [{'path': f'output/file-{index}.json'} for index in range(6)]
    }
    return facts


def _same_adapter_facts() -> dict[str, Any]:
    facts = _base_facts()
    facts['adapters'] = {
        'best': copy.deepcopy(facts['adapters']['best']),
        'final': {
            **copy.deepcopy(facts['adapters']['best']),
            'id': 'adapter-final',
            'role': 'final',
        },
    }
    return facts


GOLDEN_CASES: tuple[GoldenCase, ...] = (
    GoldenCase(
        'G01', '成功但有单个 Eval 点，Adapter 无验收',
        _base_facts(), 'succeeded', 'partial',
        'artifact_deliverable_model_unverified',
        forbidden_probe='综合判断后，模型可用。',
    ),
    GoldenCase(
        'G02', 'Best 与 Final 指向同一产物，不判断优劣',
        _same_adapter_facts(), 'succeeded', 'partial',
        'artifact_deliverable_model_unverified',
        forbidden_probe='Best 产物质量优于 Final。',
    ),
    GoldenCase(
        'G03', '只有 Best，Final 缺失',
        _variant(lambda facts: facts['adapters'].update({'final': None})),
        'succeeded', 'partial', 'not_deliverable',
        forbidden_probe='产物完整，可以直接发布。',
    ),
    GoldenCase(
        'G04', '失败且仅有 provisioning 错误码',
        _failed_facts(), 'failed', 'unknown', 'not_deliverable',
        forbidden_probe='根因是密钥安装脚本存在缺陷。',
    ),
    GoldenCase(
        'G05', '取消但 runtime 与 manifest 可读',
        _cancelled_facts(), 'cancelled', 'unknown', 'not_deliverable',
        forbidden_probe='本次训练失败，质量较低。',
    ),
    GoldenCase(
        'G06', '成功标记但退出码冲突',
        _variant(
            lambda facts: facts['attempt'].update({'exit_code': 137})
        ),
        'succeeded', 'blocked',
        'artifact_deliverable_model_unverified',
        forbidden_probe='训练健康度健康。',
    ),
    GoldenCase(
        'G07', '运行时状态存在阻断冲突',
        _variant(
            lambda facts: facts['runtime'].update({
                'ready': False,
                'mismatches': [{
                    'field': 'llamafactory',
                    'expected': '0.9.5',
                    'actual': '0.8.0',
                }],
            })
        ),
        'succeeded', 'blocked',
        'artifact_deliverable_model_unverified',
        forbidden_probe='运行时环境完全兼容。',
    ),
    GoldenCase(
        'G08', '当前 Adapter 存在匹配的独立验收',
        _variant(lambda facts: facts.update({
            'inference_acceptance': [{
                'adapter_id': 'adapter-best',
                'adapter_fingerprint': 'a' * 64,
                'result': 'passed',
            }],
        })),
        'succeeded', 'partial', 'ready_for_release_review',
        forbidden_probe='已经验证生产可用。',
    ),
    GoldenCase(
        'G09', '其他 Adapter 的验收不能升级当前产物',
        _variant(lambda facts: facts.update({
            'inference_trials': [],
            'inference_acceptance': [{
                'adapter_id': 'adapter-other',
                'adapter_fingerprint': 'c' * 64,
                'result': 'passed',
            }],
        })),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='推理验收通过，可进入发布评审。',
    ),
    GoldenCase(
        'G10', 'Token 预检未上报',
        _variant(lambda facts: facts.update({'token_preflight': None})),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='Token 无溢出，输入长度安全。',
    ),
    GoldenCase(
        'G11', '日志缺失',
        _variant(lambda facts: facts.update({'logs': None})),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='日志无异常。',
    ),
    GoldenCase(
        'G12', 'GPU 显存峰值未上报',
        _variant(lambda facts: facts.update({'memory': None})),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='显存充足，没有 OOM 风险。',
    ),
    GoldenCase(
        'G13', '只有 Attempt snapshot，其他证据全缺',
        _variant(lambda facts: facts.update({
            'metrics': {
                'points': [],
                'counts': {'train': 0, 'eval': 0, 'learning_rate': 0},
                'first_train': None,
                'last_train': None,
                'latest_eval': None,
                'lowest_eval': None,
            },
            'token_preflight': None,
            'runtime': None,
            'memory': None,
            'manifest': None,
            'provisioning': None,
            'logs': None,
            'adapters': None,
        })),
        'succeeded', 'unknown', 'unknown',
        forbidden_probe='训练健康度健康，可以继续训练。',
    ),
    GoldenCase(
        'G14', '日志存在缺口',
        _variant(lambda facts: facts['logs'].update({'gap': True})),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='日志完整且没有异常。',
    ),
    GoldenCase(
        'G15', '显存采样器错误',
        _variant(lambda facts: facts['memory'].update({
            'sampler_error': 'sampler_timeout',
        })),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='显存峰值可完全代表训练过程，没有风险。',
    ),
    GoldenCase(
        'G16', 'Learning Rate 未上报',
        _variant(lambda facts: facts['metrics'].update({
            'points': [
                {'step': 1, 'loss': 2.5},
                {'step': 22, 'loss': 0.31, 'eval_loss': 0.2148},
            ],
            'counts': {'train': 22, 'eval': 1, 'learning_rate': 0},
        })),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='学习率调度正常。',
    ),
    GoldenCase(
        'G17', '没有 Eval 观测',
        _variant(lambda facts: facts['metrics'].update({
            'points': [
                {'step': 1, 'loss': 2.5, 'learning_rate': 0.00002},
                {'step': 22, 'loss': 0.31, 'learning_rate': 0.00008},
            ],
            'counts': {'train': 22, 'eval': 0, 'learning_rate': 22},
            'latest_eval': None,
            'lowest_eval': None,
        })),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='泛化稳定，没有过拟合。',
    ),
    GoldenCase(
        'G18', 'Token 预检发现溢出',
        _variant(lambda facts: facts['token_preflight'].update({
            'overflow': [{'source_line': 7, 'tokens': 1024}],
        })),
        'succeeded', 'partial', 'artifact_deliverable_model_unverified',
        forbidden_probe='所有样本都在上下文窗口内。',
    ),
)

NEGATIVE_VALIDATOR_CASES: tuple[NegativeValidatorCase, ...] = (
    NegativeValidatorCase(
        'N01', 'G01', '综合判断后，模型可用。',
    ),
    NegativeValidatorCase(
        'N02', 'G08', '当前产物已经验证生产可用。',
    ),
    NegativeValidatorCase(
        'N03', 'G01', 'Train Loss 下降说明业务准确率提升。',
    ),
    NegativeValidatorCase(
        'N04', 'G04', '已确认根因是密钥安装失败。',
    ),
    NegativeValidatorCase(
        'N05', 'G05', '本次训练失败，质量较低。',
    ),
    NegativeValidatorCase(
        'N06', 'G09', '推理验收通过，可进入发布评审。',
    ),
    NegativeValidatorCase(
        'N07', 'G01', '已确认过拟合。',
    ),
    NegativeValidatorCase(
        'N08', 'G06', '训练健康度健康。',
    ),
    NegativeValidatorCase(
        'N09', 'G03', '交付状态已就绪。',
    ),
)


def _coverage(
    kind: str,
    evidence_id: str,
    status: str,
    reason: str | None = None,
) -> tuple[EvidenceCoverage, EvidenceRef]:
    return (
        EvidenceCoverage(
            category=kind,
            status=status,
            reason=reason,
            evidence_ids=[evidence_id],
        ),
        EvidenceRef(
            id=evidence_id,
            kind=kind,
            source_locator=f'golden/{kind}',
            field_path=kind,
            observed_at=NOW,
            source_version='golden-v1',
            source_digest=digest(kind),
            coverage=status,
            unavailable_reason=reason,
        ),
    )


def build_pack(case: GoldenCase) -> EvidencePack:
    facts = case.facts
    coverage: list[EvidenceCoverage] = []
    evidence: list[EvidenceRef] = []

    def add(
        kind: str,
        evidence_id: str,
        available: bool,
        *,
        missing_status: str = 'missing',
        reason: str | None = None,
    ):
        status = 'available' if available else missing_status
        coverage_item, evidence_item = _coverage(
            kind,
            evidence_id,
            status,
            None if available else (reason or f'{kind}_not_reported'),
        )
        coverage.append(coverage_item)
        evidence.append(evidence_item)

    add('attempt', 'E-ATTEMPT', True)
    add(
        'metrics',
        'E-METRICS',
        bool((facts.get('metrics') or {}).get('points')),
        missing_status=(
            'not_applicable' if case.state != 'succeeded' else 'missing'
        ),
    )
    add('token_preflight', 'E-TOKEN', facts.get('token_preflight') is not None)
    add('runtime', 'E-RUNTIME', facts.get('runtime') is not None)
    add(
        'memory',
        'E-MEMORY',
        facts.get('memory') is not None,
        missing_status='not_reached',
    )
    add('manifest', 'E-MANIFEST', facts.get('manifest') is not None)
    add(
        'provisioning',
        'E-PROVISIONING',
        facts.get('provisioning') is not None,
        missing_status=(
            'not_applicable' if case.state != 'succeeded' else 'missing'
        ),
    )
    add('logs', 'E-LOGS', facts.get('logs') is not None)
    adapters = facts.get('adapters')
    add('adapter', 'E-ADAPTER-BEST', bool((adapters or {}).get('best')))
    add('adapter', 'E-ADAPTER-FINAL', bool((adapters or {}).get('final')))
    trials = facts.get('inference_trials')
    add(
        'inference_trial',
        'E-INFERENCE-TRIALS',
        bool(trials),
        missing_status=(
            'unavailable'
            if trials is None
            else 'not_applicable'
        ),
    )
    acceptance = facts.get('inference_acceptance')
    acceptance_available = isinstance(acceptance, list) and bool(acceptance)
    add(
        'inference_acceptance',
        'E-INFERENCE-ACCEPTANCE',
        acceptance_available,
        reason=(
            None
            if acceptance_available
            else 'independent_inference_acceptance_not_available'
        ),
    )

    conflicts: list[EvidenceConflict] = []
    runtime = facts.get('runtime') if isinstance(facts.get('runtime'), dict) else {}
    if runtime.get('mismatches'):
        conflicts.append(EvidenceConflict(
            code='runtime_mismatch',
            left_ref='E-RUNTIME',
            right_ref='E-ATTEMPT',
            description='Golden runtime evidence reports a mismatch.',
            blocking=True,
        ))
    return EvidencePack(
        attempt_id=ATTEMPT_ID,
        evidence_cutoff_at=NOW,
        attempt_state=case.state,
        source_revision=SourceRevision(
            attempt_updated_at=NOW,
            snapshot_sha256='c' * 64,
            metrics_digest=digest(facts.get('metrics')),
            runtime_digest=digest(facts.get('runtime')),
            manifest_digest=digest(facts.get('manifest')),
            adapter_revision=digest(adapters),
            inference_revision=digest({
                'trials': facts.get('inference_trials'),
                'acceptance': facts.get('inference_acceptance'),
            }),
        ),
        coverage=coverage,
        evidence=evidence,
        facts=facts,
        conflicts=conflicts,
    ).with_digest()


def safe_candidate(pack: EvidencePack, gate) -> CandidateReport:
    facts = pack.facts
    adapters = facts.get('adapters') if isinstance(facts.get('adapters'), dict) else {}
    acceptance = facts.get('inference_acceptance')
    summary = (
        f'冻结 GateResult 为 health_status={gate.health_status}、'
        f'delivery_status={gate.delivery_status}。'
    )
    if pack.attempt_state == 'succeeded':
        summary += '本次只解释训练过程与产物证据，无法判断业务效果或模型可用。'
    elif pack.attempt_state == 'cancelled':
        summary += 'Attempt 已取消，不能把未完成过程表述为训练失败。'
    else:
        summary += 'Attempt 失败，当前证据不足以判断根因。'
    if facts.get('token_preflight') is None:
        summary += ' Token 预检未上报，无法判断是否存在溢出。'
    if facts.get('logs') is None:
        summary += ' 日志未上报，无法完成异常核对。'
    if facts.get('memory') is None:
        summary += ' 显存峰值未上报，无法判断峰值余量。'
    if adapters.get('best') is None or adapters.get('final') is None:
        summary += ' Best/Final Adapter 未齐备，不能判断产物可交付。'
    if gate.delivery_status == 'ready_for_release_review':
        summary += ' 当前记录仅支持进入发布评审，不等于生产可用。'
    elif gate.delivery_status == 'artifact_deliverable_model_unverified':
        summary += ' 独立推理验收未上报，模型可用性仍未验证。'

    finding = Finding(
        id='FND-COVERAGE',
        category='coverage',
        severity=(
            'blocked'
            if gate.health_status == 'blocked'
            else 'attention'
            if gate.health_status in {'partial', 'unknown', 'attention'}
            else 'info'
        ),
        epistemic_status='observed',
        title='证据覆盖决定本次结论边界',
        observation=Claim(
            id='FND-COVERAGE-OBS',
            layer='observation',
            text='本报告只读取冻结 EvidencePack 与确定性 GateResult。',
            evidence_ids=['E-ATTEMPT'],
        ),
        evidence_ids=['E-ATTEMPT'],
    )
    return CandidateReport(
        summary=summary,
        claims=[],
        findings=[finding],
        limitations=[
            Limitation(
                code='business_metric_unavailable',
                text='未上报 task metric，无法判断业务准确率或用户满意度。',
                affected_axis='health',
                evidence_ids=['E-METRICS'],
            ),
            Limitation(
                code='independent_inference_acceptance_not_established',
                text='当前结果不代表独立推理验收通过，也不能证明模型可用。',
                affected_axis='delivery',
                evidence_ids=['E-INFERENCE-ACCEPTANCE'],
            ),
        ],
        next_experiments=[],
    )


def _candidate_text(candidate: CandidateReport) -> str:
    values = [candidate.summary]
    for finding in candidate.findings:
        values.append(finding.title)
        values.append(finding.observation.text)
        if finding.inference:
            values.append(finding.inference.text)
        if finding.recommendation:
            values.append(finding.recommendation.text)
    values.extend(item.text for item in candidate.limitations)
    values.extend(
        item.hypothesis for item in candidate.next_experiments
    )
    return '\n'.join(values)


def evaluate(
    *,
    generator=None,
    case_ids: set[str] | None = None,
    repeat: int = 1,
) -> dict[str, Any]:
    validator = ReportValidator()
    gate_engine = GateEngine()
    results: list[dict[str, Any]] = []
    started = time.perf_counter()
    for case in GOLDEN_CASES:
        if case_ids and case.id not in case_ids:
            continue
        pack = build_pack(case)
        gate = gate_engine.evaluate(pack)
        gate_match = (
            gate.health_status == case.expected_health
            and gate.delivery_status == case.expected_delivery
        )
        for run_index in range(max(1, repeat)):
            run_started = time.perf_counter()
            reset_usage = getattr(generator, 'reset_usage', None)
            if callable(reset_usage):
                reset_usage()
            error = None
            issues = []
            forbidden_hits: list[str] = []
            first_pass_issues = []
            first_pass_forbidden_hits: list[str] = []
            repair_attempted = False
            repair_succeeded = False
            try:
                if generator is None:
                    candidate = safe_candidate(pack, gate)
                else:
                    candidate = generator.generate(build_context(pack, gate))
                first_pass_issues = validator.validate(candidate, pack, gate)
                text = _candidate_text(candidate)
                if case.forbidden_probe and case.forbidden_probe in text:
                    first_pass_forbidden_hits.append(case.forbidden_probe)
                if first_pass_issues and generator is not None:
                    repair_attempted = True
                    candidate = generator.repair(
                        build_context(pack, gate),
                        candidate,
                        first_pass_issues,
                    )
                    issues = validator.validate(candidate, pack, gate)
                    text = _candidate_text(candidate)
                    if case.forbidden_probe and case.forbidden_probe in text:
                        forbidden_hits.append(case.forbidden_probe)
                    repair_succeeded = not issues
                else:
                    issues = first_pass_issues
                    forbidden_hits = first_pass_forbidden_hits
            except Exception as exc:
                error = type(exc).__name__
                text = ''
            elapsed_ms = int((time.perf_counter() - run_started) * 1000)
            read_usage = getattr(generator, 'usage', None)
            run_usage = read_usage() if callable(read_usage) else None
            results.append({
                'case_id': case.id,
                'run': run_index + 1,
                'title': case.title,
                'gate_expected': {
                    'health': case.expected_health,
                    'delivery': case.expected_delivery,
                },
                'gate_actual': {
                    'health': gate.health_status,
                    'delivery': gate.delivery_status,
                },
                'gate_match': gate_match,
                'first_pass_validator_issue_codes': [
                    item.code for item in first_pass_issues
                ],
                'first_pass_validator_issues': [
                    item.model_dump(mode='json')
                    for item in first_pass_issues
                ],
                'first_pass_forbidden_hits': first_pass_forbidden_hits,
                'first_pass_clean': (
                    not first_pass_issues
                    and not first_pass_forbidden_hits
                    and error is None
                ),
                'repair_attempted': repair_attempted,
                'repair_succeeded': repair_succeeded,
                'validator_issue_codes': [item.code for item in issues],
                'validator_issues': [
                    item.model_dump(mode='json') for item in issues
                ],
                'forbidden_hits': forbidden_hits,
                'error': error,
                'latency_ms': elapsed_ms,
                'usage': run_usage,
                'passed': (
                    gate_match
                    and not issues
                    and not forbidden_hits
                    and error is None
                ),
            })
    total = len(results)
    passed = sum(1 for item in results if item['passed'])
    first_pass_clean = sum(
        1 for item in results if item['first_pass_clean']
    )
    repairs = [item for item in results if item['repair_attempted']]
    repaired = [item for item in repairs if item['repair_succeeded']]
    negative_results: list[dict[str, Any]] = []
    case_by_id = {case.id: case for case in GOLDEN_CASES}
    for negative in NEGATIVE_VALIDATOR_CASES:
        case = case_by_id[negative.source_case_id]
        pack = build_pack(case)
        gate = gate_engine.evaluate(pack)
        unsafe = safe_candidate(pack, gate).model_copy(deep=True)
        unsafe.summary += '\n' + negative.text
        issues = validator.validate(unsafe, pack, gate)
        rejected = any(item.code == 'forbidden_claim' for item in issues)
        negative_results.append({
            'id': negative.id,
            'source_case_id': negative.source_case_id,
            'injected_claim': negative.text,
            'issue_codes': [item.code for item in issues],
            'rejected': rejected,
        })
    negative_passed = sum(
        1 for item in negative_results if item['rejected']
    )
    negative_total = len(negative_results)
    usage_rows = [
        item['usage'] for item in results
        if isinstance(item.get('usage'), dict)
    ]

    def sum_field(name):
        values = [
            item.get(name)
            for item in usage_rows
            if type(item.get(name)) is int
        ]
        return sum(values) if values else None

    return {
        'suite': 'training-diagnosis-golden-v1',
        'mode': 'live_model' if generator is not None else 'fixture',
        'case_count': len({item['case_id'] for item in results}),
        'run_count': total,
        'passed': passed,
        'failed': total - passed,
        'gate_fidelity': (
            sum(1 for item in results if item['gate_match']) / total
            if total else None
        ),
        'validator_clean_rate': (
            sum(
                1 for item in results
                if not item['validator_issue_codes'] and item['error'] is None
            ) / total
            if total else None
        ),
        'first_pass_clean_rate': (
            first_pass_clean / total if total else None
        ),
        'repair_attempts': len(repairs),
        'repair_succeeded': len(repaired),
        'repair_success_rate': (
            len(repaired) / len(repairs) if repairs else None
        ),
        'forbidden_claim_rate': (
            sum(1 for item in results if item['forbidden_hits']) / total
            if total else None
        ),
        'validator_negative_checks': {
            'total': negative_total,
            'passed': negative_passed,
            'failed': negative_total - negative_passed,
            'rejection_rate': (
                negative_passed / negative_total
                if negative_total else None
            ),
            'results': negative_results,
        },
        'usage_totals': {
            'reported_cases': len(usage_rows),
            'model_calls': sum_field('model_calls'),
            'prompt_tokens': sum_field('prompt_tokens'),
            'completion_tokens': sum_field('completion_tokens'),
            'total_tokens': sum_field('total_tokens'),
            'latency_ms': sum_field('latency_ms'),
        },
        'elapsed_ms': int((time.perf_counter() - started) * 1000),
        'results': results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Run the ModelForge training diagnosis golden set.',
    )
    parser.add_argument(
        '--live',
        action='store_true',
        help='Call the configured real model instead of fixture candidates.',
    )
    parser.add_argument(
        '--case',
        action='append',
        default=[],
        help='Run only the selected case ID; can be repeated.',
    )
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--output')
    args = parser.parse_args(argv)

    generator = None
    if args.live:
        from modelforge.settings import get_settings
        from .generator import LangChainOpenAIGenerator

        generator = LangChainOpenAIGenerator(get_settings())
    result = evaluate(
        generator=generator,
        case_ids=set(args.case) or None,
        repeat=max(1, args.repeat),
    )
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as stream:
            stream.write(payload + '\n')
    print(payload)
    return (
        0
        if (
            result['failed'] == 0
            and result['validator_negative_checks']['failed'] == 0
        )
        else 1
    )


if __name__ == '__main__':
    raise SystemExit(main())
