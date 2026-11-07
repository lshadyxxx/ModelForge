"""Explicit independent inference acceptance records.

An acceptance is a human attestation tied to one exact Trial and Adapter
fingerprint. Trial readiness never creates an acceptance automatically.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from modelforge.errors import AppError


CRITERIA_VERSION = 'inference-acceptance-v1'


class AcceptanceDecision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    adapter_id: uuid.UUID
    adapter_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')
    result: Literal['passed', 'failed', 'inconclusive']
    criteria_version: Literal['inference-acceptance-v1']
    reviewer_ref: str = Field(min_length=1, max_length=120)


def _canonical(value) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
        allow_nan=False,
    ).encode('utf-8')


def acceptance_evidence_digest(
    *,
    adapter_fingerprint: str,
    adapter_id: uuid.UUID,
    criteria_version: str,
    result: str,
    reviewer_ref: str,
    trial_id: uuid.UUID,
    trial_snapshot,
) -> str:
    return hashlib.sha256(_canonical({
        'schema': 'inference-acceptance-evidence-v1',
        'adapter_id': str(adapter_id),
        'adapter_fingerprint': adapter_fingerprint,
        'trial_id': str(trial_id),
        'trial_snapshot': trial_snapshot,
        'result': result,
        'criteria_version': criteria_version,
        'reviewer_ref': reviewer_ref,
    })).hexdigest()


class InferenceAcceptance:
    def __init__(self, resources):
        self.resources = resources
        self.pool = resources.pool

    def list(self, trial_id: uuid.UUID):
        with self.pool.connection() as connection:
            return connection.execute(
                '''SELECT id, adapter_id, adapter_fingerprint, trial_id,
                          result, criteria_version, evidence_digest,
                          reviewer_ref, accepted_at, recorded_at
                   FROM training_inference_acceptance
                   WHERE trial_id=%s
                   ORDER BY accepted_at DESC, recorded_at DESC, id DESC''',
                (trial_id,),
            ).fetchall()

    def record(self, trial_id: uuid.UUID, body: AcceptanceDecision):
        decision = AcceptanceDecision.model_validate(body.model_dump())
        if decision.criteria_version != CRITERIA_VERSION:
            raise AppError(
                422,
                'acceptance_criteria_unsupported',
                '验收标准版本不受支持。',
            )

        with self.pool.connection() as connection:
            row = connection.execute(
                '''SELECT t.id, t.adapter_id, t.state, t.stop_requested,
                          t.request_state, t.snapshot,
                          a.fingerprint AS adapter_fingerprint,
                          a.state AS adapter_state
                   FROM inference_trials t
                   JOIN adapter_versions a ON a.id=t.adapter_id
                   WHERE t.id=%s
                   FOR UPDATE OF t''',
                (trial_id,),
            ).fetchone()
            if not row:
                raise AppError(404, 'not_found', 'Inference trial not found')
            if (
                row['state'] != 'ready'
                or row['request_state'] != 'idle'
                or row['stop_requested']
            ):
                raise AppError(
                    409,
                    'acceptance_trial_not_ready',
                    '只有 ready、空闲且未请求停止的 Trial 可以记录验收。',
                )
            if row['adapter_state'] != 'available':
                raise AppError(
                    409,
                    'acceptance_adapter_unavailable',
                    'Adapter 尚未完成正式存储校验。',
                )
            if (
                str(row['adapter_id']) != str(decision.adapter_id)
                or row['adapter_fingerprint'] != decision.adapter_fingerprint
            ):
                raise AppError(
                    409,
                    'acceptance_adapter_mismatch',
                    'Trial 绑定的 Adapter ID 或 fingerprint 已变化。',
                )

            accepted_at = datetime.now(timezone.utc)
            evidence_digest = acceptance_evidence_digest(
                adapter_fingerprint=row['adapter_fingerprint'],
                adapter_id=row['adapter_id'],
                criteria_version=decision.criteria_version,
                result=decision.result,
                reviewer_ref=decision.reviewer_ref,
                trial_id=trial_id,
                trial_snapshot=row['snapshot'],
            )
            identifier = uuid.uuid4()
            inserted = connection.execute(
                '''INSERT INTO training_inference_acceptance(
                       id, adapter_id, adapter_fingerprint, trial_id, result,
                       criteria_version, evidence_digest, reviewer_ref,
                       accepted_at
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (trial_id, criteria_version, evidence_digest)
                   DO NOTHING
                   RETURNING id''',
                (
                    identifier,
                    row['adapter_id'],
                    row['adapter_fingerprint'],
                    trial_id,
                    decision.result,
                    decision.criteria_version,
                    evidence_digest,
                    decision.reviewer_ref,
                    accepted_at,
                ),
            ).fetchone()
            if inserted:
                identifier = inserted['id']
            else:
                existing = connection.execute(
                    '''SELECT id
                       FROM training_inference_acceptance
                       WHERE trial_id=%s AND criteria_version=%s
                         AND evidence_digest=%s''',
                    (
                        trial_id,
                        decision.criteria_version,
                        evidence_digest,
                    ),
                ).fetchone()
                identifier = existing['id']
        return next(
            item for item in self.list(trial_id)
            if str(item['id']) == str(identifier)
        )
