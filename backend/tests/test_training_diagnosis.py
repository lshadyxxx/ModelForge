from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from modelforge.errors import AppError
from modelforge.modules.diagnosis.contracts import (
    CandidateReport,
    Claim,
    EvidenceCoverage,
    EvidencePack,
    EvidenceRef,
    Finding,
    Limitation,
    NextExperiment,
    SourceRevision,
    digest,
)
from modelforge.modules.diagnosis.drafts import build_training_draft
from modelforge.modules.diagnosis.context import build_context
from modelforge.modules.diagnosis.evaluation import (
    GOLDEN_CASES,
    NEGATIVE_VALIDATOR_CASES,
    build_pack as build_golden_pack,
    evaluate as evaluate_golden_set,
)
from modelforge.modules.diagnosis.evidence import EvidenceCollector, _redact
from modelforge.modules.diagnosis.gates import GateEngine
from modelforge.modules.diagnosis.generator import (
    LangChainOpenAIGenerator,
    _UsageAccumulator,
    _extract_usage,
)
from modelforge.modules.diagnosis.validator import ReportValidator
from modelforge.modules.diagnosis.worker import LeaseHeartbeat
from modelforge.settings import get_settings


NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)
ATTEMPT_ID = uuid.UUID('fbc8a03d-27e3-4ef2-8253-c23ac8a599ac')


def success_facts():
    return {
        'attempt': {
            'id': str(ATTEMPT_ID),
            'state': 'succeeded',
            'outcome': 'succeeded',
            'exit_code': 0,
            'error_code': None,
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
                {'step': 22, 'loss': 0.31, 'eval_loss': 0.2148, 'learning_rate': 0.00008},
            ],
            'counts': {'train': 22, 'eval': 1, 'learning_rate': 22},
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
        'provisioning': {'runtime_state': 'preflight_ready', 'artifact_state': 'verified'},
        'logs': {'chunks_received': 8, 'gap': False, 'excerpt': 'training completed'},
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


def pack(
    *,
    state='succeeded',
    facts=None,
    overrides=None,
    acceptance_available=False,
):
    facts = facts if facts is not None else success_facts()
    if overrides:
        for path, value in overrides.items():
            cursor = facts
            parts = path.split('.')
            for part in parts[:-1]:
                cursor = cursor[part]
            cursor[parts[-1]] = value
    ids = {
        'attempt': 'E-ATTEMPT',
        'metrics': 'E-METRICS',
        'token_preflight': 'E-TOKEN',
        'runtime': 'E-RUNTIME',
        'memory': 'E-MEMORY',
        'manifest': 'E-MANIFEST',
        'provisioning': 'E-PROVISIONING',
        'logs': 'E-LOGS',
        'adapter': 'E-ADAPTER',
        'inference_trial': 'E-INFERENCE-TRIALS',
        'inference_acceptance': 'E-INFERENCE-ACCEPTANCE',
    }
    evidence = []
    coverage = []
    for kind, evidence_id in ids.items():
        available = (
            kind == 'attempt'
            or (
                kind == 'metrics'
                and bool((facts.get('metrics') or {}).get('points'))
            )
            or (kind == 'token_preflight' and facts.get('token_preflight') is not None)
            or (kind == 'runtime' and facts.get('runtime') is not None)
            or (kind == 'memory' and facts.get('memory') is not None)
            or (kind == 'manifest' and facts.get('manifest') is not None)
            or (kind == 'provisioning' and facts.get('provisioning') is not None)
            or (kind == 'logs' and facts.get('logs') is not None)
            or (kind == 'adapter' and facts.get('adapters') is not None)
            or (kind == 'inference_trial' and state == 'succeeded')
            or (kind == 'inference_acceptance' and acceptance_available)
        )
        status = 'available' if available else (
            'not_applicable'
            if kind in {'metrics', 'provisioning', 'inference_acceptance'}
            and state != 'succeeded'
            else 'missing'
        )
        evidence.append(EvidenceRef(
            id=evidence_id,
            kind=kind,
            source_locator=f'test/{kind}',
            field_path=kind,
            observed_at=NOW,
            source_version='snapshot',
            source_digest=digest(facts.get(kind)),
            coverage=status,
            unavailable_reason=None if available else f'{kind}_missing',
        ))
        coverage.append(EvidenceCoverage(
            category=kind,
            status=status,
            reason=None if available else f'{kind}_missing',
            evidence_ids=[evidence_id],
        ))
    return EvidencePack(
        attempt_id=ATTEMPT_ID,
        evidence_cutoff_at=NOW,
        attempt_state=state,
        source_revision=SourceRevision(
            attempt_updated_at=NOW,
            snapshot_sha256='c' * 64,
            metrics_digest=digest(facts.get('metrics')),
            adapter_revision=digest(facts.get('adapters')),
        ),
        coverage=coverage,
        evidence=evidence,
        facts=facts,
    ).with_digest()


def candidate():
    return CandidateReport(
        summary='仅有 1 个 Eval 采样点 0.2148 @ step 22，可核对单次验证结果，但不能判断稳定泛化趋势。',
        claims=[],
        findings=[
            Finding(
                id='loss-single-eval',
                category='loss_eval',
                severity='info',
                epistemic_status='observed',
                title='Eval 只有 1 个采样点',
                observation=Claim(
                    id='loss-observation',
                    layer='observation',
                    text='Eval Loss 为 0.2148，仅出现在 step 22。',
                    evidence_ids=['E-METRICS'],
                ),
                inference=Claim(
                    id='loss-inference',
                    layer='inference',
                    text='单点不足以判断训练是否过拟合。',
                    evidence_ids=['E-METRICS'],
                ),
                recommendation=Claim(
                    id='loss-recommendation',
                    layer='recommendation',
                    text='先补齐独立推理验收，再决定是否进入发布评审。',
                    evidence_ids=['E-ADAPTER'],
                ),
                evidence_ids=['E-METRICS', 'E-ADAPTER'],
            ),
        ],
        limitations=[
            Limitation(
                code='business_metric_unavailable',
                text='未上报 task metric，无法判断业务准确率或用户满意度。',
                affected_axis='health',
                evidence_ids=['E-METRICS'],
            ),
        ],
        next_experiments=[
            NextExperiment(
                id='eval-more-samples',
                priority='P1',
                title='增加验证采样频率',
                hypothesis='多个 Eval 观测点可以帮助判断验证趋势，但不证明业务效果。',
                evidence_ids=['E-METRICS'],
                preconditions=['不改变历史 Attempt', '仍需独立推理验收'],
                config_patch={'epochs': 2, 'learning_rate': 0.0001},
            ),
        ],
    )


def test_success_gate_is_partial_and_model_unverified():
    result = GateEngine().evaluate(pack())
    assert result.health_status == 'partial'
    assert result.delivery_status == 'artifact_deliverable_model_unverified'
    assert any(item.code == 'eval_series_partial' for item in result.health_reasons)
    assert any(
        item.code == 'independent_inference_acceptance_missing'
        for item in result.delivery_reasons
    )
    assert result.gate_digest == result.with_digest().gate_digest


def test_failed_and_cancelled_do_not_invent_health_or_delivery():
    failed_facts = {
        'attempt': {
            'id': str(ATTEMPT_ID),
            'state': 'failed',
            'outcome': 'failed',
            'exit_code': None,
            'error_code': 'bootstrap_key_install_failed',
        },
        'metrics': {'points': [], 'counts': {'train': 0, 'eval': 0, 'learning_rate': 0}},
        'runtime': None,
        'manifest': None,
        'logs': None,
        'adapters': None,
    }
    failed = GateEngine().evaluate(pack(state='failed', facts=failed_facts))
    assert failed.health_status == 'unknown'
    assert failed.delivery_status == 'not_deliverable'

    cancelled_facts = {
        **failed_facts,
        'attempt': {
            **failed_facts['attempt'],
            'state': 'cancelled',
            'outcome': 'cancelled',
            'error_code': None,
        },
    }
    cancelled = GateEngine().evaluate(pack(state='cancelled', facts=cancelled_facts))
    assert cancelled.health_status == 'unknown'
    assert cancelled.delivery_status == 'not_deliverable'
    assert any(
        '不能把未完成过程判定为训练失败' in item.text
        for item in cancelled.health_reasons
    )


def test_snapshot_only_success_is_unknown_not_a_pseudo_health_result():
    bare = {
        'attempt': {
            'id': str(ATTEMPT_ID),
            'state': 'succeeded',
            'outcome': 'succeeded',
            'exit_code': 0,
            'error_code': None,
        },
        'metrics': {'points': [], 'counts': {'train': 0, 'eval': 0, 'learning_rate': 0}},
        'runtime': None,
        'memory': None,
        'logs': None,
        'manifest': None,
        'token_preflight': None,
        'adapters': None,
    }
    result = GateEngine().evaluate(pack(facts=bare))
    assert result.health_status == 'unknown'
    assert result.delivery_status == 'unknown'
    assert any(
        item.code == 'training_evidence_insufficient'
        for item in result.health_reasons
    )


def test_adapter_incomplete_and_acceptance_rules_do_not_overclaim():
    missing_final = success_facts()
    missing_final['adapters'] = {'best': missing_final['adapters']['best'], 'final': None}
    incomplete = GateEngine().evaluate(pack(facts=missing_final))
    assert incomplete.delivery_status == 'not_deliverable'

    accepted = success_facts()
    accepted['inference_acceptance'] = [{
        'adapter_id': 'adapter-best',
        'adapter_fingerprint': 'a' * 64,
        'result': 'passed',
    }]
    verified = GateEngine().evaluate(pack(facts=accepted, acceptance_available=True))
    assert verified.delivery_status == 'ready_for_release_review'
    assert '不等于生产可用' in verified.delivery_reasons[-1].text


def test_latest_acceptance_decision_controls_delivery_status():
    records = success_facts()
    records['inference_acceptance'] = [{
        'adapter_id': 'adapter-best',
        'adapter_fingerprint': 'a' * 64,
        'result': 'passed',
        'accepted_at': '2026-11-07T01:00:00+00:00',
    }, {
        'adapter_id': 'adapter-best',
        'adapter_fingerprint': 'a' * 64,
        'result': 'failed',
        'accepted_at': '2026-11-07T02:00:00+00:00',
    }]
    gate = GateEngine().evaluate(pack(
        facts=records,
        acceptance_available=True,
    ))
    assert (
        gate.delivery_status
        == 'artifact_deliverable_model_unverified'
    )


def test_validator_requires_evidence_numbers_and_forbidden_claims():
    evidence_pack = pack()
    gate = GateEngine().evaluate(evidence_pack)
    validator = ReportValidator()
    assert validator.validate(candidate(), evidence_pack, gate) == []

    unsupported = candidate()
    unsupported.findings[0].observation.text = 'Eval Loss 为 0.2148，准确率 99.9%。'
    issues = validator.validate(unsupported, evidence_pack, gate)
    assert any(item.code == 'unsupported_number' for item in issues)

    unknown_reference = candidate()
    unknown_reference.findings[0].evidence_ids.append('E-99')
    issues = validator.validate(unknown_reference, evidence_pack, gate)
    assert any(item.code == 'unknown_evidence_id' for item in issues)

    overclaim = candidate()
    overclaim.summary += ' 模型可用。'
    issues = validator.validate(overclaim, evidence_pack, gate)
    assert any(item.code == 'forbidden_claim' for item in issues)

    safe_negation = candidate()
    safe_negation.findings[0].recommendation.text = (
        'Adapter 可下发不等于模型可用，仍需独立推理验收。'
    )
    assert validator.validate(safe_negation, evidence_pack, gate) == []


def test_validator_normalizes_equivalent_numbers_and_negated_boundaries():
    evidence_pack = pack()
    gate = GateEngine().evaluate(evidence_pack)
    validator = ReportValidator()

    equivalent = candidate()
    equivalent.findings[0].observation.text = (
        '显存峰值为 2,580,545,536 字节；Eval Loss 为 0.21480。'
    )
    issues = validator.validate(equivalent, evidence_pack, gate)
    assert not any(item.code == 'unsupported_number' for item in issues)

    negated = candidate()
    negated.summary += ' 不得声称模型可用，也不得将业务准确率归因于 Train Loss。'
    assert validator.validate(negated, evidence_pack, gate) == []

    suffix_negated = candidate()
    suffix_negated.limitations[0].text = (
        'Eval 只有单点，过拟合与收敛稳定性均无法判断。'
    )
    assert validator.validate(suffix_negated, evidence_pack, gate) == []

    cancelled = candidate()
    cancelled.summary = (
        'Attempt 已取消，不能把未完成过程表述为训练失败或低质量。'
    )
    cancelled_pack = pack(
        state='cancelled',
        facts={
            **success_facts(),
            'attempt': {
                **success_facts()['attempt'],
                'state': 'cancelled',
                'outcome': 'cancelled',
                'error_code': None,
            },
        },
    )
    cancelled_gate = GateEngine().evaluate(cancelled_pack)
    assert validator.validate(cancelled, cancelled_pack, cancelled_gate) == []

    cancelled.summary = '本次训练失败，质量较低。'
    issues = validator.validate(cancelled, cancelled_pack, cancelled_gate)
    assert any(item.code == 'forbidden_claim' for item in issues)


def test_golden_set_fixture_mode_passes_all_cases():
    result = evaluate_golden_set()

    assert result['case_count'] == len(GOLDEN_CASES) == 18
    assert result['run_count'] == 18
    assert result['failed'] == 0
    assert result['gate_fidelity'] == 1
    assert result['validator_clean_rate'] == 1
    assert result['first_pass_clean_rate'] == 1
    assert result['repair_attempts'] == 0
    assert result['repair_success_rate'] is None
    assert result['usage_totals']['reported_cases'] == 0
    assert result['forbidden_claim_rate'] == 0
    assert (
        result['validator_negative_checks']['total']
        == len(NEGATIVE_VALIDATOR_CASES)
        == 9
    )
    assert result['validator_negative_checks']['failed'] == 0
    assert result['validator_negative_checks']['rejection_rate'] == 1
    assert {
        item['case_id']
        for item in result['results']
        if not item['passed']
    } == set()


def test_golden_set_acceptance_coverage_is_derived_from_facts():
    by_id = {case.id: case for case in GOLDEN_CASES}
    gate_engine = GateEngine()

    accepted_pack = build_golden_pack(by_id['G08'])
    accepted_coverage = next(
        item
        for item in accepted_pack.coverage
        if item.category == 'inference_acceptance'
    )
    accepted_gate = gate_engine.evaluate(accepted_pack)
    assert accepted_coverage.status == 'available'
    assert accepted_gate.delivery_status == 'ready_for_release_review'

    other_pack = build_golden_pack(by_id['G09'])
    other_coverage = next(
        item
        for item in other_pack.coverage
        if item.category == 'inference_acceptance'
    )
    other_gate = gate_engine.evaluate(other_pack)
    assert other_coverage.status == 'available'
    assert (
        other_gate.delivery_status
        == 'artifact_deliverable_model_unverified'
    )


def test_golden_set_covers_failed_cancelled_and_missing_evidence_boundaries():
    by_id = {case.id: case for case in GOLDEN_CASES}
    gate_engine = GateEngine()

    failed = gate_engine.evaluate(build_golden_pack(by_id['G04']))
    assert failed.health_status == 'unknown'
    assert failed.delivery_status == 'not_deliverable'

    cancelled = gate_engine.evaluate(build_golden_pack(by_id['G05']))
    assert cancelled.health_status == 'unknown'
    assert cancelled.delivery_status == 'not_deliverable'
    assert any(
        '训练失败或低质量' in item.text
        for item in cancelled.health_reasons
    )

    missing = gate_engine.evaluate(build_golden_pack(by_id['G13']))
    assert missing.health_status == 'unknown'
    assert missing.delivery_status == 'unknown'


def test_model_context_boundary_tracks_acceptance_evidence():
    evidence_pack = pack()
    gate = GateEngine().evaluate(evidence_pack)
    context = build_context(evidence_pack, gate)
    assert '当前没有当前 Adapter 的独立推理验收记录' in context

    accepted = success_facts()
    accepted['inference_acceptance'] = [{
        'adapter_id': 'adapter-best',
        'adapter_fingerprint': 'a' * 64,
        'result': 'passed',
    }]
    accepted_pack = pack(facts=accepted, acceptance_available=True)
    accepted_gate = GateEngine().evaluate(accepted_pack)
    accepted_context = build_context(accepted_pack, accepted_gate)
    assert '当前没有当前 Adapter 的独立推理验收记录' not in accepted_context
    assert '"matched":true' in accepted_context

    other = success_facts()
    other['inference_acceptance'] = [{
        'adapter_id': 'adapter-other',
        'adapter_fingerprint': 'c' * 64,
        'result': 'passed',
    }]
    other_pack = pack(facts=other, acceptance_available=True)
    other_gate = GateEngine().evaluate(other_pack)
    other_context = build_context(other_pack, other_gate)
    assert '不能把该验收转移给当前 Best/Final' in other_context
    assert '"matched":false' in other_context


def test_redaction_handles_each_pattern_without_group_errors():
    value = _redact(
        'Authorization: Bearer abc.def password=hunter2 '
        'api_key=sk-secret token:zzz'
    )
    assert 'abc.def' not in value
    assert 'hunter2' not in value
    assert 'sk-secret' not in value
    assert 'zzz' not in value
    assert value.count('[redacted]') == 4


def test_adapter_reference_query_rejects_non_uuid_values():
    adapter_id = uuid.uuid4()
    assert EvidenceCollector._adapter_uuids({
        'best': {'id': str(adapter_id)},
        'final': {'id': 'not-a-uuid'},
    }) == [adapter_id]


def test_draft_is_unsubmitted_and_rejects_unknown_patch_fields():
    report = {
        'id': 'report-1',
        'attempt_id': str(ATTEMPT_ID),
        'next_experiments': [{
            'id': 'exp-1',
            'config_patch': {'num_train_epochs': 2, 'learning_rate': 0.0001},
        }],
    }
    draft = build_training_draft(
        report,
        experiment_id='exp-1',
        base_config={'epochs': 1, 'learning_rate': 0.0002},
    )
    assert draft['status'] == 'unsubmitted_draft'
    assert draft['draft_config']['epochs'] == 2
    assert draft['base_attempt_config']['epochs'] == 1
    assert draft['config_patch'] == {'epochs': 2, 'learning_rate': 0.0001}

    report['next_experiments'][0]['config_patch'] = {'batch_size': 2, 'command': 'rm -rf /'}
    with pytest.raises(AppError) as error:
        build_training_draft(
            report,
            experiment_id='exp-1',
            base_config={'epochs': 1},
        )
    assert error.value.code == 'draft_patch_not_allowed'


def test_fixed_langgraph_publishes_only_after_gate_and_validation():
    from langgraph.checkpoint.memory import InMemorySaver

    from modelforge.modules.diagnosis.graph import (
        build_diagnosis_graph,
        graph_config,
        initial_state,
    )

    evidence_pack = pack()
    job_id = uuid.uuid4()

    class FakeRepository:
        def __init__(self):
            self.gate = None
            self.published = None
            self.failed = None
            self.usage = None

        def load_evidence(self, requested_job):
            assert requested_job == job_id
            return evidence_pack

        def set_gate(self, requested_job, owner, fencing_token, gate):
            assert requested_job == job_id
            self.gate = gate

        def publish(self, report, *, owner, fencing_token):
            self.published = report.with_digest()
            return self.published

        def fail(self, requested_job, *, owner, fencing_token, error_code):
            self.failed = error_code

        def set_usage(self, requested_job, owner, fencing_token, usage):
            self.usage = usage

    class FakeGenerator:
        model_name = 'fixture-structured-model'

        def generate(self, context):
            assert 'diagnosis-prompt-context-v2' in context
            assert 'E-METRICS' in context
            return candidate()

        def repair(self, context, previous, issues):
            raise AssertionError('valid candidate must not be repaired')

        def usage(self):
            return {
                'schema': 'diagnosis-model-usage-v1',
                'model_calls': 1,
                'reported_calls': 1,
                'unreported_calls': 0,
                'prompt_tokens': 10,
                'completion_tokens': 5,
                'total_tokens': 15,
                'latency_ms': 20,
                'cost_estimate': None,
                'cost_note': 'provider_price_not_configured',
            }

    repository = FakeRepository()
    graph = build_diagnosis_graph(
        repository=repository,
        collector=object(),
        generator=FakeGenerator(),
        validator=ReportValidator(),
        checkpointer=InMemorySaver(),
        job_id=job_id,
        attempt_id=ATTEMPT_ID,
        owner='worker-1',
        fencing_token=1,
    )
    result = graph.invoke(
        initial_state(job_id, ATTEMPT_ID),
        config=graph_config(job_id),
    )
    assert result['report_id'] == str(repository.published.id)
    assert repository.failed is None
    assert repository.usage['total_tokens'] == 15
    assert repository.gate.health_status == 'partial'
    assert repository.published.health.status == 'partial'
    assert (
        repository.published.delivery.status
        == 'artifact_deliverable_model_unverified'
    )


def test_usage_extraction_does_not_invent_missing_tokens():
    message = SimpleNamespace(usage_metadata={
        'input_tokens': 120,
        'output_tokens': 30,
        'total_tokens': 150,
    })
    response = SimpleNamespace(
        generations=[[SimpleNamespace(message=message)]],
        llm_output=None,
    )
    assert _extract_usage(response) == {
        'prompt_tokens': 120,
        'completion_tokens': 30,
        'total_tokens': 150,
    }

    fallback = SimpleNamespace(
        generations=[],
        llm_output={
            'token_usage': {
                'prompt_tokens': 8,
                'completion_tokens': 2,
                'total_tokens': 10,
            },
        },
    )
    assert _extract_usage(fallback)['total_tokens'] == 10
    assert _extract_usage(SimpleNamespace(
        generations=[],
        llm_output=None,
    )) is None

    accumulator = _UsageAccumulator()
    accumulator.start('call-1')
    accumulator.finish('call-1', response)
    accumulator.start('call-2')
    accumulator.finish('call-2')
    usage = accumulator.snapshot()
    assert usage['model_calls'] == 2
    assert usage['reported_calls'] == 1
    assert usage['unreported_calls'] == 1
    assert usage['total_tokens'] == 150
    assert usage['latency_ms'] >= 0
    assert usage['cost_estimate'] is None


def test_lease_heartbeat_renews_while_work_is_in_flight():
    class Repository:
        def __init__(self):
            self.calls = 0
            self.observed = threading.Event()

        def heartbeat(self, job_id, owner, fencing_token, lease_seconds):
            self.calls += 1
            if self.calls >= 2:
                self.observed.set()
            return True

    repository = Repository()
    with LeaseHeartbeat(
        repository,
        job_id=uuid.uuid4(),
        owner='worker-1',
        fencing_token=3,
        lease_seconds=30,
        interval_seconds=0.01,
    ) as heartbeat:
        assert repository.observed.wait(1)

    assert repository.calls >= 2
    assert not heartbeat.lost


def test_lease_heartbeat_fails_closed_after_lease_is_lost():
    class Repository:
        def __init__(self):
            self.observed = threading.Event()

        def heartbeat(self, job_id, owner, fencing_token, lease_seconds):
            self.observed.set()
            return False

    repository = Repository()
    with LeaseHeartbeat(
        repository,
        job_id=uuid.uuid4(),
        owner='worker-1',
        fencing_token=3,
        lease_seconds=30,
        interval_seconds=0.01,
    ) as heartbeat:
        assert repository.observed.wait(1)

    assert heartbeat.lost
    with pytest.raises(AppError) as error:
        heartbeat.raise_if_lost()
    assert error.value.code == 'diagnosis_lease_lost'


@pytest.mark.skipif(
    os.getenv('MF_AI_LIVE_EVAL') != '1',
    reason='set MF_AI_LIVE_EVAL=1 with a real OpenAI-compatible model to run',
)
def test_live_model_output_is_contract_valid_and_evidence_bound():
    settings = get_settings()
    if not settings.ai_model or settings.ai_api_key is None:
        pytest.skip('real model name and credentials are not configured')

    evidence_pack = pack()
    gate = GateEngine().evaluate(evidence_pack)
    generator = LangChainOpenAIGenerator(settings)
    candidate_report = generator.generate(
        build_context(evidence_pack, gate)
    )
    issues = ReportValidator().validate(
        candidate_report,
        evidence_pack,
        gate,
    )
    assert not issues, [
        {'code': issue.code, 'path': issue.path}
        for issue in issues
    ]
