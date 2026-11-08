"""Read-only historical candidate queries for diagnosis comparisons."""
from __future__ import annotations

import hashlib
import math
import uuid
from typing import Any

from modelforge.errors import AppError
from modelforge.modules.training import Training

from .comparison import ComparisonEngine, comparison_group
from .contracts import (
    BaselineSelection,
    ComparisonCandidate,
    ComparisonCandidates,
    ComparisonMode,
    canonical,
)


class ComparisonRepository:
    def __init__(self, resources):
        self.resources = resources
        self.pool = resources.pool
        self.training = Training(resources)
        self.engine = ComparisonEngine()

    def candidates(
        self,
        attempt_id: uuid.UUID,
        *,
        limit: int = 20,
    ) -> ComparisonCandidates:
        limit = max(1, min(int(limit), 20))
        subject = self._comparison_subject(attempt_id)
        group = comparison_group({'snapshot': subject.get('snapshot')})
        if not all((
            group.base_fingerprint,
            group.dataset_sha256,
            group.dataset_split_sha256,
        )):
            raise AppError(
                409,
                'snapshot_integrity_failed',
                '当前 Attempt 的 Snapshot 缺少比较键。',
            )

        with self.pool.connection() as connection:
            rows = connection.execute(
                '''
                SELECT a.id, a.task_id, a.number, a.state, a.created_at,
                       a.metrics, a.runtime_report, a.token_preflight,
                       t.name, t.snapshot, t.snapshot_sha256
                FROM training_attempts AS a
                JOIN training_tasks AS t ON t.id = a.task_id
                WHERE a.state = 'succeeded'
                  AND a.id <> %s
                  AND a.created_at < %s
                  AND t.snapshot->'base'->>'fingerprint' = %s
                  AND t.snapshot->'dataset'->>'sha256' = %s
                  AND t.snapshot->'dataset'->>'split_sha256' = %s
                ORDER BY a.created_at DESC, a.number DESC, a.id DESC
                LIMIT %s
                ''',
                (
                    attempt_id,
                    subject['created_at'],
                    group.base_fingerprint,
                    group.dataset_sha256,
                    group.dataset_split_sha256,
                    limit,
                ),
            ).fetchall()

        adapter_rows = self._adapter_rows([row['id'] for row in rows])
        subject_adapters = self._adapter_rows([attempt_id])
        subject_facts = self._facts(
            subject,
            adapters=subject_adapters.get(attempt_id, {}),
        )
        candidates: list[ComparisonCandidate] = []
        for row in rows:
            if not self._snapshot_valid(row):
                continue
            adapters = adapter_rows.get(row['id'], {})
            facts = self._facts(row, adapters=adapters)
            best = self._eval_loss(adapters.get('best'))
            final = self._eval_loss(adapters.get('final'))
            status, changed, confounders = self.engine.preview(
                subject_facts,
                facts,
            )
            candidates.append(ComparisonCandidate(
                attempt_id=row['id'],
                task_id=row['task_id'],
                task_name=row['name'],
                attempt_number=row['number'],
                state='succeeded',
                created_at=row['created_at'],
                snapshot_sha256=row['snapshot_sha256'],
                base_fingerprint=group.base_fingerprint,
                dataset_sha256=group.dataset_sha256,
                dataset_split_sha256=group.dataset_split_sha256,
                best_eval_loss=best,
                final_eval_loss=final,
                eval_point_count=self._eval_count(row.get('metrics')),
                available_adapter_roles=[
                    role
                    for role in ('best', 'final')
                    if (adapters.get(role) or {}).get('state') == 'available'
                ],
                comparability_preview=status,
                changed_parameter_count=changed,
                confounder_preview_codes=confounders,
            ))

        suggested = next(
            (
                item.attempt_id
                for item in candidates
                if item.best_eval_loss is not None
                or item.final_eval_loss is not None
            ),
            None,
        )
        return ComparisonCandidates(
            subject_attempt_id=attempt_id,
            group=group,
            suggested_baseline_attempt_id=suggested,
            candidates=candidates,
        )

    def resolve(
        self,
        attempt_id: uuid.UUID,
        *,
        mode: ComparisonMode,
        requested_attempt_id: uuid.UUID | None,
    ) -> tuple[BaselineSelection, dict[str, Any] | None]:
        if mode == 'none':
            return BaselineSelection(
                mode='none',
                selection_rule='none',
            ), None

        subject = self._comparison_subject(attempt_id)
        if mode == 'explicit':
            if requested_attempt_id is None:
                raise AppError(
                    422,
                    'baseline_required',
                    '显式比较必须提供 baseline_attempt_id。',
                )
            baseline = self._validated_baseline(
                subject,
                requested_attempt_id,
            )
            return BaselineSelection(
                mode='explicit',
                requested_attempt_id=requested_attempt_id,
                resolved_attempt_id=requested_attempt_id,
                selection_rule='explicit',
            ), baseline

        candidates = self.candidates(attempt_id)
        suggested = candidates.suggested_baseline_attempt_id
        if suggested is None:
            return BaselineSelection(
                mode='auto',
                selection_rule='not_available',
                reason_code='no_prior_successful_run_with_metrics',
            ), None
        baseline = self._validated_baseline(subject, suggested)
        return BaselineSelection(
            mode='auto',
            resolved_attempt_id=suggested,
            selection_rule='latest_previous_success',
        ), baseline

    def assert_resolved_baseline(
        self,
        subject_attempt_id: uuid.UUID,
        baseline_attempt_id: uuid.UUID,
    ) -> dict[str, Any]:
        subject = self._comparison_subject(subject_attempt_id)
        return self._validated_baseline(subject, baseline_attempt_id)

    def _comparison_subject(self, attempt_id: uuid.UUID) -> dict[str, Any]:
        attempt = self.training.get(attempt_id)
        if attempt['state'] not in {'succeeded', 'failed', 'cancelled'}:
            raise AppError(
                409,
                'attempt_not_terminal',
                '只能在终态 Attempt 上查找历史比较。',
            )
        if attempt['state'] != 'succeeded':
            raise AppError(
                409,
                'subject_not_succeeded_for_comparison',
                '失败或取消的 Attempt 不做训练效果对比。',
            )
        return attempt

    def _validated_baseline(
        self,
        subject: dict[str, Any],
        baseline_id: uuid.UUID,
    ) -> dict[str, Any]:
        if baseline_id == subject['id']:
            raise AppError(
                422,
                'baseline_same_as_subject',
                '基线不能指向当前 Attempt。',
            )
        with self.pool.connection() as connection:
            row = connection.execute(
                '''
                SELECT a.id, a.task_id, a.number, a.state, a.created_at,
                       a.metrics, a.runtime_report, a.token_preflight,
                       t.name, t.snapshot, t.snapshot_sha256
                FROM training_attempts AS a
                JOIN training_tasks AS t ON t.id = a.task_id
                WHERE a.id = %s
                ''',
                (baseline_id,),
            ).fetchone()
        if row is None:
            raise AppError(
                404,
                'baseline_attempt_not_found',
                '指定的历史基线不存在。',
            )
        if row['state'] != 'succeeded':
            raise AppError(
                422,
                'baseline_not_succeeded',
                '历史基线不是成功 Attempt，不能做效果比较。',
            )
        if row['created_at'] >= subject['created_at']:
            raise AppError(
                422,
                'baseline_not_prior',
                '历史基线必须早于当前 Attempt。',
            )
        if not self._snapshot_valid(row):
            raise AppError(
                409,
                'baseline_snapshot_integrity_failed',
                '历史基线 Snapshot 完整性校验失败。',
            )
        subject_group = comparison_group({'snapshot': subject.get('snapshot')})
        baseline_group = comparison_group({'snapshot': row.get('snapshot')})
        if subject_group != baseline_group:
            raise AppError(
                422,
                'baseline_not_comparable',
                '历史基线与当前运行的基座、数据集或 split 不一致。',
            )
        return row

    @staticmethod
    def _snapshot_valid(row: dict[str, Any]) -> bool:
        snapshot = row.get('snapshot')
        expected = row.get('snapshot_sha256')
        if not isinstance(snapshot, dict) or not isinstance(expected, str):
            return False
        actual = hashlib.sha256(canonical(snapshot)).hexdigest()
        return actual == expected

    def _adapter_rows(
        self,
        attempt_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, dict[str, dict[str, Any]]]:
        if not attempt_ids:
            return {}
        with self.pool.connection() as connection:
            rows = connection.execute(
                '''
                SELECT id, source_attempt_id, role, state, fingerprint, metrics
                FROM adapter_versions
                WHERE source_attempt_id = ANY(%s::uuid[])
                ''',
                (attempt_ids,),
            ).fetchall()
        result: dict[uuid.UUID, dict[str, dict[str, Any]]] = {}
        for row in rows:
            result.setdefault(row['source_attempt_id'], {})[row['role']] = dict(row)
        return result

    @staticmethod
    def _facts(
        row: dict[str, Any],
        *,
        adapters: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        metrics = row.get('metrics') if isinstance(row.get('metrics'), list) else []
        eval_points = [
            item for item in metrics
            if isinstance(item, dict) and _finite(item.get('eval_loss'))
        ]
        train_points = [
            item for item in metrics
            if isinstance(item, dict) and _finite(item.get('loss'))
        ]
        lr_points = [
            item for item in metrics
            if isinstance(item, dict) and _finite(item.get('learning_rate'))
        ]
        latest_eval = max(
            eval_points,
            key=lambda item: (
                item.get('step') is not None,
                item.get('step') or 0,
            ),
            default=None,
        )
        lowest_eval = min(
            eval_points,
            key=lambda item: item['eval_loss'],
            default=None,
        )
        runtime = row.get('runtime_report') if isinstance(row.get('runtime_report'), dict) else {}
        return {
            'snapshot': row.get('snapshot') if isinstance(row.get('snapshot'), dict) else {},
            'metrics': {
                'points': metrics,
                'counts': {
                    'train': len(train_points),
                    'eval': len(eval_points),
                    'learning_rate': len(lr_points),
                },
                'latest_eval': latest_eval,
                'lowest_eval': lowest_eval,
                'last_train': train_points[-1] if train_points else None,
            },
            'token_preflight': row.get('token_preflight'),
            'runtime': runtime,
            'memory': runtime.get('training_memory'),
            'logs': {'gap': False},
            'adapters': adapters,
        }

    @staticmethod
    def _eval_count(metrics: Any) -> int:
        if not isinstance(metrics, list):
            return 0
        return sum(
            1
            for item in metrics
            if isinstance(item, dict) and _finite(item.get('eval_loss'))
        )

    @staticmethod
    def _eval_loss(adapter: Any) -> float | None:
        if not isinstance(adapter, dict) or adapter.get('state') != 'available':
            return None
        metrics = adapter.get('metrics')
        if not isinstance(metrics, dict):
            return None
        value = metrics.get('eval_loss')
        return float(value) if _finite(value) else None


def _finite(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )
