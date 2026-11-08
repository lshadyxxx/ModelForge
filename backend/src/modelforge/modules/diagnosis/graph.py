"""Fixed LangGraph workflow for one advisory diagnosis job."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, TypedDict

from modelforge.errors import AppError

from .comparison import ComparisonEngine
from .comparison_repository import ComparisonRepository
from .context import build_context
from .contracts import (
    AdvisoryReportV2,
    BaselineEvidenceProjection,
    BaselineSelection,
    CandidateReport,
    ComparisonResult,
    EvidencePack,
    EvidencePackV2,
    GateAxis,
    GateResult,
    ValidationIssue,
    digest,
    parse_evidence_pack,
)
from .evidence import with_comparison
from .gates import GateEngine
from .generator import GENERATOR_VERSION
from .prompts import PROMPT_VERSION


GRAPH_VERSION = 'training-diagnosis-graph-v2'

_HEALTH_LABELS = {
    'healthy': '训练健康',
    'attention': '需要关注',
    'blocked': '结论已阻断',
    'partial': '部分可判断',
    'unknown': '无法判断',
}
_DELIVERY_LABELS = {
    'not_deliverable': '当前不可交付',
    'artifact_deliverable_model_unverified': '产物可下发，模型可用性未验证',
    'ready_for_release_review': '可进入发布评审',
    'unknown': '无法判断',
}


class DiagnosisState(TypedDict, total=False):
    job_id: str
    attempt_id: str
    comparison_mode: str
    baseline_attempt_id: str | None
    subject_pack: dict[str, Any]
    baseline_projection: dict[str, Any] | None
    selection: dict[str, Any]
    subject_gate: dict[str, Any]
    baseline_gate: dict[str, Any] | None
    comparison: dict[str, Any] | None
    evidence_frozen: bool
    evidence_digest: str
    baseline_evidence_digest: str | None
    candidate_report: dict[str, Any]
    validation_issues: list[dict[str, Any]]
    repair_count: int
    report_id: str
    error_code: str


def _issue_state(issues: list[ValidationIssue]) -> list[dict[str, Any]]:
    return [item.model_dump(mode='json') for item in issues]


def _axis(status: str, reasons: list[dict[str, Any]], labels: dict[str, str]) -> GateAxis:
    return GateAxis(
        status=status,
        label=labels.get(status, status),
        rationale='；'.join(
            item['text'] for item in reasons[:4]
        ) or '当前没有额外门禁说明。',
        evidence_ids=list(dict.fromkeys(
            evidence_id
            for item in reasons
            for evidence_id in item.get('evidence_ids', [])
        )),
    )


def _generator_usage(generator) -> dict[str, Any] | None:
    read = getattr(generator, 'usage', None)
    if not callable(read):
        return None
    usage = read()
    return usage if isinstance(usage, dict) else None


def _load_frozen_evidence(repository, job_id: uuid.UUID):
    try:
        return repository.load_evidence(job_id), True
    except AppError as error:
        if error.code != 'diagnosis_evidence_not_found':
            raise
        return None, False


def build_diagnosis_graph(
    *,
    repository,
    collector,
    generator,
    validator,
    checkpointer,
    job_id: uuid.UUID,
    attempt_id: uuid.UUID,
    owner: str,
    fencing_token: int,
    comparison_mode: str = 'none',
    baseline_attempt_id: uuid.UUID | None = None,
):
    from langgraph.graph import END, START, StateGraph

    gate_engine = GateEngine()
    comparison_engine = ComparisonEngine()

    def collect_subject(state: DiagnosisState) -> DiagnosisState:
        pack, frozen = _load_frozen_evidence(repository, job_id)
        if pack is None:
            pack = collector.collect(attempt_id)
        if pack.attempt_id != attempt_id:
            raise AppError(
                409,
                'diagnosis_evidence_attempt_mismatch',
                'Frozen evidence belongs to a different Attempt',
            )
        baseline_projection = None
        selection = BaselineSelection(mode='none', selection_rule='none')
        comparison = None
        if isinstance(pack, EvidencePackV2) and pack.comparison is not None:
            comparison = pack.comparison.comparison_result
            baseline_projection = pack.comparison.baseline
            selection = comparison.selection
        return {
            'job_id': str(job_id),
            'attempt_id': str(attempt_id),
            'comparison_mode': comparison_mode,
            'baseline_attempt_id': (
                str(baseline_attempt_id)
                if baseline_attempt_id is not None else None
            ),
            'subject_pack': pack.model_dump(mode='json'),
            'baseline_projection': (
                baseline_projection.model_dump(mode='json')
                if baseline_projection is not None else None
            ),
            'selection': selection.model_dump(mode='json'),
            'comparison': (
                comparison.model_dump(mode='json')
                if comparison is not None else None
            ),
            'evidence_frozen': frozen,
            'evidence_digest': pack.canonical_digest or '',
            'baseline_evidence_digest': (
                baseline_projection.canonical_digest
                if baseline_projection is not None else None
            ),
            'repair_count': state.get('repair_count', 0),
        }

    def collect_baseline(state: DiagnosisState) -> DiagnosisState:
        if state.get('evidence_frozen'):
            return {}
        if comparison_mode == 'none':
            return {
                'baseline_projection': None,
                'selection': BaselineSelection(
                    mode='none',
                    selection_rule='none',
                ).model_dump(mode='json'),
            }
        if baseline_attempt_id is None:
            return {
                'baseline_projection': None,
                'selection': BaselineSelection(
                    mode=comparison_mode,
                    selection_rule='not_available',
                    reason_code=(
                        'subject_not_succeeded_for_comparison'
                        if comparison_mode == 'auto'
                        else 'no_prior_successful_run_with_metrics'
                    ),
                ).model_dump(mode='json'),
            }
        try:
            ComparisonRepository(collector.resources).assert_resolved_baseline(
                attempt_id,
                baseline_attempt_id,
            )
            baseline = collector.collect_baseline(baseline_attempt_id)
        except AppError as error:
            raise AppError(
                409,
                'comparison_evidence_changed',
                '比较基线在任务排队后发生变化，已阻止生成。',
            ) from error
        selection = BaselineSelection(
            mode=comparison_mode,
            requested_attempt_id=(
                baseline_attempt_id
                if comparison_mode == 'explicit' else None
            ),
            resolved_attempt_id=baseline_attempt_id,
            selection_rule=(
                'explicit'
                if comparison_mode == 'explicit'
                else 'latest_previous_success'
            ),
        )
        return {
            'baseline_projection': baseline.model_dump(mode='json'),
            'selection': selection.model_dump(mode='json'),
            'baseline_evidence_digest': baseline.canonical_digest,
        }

    def gate_subject(state: DiagnosisState) -> DiagnosisState:
        pack = parse_evidence_pack(state['subject_pack'])
        result = gate_engine.evaluate(pack)
        repository.set_gate(job_id, owner, fencing_token, result)
        return {
            'subject_gate': result.model_dump(mode='json'),
        }

    def gate_baseline(state: DiagnosisState) -> DiagnosisState:
        baseline = state.get('baseline_projection')
        if baseline is None:
            return {'baseline_gate': None}
        projection = BaselineEvidenceProjection.model_validate(baseline)
        return {
            'baseline_gate': projection.gate.model_dump(mode='json'),
        }

    def compare(state: DiagnosisState) -> DiagnosisState:
        if state.get('comparison'):
            return {}
        pack = parse_evidence_pack(state['subject_pack'])
        subject_gate = GateResult.model_validate(state['subject_gate'])
        baseline = (
            BaselineEvidenceProjection.model_validate(
                state['baseline_projection']
            )
            if state.get('baseline_projection') else None
        )
        selection = BaselineSelection.model_validate(state['selection'])
        result = comparison_engine.compare(
            pack,
            subject_gate,
            baseline=baseline,
            selection=selection,
        )
        if result.comparability_status == 'not_comparable':
            raise AppError(
                409,
                'comparison_evidence_changed',
                '比较证据在冻结时不再满足硬可比条件。',
            )
        if not state.get('evidence_frozen'):
            comparable = with_comparison(pack, result, baseline)
            comparable = repository.freeze_evidence(
                job_id,
                comparable,
                owner=owner,
                fencing_token=fencing_token,
            )
            return {
                'subject_pack': comparable.model_dump(mode='json'),
                'evidence_frozen': True,
                'evidence_digest': comparable.canonical_digest or '',
                'baseline_evidence_digest': (
                    baseline.canonical_digest if baseline is not None else None
                ),
                'comparison': result.model_dump(mode='json'),
            }
        return {
            'comparison': result.model_dump(mode='json'),
        }

    def generate(state: DiagnosisState) -> DiagnosisState:
        pack = parse_evidence_pack(state['subject_pack'])
        gate = GateResult.model_validate(state['subject_gate'])
        baseline_gate = (
            GateResult.model_validate(state['baseline_gate'])
            if state.get('baseline_gate') else None
        )
        comparison = (
            ComparisonResult.model_validate(state['comparison'])
            if state.get('comparison') else None
        )
        context = build_context(
            pack,
            gate,
            comparison=comparison,
            baseline_gate=baseline_gate,
        )
        candidate = generator.generate(context)
        return {
            'candidate_report': candidate.model_dump(mode='json'),
            'validation_issues': [],
        }

    def validate(state: DiagnosisState) -> DiagnosisState:
        pack = parse_evidence_pack(state['subject_pack'])
        gate = GateResult.model_validate(state['subject_gate'])
        baseline_gate = (
            GateResult.model_validate(state['baseline_gate'])
            if state.get('baseline_gate') else None
        )
        comparison = (
            ComparisonResult.model_validate(state['comparison'])
            if state.get('comparison') else None
        )
        candidate = CandidateReport.model_validate(state['candidate_report'])
        issues = validator.validate(
            candidate,
            pack,
            gate,
            comparison=comparison,
            baseline_gate=baseline_gate,
        )
        return {'validation_issues': _issue_state(issues)}

    def repair(state: DiagnosisState) -> DiagnosisState:
        pack = parse_evidence_pack(state['subject_pack'])
        gate = GateResult.model_validate(state['subject_gate'])
        baseline_gate = (
            GateResult.model_validate(state['baseline_gate'])
            if state.get('baseline_gate') else None
        )
        comparison = (
            ComparisonResult.model_validate(state['comparison'])
            if state.get('comparison') else None
        )
        candidate = CandidateReport.model_validate(state['candidate_report'])
        issues = [
            ValidationIssue.model_validate(item)
            for item in state.get('validation_issues', [])
        ]
        context = build_context(
            pack,
            gate,
            repair_issues=issues,
            previous_candidate=candidate.model_dump(mode='json'),
            comparison=comparison,
            baseline_gate=baseline_gate,
        )
        repaired = generator.repair(context, candidate, issues)
        return {
            'candidate_report': repaired.model_dump(mode='json'),
            'repair_count': 1,
        }

    def validation_route(state: DiagnosisState) -> str:
        if not state.get('validation_issues'):
            return 'publish'
        if int(state.get('repair_count') or 0) < 1:
            return 'repair'
        return 'fail'

    def publish(state: DiagnosisState) -> DiagnosisState:
        pack = parse_evidence_pack(state['subject_pack'])
        gate_result = GateResult.model_validate(state['subject_gate'])
        baseline_gate = (
            GateResult.model_validate(state['baseline_gate'])
            if state.get('baseline_gate') else None
        )
        comparison = ComparisonResult.model_validate(state['comparison'])
        candidate = CandidateReport.model_validate(state['candidate_report'])
        health_reasons = [
            item.model_dump(mode='json') for item in gate_result.health_reasons
        ]
        delivery_reasons = [
            item.model_dump(mode='json') for item in gate_result.delivery_reasons
        ]
        generated_at = datetime.now(timezone.utc)
        usage = _generator_usage(generator)
        if usage:
            repository.set_usage(
                job_id,
                owner,
                fencing_token,
                usage,
            )
        baseline = (
            BaselineEvidenceProjection.model_validate(
                state['baseline_projection']
            )
            if state.get('baseline_projection') else None
        )
        input_digest = digest({
            'subject_evidence': pack.canonical_digest,
            'baseline_evidence': (
                baseline.canonical_digest if baseline is not None else None
            ),
            'subject_gate': gate_result.gate_digest,
            'baseline_gate': (
                baseline_gate.gate_digest if baseline_gate is not None else None
            ),
            'comparison': comparison.comparison_digest,
        })
        report = AdvisoryReportV2(
            id=uuid.uuid4(),
            job_id=job_id,
            attempt_id=attempt_id,
            version=1,
            report_mode='full' if pack.attempt_state == 'succeeded' else 'limited',
            freshness='current',
            integrity=(
                'conflict'
                if (
                    any(item.blocking for item in pack.conflicts)
                    or (
                        baseline_gate is not None
                        and any(
                            item.blocking
                            for item in baseline_gate.conflicts
                        )
                    )
                )
                else 'consistent'
            ),
            health=_axis(
                gate_result.health_status,
                health_reasons,
                _HEALTH_LABELS,
            ),
            delivery=_axis(
                gate_result.delivery_status,
                delivery_reasons,
                _DELIVERY_LABELS,
            ),
            summary=candidate.summary,
            claims=candidate.claims,
            findings=candidate.findings,
            limitations=candidate.limitations,
            next_experiments=candidate.next_experiments,
            source_revision=pack.source_revision,
            policy_version=gate_result.policy_version,
            graph_version=GRAPH_VERSION,
            prompt_version=PROMPT_VERSION,
            generator_version=GENERATOR_VERSION,
            model_name=generator.model_name,
            input_digest=input_digest,
            generated_at=generated_at,
            published_at=generated_at,
            baseline_attempt_id=comparison.selection.resolved_attempt_id,
            comparison=comparison,
        )
        published = repository.publish(
            report,
            owner=owner,
            fencing_token=fencing_token,
        )
        return {'report_id': str(published.id)}

    def fail(state: DiagnosisState) -> DiagnosisState:
        error_code = (
            'diagnosis_validation_failed'
            if state.get('validation_issues')
            else 'diagnosis_workflow_failed'
        )
        usage = _generator_usage(generator)
        if usage:
            repository.set_usage(
                job_id,
                owner,
                fencing_token,
                usage,
            )
        repository.fail(
            job_id,
            owner=owner,
            fencing_token=fencing_token,
            error_code=error_code,
        )
        return {'error_code': error_code}

    builder = StateGraph(DiagnosisState)
    builder.add_node('collect_subject', collect_subject)
    builder.add_node('collect_baseline', collect_baseline)
    builder.add_node('gate_subject', gate_subject)
    builder.add_node('gate_baseline', gate_baseline)
    builder.add_node('compare', compare)
    builder.add_node('generate', generate)
    builder.add_node('validate', validate)
    builder.add_node('repair', repair)
    builder.add_node('publish', publish)
    builder.add_node('fail', fail)
    builder.add_edge(START, 'collect_subject')
    builder.add_edge('collect_subject', 'collect_baseline')
    builder.add_edge('collect_baseline', 'gate_subject')
    builder.add_edge('gate_subject', 'gate_baseline')
    builder.add_edge('gate_baseline', 'compare')
    builder.add_edge('compare', 'generate')
    builder.add_edge('generate', 'validate')
    builder.add_conditional_edges(
        'validate',
        validation_route,
        {
            'publish': 'publish',
            'repair': 'repair',
            'fail': 'fail',
        },
    )
    builder.add_edge('repair', 'validate')
    builder.add_edge('publish', END)
    builder.add_edge('fail', END)
    return builder.compile(checkpointer=checkpointer)


def initial_state(job_id: uuid.UUID, attempt_id: uuid.UUID) -> DiagnosisState:
    return {
        'job_id': str(job_id),
        'attempt_id': str(attempt_id),
        'repair_count': 0,
    }


def graph_config(job_id: uuid.UUID) -> dict[str, Any]:
    return {
        'configurable': {
            'thread_id': f'diagnosis:{job_id}',
            'checkpoint_ns': GRAPH_VERSION,
        },
        'recursion_limit': 12,
    }
