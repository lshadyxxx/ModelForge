"""Fixed LangGraph workflow for one advisory diagnosis job."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, TypedDict

from modelforge.errors import AppError

from .context import build_context
from .contracts import (
    AdvisoryReport,
    CandidateReport,
    GateAxis,
    GateResult,
    ValidationIssue,
)
from .gates import GateEngine
from .generator import GENERATOR_VERSION
from .prompts import PROMPT_VERSION


GRAPH_VERSION = 'training-diagnosis-graph-v1'

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
    evidence_digest: str
    gate_snapshot: dict[str, Any]
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
):
    from langgraph.graph import END, START, StateGraph

    gate_engine = GateEngine()

    def collect(state: DiagnosisState) -> DiagnosisState:
        try:
            pack = repository.load_evidence(job_id)
        except AppError as error:
            if error.code != 'diagnosis_evidence_not_found':
                raise
            pack = collector.collect(attempt_id)
            pack = repository.freeze_evidence(job_id, pack)
        if pack.attempt_id != attempt_id:
            raise AppError(
                409,
                'diagnosis_evidence_attempt_mismatch',
                'Frozen evidence belongs to a different Attempt',
            )
        return {
            'job_id': str(job_id),
            'attempt_id': str(attempt_id),
            'evidence_digest': pack.canonical_digest or '',
            'repair_count': state.get('repair_count', 0),
        }

    def gate(state: DiagnosisState) -> DiagnosisState:
        pack = repository.load_evidence(job_id)
        result = gate_engine.evaluate(pack)
        repository.set_gate(job_id, owner, fencing_token, result)
        return {
            'gate_snapshot': result.model_dump(mode='json'),
        }

    def generate(state: DiagnosisState) -> DiagnosisState:
        pack = repository.load_evidence(job_id)
        result = GateResult.model_validate(state['gate_snapshot'])
        context = build_context(pack, result)
        candidate = generator.generate(context)
        return {
            'candidate_report': candidate.model_dump(mode='json'),
            'validation_issues': [],
        }

    def validate(state: DiagnosisState) -> DiagnosisState:
        pack = repository.load_evidence(job_id)
        result = GateResult.model_validate(state['gate_snapshot'])
        candidate = CandidateReport.model_validate(state['candidate_report'])
        issues = validator.validate(candidate, pack, result)
        return {'validation_issues': _issue_state(issues)}

    def repair(state: DiagnosisState) -> DiagnosisState:
        pack = repository.load_evidence(job_id)
        result = GateResult.model_validate(state['gate_snapshot'])
        candidate = CandidateReport.model_validate(state['candidate_report'])
        issues = [
            ValidationIssue.model_validate(item)
            for item in state.get('validation_issues', [])
        ]
        context = build_context(
            pack,
            result,
            repair_issues=issues,
            previous_candidate=candidate.model_dump(mode='json'),
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
        pack = repository.load_evidence(job_id)
        gate_result = GateResult.model_validate(state['gate_snapshot'])
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
        report = AdvisoryReport(
            id=uuid.uuid4(),
            job_id=job_id,
            attempt_id=attempt_id,
            version=1,
            report_mode='full' if pack.attempt_state == 'succeeded' else 'limited',
            freshness='current',
            integrity=(
                'conflict'
                if any(item.blocking for item in pack.conflicts)
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
            input_digest=pack.canonical_digest or '',
            generated_at=generated_at,
            published_at=generated_at,
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
    builder.add_node('collect', collect)
    builder.add_node('gate', gate)
    builder.add_node('generate', generate)
    builder.add_node('validate', validate)
    builder.add_node('repair', repair)
    builder.add_node('publish', publish)
    builder.add_node('fail', fail)
    builder.add_edge(START, 'collect')
    builder.add_edge('collect', 'gate')
    builder.add_edge('gate', 'generate')
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
        'recursion_limit': 8,
    }
