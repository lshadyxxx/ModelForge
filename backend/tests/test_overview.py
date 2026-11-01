from modelforge.modules.overview.routes import (
    latest_training_projection,
    overview_payload,
    recent_activity,
    training_metrics,
)


def test_metrics_separate_train_average_from_latest_eval_loss():
    metrics = [
        {'step': 1, 'loss': 2.0},
        {'step': 2, 'loss': 1.0},
        {'step': 2, 'loss': float('nan')},
        {'step': 3, 'eval_loss': 0.25},
        {'step': 3, 'loss': 1.5},
        {'step': 4, 'eval_loss': 0.125},
        {'step': 4, 'loss': True},
    ]

    result = training_metrics(metrics)

    assert result == {
        'average_train_loss': 1.5,
        'eval_loss': 0.125,
        'step': 4,
        'loss_series': [
            {'step': 1, 'loss': 2.0},
            {'step': 2, 'loss': 1.0},
            {'step': 3, 'loss': 1.5},
        ],
    }


def test_downsampled_chart_keeps_average_over_every_valid_loss():
    metrics = [{'step': step, 'loss': float(step)} for step in range(1, 121)]
    metrics.append({'step': 121, 'eval_loss': 0.1})

    result = training_metrics(metrics)

    assert result['average_train_loss'] == 60.5
    assert len(result['loss_series']) == 80
    assert result['loss_series'][0] == {'step': 1, 'loss': 1.0}
    assert result['loss_series'][-1] == {'step': 120, 'loss': 120.0}
    assert result['eval_loss'] == 0.1
    assert result['step'] == 121


def test_latest_training_projection_resolves_names_and_omits_storage_details():
    attempt = {
        'id': 'attempt-2',
        'name': 'acceptance run',
        'number': 2,
        'state': 'succeeded',
        'stage': 'finished',
        'error_code': None,
        'created_at': '2026-11-01T19:41:38+08:00',
        'updated_at': '2026-11-01T20:40:28+08:00',
        'metrics': [
            {'step': 1, 'loss': 2.0},
            {'step': 2, 'loss': 1.0},
            {'step': 2, 'eval_loss': 0.5},
        ],
        'runtime_report': {
            'gpu': 'RTX 4090',
            'memory_bytes': 1024,
            'versions': {'torch': '2.15.0'},
        },
        'token_preflight': {'samples': ['must not leak']},
        'execution_manifest': {'files': ['must not leak']},
    }
    snapshot = {
        'dataset': {
            'id': 'dataset-version-1',
            'object_key': 'private/dataset.jsonl',
            'sample_count': 24,
        },
        'base': {
            'id': 'model-version-1',
            'files': [{'object_key': 'private/model.safetensors'}],
        },
        'config': {'epochs': 1, 'lora_rank': 8},
        'instance': {'region': 'region-a', 'gpu_type': '4090', 'instance_id': 'private-instance'},
        'runtime': 'llamafactory-sft-lora-v1',
    }
    datasets = [{
        'version_id': 'dataset-version-1',
        'name': 'training-data',
        'version_number': 1,
        'sample_count': 24,
        'object_key': 'private/dataset.jsonl',
    }]
    models = [{
        'id': 'model-version-1',
        'name': 'base-model',
        'version_number': 1,
        'source_kind': 'modelscope',
        'format_summary': {'model_type': 'qwen3'},
        'bucket': 'private-bucket',
    }]

    result = latest_training_projection(attempt, snapshot, datasets, models)
    serialized = repr(result)

    assert result['dataset']['name'] == 'training-data'
    assert result['base']['name'] == 'base-model'
    assert result['average_train_loss'] == 1.5
    assert result['eval_loss'] == 0.5
    assert result['runtime']['gpu'] == 'RTX 4090'
    assert result['runtime']['memory_bytes'] == 1024
    assert result['runtime']['versions'] == {'torch': '2.15.0'}
    assert result['instance'] == {'region': 'region-a', 'gpu_type': '4090'}
    assert 'object_key' not in serialized
    assert 'private-bucket' not in serialized
    assert 'token_preflight' not in serialized
    assert 'execution_manifest' not in serialized


def test_payload_counts_attention_and_keeps_stopped_trials_out_of_gpu_state():
    attempts = [
        {
            'id': 'attempt-2', 'name': 'run', 'number': 2, 'state': 'succeeded',
            'stage': 'finished', 'updated_at': '2026-11-01T20:40:28+08:00', 'metrics': [],
        },
        {
            'id': 'attempt-1', 'name': 'run', 'number': 1, 'state': 'failed',
            'stage': 'finished', 'error_code': 'cloud_invalid_response',
            'updated_at': '2026-11-01T19:41:12+08:00', 'metrics': [],
        },
    ]
    trials = [{
        'id': 'trial-1', 'adapter_id': 'adapter-1', 'state': 'stopped',
        'instance_id': 'cpod-example', 'updated_at': '2026-11-02T00:36:40+08:00',
    }]

    result = overview_payload(
        datasets=[{'version_id': 'dataset-1', 'state': 'published'}],
        models=[{'id': 'model-1', 'state': 'available'}],
        attempts=attempts,
        trials=trials,
        adapters=[{'id': 'adapter-1', 'state': 'available', 'role': 'best', 'metrics': {}}],
        adapters_available=2,
        gpu=None,
        latest_snapshot={},
    )

    assert result['schema'] == 1
    assert result['adapters_available'] == 2
    assert result['attention_training']['number'] == 1
    assert result['attention_count'] == 1
    assert result['live_work_count'] == 0
    assert result['gpu'] is None
    assert result['latest_trial']['state'] == 'stopped'
    assert [item['kind'] for item in result['recent_activity']] == [
        'inference', 'training', 'training',
    ]


def test_recent_activity_orders_by_instant_across_timezone_offsets():
    result = recent_activity(
        [{
            'id': 'attempt-1',
            'name': 'run',
            'number': 1,
            'state': 'succeeded',
            'updated_at': '2026-11-01T00:00:00+08:00',
            'metrics': [],
        }],
        [{
            'id': 'trial-1',
            'adapter_id': 'adapter-1',
            'state': 'stopped',
            'updated_at': '2026-10-31T17:00:00+00:00',
        }],
    )

    assert [item['kind'] for item in result] == ['inference', 'training']


def test_payload_uses_all_inputs_for_recent_update_order():
    attempts = [
        {
            'id': f'attempt-{number}',
            'name': 'run',
            'number': number,
            'state': 'succeeded',
            'updated_at': f'2026-11-01T{number:02d}:00:00+00:00',
            'metrics': [],
        }
        for number in range(1, 10)
    ]

    result = overview_payload(
        datasets=[],
        models=[],
        attempts=attempts,
        trials=[],
        adapters=[],
        gpu=None,
        latest_snapshot={},
    )

    assert result['recent_activity'][0]['id'] == 'attempt-9'
