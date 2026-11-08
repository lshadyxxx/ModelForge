from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import pytest

from modelforge.errors import AppError
from modelforge.modules.diagnosis.comparison import (
    ComparisonEngine,
    RELATIVE_EVAL_EPSILON,
)
from modelforge.modules.diagnosis.comparison_repository import ComparisonRepository
from modelforge.modules.diagnosis.context import build_context
from modelforge.modules.diagnosis.contracts import (
    BaselineEvidenceProjection,
    BaselineSelection,
    CandidateReport,
    Claim,
    ComparisonResult,
    EvidenceCoverage,
    EvidencePack,
    EvidencePackV2,
    EvidenceRef,
    GateResult,
    ModelEffect,
    SourceRevision,
    digest,
    parse_evidence_pack,
)
from modelforge.modules.diagnosis.gates import GateEngine
from modelforge.modules.diagnosis import use_cases as use_cases_module
from modelforge.modules.diagnosis.use_cases import DiagnosisUseCases
from modelforge.modules.diagnosis.validator import ReportValidator


NOW = datetime(2026, 11, 8, tzinfo=timezone.utc)
SUBJECT_ID = uuid.UUID('11111111-1111-1111-1111-111111111111')
BASELINE_ID = uuid.UUID('22222222-2222-2222-2222-222222222222')

DEFAULT_CONFIG = {
    'epochs': 1,
    'learning_rate': 2e-4,
    'cutoff_len': 512,
    'batch_size': 1,
    'gradient_accumulation': 1,
    'lora_rank': 8,
    'lora_alpha': 16,
    'lora_dropout': 0.0,
    'scheduler': 'cosine',
    'warmup_ratio': 0.0,
    'template': 'qwen3_nothink',
    'seed': 42,
}


def snapshot(
    *,
    config=None,
    base='base-a',
    dataset='dataset-a',
    split='split-a',
    image='image-a',
):
    values = dict(DEFAULT_CONFIG)
    values.update(config or {})
    return {
        'base': {'fingerprint': base},
        'dataset': {'sha256': dataset, 'split_sha256': split},
        'config': values,
        'instance': {'gpu_type': 'RTX 4090'},
        'training_image_profile': {'id': image},
    }


def facts(
    *,
    eval_loss=0.30,
    eval_points=3,
    config=None,
    runtime_lock='lock-a',
    gpu='RTX 4090',
    token_overflow=0,
    runtime_mismatch=False,
    ready=True,
    logs_gap=False,
    **snapshot_values,
):
    points = []
    total_steps = max(eval_points, 2)
    eval_start = total_steps - eval_points + 1 if eval_points else total_steps + 1
    for step in range(1, total_steps + 1):
        points.append({
            'step': step,
            'loss': 0.5 - step * 0.01,
            'eval_loss': eval_loss if step >= eval_start else None,
            'learning_rate': 2e-4,
        })
    eval_metrics = [point for point in points if point.get('eval_loss') is not None]
    adapters = {
        'best': {
            'id': str(uuid.uuid4()),
            'role': 'best',
            'state': 'available',
            'fingerprint': 'a' * 64,
            'metrics': {'eval_loss': eval_loss},
        },
        'final': {
            'id': str(uuid.uuid4()),
            'role': 'final',
            'state': 'available',
            'fingerprint': 'b' * 64,
            'metrics': {'eval_loss': eval_loss},
        },
    }
    runtime = {
        'ready': ready,
        'lock_id': runtime_lock,
        'gpu': gpu,
        'mismatches': [{'field': 'cuda'}] if runtime_mismatch else [],
        'training_memory': {
            'device_peak_used_bytes': 1024,
            'sampler_error': None,
        },
    }
    return {
        'attempt': {
            'id': str(SUBJECT_ID),
            'state': 'succeeded',
            'number': 1,
            'created_at': NOW.isoformat(),
        },
        'snapshot': snapshot(**snapshot_values, config=config),
        'metrics': {
            'points': points,
            'counts': {
                'train': len(points),
                'eval': len(eval_metrics),
                'learning_rate': len(points),
            },
            'latest_eval': eval_metrics[-1] if eval_metrics else None,
            'lowest_eval': eval_metrics[0] if eval_metrics else None,
            'last_train': points[-1],
        },
        'token_preflight': {'overflow': [{} for _ in range(token_overflow)]},
        'runtime': runtime,
        'memory': runtime['training_memory'],
        'manifest': {'diagnostic_gap': False, 'files': []},
        'logs': {'chunks_received': 1, 'gap': logs_gap, 'excerpt': None},
        'adapters': adapters,
        'inference_trials': [],
        'inference_acceptance': [],
    }


def gate(
    *,
    health='healthy',
    delivery='artifact_deliverable_model_unverified',
):
    return GateResult(
        policy_version='gate-test',
        health_status=health,
        delivery_status=delivery,
        coverage=[],
    ).with_digest()


def pack(value=None):
    value = value or facts()
    return EvidencePackV2(
        attempt_id=SUBJECT_ID,
        evidence_cutoff_at=NOW,
        attempt_state='succeeded',
        source_revision=SourceRevision(
            attempt_updated_at=NOW,
            snapshot_sha256='c' * 64,
        ),
        coverage=[],
        evidence=[
            EvidenceRef(
                id='E-ATTEMPT',
                kind='attempt',
                source_locator='test/attempt',
                coverage='available',
            ),
            EvidenceRef(
                id='E-METRICS',
                kind='metrics',
                source_locator='test/metrics',
                coverage='available',
            ),
        ],
        facts=value,
    ).with_digest()


def projection(value=None, *, baseline_gate=None):
    value = value or facts()
    baseline_gate = baseline_gate or gate()
    return BaselineEvidenceProjection(
        attempt_id=BASELINE_ID,
        snapshot_sha256='d' * 64,
        attempt_state='succeeded',
        facts=value,
        coverage=[
            EvidenceCoverage(
                category='metrics',
                status='available',
                evidence_ids=['E-BASE-METRICS'],
            )
        ],
        evidence=[
            EvidenceRef(
                id='E-BASE-ATTEMPT',
                kind='attempt',
                source_locator='test/baseline/attempt',
                coverage='available',
            ),
            EvidenceRef(
                id='E-BASE-METRICS',
                kind='metrics',
                source_locator='test/baseline/metrics',
                coverage='available',
            ),
        ],
        gate=baseline_gate,
        source_revision=SourceRevision(
            attempt_updated_at=NOW,
            snapshot_sha256='d' * 64,
        ),
    ).with_digest()


def selection(mode='explicit'):
    return BaselineSelection(
        mode=mode,
        requested_attempt_id=BASELINE_ID if mode == 'explicit' else None,
        resolved_attempt_id=BASELINE_ID,
        selection_rule='explicit' if mode == 'explicit' else 'latest_previous_success',
    )


def compare(subject=None, baseline=None, **kwargs):
    return ComparisonEngine().compare(
        pack(subject),
        kwargs.pop('subject_gate', gate()),
        baseline=projection(baseline),
        selection=selection(),
    )


def test_c01_improved_and_high_confidence():
    result = compare(
        facts(eval_loss=0.291, config={'learning_rate': 1e-4}),
        facts(eval_loss=0.300, config={'learning_rate': 2e-4}),
    )
    assert result.training_signal == 'improved'
    assert result.confidence == 'high'
    assert result.model_effect.status == 'unverified'
    assert result.comparability_status == 'strict'


def test_c02_worsened():
    result = compare(facts(eval_loss=0.309), facts(eval_loss=0.300))
    assert result.training_signal == 'worsened'


def test_c03_flat_uses_two_percent_policy():
    result = compare(facts(eval_loss=0.301), facts(eval_loss=0.300))
    assert abs(0.301 - 0.300) / 0.300 <= RELATIVE_EVAL_EPSILON
    assert result.training_signal == 'flat'


def test_c04_single_eval_is_low_confidence():
    result = compare(
        facts(eval_loss=0.291, eval_points=1),
        facts(eval_loss=0.300, eval_points=1),
    )
    assert result.confidence == 'low'
    assert any(item.code == 'eval_coverage_low' for item in result.confounders)


def test_c05_multiple_parameters_are_not_single_attributed():
    result = compare(
        facts(eval_loss=0.291, config={'learning_rate': 1e-4, 'lora_rank': 16}),
        facts(eval_loss=0.300),
    )
    assert any(
        item.code == 'multiple_parameters_changed'
        for item in result.confounders
    )


def test_c06_seed_change_is_stochastic_confounder():
    result = compare(
        facts(eval_loss=0.291, config={'seed': 43}),
        facts(eval_loss=0.300, config={'seed': 42}),
    )
    assert any(item.code == 'seed_changed' for item in result.confounders)


def test_c07_runtime_lock_change_is_conditional():
    result = compare(
        facts(runtime_lock='lock-b'),
        facts(runtime_lock='lock-a'),
    )
    assert result.comparability_status == 'conditional'
    assert any(item.code == 'runtime_lock_changed' for item in result.confounders)


def test_c08_gpu_change_is_conditional():
    result = compare(
        facts(gpu='A10'),
        facts(gpu='RTX 4090'),
    )
    assert result.comparability_status == 'conditional'
    assert any(item.code == 'gpu_changed' for item in result.confounders)


@pytest.mark.parametrize(
    ('subject_values', 'code'),
    [
        ({'dataset': 'dataset-b'}, 'C09'),
        ({'split': 'split-b'}, 'C10'),
    ],
)
def test_hard_key_mismatch_is_not_comparable(subject_values, code):
    result = compare(
        facts(eval_loss=0.291, **subject_values),
        facts(eval_loss=0.300),
    )
    assert code in {'C09', 'C10'}
    assert result.comparability_status == 'not_comparable'
    assert result.training_signal == 'inconclusive'


def test_c11_no_baseline_is_explicit():
    result = ComparisonEngine().compare(pack(), gate())
    assert result.comparability_status == 'no_baseline'
    assert result.selection.mode == 'none'
    assert result.model_effect.status == 'unverified'


def test_c12_baseline_metrics_missing_is_inconclusive():
    missing = facts(eval_points=0)
    missing['adapters']['best']['metrics'] = {}
    missing['adapters']['final']['metrics'] = {}
    result = compare(facts(eval_loss=0.291), missing)
    assert result.training_signal == 'inconclusive'
    assert any(item.code == 'baseline_metrics_missing' for item in result.confounders)


def test_c13_token_overflow_regression_makes_improvement_mixed():
    result = compare(
        facts(eval_loss=0.291, token_overflow=2),
        facts(eval_loss=0.300, token_overflow=0),
    )
    assert result.training_signal == 'mixed'
    assert any(item['code'] == 'token_overflow_increased' for item in result.regressions)


def test_c14_runtime_mismatch_regression_makes_improvement_mixed():
    result = compare(
        facts(eval_loss=0.291, runtime_mismatch=True),
        facts(eval_loss=0.300, runtime_mismatch=False),
    )
    assert result.training_signal == 'mixed'
    assert any(item['code'] == 'runtime_mismatch' for item in result.regressions)


def test_c15_failed_baseline_cannot_enter_projection_contract():
    with pytest.raises(ValueError):
        BaselineEvidenceProjection(
            attempt_id=BASELINE_ID,
            snapshot_sha256='d' * 64,
            attempt_state='failed',
            facts={},
            coverage=[],
            evidence=[],
            gate=gate(),
            source_revision=SourceRevision(
                attempt_updated_at=NOW,
                snapshot_sha256='d' * 64,
            ),
        )


def test_comparison_digest_is_repeatable():
    first = compare(facts(eval_loss=0.291), facts(eval_loss=0.300))
    second = compare(facts(eval_loss=0.291), facts(eval_loss=0.300))
    assert first.comparison_digest == second.comparison_digest


def _comparison_for_validator():
    return ComparisonResult(
        policy_version='training-comparison-policy-v1',
        group=ComparisonEngine().compare(pack(), gate()).group,
        selection=selection(),
        comparability_status='conditional',
        confidence='low',
        training_signal='improved',
        delivery_signal='same',
        model_effect=ModelEffect(
            status='unverified',
            reason='no_comparable_downstream_evaluation',
            note='未验证',
        ),
        evidence_ids=['E-ATTEMPT', 'E-BASE-ATTEMPT', 'E-COMPARE-CONCLUSION'],
    ).with_digest()


def _candidate(text='训练信号改善，但模型效果未验证。', evidence_ids=None):
    return CandidateReport(
        summary=text,
        claims=[Claim(
            id='CLM-001',
            layer='observation',
            text=text,
            evidence_ids=evidence_ids or ['E-ATTEMPT', 'E-BASE-ATTEMPT'],
        )],
    )


def test_c16_validator_rejects_model_effect_overclaim():
    comparison = _comparison_for_validator()
    candidate = _candidate(
        '本次微调成功，模型效果更好。',
        ['E-ATTEMPT', 'E-BASE-ATTEMPT'],
    )
    issues = ReportValidator().validate(
        candidate,
        pack(),
        gate(),
        comparison=comparison,
        baseline_gate=gate(),
    )
    assert any(item.code == 'model_effect_overclaim' for item in issues)


def test_c17_validator_requires_baseline_evidence():
    comparison = _comparison_for_validator()
    candidate = _candidate('Best Eval Loss 较基线改善。', ['E-ATTEMPT'])
    issues = ReportValidator().validate(
        candidate,
        pack(),
        gate(),
        comparison=comparison,
        baseline_gate=gate(),
    )
    assert any(item.code == 'comparison_evidence_missing' for item in issues)


def test_c18_validator_rejects_unfrozen_number():
    comparison = _comparison_for_validator()
    candidate = _candidate('较基线改善 0.99。', ['E-ATTEMPT', 'E-BASE-ATTEMPT'])
    issues = ReportValidator().validate(
        candidate,
        pack(),
        gate(),
        comparison=comparison,
        baseline_gate=gate(),
    )
    assert any(item.code == 'unsupported_number' for item in issues)


def test_no_baseline_validator_rejects_historical_claim():
    candidate = _candidate('本次较基线改善。', ['E-ATTEMPT'])
    issues = ReportValidator().validate(candidate, pack(), gate())
    assert any(item.code == 'comparison_without_baseline' for item in issues)


def test_comparison_context_contains_dual_evidence_and_unverified_boundary():
    comparison = _comparison_for_validator()
    baseline = projection()
    context = build_context(
        pack(),
        gate(),
        comparison=comparison,
        baseline_gate=baseline.gate,
    )
    assert 'diagnosis-prompt-context-v2' in context
    assert 'comparison' in context
    assert 'E-BASE-ATTEMPT' in context
    assert '模型效果未验证' in context or 'unverified' in context


class _FakeTraining:
    def __init__(self, attempt):
        self.attempt = attempt

    def get(self, attempt_id):
        assert attempt_id == uuid.UUID(str(self.attempt['id']))
        return self.attempt


class _FakeDiagnosisRepository:
    def __init__(self):
        self.created = None

    def create_job(self, attempt_id, **kwargs):
        self.created = {'attempt_id': attempt_id, **kwargs}
        return {'id': uuid.uuid4(), 'state': 'queued'}, True

    def get_job(self, job_id):
        return {
            'job_id': job_id,
            'attempt_id': SUBJECT_ID,
            'state': 'queued',
        }


def _use_cases_for_attempt(monkeypatch, attempt):
    fake_repository = _FakeDiagnosisRepository()
    monkeypatch.setattr(
        use_cases_module,
        'Training',
        lambda resources: _FakeTraining(attempt),
    )
    monkeypatch.setattr(
        use_cases_module,
        'DiagnosisRepository',
        lambda resources: fake_repository,
    )
    resources = SimpleNamespace(
        settings=SimpleNamespace(ai_enabled=True, ai_model='test-model'),
        pool=object(),
    )
    service = DiagnosisUseCases(resources)
    return service, fake_repository


def test_failed_subject_explicit_comparison_is_rejected(monkeypatch):
    attempt = {
        'id': SUBJECT_ID,
        'state': 'failed',
        'snapshot_sha256': 'c' * 64,
    }
    service, _ = _use_cases_for_attempt(monkeypatch, attempt)

    class RejectingComparison:
        def __init__(self, resources):
            pass

        def resolve(self, *args, **kwargs):
            raise AppError(
                409,
                'subject_not_succeeded_for_comparison',
                '失败或取消的 Attempt 不做训练效果对比。',
            )

    monkeypatch.setattr(
        use_cases_module,
        'ComparisonRepository',
        RejectingComparison,
    )
    with pytest.raises(AppError) as caught:
        service.create(
            SUBJECT_ID,
            comparison_mode='explicit',
            baseline_attempt_id=BASELINE_ID,
        )
    assert caught.value.code == 'subject_not_succeeded_for_comparison'


def test_failed_subject_auto_creates_single_run_job(monkeypatch):
    attempt = {
        'id': SUBJECT_ID,
        'state': 'failed',
        'snapshot_sha256': 'c' * 64,
    }
    service, repository = _use_cases_for_attempt(monkeypatch, attempt)

    class NoResolveComparison:
        def __init__(self, resources):
            pass

        def resolve(self, *args, **kwargs):
            raise AssertionError('failed subject must not resolve a baseline')

    monkeypatch.setattr(
        use_cases_module,
        'ComparisonRepository',
        NoResolveComparison,
    )
    job = service.create(SUBJECT_ID, comparison_mode='auto')
    assert job['state'] == 'queued'
    assert repository.created['comparison_mode'] == 'auto'
    assert repository.created['baseline_attempt_id'] is None


def test_failed_attempt_cannot_query_comparison_candidates():
    repository = object.__new__(ComparisonRepository)
    repository.training = _FakeTraining({
        'id': SUBJECT_ID,
        'state': 'failed',
    })
    with pytest.raises(AppError) as caught:
        repository._comparison_subject(SUBJECT_ID)
    assert caught.value.code == 'subject_not_succeeded_for_comparison'


def test_v1_evidence_pack_still_parses_after_v2_contract():
    v2 = pack()
    original = EvidencePack(
        **v2.model_dump(mode='json', exclude={
            'schema_version',
            'comparison',
            'canonical_digest',
        })
    ).with_digest()
    parsed = parse_evidence_pack(original.model_dump(mode='json'))
    assert parsed.schema_version == 'evidence-pack-v1'
    assert parsed.canonical_digest == original.canonical_digest
