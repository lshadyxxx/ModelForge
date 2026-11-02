"""Concrete remote presets. Script paths, command lines and reports stay here."""
import json
from pathlib import Path
from modelforge.errors import AppError
from modelforge.modules.training import TrainingPlan
from modelforge.modules.serving import ServingPlan
from .runtime_lock import (
    inference_runtime_lock_bytes,
    inference_runtime_lock_sha256,
    training_runtime_lock_bytes,
    training_runtime_lock_sha256,
)

def _json(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

class LlamaFactoryExecutor:
    evidence_files=('execution.json','data/dataset_info.json','runtime-lock.json','runtime-lock-report.json',
                    'runtime-baseline.json','token-preflight.json','gpu-memory.json','gpu/torch-peaks.json',
                    'train.json','output/trainer_state.json','process.log','result.json','failure.json')
    required_evidence=frozenset({'execution.json','process.log','result.json','gpu-memory.json'})

    def prepare(self,dataset,config,model_path):
        info={key:{'file_name':name+'.json','formatting':'sharegpt','columns':{'messages':'messages'},
              'tags':{'role_tag':'role','content_tag':'content','user_tag':'user','assistant_tag':'assistant','system_tag':'system'}}
              for key,name in [('mf_train','train'),('mf_validation','validation')]}
        files={'data/'+role+'.json':_json(samples) for role,samples in dataset.items()}
        files.update({'data/dataset_info.json':_json(info),
                      'execution.json':_json({'config':config,'model_path':model_path,
                          'runtime_lock_sha256':training_runtime_lock_sha256()}),
                      'runtime-lock.json':training_runtime_lock_bytes(),
                      'run.py':Path(__file__).with_name('train_remote.py').read_bytes()})
        return TrainingPlan(files,('python3','run.py'))

    def reports(self,read_json):
        result={}
        for path,field in [('runtime-baseline.json','runtime_report'),('token-preflight.json','token_preflight')]:
            try:result[field]=read_json(path)
            except (AppError,ValueError,KeyError):pass
        try:
            state=read_json('output/trainer_state.json')
            result['metrics']=[{key:point[key] for key in ('step','epoch','loss','eval_loss','learning_rate') if key in point}
                               for point in state.get('log_history',[]) if 'loss' in point or 'eval_loss' in point]
        except (AppError,ValueError,KeyError):pass
        return result

    def result(self,read_json):return read_json('result.json')

    def failure_code(self,read_json):
        try:return read_json('failure.json')['code']
        except Exception:return 'training_failed'

class VllmExecutor:
    def prepare(self,model_path,config,adapter_fingerprint):
        files={'execution.json':_json({'model_path':model_path,'rank':config['lora_rank'],
              'max_model_len':config['cutoff_len'],'adapter_fingerprint':adapter_fingerprint,
              'runtime_lock_sha256':inference_runtime_lock_sha256()}),
              'runtime-lock.json':inference_runtime_lock_bytes(),
              'serve.py':Path(__file__).with_name('serve_remote.py').read_bytes()}
        return ServingPlan(files,('python3','serve.py'))

    def ready(self,health,adapter_fingerprint):
        return bool(health.get('ready') and health.get('adapter_probe')
                    and health.get('adapter_fingerprint')==adapter_fingerprint
                    and health.get('runtime_lock_sha256')==inference_runtime_lock_sha256())
