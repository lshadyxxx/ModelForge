"""Read-only, compact composition through module public contracts."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import Adapters, ModelRegistry
from modelforge.modules.resources import GpuLeases
from modelforge.modules.serving import Serving
from modelforge.modules.training import Training

router = APIRouter(prefix='/api/v1/overview', tags=['overview'])

_ATTENTION_STATES = {'failed', 'blocked'}
_TERMINAL_STATES = {'succeeded', 'failed', 'cancelled', 'stopped'}
_MAX_LOSS_POINTS = 80


def _text(value: Any) -> str | None:
    return str(value) if value is not None else None


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _timestamp(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, 'isoformat') else str(value)


def _timestamp_sort_key(value: Any) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _loss_points(metrics: Any) -> list[dict[str, float | int]]:
    points = []
    for index, item in enumerate(metrics if isinstance(metrics, list) else [], start=1):
        if not isinstance(item, dict):
            continue
        loss = _number(item.get('loss'))
        if loss is None:
            continue
        raw_step = item.get('step')
        step = raw_step if isinstance(raw_step, int) and not isinstance(raw_step, bool) else index
        points.append({'step': step, 'loss': loss})
    return points


def _bounded_loss_series(points: list[dict[str, float | int]],
                         limit: int = _MAX_LOSS_POINTS) -> list[dict[str, float | int]]:
    if len(points) <= limit:
        return points
    indexes = [round(index * (len(points) - 1) / (limit - 1)) for index in range(limit)]
    return [points[index] for index in dict.fromkeys(indexes)]


def training_metrics(metrics: Any) -> dict[str, Any]:
    """Project bounded, finite metrics without exposing the full attempt row."""
    loss_points = _loss_points(metrics)
    loss_series = _bounded_loss_series(loss_points)
    losses = [point['loss'] for point in loss_points]
    latest_eval = None
    latest_step = None
    for item in reversed(metrics if isinstance(metrics, list) else []):
        if not isinstance(item, dict):
            continue
        raw_step = item.get('step')
        if latest_step is None and isinstance(raw_step, int) and not isinstance(raw_step, bool):
            latest_step = raw_step
        eval_loss = _number(item.get('eval_loss'))
        if latest_eval is None and eval_loss is not None:
            latest_eval = eval_loss
    if latest_step is None and loss_series:
        latest_step = loss_series[-1]['step']
    return {
        'average_train_loss': sum(losses) / len(losses) if losses else None,
        'eval_loss': latest_eval,
        'step': latest_step,
        'loss_series': loss_series,
    }


def _pick(source: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    return {key: source[key] for key in keys if key in source}


def training_context(row: dict[str, Any], snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        snapshot = {}
    runtime = row.get('runtime_report')
    if not isinstance(runtime, dict):
        runtime = snapshot.get('runtime')
    config = snapshot.get('config')
    instance = snapshot.get('instance')
    return {
        'runtime': _pick(runtime, ('gpu', 'memory_bytes', 'versions', 'template')),
        'config': _pick(config, (
            'epochs', 'learning_rate', 'cutoff_len', 'batch_size', 'gradient_accumulation',
            'lora_rank', 'lora_alpha', 'lora_dropout', 'scheduler', 'warmup_ratio', 'template', 'seed',
        )),
        'instance': _pick(instance, (
            'region', 'zone', 'gpu_type', 'cpu', 'memory_mb', 'image_id', 'charge_type',
            'boot_disk_gb', 'boot_disk_type', 'cpu_platform',
        )),
    }


def latest_training_projection(
    row: dict[str, Any],
    snapshot: Any,
    dataset_rows: list[dict[str, Any]],
    model_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    dataset_snapshot = snapshot.get('dataset') if isinstance(snapshot.get('dataset'), dict) else {}
    base_snapshot = snapshot.get('base') if isinstance(snapshot.get('base'), dict) else {}
    dataset_id = _text(dataset_snapshot.get('id'))
    base_id = _text(base_snapshot.get('id'))
    dataset = next((item for item in dataset_rows if _text(item.get('version_id')) == dataset_id), None)
    base = next((item for item in model_rows if _text(item.get('id')) == base_id), None)
    context = training_context(row, snapshot)
    return {
        'id': _text(row.get('id')),
        'name': row.get('name'),
        'number': row.get('number'),
        'state': row.get('state'),
        'stage': row.get('stage'),
        'error_code': row.get('error_code'),
        'created_at': _timestamp(row.get('created_at')),
        'updated_at': _timestamp(row.get('updated_at')),
        **training_metrics(row.get('metrics')),
        **context,
        'dataset': {
            'id': dataset_id,
            'name': dataset.get('name') if dataset else None,
            'version_number': dataset.get('version_number') if dataset else None,
            'sample_count': dataset.get('sample_count') if dataset
            else dataset_snapshot.get('sample_count'),
        },
        'base': {
            'id': base_id,
            'name': base.get('name') if base else None,
            'version_number': base.get('version_number') if base else None,
            'source_kind': base.get('source_kind') if base else base_snapshot.get('source_kind'),
            'compatibility_state': base.get('compatibility_state') if base else None,
            'model_type': (
                base.get('format_summary', {}).get('model_type')
                if base and isinstance(base.get('format_summary'), dict) else None
            ),
        },
    }


def _attention(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': _text(row.get('id')),
        'name': row.get('name'),
        'number': row.get('number'),
        'state': row.get('state'),
        'stage': row.get('stage'),
        'error_code': row.get('error_code'),
        'updated_at': _timestamp(row.get('updated_at')),
    }


def _trial_projection(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': _text(row.get('id')),
        'adapter_id': _text(row.get('adapter_id')),
        'state': row.get('state'),
        'instance_id': row.get('instance_id'),
        'error_code': row.get('error_code'),
        'request_state': row.get('request_state'),
        'stop_requested': row.get('stop_requested'),
        'created_at': _timestamp(row.get('created_at')),
        'updated_at': _timestamp(row.get('updated_at')),
    }


def _adapter_projection(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': _text(row.get('id')),
        'source_attempt_id': _text(row.get('source_attempt_id')),
        'role': row.get('role'),
        'state': row.get('state'),
        'metrics': row.get('metrics') if isinstance(row.get('metrics'), dict) else {},
        'created_at': _timestamp(row.get('created_at')),
    }


def _activity_detail(row: dict[str, Any], kind: str) -> str:
    if kind == 'training':
        summary = training_metrics(row.get('metrics'))
        if summary['step'] is not None and summary['eval_loss'] is not None:
            return f"{summary['step']} step · eval {summary['eval_loss']:.4f}"
        if row.get('error_code'):
            return str(row['error_code'])
        return f"阶段 {row.get('stage')}" if row.get('stage') else '尚无指标'
    instance = row.get('instance_id')
    return f"实例 {instance[:13]}…" if instance and len(instance) > 13 else (
        f"实例 {instance}" if instance else '尚未关联实例'
    )


def recent_activity(attempts: list[dict[str, Any]], trials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    activity = []
    for row in attempts:
        activity.append({
            'kind': 'training',
            'id': _text(row.get('id')),
            'label': f"训练 Attempt #{row.get('number')}",
            'name': row.get('name'),
            'state': row.get('state'),
            'detail': _activity_detail(row, 'training'),
            'updated_at': _timestamp(row.get('updated_at')),
        })
    for row in trials:
        activity.append({
            'kind': 'inference',
            'id': _text(row.get('id')),
            'label': f"推理 Trial {str(row.get('id'))[:8]}",
            'name': f"Adapter {str(row.get('adapter_id'))[:8]}",
            'state': row.get('state'),
            'detail': _activity_detail(row, 'inference'),
            'updated_at': _timestamp(row.get('updated_at')),
        })
    activity.sort(key=lambda item: _timestamp_sort_key(item['updated_at']), reverse=True)
    return activity[:8]


def _gpu_projection(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    return _pick(row, (
        'owner_kind', 'owner_id', 'provider_instance_id', 'create_state',
        'instance_state', 'process_state', 'cleanup_state', 'heartbeat_at',
    ))


def overview_payload(
    *,
    datasets: list[dict[str, Any]],
    models: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    trials: list[dict[str, Any]],
    adapters: list[dict[str, Any]],
    adapters_available: int | None = None,
    gpu: Any,
    latest_snapshot: Any = None,
) -> dict[str, Any]:
    latest = attempts[0] if attempts else None
    attention_rows = [row for row in attempts if row.get('state') in _ATTENTION_STATES]
    attention_trials = [row for row in trials if row.get('state') == 'blocked']
    live_attempts = [row for row in attempts if row.get('state') not in _TERMINAL_STATES]
    live_trials = [row for row in trials if row.get('state') not in _TERMINAL_STATES]
    return {
        'schema': 1,
        'datasets_published': sum(row.get('state') == 'published' for row in datasets),
        'models_available': sum(row.get('state') == 'available' for row in models),
        'adapters_available': (
            adapters_available if adapters_available is not None
            else sum(row.get('state') == 'available' for row in adapters)
        ),
        'gpu': _gpu_projection(gpu),
        'latest_training': (
            latest_training_projection(latest, latest_snapshot, datasets, models)
            if latest else None
        ),
        'attention_training': _attention(attention_rows[0]) if attention_rows else None,
        'latest_trial': _trial_projection(trials[0]) if trials else None,
        'attention_count': len(attention_rows) + len(attention_trials),
        'live_work_count': len(live_attempts) + len(live_trials),
        'adapters': [_adapter_projection(row) for row in adapters[:10]],
        'recent_activity': recent_activity(attempts, trials),
    }


@router.get('')
def overview(request: Request):
    resources = request.app.state.resources
    datasets = DatasetRegistry(resources).list()
    models = ModelRegistry(resources).list()
    attempts = Training(resources).list()
    trials = Serving(resources).list()
    adapter_contract = Adapters(resources)
    adapters = []
    latest_snapshot = None
    if attempts:
        latest_attempt = attempts[0]
        latest_snapshot = Training(resources).get(latest_attempt['id'])['snapshot']
        adapters = adapter_contract.list(attempt_id=latest_attempt['id'], limit=10)
    return overview_payload(
        datasets=datasets,
        models=models,
        attempts=attempts,
        trials=trials,
        adapters=adapters,
        adapters_available=adapter_contract.available_count(),
        gpu=GpuLeases(resources.pool).current(),
        latest_snapshot=latest_snapshot,
    )
