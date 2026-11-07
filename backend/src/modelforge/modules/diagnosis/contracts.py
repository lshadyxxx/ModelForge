"""Strict contracts for advisory diagnosis evidence and reports."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


HealthStatus = Literal['healthy', 'attention', 'blocked', 'partial', 'unknown']
DeliveryStatus = Literal[
    'not_deliverable',
    'artifact_deliverable_model_unverified',
    'ready_for_release_review',
    'unknown',
]
CoverageStatus = Literal[
    'available',
    'missing',
    'not_reached',
    'not_applicable',
    'conflict',
    'unavailable',
]
EvidenceKind = Literal[
    'attempt',
    'metrics',
    'token_preflight',
    'runtime',
    'memory',
    'manifest',
    'provisioning',
    'logs',
    'adapter',
    'inference_trial',
    'inference_acceptance',
]


def canonical(value: Any) -> bytes:
    """Deterministic JSON used for evidence and report digests."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
        allow_nan=False,
    ).encode('utf-8')


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


class EvidenceCoverage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    category: EvidenceKind
    status: CoverageStatus
    reason: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    kind: EvidenceKind
    source_locator: str
    field_path: str | None = None
    observed_at: datetime | None = None
    source_version: str | None = None
    source_digest: str | None = None
    excerpt: str | None = None
    coverage: CoverageStatus
    unavailable_reason: str | None = None


class EvidenceConflict(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str
    left_ref: str
    right_ref: str
    description: str
    blocking: bool = False


class SourceRevision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_updated_at: datetime
    snapshot_sha256: str
    metrics_digest: str | None = None
    runtime_digest: str | None = None
    manifest_digest: str | None = None
    adapter_revision: str | None = None
    inference_revision: str | None = None


class EvidencePack(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['evidence-pack-v1'] = 'evidence-pack-v1'
    attempt_id: UUID
    evidence_cutoff_at: datetime
    attempt_state: Literal['succeeded', 'failed', 'cancelled']
    source_revision: SourceRevision
    coverage: list[EvidenceCoverage]
    evidence: list[EvidenceRef]
    facts: dict[str, Any]
    conflicts: list[EvidenceConflict] = Field(default_factory=list)
    redaction_version: str = 'diagnosis-redaction-v1'
    canonical_digest: str | None = None

    def with_digest(self) -> 'EvidencePack':
        body = self.model_dump(mode='json', exclude={'canonical_digest'})
        return self.model_copy(update={'canonical_digest': digest(body)})


class GateReason(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class GateResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    policy_version: str
    health_status: HealthStatus
    delivery_status: DeliveryStatus
    health_reasons: list[GateReason] = Field(default_factory=list)
    delivery_reasons: list[GateReason] = Field(default_factory=list)
    coverage: list[EvidenceCoverage]
    conflicts: list[EvidenceConflict] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    gate_digest: str | None = None

    def with_digest(self) -> 'GateResult':
        body = self.model_dump(mode='json', exclude={'gate_digest'})
        return self.model_copy(update={'gate_digest': digest(body)})


class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=80)
    layer: Literal['observation', 'inference', 'recommendation', 'limitation']
    text: str = Field(min_length=1, max_length=1200)
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)
    basis_claim_ids: list[str] = Field(default_factory=list, max_length=20)
    confidence: Literal['high', 'medium', 'low'] = 'medium'
    limitations: list[str] = Field(default_factory=list, max_length=10)


class Finding(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=80)
    category: Literal[
        'loss_eval',
        'runtime',
        'token',
        'memory',
        'artifact',
        'failure',
        'coverage',
    ]
    severity: Literal['blocked', 'attention', 'passed', 'info']
    epistemic_status: Literal['observed', 'inferred', 'unknown']
    title: str = Field(min_length=1, max_length=240)
    observation: Claim
    inference: Claim | None = None
    recommendation: Claim | None = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)


class Limitation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=1200)
    affected_axis: Literal['health', 'delivery'] | None = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)


class NextExperiment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=80)
    priority: Literal['P0', 'P1', 'P2']
    title: str = Field(min_length=1, max_length=240)
    hypothesis: str = Field(min_length=1, max_length=1200)
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)
    preconditions: list[str] = Field(default_factory=list, max_length=20)
    config_patch: dict[str, Any] | None = None
    draft_only: Literal[True] = True


class CandidateReport(BaseModel):
    model_config = ConfigDict(extra='forbid')
    summary: str = Field(min_length=1, max_length=1600)
    claims: list[Claim] = Field(default_factory=list, max_length=30)
    findings: list[Finding] = Field(default_factory=list, max_length=16)
    limitations: list[Limitation] = Field(default_factory=list, max_length=20)
    next_experiments: list[NextExperiment] = Field(
        default_factory=list, max_length=8
    )


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str
    message: str
    path: str | None = None


class GateAxis(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: str
    label: str
    rationale: str
    evidence_ids: list[str] = Field(default_factory=list)


class AdvisoryReport(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['advisory-report-v1'] = 'advisory-report-v1'
    id: UUID
    job_id: UUID
    attempt_id: UUID
    version: int
    report_mode: Literal['full', 'limited']
    freshness: Literal['current', 'stale'] = 'current'
    integrity: Literal['consistent', 'conflict'] = 'consistent'
    health: GateAxis
    delivery: GateAxis
    summary: str
    claims: list[Claim]
    findings: list[Finding]
    limitations: list[Limitation]
    next_experiments: list[NextExperiment]
    source_revision: SourceRevision
    policy_version: str
    graph_version: str
    prompt_version: str
    generator_version: str
    model_name: str
    input_digest: str
    report_digest: str | None = None
    generated_at: datetime
    published_at: datetime

    def with_digest(self) -> 'AdvisoryReport':
        body = self.model_dump(mode='json', exclude={'report_digest'})
        return self.model_copy(update={'report_digest': digest(body)})
