"""Read-only evidence collection for an already frozen training Attempt."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from modelforge.errors import AppError
from modelforge.modules.models import Adapters
from modelforge.modules.training import Training

from .contracts import (
    BaselineEvidenceProjection,
    ComparisonEvidence,
    ComparisonResult,
    EvidenceConflict,
    EvidenceCoverage,
    EvidencePack,
    EvidencePackV2,
    EvidenceRef,
    SourceRevision,
    digest,
)


_SECRET_PATTERNS = (
    (
        re.compile(
            r'(?i)(authorization\s*:\s*)(?:bearer\s+)?[^\s,;]+'
        ),
        r'\1[redacted]',
    ),
    (re.compile(r'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+'), r'\1[redacted]'),
    (
        re.compile(
            r'(?i)(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)[^\s,;]+'
        ),
        r'\1\2[redacted]',
    ),
)
_SECRET_KEY = re.compile(
    r'(?i)^(?:password|passwd|secret|token|access_token|refresh_token|'
    r'api[_-]?key|authorization|private[_-]?key|client[_-]?secret)$'
)


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _redact(value: Any) -> Any:
    if isinstance(value, str):
        result = value
        for pattern, replacement in _SECRET_PATTERNS:
            result = pattern.sub(replacement, result)
        return result
    if isinstance(value, dict):
        return {
            key: '[redacted]' if _SECRET_KEY.search(str(key)) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _at(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


class EvidenceCollector:
    """Collect only facts needed by the advisory report.

    The collector never mutates training, Adapter or serving rows. Any read
    failure is represented as unavailable coverage rather than an empty value.
    """

    def __init__(self, resources):
        self.resources = resources
        self.pool = resources.pool

    def collect(self, attempt_id: uuid.UUID) -> EvidencePackV2:
        attempt = _jsonable(Training(self.resources).get(attempt_id))
        state = attempt.get('state')
        if state not in ('succeeded', 'failed', 'cancelled'):
            raise AppError(
                409,
                'attempt_not_terminal',
                'AI diagnosis requires a succeeded, failed or cancelled Attempt',
            )

        metrics = _jsonable(attempt.get('metrics') or [])
        metrics = metrics if isinstance(metrics, list) else []
        runtime = _redact(_jsonable(attempt.get('runtime_report')))
        token_preflight = _redact(_jsonable(attempt.get('token_preflight')))
        manifest = _redact(_jsonable(attempt.get('execution_manifest')))
        provisioning = _redact(_jsonable(attempt.get('provisioning')))
        snapshot = _jsonable(attempt.get('snapshot') or {})
        logs, logs_error = self._logs(attempt_id)
        adapters, adapters_error = self._adapters(attempt_id)
        trials, trials_error = self._trials(adapters)
        acceptance, acceptance_error = self._acceptance(adapters)

        memory = (runtime or {}).get('training_memory') if isinstance(runtime, dict) else None
        train_points = [
            point for point in metrics
            if isinstance(point, dict) and point.get('loss') is not None
        ]
        eval_points = [
            point for point in metrics
            if isinstance(point, dict) and point.get('eval_loss') is not None
        ]
        lr_points = [
            point for point in metrics
            if isinstance(point, dict) and point.get('learning_rate') is not None
        ]
        latest_eval = max(
            eval_points,
            key=lambda point: (point.get('step') is not None, point.get('step') or 0),
            default=None,
        ) if eval_points else None
        lowest_eval = min(
            eval_points,
            key=lambda point: point['eval_loss'],
            default=None,
        ) if eval_points else None
        last_train = train_points[-1] if train_points else None
        first_train = train_points[0] if train_points else None

        facts = {
            'attempt': {
                'id': str(attempt['id']),
                'task_id': str(attempt['task_id']),
                'number': attempt.get('number'),
                'state': state,
                'outcome': attempt.get('outcome'),
                'created_at': attempt.get('created_at'),
                'updated_at': attempt.get('updated_at'),
                'error_code': attempt.get('error_code'),
                'exit_code': attempt.get('exit_code'),
                'snapshot_sha256': attempt.get('snapshot_sha256'),
            },
            'snapshot': {
                'config': snapshot.get('config') if isinstance(snapshot, dict) else None,
                'base': snapshot.get('base') if isinstance(snapshot, dict) else None,
                'dataset': snapshot.get('dataset') if isinstance(snapshot, dict) else None,
                'instance': snapshot.get('instance') if isinstance(snapshot, dict) else None,
            },
            'metrics': {
                'points': metrics,
                'counts': {
                    'train': len(train_points),
                    'eval': len(eval_points),
                    'learning_rate': len(lr_points),
                },
                'first_train': first_train,
                'last_train': last_train,
                'latest_eval': latest_eval,
                'lowest_eval': lowest_eval,
            },
            'token_preflight': token_preflight,
            'runtime': runtime,
            'memory': memory,
            'manifest': manifest,
            'provisioning': provisioning,
            'logs': logs,
            'adapters': adapters,
            'inference_trials': trials,
            'inference_acceptance': acceptance,
        }

        evidence: list[EvidenceRef] = []
        coverage: list[EvidenceCoverage] = []

        def add(
            kind: str,
            evidence_id: str,
            locator: str,
            *,
            field_path: str | None,
            value: Any,
            status: str,
            reason: str | None = None,
            excerpt: str | None = None,
        ):
            source_digest = digest(value) if value is not None else None
            evidence.append(EvidenceRef(
                id=evidence_id,
                kind=kind,
                source_locator=locator,
                field_path=field_path,
                observed_at=_at(attempt.get('updated_at')),
                source_version=str(attempt.get('snapshot_sha256') or ''),
                source_digest=source_digest,
                excerpt=excerpt,
                coverage=status,
                unavailable_reason=reason,
            ))
            coverage.append(EvidenceCoverage(
                category=kind,
                status=status,
                reason=reason,
                evidence_ids=[evidence_id],
            ))

        add(
            'attempt',
            'E-ATTEMPT',
            f'training_attempts/{attempt["id"]}',
            field_path='attempt',
            value=facts['attempt'],
            status='available',
        )
        add(
            'metrics',
            'E-METRICS',
            f'training_attempts/{attempt["id"]}/metrics',
            field_path='metrics',
            value=facts['metrics'],
            status='available' if metrics else 'missing',
            reason=None if metrics else 'metrics_not_reported',
        )
        add(
            'token_preflight',
            'E-TOKEN',
            f'training_attempts/{attempt["id"]}/token_preflight',
            field_path='token_preflight',
            value=token_preflight,
            status='available' if token_preflight is not None else 'missing',
            reason=None if token_preflight is not None else 'token_preflight_not_reported',
        )
        add(
            'runtime',
            'E-RUNTIME',
            f'training_attempts/{attempt["id"]}/runtime_report',
            field_path='runtime_report',
            value=runtime,
            status='available' if runtime is not None else 'missing',
            reason=None if runtime is not None else 'runtime_report_not_reported',
        )
        add(
            'memory',
            'E-MEMORY',
            f'training_attempts/{attempt["id"]}/runtime_report/training_memory',
            field_path='runtime_report.training_memory',
            value=memory,
            status='available' if memory is not None else 'not_reached',
            reason=None if memory is not None else 'training_memory_not_reported',
        )
        add(
            'manifest',
            'E-MANIFEST',
            f'training_attempts/{attempt["id"]}/execution_manifest',
            field_path='execution_manifest',
            value=manifest,
            status='available' if manifest is not None else 'missing',
            reason=None if manifest is not None else 'execution_manifest_not_reported',
        )
        add(
            'provisioning',
            'E-PROVISIONING',
            f'training_attempts/{attempt["id"]}/provisioning',
            field_path='provisioning',
            value=provisioning,
            status='available' if provisioning is not None else 'not_applicable',
            reason=None if provisioning is not None else 'provisioning_not_applicable_or_not_reported',
        )
        add(
            'logs',
            'E-LOGS',
            f'training_attempts/{attempt["id"]}/training_log_chunks',
            field_path='logs',
            value=logs,
            status=(
                'unavailable'
                if logs_error is not None
                else 'available'
                if (logs or {}).get('chunks_received', 0) > 0
                else 'missing'
            ),
            reason=logs_error or (
                None
                if (logs or {}).get('chunks_received', 0) > 0
                else 'logs_not_reported'
            ),
            excerpt=(logs.get('excerpt') if isinstance(logs, dict) else None),
        )
        for role in ('best', 'final'):
            adapter = (adapters or {}).get(role)
            add(
                'adapter',
                f'E-ADAPTER-{role.upper()}',
                f'adapter_versions/{role}',
                field_path=f'adapters.{role}',
                value=adapter,
                status=(
                    'available' if adapter is not None
                    else ('unavailable' if adapters_error else 'missing')
                ),
                reason=adapters_error if adapters_error else (
                    None if adapter is not None else f'{role}_adapter_not_published'
                ),
            )
        add(
            'inference_trial',
            'E-INFERENCE-TRIALS',
            f'inference_trials/by_adapters',
            field_path='inference_trials',
            value=trials,
            status=(
                'unavailable' if trials_error is not None
                else 'available' if trials
                else 'not_applicable'
            ),
            reason=trials_error,
        )
        add(
            'inference_acceptance',
            'E-INFERENCE-ACCEPTANCE',
            'inference_acceptance/by_adapter',
            field_path='inference_acceptance',
            value=acceptance,
            status=(
                'unavailable'
                if acceptance_error is not None
                else 'available'
                if acceptance
                else 'missing'
            ),
            reason=acceptance_error or (
                None
                if acceptance
                else 'independent_inference_acceptance_not_available'
            ),
        )

        conflicts: list[EvidenceConflict] = []
        if isinstance(manifest, dict) and manifest.get('diagnostic_gap'):
            conflicts.append(EvidenceConflict(
                code='manifest_diagnostic_gap',
                left_ref='E-MANIFEST',
                right_ref='E-ATTEMPT',
                description='Execution manifest reports a diagnostic gap.',
                blocking=False,
            ))
        if isinstance(runtime, dict) and runtime.get('mismatches'):
            conflicts.append(EvidenceConflict(
                code='runtime_mismatch',
                left_ref='E-RUNTIME',
                right_ref='E-ATTEMPT',
                description='Runtime report contains compatibility mismatches.',
                blocking=True,
            ))

        source_revision = self._source_revision(
            attempt,
            metrics=metrics,
            runtime=runtime,
            manifest=manifest,
            adapters=adapters,
            trials=trials,
            acceptance=acceptance,
        )
        pack = EvidencePackV2(
            attempt_id=attempt_id,
            evidence_cutoff_at=datetime.now(timezone.utc),
            attempt_state=state,
            source_revision=source_revision,
            coverage=coverage,
            evidence=evidence,
            facts=facts,
            conflicts=conflicts,
        )
        return pack.with_digest()

    def collect_baseline(
        self,
        attempt_id: uuid.UUID,
    ) -> BaselineEvidenceProjection:
        """Freeze a redacted historical projection with E-BASE-* evidence IDs."""
        pack = self.collect(attempt_id)
        if pack.attempt_state != 'succeeded':
            raise AppError(
                422,
                'baseline_not_succeeded',
                '历史基线不是成功 Attempt，不能做效果比较。',
            )
        mapping = {
            item.id: 'E-BASE-' + item.id.removeprefix('E-')
            for item in pack.evidence
        }
        facts = _jsonable(pack.facts)
        logs = facts.get('logs') if isinstance(facts.get('logs'), dict) else {}
        facts['logs'] = {
            'chunks_received': logs.get('chunks_received', 0),
            'gap': bool(logs.get('gap')),
            'excerpt': None,
        }
        evidence = [
            item.model_copy(update={'id': mapping.get(item.id, item.id)})
            for item in pack.evidence
        ]
        coverage = [
            item.model_copy(update={
                'evidence_ids': [
                    mapping.get(identifier, identifier)
                    for identifier in item.evidence_ids
                ],
            })
            for item in pack.coverage
        ]
        conflicts = [
            item.model_copy(update={
                'left_ref': mapping.get(item.left_ref, item.left_ref),
                'right_ref': mapping.get(item.right_ref, item.right_ref),
            })
            for item in pack.conflicts
        ]
        baseline_pack = EvidencePackV2(
            attempt_id=attempt_id,
            evidence_cutoff_at=pack.evidence_cutoff_at,
            attempt_state='succeeded',
            source_revision=pack.source_revision,
            coverage=coverage,
            evidence=evidence,
            facts=facts,
            conflicts=conflicts,
            redaction_version=pack.redaction_version,
        ).with_digest()
        from .gates import GateEngine

        projection = BaselineEvidenceProjection(
            attempt_id=attempt_id,
            snapshot_sha256=pack.source_revision.snapshot_sha256,
            attempt_state='succeeded',
            facts=facts,
            coverage=coverage,
            evidence=evidence,
            gate=GateEngine().evaluate(baseline_pack),
            source_revision=pack.source_revision,
        )
        return projection.with_digest()

    def current_source_revision(self, attempt_id: uuid.UUID) -> SourceRevision:
        """Re-read source markers without freezing or mutating evidence."""
        attempt = _jsonable(Training(self.resources).get(attempt_id))
        metrics = _jsonable(attempt.get('metrics') or [])
        metrics = metrics if isinstance(metrics, list) else []
        runtime = _redact(_jsonable(attempt.get('runtime_report')))
        manifest = _redact(_jsonable(attempt.get('execution_manifest')))
        adapters, _ = self._adapters(attempt_id)
        trials, _ = self._trials(adapters)
        acceptance, _ = self._acceptance(adapters)
        return self._source_revision(
            attempt,
            metrics=metrics,
            runtime=runtime,
            manifest=manifest,
            adapters=adapters,
            trials=trials,
            acceptance=acceptance,
        )

    def _source_revision(
        self,
        attempt: dict[str, Any],
        *,
        metrics: Any,
        runtime: Any,
        manifest: Any,
        adapters: Any,
        trials: Any,
        acceptance: Any,
    ) -> SourceRevision:
        inference_revision = (
            digest({'trials': trials, 'acceptance': acceptance})
            if trials is not None
            else None
        )
        return SourceRevision(
            attempt_updated_at=(
                _at(attempt.get('updated_at')) or datetime.now(timezone.utc)
            ),
            snapshot_sha256=str(attempt.get('snapshot_sha256') or ''),
            metrics_digest=digest(metrics) if metrics else None,
            runtime_digest=digest(runtime) if runtime is not None else None,
            manifest_digest=digest(manifest) if manifest is not None else None,
            adapter_revision=digest(adapters) if adapters is not None else None,
            inference_revision=inference_revision,
        )

    def _logs(self, attempt_id: uuid.UUID):
        try:
            chunks = Training(self.resources).logs(attempt_id, 0)
            text = ''.join(str(row.get('content', '')) for row in chunks)
            excerpt = _redact(text)[:4000]
            return {
                'chunks_received': len(chunks),
                'gap': any(bool(row.get('gap')) for row in chunks),
                'excerpt': excerpt,
            }, None
        except Exception:
            return {
                'chunks_received': 0,
                'gap': False,
                'excerpt': None,
            }, 'logs_unavailable'

    def _adapters(self, attempt_id: uuid.UUID):
        try:
            rows = Adapters(self.resources).list(attempt_id=attempt_id)
            safe_keys = (
                'id',
                'source_attempt_id',
                'role',
                'state',
                'fingerprint',
                'manifest',
                'metrics',
                'created_at',
            )
            by_role = {
                row.get('role'): _redact({
                    key: _jsonable(row[key])
                    for key in safe_keys
                    if key in row
                })
                for row in rows
            }
            return {
                'best': by_role.get('best'),
                'final': by_role.get('final'),
            }, None
        except Exception:
            return None, 'adapter_read_unavailable'

    @staticmethod
    def _adapter_uuids(adapters) -> list[uuid.UUID]:
        identifiers: list[uuid.UUID] = []
        for item in adapters.values():
            if not isinstance(item, dict) or not item.get('id'):
                continue
            try:
                identifiers.append(uuid.UUID(str(item['id'])))
            except (TypeError, ValueError, AttributeError):
                continue
        return list(dict.fromkeys(identifiers))

    def _trials(self, adapters):
        if adapters is None:
            return None, 'adapter_read_unavailable'
        ids = self._adapter_uuids(adapters)
        if not ids:
            return [], None
        try:
            with self.pool.connection() as connection:
                rows = connection.execute(
                    '''SELECT id, adapter_id, state, instance_id, error_code,
                              request_state, created_at, updated_at
                       FROM inference_trials
                       WHERE adapter_id = ANY(%s::uuid[])
                       ORDER BY created_at DESC''',
                    (ids,),
                ).fetchall()
            return _redact(_jsonable(rows)), None
        except Exception:
            return None, 'inference_trial_read_unavailable'

    def _acceptance(self, adapters):
        if adapters is None:
            return None, 'adapter_read_unavailable'
        ids = self._adapter_uuids(adapters)
        if not ids:
            return [], None
        try:
            with self.pool.connection() as connection:
                exists = connection.execute(
                    "SELECT to_regclass('public.training_inference_acceptance') AS name"
                ).fetchone()
                if not exists or not exists.get('name'):
                    return None, 'inference_acceptance_table_missing'
                rows = connection.execute(
                    '''SELECT id, adapter_id, adapter_fingerprint, trial_id,
                              result, criteria_version, evidence_digest,
                              reviewer_ref, accepted_at, recorded_at
                       FROM training_inference_acceptance
                       WHERE adapter_id = ANY(%s::uuid[])
                       ORDER BY accepted_at DESC, recorded_at DESC, id DESC''',
                    (ids,),
                ).fetchall()
            return _redact(_jsonable(rows)), None
        except Exception:
            return None, 'inference_acceptance_read_unavailable'


def with_comparison(
    pack: EvidencePack | EvidencePackV2,
    comparison: ComparisonResult,
    baseline: BaselineEvidenceProjection | None,
) -> EvidencePackV2:
    """Add deterministic comparison facts to a frozen subject evidence pack."""
    observed_at = datetime.now(timezone.utc)
    subject_id = str(pack.attempt_id)
    baseline_id = str(baseline.attempt_id) if baseline is not None else 'none'
    comparison_body = comparison.model_dump(mode='json')
    definitions = (
        (
            'E-COMPARE-METRIC-BEST-EVAL',
            'comparison.metric_deltas.best_eval_loss',
            {'deltas': comparison_body['metric_deltas']},
        ),
        (
            'E-COMPARE-METRIC-FINAL-EVAL',
            'comparison.metric_deltas.final_eval_loss',
            {'deltas': comparison_body['metric_deltas']},
        ),
        (
            'E-COMPARE-PARAMETERS',
            'comparison.parameter_changes',
            comparison_body['parameter_changes'],
        ),
        (
            'E-COMPARE-CONFOUNDERS',
            'comparison.confounders',
            comparison_body['confounders'],
        ),
        (
            'E-COMPARE-CONCLUSION',
            'comparison.conclusion',
            {
                'comparability_status': comparison_body['comparability_status'],
                'confidence': comparison_body['confidence'],
                'training_signal': comparison_body['training_signal'],
                'delivery_signal': comparison_body['delivery_signal'],
                'model_effect': comparison_body['model_effect'],
                'reason_codes': comparison_body['reason_codes'],
            },
        ),
    )
    comparison_evidence = [
        EvidenceRef(
            id=identifier,
            kind='comparison',
            source_locator=(
                f'diagnosis/comparison/{subject_id}/{baseline_id}'
            ),
            field_path=field_path,
            observed_at=observed_at,
            source_version=pack.source_revision.snapshot_sha256,
            source_digest=digest(value),
            coverage='available',
        )
        for identifier, field_path, value in definitions
    ]
    comparison_coverage = [
        EvidenceCoverage(
            category='comparison',
            status='available',
            evidence_ids=[item.id for item in comparison_evidence],
        )
    ]
    evidence = list(pack.evidence) + comparison_evidence
    coverage = list(pack.coverage) + comparison_coverage
    result = EvidencePackV2(
        attempt_id=pack.attempt_id,
        evidence_cutoff_at=pack.evidence_cutoff_at,
        attempt_state=pack.attempt_state,
        source_revision=pack.source_revision,
        coverage=coverage,
        evidence=evidence,
        facts=pack.facts,
        conflicts=pack.conflicts,
        redaction_version=pack.redaction_version,
        comparison=ComparisonEvidence(
            comparison_result=comparison,
            baseline=baseline,
        ),
    )
    return result.with_digest()
