"""Publish-time validation for model-generated advisory content."""
from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from .contracts import (
    CandidateReport,
    Claim,
    EvidencePack,
    GateResult,
    ValidationIssue,
)


_NUMBER = re.compile(
    r'(?<![\w.-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?'
    r'(?:[eE][+-]?\d+)?%?(?![\w.-])'
)
_EVIDENCE_ID = re.compile(r'\bE-[A-Z0-9-]+\b')
_SENSITIVE = (
    re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+'),
    re.compile(r'(?i)\b(?:api[_-]?key|password|secret)\s*[:=]\s*\S+'),
    re.compile(r'(?i)postgres(?:ql)?://[^\s]+'),
    re.compile(r'(?i)\bsk-[A-Za-z0-9_-]{12,}'),
)
_NEGATION = re.compile(
    r'(?:尚未|未上报|未验证|未形成|没有|无法|不能|不足以|并非|不等于|'
    r'不是|不得|不应|不可|禁止|避免|并未|不证明|不代表|不表示|缺少)'
)
_SUFFIX_NEGATION = re.compile(
    r'(?:无法判断|不能判断|不足以判断|无法判定|不能判定|'
    r'无法确认|不能确认|未验证|未经验证|尚待验证|仍待验证)'
)


def _iter_claims(report: CandidateReport) -> Iterable[Claim]:
    yield from report.claims
    for finding in report.findings:
        yield finding.observation
        if finding.inference:
            yield finding.inference
        if finding.recommendation:
            yield finding.recommendation


def _numeric_literals(value: Any) -> set[str]:
    result: set[str] = set()
    if isinstance(value, bool) or value is None:
        return result
    if isinstance(value, (int, float)):
        normalized = _normalize_number(str(value))
        if normalized is not None:
            result.add(normalized)
    elif isinstance(value, str):
        result.update(
            normalized
            for match in _NUMBER.finditer(value)
            if (normalized := _normalize_number(match.group(0))) is not None
        )
    elif isinstance(value, dict):
        for key, item in value.items():
            result.update(_numeric_literals(key))
            result.update(_numeric_literals(item))
    elif isinstance(value, list):
        for item in value:
            result.update(_numeric_literals(item))
    return result


def _normalize_number(token: str) -> str | None:
    try:
        number = Decimal(token.rstrip('%').replace(',', ''))
    except InvalidOperation:
        return None
    if not number.is_finite():
        return None
    if number == 0:
        return '0'
    return format(number.normalize(), 'f')


def _negated(text: str, start: int, end: int | None = None) -> bool:
    boundary = max(
        text.rfind('。', 0, start),
        text.rfind('！', 0, start),
        text.rfind('？', 0, start),
        text.rfind('\n', 0, start),
    )
    prefix = text[boundary + 1:start].rstrip('，,；;：: ')
    if _NEGATION.search(prefix):
        return True
    if end is None:
        return False
    boundary_end = len(text)
    for marker in '。！？\n':
        position = text.find(marker, end)
        if position != -1:
            boundary_end = min(boundary_end, position)
    suffix = text[end:boundary_end].lstrip('，,；;：: ')
    return bool(_SUFFIX_NEGATION.search(suffix[:32]))


def _forbidden_phrases(
    report: CandidateReport,
    gate: GateResult,
    pack: EvidencePack,
) -> list[str]:
    text = '\n'.join(
        [report.summary]
        + [claim.text for claim in _iter_claims(report)]
        + [item.text for item in report.limitations]
    )
    issues: list[str] = []
    candidates = (
        (re.compile(r'模型可用(?!性)'), '不得在未验证时声称模型可用'),
        (re.compile(r'生产可用'), '不得声称已经生产可用'),
        (re.compile(r'业务准确率'), '不得用训练 Loss 推断业务准确率'),
        (re.compile(r'泛化良好'), '缺少足够验证证据时不得宣称泛化良好'),
        (re.compile(r'根因(?:是|为)|已确认根因'), '不得把错误码或猜测写成已确认根因'),
    )
    for pattern, message in candidates:
        for match in pattern.finditer(text):
            if not _negated(text, match.start()):
                issues.append(message)
                break
    if gate.delivery_status != 'ready_for_release_review':
        for match in re.finditer(r'(?:推理验收通过|已通过推理验收|可进入发布评审)', text):
            if not _negated(text, match.start()):
                issues.append('当前没有匹配的独立推理验收，不得声称推理验收通过')
                break
    if pack.attempt_state == 'cancelled':
        for match in re.finditer(r'训练失败', text):
            if not _negated(text, match.start(), match.end()):
                issues.append('取消的 Attempt 不能表述为训练失败')
                break
    metrics = pack.facts.get('metrics') if isinstance(pack.facts.get('metrics'), dict) else {}
    counts = metrics.get('counts') if isinstance(metrics.get('counts'), dict) else {}
    if int(counts.get('eval') or 0) < 2:
        for match in re.finditer(r'过拟合', text):
            if not _negated(text, match.start(), match.end()):
                issues.append('Eval 采样不足时不得判定过拟合')
                break
    if gate.health_status != 'healthy' and re.search(r'训练健康度(?:为)?健康', text):
        issues.append('模型文本不得改写 Gate 训练健康度')
    if gate.delivery_status != 'ready_for_release_review' and re.search(
        r'交付状态(?:为)?(?:可发布|已就绪)',
        text,
    ):
        issues.append('模型文本不得改写 Gate 可交付性')
    return issues


class ReportValidator:
    """Fail closed on unsupported, unsafe or Gate-conflicting output."""

    def validate(
        self,
        candidate: CandidateReport,
        pack: EvidencePack,
        gate: GateResult,
    ) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        evidence_ids = {item.id for item in pack.evidence}
        claims = list(_iter_claims(candidate))
        claim_ids: set[str] = set()
        for claim in claims:
            if claim.id in claim_ids:
                issues.append(ValidationIssue(
                    code='duplicate_claim_id',
                    message=f'Claim ID {claim.id} 重复。',
                    path=f'claims.{claim.id}',
                ))
            claim_ids.add(claim.id)
        for claim in claims:
            for evidence_id in claim.evidence_ids:
                if evidence_id not in evidence_ids:
                    issues.append(ValidationIssue(
                        code='unknown_evidence_id',
                        message=f'引用了不存在的证据 {evidence_id}。',
                        path=f'claims.{claim.id}.evidence_ids',
                    ))
            for basis_id in claim.basis_claim_ids:
                if basis_id not in claim_ids:
                    issues.append(ValidationIssue(
                        code='unknown_basis_claim',
                        message=f'引用了不存在的 basis claim {basis_id}。',
                        path=f'claims.{claim.id}.basis_claim_ids',
                    ))
            if claim.layer == 'observation' and not claim.evidence_ids:
                issues.append(ValidationIssue(
                    code='observation_without_evidence',
                    message='观测陈述必须引用证据。',
                    path=f'claims.{claim.id}',
                ))
            if claim.layer == 'inference' and not (
                claim.evidence_ids or claim.basis_claim_ids
            ):
                issues.append(ValidationIssue(
                    code='inference_without_basis',
                    message='推断必须引用证据或已有 claim。',
                    path=f'claims.{claim.id}',
                ))

        finding_ids: set[str] = set()
        for finding in candidate.findings:
            if finding.id in finding_ids:
                issues.append(ValidationIssue(
                    code='duplicate_finding_id',
                    message=f'Finding ID {finding.id} 重复。',
                    path=f'findings.{finding.id}',
                ))
            finding_ids.add(finding.id)
            if not finding.evidence_ids:
                issues.append(ValidationIssue(
                    code='finding_without_evidence',
                    message='每条关键发现至少需要一个证据引用。',
                    path=f'findings.{finding.id}',
                ))
            for evidence_id in finding.evidence_ids:
                if evidence_id not in evidence_ids:
                    issues.append(ValidationIssue(
                        code='unknown_evidence_id',
                        message=f'Finding 引用了不存在的证据 {evidence_id}。',
                        path=f'findings.{finding.id}.evidence_ids',
                    ))
            if finding.epistemic_status == 'unknown' and finding.severity == 'passed':
                issues.append(ValidationIssue(
                    code='unknown_marked_passed',
                    message='无法判断的发现不能显示为通过。',
                    path=f'findings.{finding.id}',
                ))
            if (
                finding.epistemic_status == 'observed'
                and not finding.observation.evidence_ids
            ):
                issues.append(ValidationIssue(
                    code='observed_finding_without_evidence',
                    message='观测型发现必须引用证据。',
                    path=f'findings.{finding.id}.observation',
                ))

        for experiment in candidate.next_experiments:
            for evidence_id in experiment.evidence_ids:
                if evidence_id not in evidence_ids:
                    issues.append(ValidationIssue(
                        code='unknown_evidence_id',
                        message=f'下一步实验引用了不存在的证据 {evidence_id}。',
                        path=f'next_experiments.{experiment.id}.evidence_ids',
                    ))
            if not experiment.evidence_ids and experiment.priority == 'P0':
                issues.append(ValidationIssue(
                    code='p0_without_evidence',
                    message='P0 下一步实验必须说明证据依据。',
                    path=f'next_experiments.{experiment.id}',
                ))

        allowed_numbers = _numeric_literals(pack.facts)
        allowed_numbers.update(_numeric_literals(gate.model_dump(mode='json')))
        allowed_numbers.update({'0', '1', '2', '3'})
        for claim in claims + [
            item for item in report_limitation_claims(candidate)
        ]:
            for match in _NUMBER.finditer(claim.text):
                token = _normalize_number(match.group(0))
                if token is None or token not in allowed_numbers:
                    issues.append(ValidationIssue(
                        code='unsupported_number',
                        message=f'数字 {match.group(0)} 不在冻结证据中。',
                        path=f'claims.{claim.id}.text',
                    ))
            for evidence_id in _EVIDENCE_ID.findall(claim.text):
                if evidence_id not in evidence_ids:
                    issues.append(ValidationIssue(
                        code='unknown_evidence_id',
                        message=f'正文引用了不存在的证据 {evidence_id}。',
                        path=f'claims.{claim.id}.text',
                    ))

        for text, path in report_texts(candidate):
            for pattern in _SENSITIVE:
                if pattern.search(text):
                    issues.append(ValidationIssue(
                        code='sensitive_content',
                        message='候选报告包含疑似敏感信息。',
                        path=path,
                    ))
                    break

        for message in _forbidden_phrases(candidate, gate, pack):
            issues.append(ValidationIssue(
                code='forbidden_claim',
                message=message,
                path='report',
            ))
        return issues


def report_limitation_claims(candidate: CandidateReport):
    for limitation in candidate.limitations:
        yield Claim(
            id='limitation-' + limitation.code,
            layer='limitation',
            text=limitation.text,
            evidence_ids=limitation.evidence_ids,
        )


def report_texts(candidate: CandidateReport):
    yield candidate.summary, 'summary'
    for claim in _iter_claims(candidate):
        yield claim.text, f'claims.{claim.id}.text'
    for limitation in candidate.limitations:
        yield limitation.text, f'limitations.{limitation.code}.text'
    for experiment in candidate.next_experiments:
        yield experiment.title, f'next_experiments.{experiment.id}.title'
        yield experiment.hypothesis, f'next_experiments.{experiment.id}.hypothesis'
