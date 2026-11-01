from pydantic import ValidationError
import json
import pytest
from modelforge.modules.training import TrainingConfig
from modelforge.runtimes.executors import LlamaFactoryExecutor
from modelforge.runtimes.runtime_lock import (
    training_runtime_lock, training_runtime_lock_bytes, training_runtime_lock_sha256)
from modelforge.runtimes.train_remote import runtime_mismatches

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
