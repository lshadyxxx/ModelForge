from pydantic import ValidationError
import json
import pytest
from modelforge.modules.training import TrainingConfig
from modelforge.runtimes.executors import LlamaFactoryExecutor
from modelforge.runtimes.runtime_lock import (
    training_runtime_lock, training_runtime_lock_bytes, training_runtime_lock_sha256)
from modelforge.runtimes.train_remote import (
    DeviceMemorySampler,
    parse_device_memory_bytes,
    runtime_mismatches,
    write_training_memory,
)

@pytest.mark.parametrize('field,value',[('epochs',0),('epochs',101),('learning_rate',float('nan')),
    ('cutoff_len',0),('batch_size',9),('lora_rank',7),('scheduler','arbitrary'),('warmup_ratio',.31)])
def test_invalid_controlled_training_parameters(field,value):
    with pytest.raises(ValidationError): TrainingConfig(template='qwen3_nothink',**{field:value})

def test_no_freeform_runtime_config():
    with pytest.raises(ValidationError): TrainingConfig(template='qwen3_nothink',trust_remote_code=True)


def test_training_runtime_lock_is_embedded_in_execution_plan():
    plan=LlamaFactoryExecutor().prepare({'train':[],'validation':[]},{'template':'qwen3_nothink'},
                                        '/remote/base')
    execution=json.loads(plan.files['execution.json'])
    lock=json.loads(plan.files['runtime-lock.json'])
    assert plan.files['runtime-lock.json']==training_runtime_lock_bytes()
    assert execution['runtime_lock_sha256']==training_runtime_lock_sha256()
    assert lock==training_runtime_lock()
    assert lock['packages']['llamafactory']=='0.9.5'


def test_training_runtime_lock_rejects_any_drift():
    lock=training_runtime_lock()
    versions=dict(lock['packages'])
    assert runtime_mismatches(lock,lock['python'],lock['cuda'],versions)==[]
    versions['transformers']='future'
    assert runtime_mismatches(lock,lock['python'],lock['cuda'],versions)==[
        {'field':'transformers','expected':'5.6.0','actual':'future'}]
    assert runtime_mismatches(lock,'3.14.0',lock['cuda'],dict(lock['packages']))[0]['field']=='python'


def test_device_memory_samples_are_normalized_to_bytes():
    assert parse_device_memory_bytes('1024\n2048\n') == [1024 * 1024**2, 2048 * 1024**2]
    with pytest.raises(ValueError):
        parse_device_memory_bytes('\n')


def test_training_memory_evidence_combines_torch_and_device_peaks(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path/'gpu').mkdir()
    (tmp_path/'gpu/torch-peaks.json').write_text(json.dumps({
        'peak_memory_allocated_bytes': 1000,
        'peak_memory_reserved_bytes': 2000,
        'device_name': 'fixture GPU',
    }))
    (tmp_path/'runtime-baseline.json').write_text(json.dumps({'gpu': 'fixture GPU'}))
    sampler = DeviceMemorySampler()
    sampler.samples = [
        {'elapsed_ms': 0, 'used_bytes': 900},
        {'elapsed_ms': 250, 'used_bytes': 3000},
    ]
    process = type('Process', (), {'returncode': 0})()
    report = write_training_memory(process, sampler, json.loads((tmp_path/'runtime-baseline.json').read_text()))
    assert report['status'] == 'measured'
    assert report['device_peak_used_bytes'] == 3000
    assert report['torch_peaks']['peak_memory_reserved_bytes'] == 2000
    assert json.loads((tmp_path/'gpu-memory.json').read_text()) == report
    summary = json.loads((tmp_path/'runtime-baseline.json').read_text())['training_memory']
    assert summary['device_peak_used_bytes'] == 3000
    assert summary['torch_peak_memory_reserved_bytes'] == 2000
    assert summary['sample_count'] == 2
    assert 'device_samples' not in summary


def test_training_memory_rejects_inconsistent_torch_peak_pair(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path/'gpu').mkdir()
    (tmp_path/'gpu/torch-peaks.json').write_text(json.dumps({
        'peak_memory_allocated_bytes': 3000,
        'peak_memory_reserved_bytes': 2000,
        'device_name': 'fixture GPU',
    }))
    runtime_report = {'gpu': 'fixture GPU'}
    sampler = DeviceMemorySampler()
    sampler.samples = [{'elapsed_ms': 0, 'used_bytes': 1000}]
    process = type('Process', (), {'returncode': 0})()
    report = write_training_memory(process, sampler, runtime_report)
    assert report['status'] == 'measured'
    assert report['torch_peaks'] is None
    assert report['device_peak_used_bytes'] == 1000
