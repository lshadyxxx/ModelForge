"""Application services for diagnosis jobs and published reports."""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from modelforge.errors import AppError
from modelforge.modules.training import Training

from .comparison import POLICY_VERSION as COMPARISON_POLICY_VERSION
from .comparison_repository import ComparisonRepository
from .contracts import (
    BaselineSelection,
    ComparisonMode,
    digest,
)
from .drafts import build_training_draft
from .gates import POLICY_VERSION
from .generator import GENERATOR_VERSION
from .graph import GRAPH_VERSION
from .prompts import PROMPT_VERSION
from .repository import DiagnosisRepository


TERMINAL_STATES = {'succeeded', 'failed', 'cancelled'}


class DiagnosisUseCases:
    def __init__(self, resources):
        self.resources = resources
        self.settings = resources.settings
        self.training = Training(resources)
        self.repository = DiagnosisRepository(resources)

    @staticmethod
    def availability(settings) -> dict[str, Any]:
        return {
            'enabled': settings.ai_enabled,
            'model_configured': bool(settings.ai_model),
            'scope': 'terminal_attempt_only',
            'trigger': 'manual',
            'ai_role': 'advisory_diagnosis_not_gate',
        }

    def _require_enabled(self) -> None:
        if not self.settings.ai_enabled:
            raise AppError(
                503,
                'ai_diagnosis_disabled',
                'AI 智能报告当前未启用；原始运行分析仍可查看。',
            )

    def _attempt(self, attempt_id: uuid.UUID) -> dict[str, Any]:
        attempt = self.training.get(attempt_id)
        if attempt['state'] not in TERMINAL_STATES:
            raise AppError(
                409,
                'attempt_not_terminal',
                '只能在训练成功、失败或取消后生成终态报告。',
            )
        return attempt

    def _request_key(
        self,
        attempt: dict[str, Any],
        *,
        comparison_mode: ComparisonMode,
        selection: BaselineSelection,
        baseline_snapshot_sha256: str | None,
    ) -> str:
        body = {
            'scope': 'initial',
            'policy': POLICY_VERSION,
            'graph': GRAPH_VERSION,
            'prompt': PROMPT_VERSION,
            'generator': GENERATOR_VERSION,
            'snapshot': attempt.get('snapshot_sha256'),
            'comparison_mode': comparison_mode,
            'selection_rule': selection.selection_rule,
            'baseline': (
                str(selection.resolved_attempt_id)
                if selection.resolved_attempt_id else None
            ),
            'baseline_snapshot': baseline_snapshot_sha256,
            'comparison_policy': COMPARISON_POLICY_VERSION,
        }
        return hashlib.sha256(
            json.dumps(body, sort_keys=True).encode('utf-8')
        ).hexdigest()

    def create(
        self,
        attempt_id: uuid.UUID,
        *,
        comparison_mode: ComparisonMode = 'auto',
        baseline_attempt_id: uuid.UUID | None = None,
    ) -> dict[str, Any]:
        self._require_enabled()
        attempt = self._attempt(attempt_id)
        comparison = ComparisonRepository(self.resources)
        selection: BaselineSelection
        baseline: dict[str, Any] | None = None
        if comparison_mode == 'explicit':
            selection, baseline = comparison.resolve(
                attempt_id,
                mode='explicit',
                requested_attempt_id=baseline_attempt_id,
            )
        elif comparison_mode == 'none':
            selection = BaselineSelection(
                mode='none',
                selection_rule='none',
            )
        elif attempt['state'] == 'succeeded':
            selection, baseline = comparison.resolve(
                attempt_id,
                mode='auto',
                requested_attempt_id=None,
            )
        else:
            selection = BaselineSelection(
                mode='auto',
                selection_rule='not_available',
                reason_code='subject_not_succeeded_for_comparison',
            )
        job, created = self.repository.create_job(
            attempt_id,
            request_key=self._request_key(
                attempt,
                comparison_mode=comparison_mode,
                selection=selection,
                baseline_snapshot_sha256=(
                    baseline.get('snapshot_sha256')
                    if baseline is not None else None
                ),
            ),
            policy_version=POLICY_VERSION,
            graph_version=GRAPH_VERSION,
            prompt_version=PROMPT_VERSION,
            generator_version=GENERATOR_VERSION,
            comparison_mode=comparison_mode,
            baseline_attempt_id=selection.resolved_attempt_id,
            comparison_policy_version=COMPARISON_POLICY_VERSION,
        )
        view = self.repository.get_job(job['id'])
        view['created'] = created
        return view

    def regenerate(self, job_id: uuid.UUID) -> dict[str, Any]:
        self._require_enabled()
        source = self.repository.get_job(job_id)
        attempt = self._attempt(uuid.UUID(str(source['attempt_id'])))
        request_key = digest({
            'scope': 'regenerate',
            'source_job': str(job_id),
            'nonce': uuid.uuid4().hex,
            'snapshot': attempt.get('snapshot_sha256'),
            'comparison_mode': source.get('comparison_mode', 'none'),
            'baseline': (
                str(source['baseline_attempt_id'])
                if source.get('baseline_attempt_id') else None
            ),
            'comparison_policy': COMPARISON_POLICY_VERSION,
        })
        job = self.repository.create_regeneration(
            job_id,
            request_key=request_key,
        )
        view = self.repository.get_job(job['id'])
        view['created'] = True
        return view

    def comparison_candidates(
        self,
        attempt_id: uuid.UUID,
        *,
        limit: int = 20,
    ) -> dict[str, Any]:
        return ComparisonRepository(self.resources).candidates(
            attempt_id,
            limit=limit,
        ).model_dump(mode='json')

    def latest(self, attempt_id: uuid.UUID) -> dict[str, Any] | None:
        self.training.get(attempt_id)
        return self.repository.get_latest(attempt_id)

    def reports(self, attempt_id: uuid.UUID) -> list[dict[str, Any]]:
        self.training.get(attempt_id)
        return self.repository.list_reports(attempt_id)

    def report(self, report_id: uuid.UUID) -> dict[str, Any]:
        return self.repository.get_report(report_id)

    def job(self, job_id: uuid.UUID) -> dict[str, Any]:
        return self.repository.get_job(job_id)

    def draft(
        self,
        report_id: uuid.UUID,
        *,
        experiment_id: str,
    ) -> dict[str, Any]:
        response = self.repository.get_report(report_id)
        report = response['report']
        attempt = self.training.get(uuid.UUID(str(report['attempt_id'])))
        snapshot = attempt.get('snapshot')
        config = snapshot.get('config') if isinstance(snapshot, dict) else None
        if not isinstance(config, dict):
            raise AppError(
                409,
                'training_config_unavailable',
                '当前 Attempt 没有可复制的冻结训练配置。',
            )
        return build_training_draft(
            report,
            experiment_id=experiment_id,
            base_config=config,
        )
