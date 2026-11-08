"""SQL persistence for diagnosis jobs, frozen evidence and immutable reports."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from modelforge.errors import AppError

from .contracts import (
    AdvisoryReport,
    AdvisoryReportV2,
    EvidencePack,
    EvidencePackV2,
    GateResult,
    parse_advisory_report,
    parse_evidence_pack,
)


class DiagnosisRepository:
    def __init__(self, resources):
        self.resources = resources
        self.pool = resources.pool

    def create_job(
        self,
        attempt_id: uuid.UUID,
        *,
        request_key: str,
        policy_version: str,
        graph_version: str,
        prompt_version: str,
        generator_version: str,
        comparison_mode: str = 'none',
        baseline_attempt_id: uuid.UUID | None = None,
        comparison_policy_version: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        job_id = uuid.uuid4()
        with self.pool.connection() as connection:
            inserted = connection.execute(
                '''
                INSERT INTO training_diagnosis_jobs(
                    id, attempt_id, request_key, policy_version, graph_version,
                    prompt_version, generator_version, comparison_mode,
                    baseline_attempt_id, comparison_policy_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (attempt_id, request_key) DO NOTHING
                RETURNING *
                ''',
                (
                    job_id,
                    attempt_id,
                    request_key,
                    policy_version,
                    graph_version,
                    prompt_version,
                    generator_version,
                    comparison_mode,
                    baseline_attempt_id,
                    comparison_policy_version,
                ),
            ).fetchone()
            if inserted is not None:
                return inserted, True
            existing = connection.execute(
                '''
                SELECT * FROM training_diagnosis_jobs
                WHERE attempt_id = %s AND request_key = %s
                ''',
                (attempt_id, request_key),
            ).fetchone()
        if existing is None:
            raise AppError(503, 'diagnosis_job_unavailable', '诊断任务创建失败，请稍后重试。')
        return existing, False

    def create_regeneration(
        self,
        job_id: uuid.UUID,
        *,
        request_key: str,
    ) -> dict[str, Any]:
        with self.pool.connection() as connection:
            source = connection.execute(
                'SELECT * FROM training_diagnosis_jobs WHERE id = %s',
                (job_id,),
            ).fetchone()
            if source is None:
                raise AppError(404, 'not_found', 'Diagnosis job not found')
            if source['state'] in {'queued', 'running'}:
                raise AppError(
                    409,
                    'diagnosis_job_active',
                    '当前诊断仍在生成中，不能重复发起重新生成。',
                )
            identifier = uuid.uuid4()
            row = connection.execute(
                '''
                INSERT INTO training_diagnosis_jobs(
                    id, attempt_id, request_key, policy_version, graph_version,
                    prompt_version, generator_version, comparison_mode,
                    baseline_attempt_id, comparison_policy_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                ''',
                (
                    identifier,
                    source['attempt_id'],
                    request_key,
                    source['policy_version'],
                    source['graph_version'],
                    source['prompt_version'],
                    source['generator_version'],
                    source['comparison_mode'],
                    source['baseline_attempt_id'],
                    source['comparison_policy_version'],
                ),
            ).fetchone()
        return row

    def get_job(self, job_id: uuid.UUID) -> dict[str, Any]:
        with self.pool.connection() as connection:
            row = connection.execute(
                'SELECT * FROM training_diagnosis_jobs WHERE id = %s',
                (job_id,),
            ).fetchone()
        if row is None:
            raise AppError(404, 'not_found', 'Diagnosis job not found')
        return self._job_view(row)

    def find_latest_job(self, attempt_id: uuid.UUID) -> dict[str, Any] | None:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                SELECT * FROM training_diagnosis_jobs
                WHERE attempt_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                ''',
                (attempt_id,),
            ).fetchone()
        return self._job_view(row) if row else None

    def _job_view(self, row: dict[str, Any]) -> dict[str, Any]:
        with self.pool.connection() as connection:
            report = connection.execute(
                'SELECT id, version FROM training_diagnosis_reports WHERE job_id = %s',
                (row['id'],),
            ).fetchone()
        return {
            'job_id': row['id'],
            'attempt_id': row['attempt_id'],
            'state': row['state'],
            'error_code': row['error_code'],
            'created_at': row['created_at'],
            'started_at': row['started_at'],
            'finished_at': row['finished_at'],
            'usage': row.get('usage'),
            'comparison_mode': row.get('comparison_mode', 'none'),
            'baseline_attempt_id': row.get('baseline_attempt_id'),
            'comparison_policy_version': row.get('comparison_policy_version'),
            'latest_report_id': report['id'] if report else None,
            'report_version': report['version'] if report else None,
        }

    def set_usage(
        self,
        job_id: uuid.UUID,
        owner: str,
        fencing_token: int,
        usage: dict[str, Any] | None,
    ) -> None:
        if usage is None:
            return
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                UPDATE training_diagnosis_jobs
                SET usage = %s
                WHERE id = %s
                  AND state = 'running'
                  AND lease_owner = %s
                  AND fencing_token = %s
                  AND lease_expires_at > now()
                RETURNING id
                ''',
                (Jsonb(usage), job_id, owner, fencing_token),
            ).fetchone()
        if row is None:
            raise AppError(
                409,
                'diagnosis_lease_lost',
                '诊断任务租约已失效，不能记录模型用量。',
            )

    def claim(self, owner: str, lease_seconds: int, max_attempts: int):
        with self.pool.connection() as connection:
            with connection.transaction():
                connection.execute(
                    '''
                    UPDATE training_diagnosis_jobs
                    SET state = 'failed',
                        error_code = 'diagnosis_attempts_exhausted',
                        finished_at = now(),
                        lease_owner = NULL,
                        lease_expires_at = NULL
                    WHERE state = 'running'
                      AND lease_expires_at < now()
                      AND attempt_count >= %s
                    ''',
                    (max_attempts,),
                )
                row = connection.execute(
                    '''
                    WITH candidate AS (
                        SELECT id
                        FROM training_diagnosis_jobs
                        WHERE (
                            state = 'queued'
                            AND next_attempt_at <= now()
                        ) OR (
                            state = 'running'
                            AND lease_expires_at < now()
                            AND attempt_count < %s
                        )
                        ORDER BY created_at
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                    )
                    UPDATE training_diagnosis_jobs AS job
                    SET state = 'running',
                        lease_owner = %s,
                        lease_expires_at = now() + (%s * interval '1 second'),
                        fencing_token = job.fencing_token + 1,
                        attempt_count = job.attempt_count + 1,
                        started_at = COALESCE(job.started_at, now()),
                        error_code = NULL,
                        finished_at = NULL
                    FROM candidate
                    WHERE job.id = candidate.id
                    RETURNING job.*
                    ''',
                    (max_attempts, owner, lease_seconds),
                ).fetchone()
        return row

    def heartbeat(
        self,
        job_id: uuid.UUID,
        owner: str,
        fencing_token: int,
        lease_seconds: int,
    ) -> bool:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                UPDATE training_diagnosis_jobs
                SET lease_expires_at = now() + (%s * interval '1 second')
                WHERE id = %s
                  AND state = 'running'
                  AND lease_owner = %s
                  AND fencing_token = %s
                  AND lease_expires_at > now()
                RETURNING id
                ''',
                (lease_seconds, job_id, owner, fencing_token),
            ).fetchone()
        return row is not None

    def set_gate(
        self,
        job_id: uuid.UUID,
        owner: str,
        fencing_token: int,
        gate: GateResult,
    ) -> None:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                UPDATE training_diagnosis_jobs
                SET gate_snapshot = %s
                WHERE id = %s
                  AND state = 'running'
                  AND lease_owner = %s
                  AND fencing_token = %s
                  AND lease_expires_at > now()
                RETURNING id
                ''',
                (
                    Jsonb(gate.model_dump(mode='json')),
                    job_id,
                    owner,
                    fencing_token,
                ),
            ).fetchone()
        if row is None:
            raise AppError(409, 'diagnosis_lease_lost', '诊断任务租约已失效，不能继续写入。')

    def freeze_evidence(
        self,
        job_id: uuid.UUID,
        pack: EvidencePack | EvidencePackV2,
        *,
        owner: str | None = None,
        fencing_token: int | None = None,
    ) -> EvidencePack | EvidencePackV2:
        payload = pack.model_dump(mode='json')
        comparison = getattr(pack, 'comparison', None)
        baseline = comparison.baseline if comparison is not None else None
        baseline_attempt_id = baseline.attempt_id if baseline is not None else None
        baseline_digest = (
            baseline.canonical_digest if baseline is not None else None
        )
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                INSERT INTO training_diagnosis_evidence(
                    job_id, attempt_id, schema_version, evidence_pack,
                    evidence_digest, redaction_version, baseline_attempt_id,
                    baseline_evidence_digest
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (job_id) DO NOTHING
                RETURNING evidence_pack
                ''',
                (
                    job_id,
                    pack.attempt_id,
                    pack.schema_version,
                    Jsonb(payload),
                    pack.canonical_digest,
                    pack.redaction_version,
                    baseline_attempt_id,
                    baseline_digest,
                ),
            ).fetchone()
            if row is None:
                row = connection.execute(
                    'SELECT evidence_pack FROM training_diagnosis_evidence WHERE job_id = %s',
                    (job_id,),
                ).fetchone()
        if row is None:
            raise AppError(503, 'diagnosis_evidence_unavailable', '诊断证据冻结失败。')
        frozen = parse_evidence_pack(row['evidence_pack'])
        if frozen.canonical_digest != pack.canonical_digest:
            raise AppError(
                409,
                'diagnosis_evidence_changed',
                '同一诊断任务的证据内容发生变化，必须创建新的诊断任务。',
            )
        if baseline_attempt_id is not None:
            if owner is not None and fencing_token is not None:
                with self.pool.connection() as connection:
                    updated = connection.execute(
                        '''
                        UPDATE training_diagnosis_jobs
                        SET baseline_attempt_id = %s,
                            baseline_evidence_digest = %s,
                            comparison_policy_version = %s
                        WHERE id = %s
                          AND state = 'running'
                          AND lease_owner = %s
                          AND fencing_token = %s
                          AND lease_expires_at > now()
                        RETURNING id
                        ''',
                        (
                            baseline_attempt_id,
                            baseline_digest,
                            comparison.comparison_result.policy_version,
                            job_id,
                            owner,
                            fencing_token,
                        ),
                    ).fetchone()
                if updated is None:
                    raise AppError(
                        409,
                        'diagnosis_lease_lost',
                        '诊断任务租约已失效，不能记录比较基线。',
                    )
        return frozen

    def load_evidence(self, job_id: uuid.UUID) -> EvidencePack | EvidencePackV2:
        with self.pool.connection() as connection:
            row = connection.execute(
                'SELECT evidence_pack FROM training_diagnosis_evidence WHERE job_id = %s',
                (job_id,),
            ).fetchone()
        if row is None:
            raise AppError(404, 'diagnosis_evidence_not_found', 'Diagnosis evidence is missing')
        return parse_evidence_pack(row['evidence_pack'])

    def publish(
        self,
        report: AdvisoryReport | AdvisoryReportV2,
        *,
        owner: str,
        fencing_token: int,
    ) -> AdvisoryReport | AdvisoryReportV2:
        report = report.with_digest()
        evidence = self.load_evidence(report.job_id)
        payload = report.model_dump(mode='json')
        with self.pool.connection() as connection:
            with connection.transaction():
                job = connection.execute(
                    '''
                    SELECT * FROM training_diagnosis_jobs
                    WHERE id = %s
                    FOR UPDATE
                    ''',
                    (report.job_id,),
                ).fetchone()
                if job is None:
                    raise AppError(404, 'not_found', 'Diagnosis job not found')
                if (
                    job['state'] != 'running'
                    or job['lease_owner'] != owner
                    or job['fencing_token'] != fencing_token
                    or job['lease_expires_at'] <= datetime.now(timezone.utc)
                ):
                    raise AppError(
                        409,
                        'diagnosis_lease_lost',
                        '诊断任务租约已失效，候选报告不得发布。',
                    )
                existing = connection.execute(
                    'SELECT report FROM training_diagnosis_reports WHERE job_id = %s',
                    (report.job_id,),
                ).fetchone()
                if existing is not None:
                    return parse_advisory_report(existing['report'])
                version = connection.execute(
                    '''
                    SELECT COALESCE(max(version), 0) + 1 AS version
                    FROM training_diagnosis_reports
                    WHERE attempt_id = %s
                    ''',
                    (report.attempt_id,),
                ).fetchone()['version']
                published_at = datetime.now(timezone.utc)
                report = report.model_copy(update={
                    'version': version,
                    'published_at': published_at,
                }).with_digest()
                payload = report.model_dump(mode='json')
                comparison = getattr(report, 'comparison', None)
                connection.execute(
                    '''
                    INSERT INTO training_diagnosis_reports(
                        id, job_id, attempt_id, version, schema_version,
                        report_mode, health_status, delivery_status, report,
                        report_digest, evidence_digest, policy_version,
                        graph_version, prompt_version, generator_version,
                        model_name, created_at, published_at,
                        baseline_attempt_id, comparison_status,
                        comparison_confidence, training_signal, delivery_signal,
                        model_effect_status
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s
                    )
                    ''',
                    (
                        report.id,
                        report.job_id,
                        report.attempt_id,
                        report.version,
                        report.schema_version,
                        report.report_mode,
                        report.health.status,
                        report.delivery.status,
                        Jsonb(payload),
                        report.report_digest,
                        evidence.canonical_digest,
                        report.policy_version,
                        report.graph_version,
                        report.prompt_version,
                        report.generator_version,
                        report.model_name,
                        published_at,
                        published_at,
                        getattr(report, 'baseline_attempt_id', None),
                        (
                            comparison.comparability_status
                            if comparison is not None else None
                        ),
                        (
                            comparison.confidence
                            if comparison is not None else None
                        ),
                        (
                            comparison.training_signal
                            if comparison is not None else None
                        ),
                        (
                            comparison.delivery_signal
                            if comparison is not None else None
                        ),
                        (
                            comparison.model_effect.status
                            if comparison is not None else None
                        ),
                    ),
                )
                connection.execute(
                    '''
                    UPDATE training_diagnosis_jobs
                    SET state = 'ready',
                        finished_at = now(),
                        error_code = NULL,
                        lease_owner = NULL,
                        lease_expires_at = NULL
                    WHERE id = %s
                    ''',
                    (report.job_id,),
                )
        return report

    def fail(
        self,
        job_id: uuid.UUID,
        *,
        owner: str,
        fencing_token: int,
        error_code: str,
    ) -> None:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                UPDATE training_diagnosis_jobs
                SET state = 'failed',
                    error_code = %s,
                    finished_at = now(),
                    lease_owner = NULL,
                    lease_expires_at = NULL
                WHERE id = %s
                  AND state = 'running'
                  AND lease_owner = %s
                  AND fencing_token = %s
                RETURNING id
                ''',
                (error_code, job_id, owner, fencing_token),
            ).fetchone()
        if row is None:
            raise AppError(409, 'diagnosis_lease_lost', '诊断任务租约已失效。')

    def retry_or_fail(
        self,
        job_id: uuid.UUID,
        *,
        owner: str,
        fencing_token: int,
        error_code: str,
        max_attempts: int,
    ) -> str:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                UPDATE training_diagnosis_jobs
                SET state = CASE WHEN attempt_count >= %s THEN 'failed' ELSE 'queued' END,
                    error_code = %s,
                    next_attempt_at = now() + make_interval(
                        secs => LEAST(30, GREATEST(1, attempt_count * 2))
                    ),
                    finished_at = CASE WHEN attempt_count >= %s THEN now() ELSE NULL END,
                    lease_owner = NULL,
                    lease_expires_at = NULL
                WHERE id = %s
                  AND state = 'running'
                  AND lease_owner = %s
                  AND fencing_token = %s
                RETURNING state
                ''',
                (
                    max_attempts,
                    error_code,
                    max_attempts,
                    job_id,
                    owner,
                    fencing_token,
                ),
            ).fetchone()
        if row is None:
            raise AppError(409, 'diagnosis_lease_lost', '诊断任务租约已失效。')
        return row['state']

    def get_report(self, report_id: uuid.UUID) -> dict[str, Any]:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                SELECT report, evidence_digest, created_at
                FROM training_diagnosis_reports
                WHERE id = %s
                ''',
                (report_id,),
            ).fetchone()
        if row is None:
            raise AppError(404, 'not_found', 'Diagnosis report not found')
        return self._report_response(row)

    def get_latest(self, attempt_id: uuid.UUID) -> dict[str, Any] | None:
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                SELECT report, evidence_digest, created_at
                FROM training_diagnosis_reports
                WHERE attempt_id = %s
                ORDER BY version DESC
                LIMIT 1
                ''',
                (attempt_id,),
            ).fetchone()
        return self._report_response(row) if row else None

    def list_reports(self, attempt_id: uuid.UUID) -> list[dict[str, Any]]:
        with self.pool.connection() as connection:
            rows = connection.execute(
                '''
                SELECT report, evidence_digest, created_at
                FROM training_diagnosis_reports
                WHERE attempt_id = %s
                ORDER BY version DESC
                ''',
                (attempt_id,),
            ).fetchall()
        return [self._report_response(row) for row in rows]

    def _report_response(self, row: dict[str, Any]) -> dict[str, Any]:
        report = parse_advisory_report(row['report'])
        with self.pool.connection() as connection:
            evidence_row = connection.execute(
                '''
                SELECT evidence_pack
                FROM training_diagnosis_evidence
                WHERE job_id = %s
                ''',
                (report.job_id,),
            ).fetchone()
        try:
            from .evidence import EvidenceCollector

            collector = EvidenceCollector(self.resources)
            current_revision = collector.current_source_revision(report.attempt_id)
            stale = current_revision != report.source_revision
            if isinstance(report, AdvisoryReportV2) and report.baseline_attempt_id:
                evidence_pack = (
                    parse_evidence_pack(evidence_row['evidence_pack'])
                    if evidence_row else None
                )
                baseline = (
                    evidence_pack.comparison.baseline
                    if isinstance(evidence_pack, EvidencePackV2)
                    and evidence_pack.comparison is not None
                    else None
                )
                if baseline is None:
                    stale = True
                else:
                    baseline_revision = collector.current_source_revision(
                        report.baseline_attempt_id
                    )
                    stale = stale or (
                        baseline_revision != baseline.source_revision
                    )
        except Exception:
            # A report cannot be presented as current when its source
            # revision cannot be re-read and compared.
            stale = True
        report = report.model_copy(update={'freshness': 'stale' if stale else 'current'})
        evidence_pack = (
            parse_evidence_pack(evidence_row['evidence_pack'])
            if evidence_row
            else None
        )
        return {
            'report': report.model_dump(mode='json'),
            'evidence_digest': row['evidence_digest'],
            'evidence': (
                evidence_pack.model_dump(mode='json') if evidence_pack else None
            ),
            'created_at': row['created_at'],
        }
