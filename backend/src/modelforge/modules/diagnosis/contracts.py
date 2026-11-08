"""Strict contracts for advisory diagnosis evidence and reports."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Annotated, Any, Literal, Self, TypeAlias
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
    'comparison',
]

ComparisonMode = Literal['none', 'auto', 'explicit']
ComparabilityStatus = Literal[
    'strict',
    'conditional',
    'not_comparable',
    'no_baseline',
]
TrainingSignal = Literal[
    'improved',
    'worsened',
    'mixed',
    'flat',
    'inconclusive',
]
DeliverySignal = Literal[
    'improved',
    'worsened',
    'same',
    'inconclusive',
]
ModelEffectStatus = Literal[
    'verified_better',
    'verified_worse',
    'verified_same',
    'inconclusive',
    'unverified',
]
ComparisonConfidence = Literal['high', 'medium', 'low', 'none']
AdapterRole = Literal['best', 'final']


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


class ComparisonGroup(BaseModel):
    model_config = ConfigDict(extra='forbid')
    base_fingerprint: str
    dataset_sha256: str
    dataset_split_sha256: str


class BaselineSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: ComparisonMode
    requested_attempt_id: UUID | None = None
    resolved_attempt_id: UUID | None = None
    selection_rule: Literal[
        'none',
        'latest_previous_success',
        'explicit',
        'not_available',
    ]
    reason_code: str | None = None


class ComparisonCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID
    task_id: UUID
    task_name: str
    attempt_number: int
    state: Literal['succeeded']
    created_at: datetime
    snapshot_sha256: str
    base_fingerprint: str
    dataset_sha256: str
    dataset_split_sha256: str
    best_eval_loss: float | None = None
    final_eval_loss: float | None = None
    eval_point_count: int = 0
    available_adapter_roles: list[AdapterRole] = Field(default_factory=list)
    comparability_preview: ComparabilityStatus
    changed_parameter_count: int = 0
    confounder_preview_codes: list[str] = Field(default_factory=list)


class ComparisonCandidates(BaseModel):
    model_config = ConfigDict(extra='forbid')
    subject_attempt_id: UUID
    group: ComparisonGroup
    suggested_baseline_attempt_id: UUID | None = None
    candidates: list[ComparisonCandidate] = Field(default_factory=list)


class ParameterChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    field: Literal[
        'epochs',
        'learning_rate',
        'cutoff_len',
        'batch_size',
        'gradient_accumulation',
        'lora_rank',
        'lora_alpha',
        'lora_dropout',
        'scheduler',
        'warmup_ratio',
        'template',
        'seed',
    ]
    baseline_value: Any
    subject_value: Any
    classification: Literal[
        'optimization',
        'budget',
        'input_processing',
        'stochasticity',
    ]


ConfounderCode = Literal[
    'runtime_lock_changed',
    'training_image_changed',
    'gpu_changed',
    'template_changed',
    'seed_changed',
    'cutoff_changed',
    'multiple_parameters_changed',
    'adapter_role_mismatch',
    'baseline_metrics_missing',
    'subject_metrics_missing',
    'eval_coverage_low',
    'baseline_source_unavailable',
    'subject_source_unavailable',
]


class Confounder(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: ConfounderCode
    field: str | None = None
    baseline_value: Any = None
    subject_value: Any = None
    text: str
    blocking: bool = False


class MetricDelta(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: Literal[
        'best_eval_loss',
        'final_eval_loss',
        'latest_eval_loss',
        'lowest_eval_loss',
        'final_train_loss',
        'token_overflow_count',
    ]
    subject_value: float | int | None = None
    baseline_value: float | int | None = None
    absolute_delta: float | int | None = None
    relative_delta: float | None = None
    better_direction: Literal['lower', 'higher', 'neutral']
    evidence_ids: list[str] = Field(default_factory=list)


class ModelEffect(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: ModelEffectStatus
    reason: Literal[
        'no_comparable_downstream_evaluation',
        'evaluation_missing_on_one_side',
        'evaluation_spec_mismatch',
        'score_comparison_available',
    ]
    subject_evaluation_id: UUID | None = None
    baseline_evaluation_id: UUID | None = None
    note: str


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


class ComparisonResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['comparison-result-v1'] = 'comparison-result-v1'
    policy_version: str
    group: ComparisonGroup
    selection: BaselineSelection
    comparability_status: ComparabilityStatus
    confidence: ComparisonConfidence
    training_signal: TrainingSignal
    delivery_signal: DeliverySignal
    model_effect: ModelEffect
    primary_adapter_role: AdapterRole | None = None
    metric_deltas: list[MetricDelta] = Field(default_factory=list)
    parameter_changes: list[ParameterChange] = Field(default_factory=list)
    confounders: list[Confounder] = Field(default_factory=list)
    regressions: list[dict[str, Any]] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    comparison_digest: str | None = None

    def with_digest(self) -> 'ComparisonResult':
        body = self.model_dump(mode='json', exclude={'comparison_digest'})
        return self.model_copy(update={'comparison_digest': digest(body)})


class BaselineEvidenceProjection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID
    snapshot_sha256: str
    attempt_state: Literal['succeeded']
    facts: dict[str, Any]
    coverage: list[EvidenceCoverage]
    evidence: list[EvidenceRef]
    gate: GateResult
    source_revision: SourceRevision
    canonical_digest: str | None = None

    def with_digest(self) -> 'BaselineEvidenceProjection':
        body = self.model_dump(mode='json', exclude={'canonical_digest'})
        return self.model_copy(update={'canonical_digest': digest(body)})


class ComparisonEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    comparison_result: ComparisonResult
    baseline: BaselineEvidenceProjection | None = None


class _EvidenceBase(BaseModel):
    model_config = ConfigDict(extra='forbid')
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

    def with_digest(self) -> Self:
        body = self.model_dump(mode='json', exclude={'canonical_digest'})
        return self.model_copy(update={'canonical_digest': digest(body)})


class EvidencePack(_EvidenceBase):
    schema_version: Literal['evidence-pack-v1'] = 'evidence-pack-v1'


class EvidencePackV2(_EvidenceBase):
    schema_version: Literal['evidence-pack-v2'] = 'evidence-pack-v2'
    comparison: ComparisonEvidence | None = None


EvidencePackDocument: TypeAlias = Annotated[
    EvidencePack | EvidencePackV2,
    Field(discriminator='schema_version'),
]


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
        'comparison',
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


class _AdvisoryBase(BaseModel):
    model_config = ConfigDict(extra='forbid')
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

    def with_digest(self) -> Self:
        body = self.model_dump(mode='json', exclude={'report_digest'})
        return self.model_copy(update={'report_digest': digest(body)})


class AdvisoryReport(_AdvisoryBase):
    schema_version: Literal['advisory-report-v1'] = 'advisory-report-v1'


class AdvisoryReportV2(_AdvisoryBase):
    schema_version: Literal['advisory-report-v2'] = 'advisory-report-v2'
    baseline_attempt_id: UUID | None = None
    comparison: ComparisonResult


AdvisoryReportDocument: TypeAlias = Annotated[
    AdvisoryReport | AdvisoryReportV2,
    Field(discriminator='schema_version'),
]


def parse_evidence_pack(value: Any) -> EvidencePack | EvidencePackV2:
    """Read a persisted evidence document without discarding v1 history."""
    if isinstance(value, dict) and value.get('schema_version') == 'evidence-pack-v2':
        return EvidencePackV2.model_validate(value)
    return EvidencePack.model_validate(value)


def parse_advisory_report(value: Any) -> AdvisoryReport | AdvisoryReportV2:
    """Read a persisted report document without rewriting old reports."""
    if isinstance(value, dict) and value.get('schema_version') == 'advisory-report-v2':
        return AdvisoryReportV2.model_validate(value)
    return AdvisoryReport.model_validate(value)
