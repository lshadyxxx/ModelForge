"""Copied to an isolated remote workspace; reports facts, never platform SQL."""
import importlib.metadata
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys


def runtime_mismatches(lock, python_version, cuda_version, versions):
    mismatches = []
    if python_version != lock['python']:
        mismatches.append({'field': 'python', 'expected': lock['python'], 'actual': python_version})
    if cuda_version != lock['cuda']:
        mismatches.append({'field': 'cuda', 'expected': lock['cuda'], 'actual': cuda_version})
    for name, expected in sorted(lock['packages'].items()):
        actual = versions.get(name)
        if actual != expected:
            mismatches.append({'field': name, 'expected': expected, 'actual': actual})
    return mismatches


def run():
    frozen = json.loads(Path('execution.json').read_text())
    c = frozen['config']; base = frozen['model_path']
    lock_bytes = Path('runtime-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    lock_sha256 = hashlib.sha256(lock_bytes).hexdigest()
    if lock_sha256 != frozen.get('runtime_lock_sha256'):
        raise RuntimeError('runtime_lock_invalid')
    import torch
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('single_gpu_required')
    versions = {}
    for name in lock['packages']:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    identity = {'python': platform.python_version(), 'cuda': torch.version.cuda, 'versions': versions}
    mismatches = runtime_mismatches(lock, identity['python'], identity['cuda'], versions)
    lock_report = {'lock_id': lock['id'], 'lock_sha256': lock_sha256,
                   **identity, 'mismatches': mismatches}
    Path('runtime-lock-report.json').write_text(json.dumps(lock_report, allow_nan=False))
    if mismatches:
        raise RuntimeError('runtime_lock_mismatch')
    report = {'lock_id': lock['id'], 'lock_sha256': lock_sha256,
              'python': identity['python'], 'cuda': identity['cuda'], 'versions': versions,
              'gpu': torch.cuda.get_device_name(0),
              'memory_bytes': torch.cuda.get_device_properties(0).total_memory, 'template': c['template']}
    Path('runtime-baseline.json').write_text(json.dumps(report))
    config = {
        'model_name_or_path': base, 'trust_remote_code': False, 'stage': 'sft', 'do_train': True, 'do_eval': True,
        'finetuning_type': 'lora', 'lora_target': 'all', 'template': c['template'],
        'dataset': 'mf_train', 'eval_dataset': 'mf_validation', 'dataset_dir': 'data',
        'cutoff_len': c['cutoff_len'], 'packing': False, 'preprocessing_num_workers': 1,
        'output_dir': 'output', 'overwrite_output_dir': False, 'logging_steps': 1,
        'save_strategy': 'epoch', 'eval_strategy': 'epoch', 'save_total_limit': None,
        'load_best_model_at_end': False, 'num_train_epochs': c['epochs'],
        'learning_rate': c['learning_rate'], 'per_device_train_batch_size': c['batch_size'],
        'per_device_eval_batch_size': 1, 'gradient_accumulation_steps': c['gradient_accumulation'],
        'lora_rank': c['lora_rank'], 'lora_alpha': c['lora_alpha'], 'lora_dropout': c['lora_dropout'],
        'lr_scheduler_type': c['scheduler'], 'warmup_ratio': c['warmup_ratio'], 'seed': c['seed'],
        'bf16': bool(torch.cuda.is_bf16_supported()), 'fp16': not torch.cuda.is_bf16_supported(),
        'report_to': 'none', 'plot_loss': False, 'enable_thinking': False}
    # Use the training library's own tokenizer/template/processor with an unbounded
    # temporary cutoff. Inspect every complete sequence before training can truncate.
    from llamafactory.hparams import get_train_args
    from llamafactory.model import load_tokenizer
    from llamafactory.data import get_template_and_fix_tokenizer
    from llamafactory.data.processor.supervised import SupervisedDatasetProcessor
    ma, da, ta, fa, ga = get_train_args({**config, 'cutoff_len': 1000000000})
    tokenizer = load_tokenizer(ma)['tokenizer']
    template = get_template_and_fix_tokenizer(tokenizer, da)
    processor = SupervisedDatasetProcessor(template=template, tokenizer=tokenizer,
        processor=None, data_args=da)
    lengths = []
    for role in ('train','validation'):
        rows = json.loads(Path('data', role+'.json').read_text())
        for row in rows:
            messages = row['messages']; system = ''
            if messages and messages[0]['role'] == 'system': system = messages[0]['content']; messages = messages[1:]
            if not messages or messages[-1]['role'] != 'assistant': raise RuntimeError('assistant_target_required')
            ids, labels = processor._encode_data_example(prompt=messages[:-1], response=messages[-1:],
                system=system, tools=None, images=[], videos=[], audios=[])
            lengths.append({'split': role, 'source_line': row['source_line'], 'tokens': len(ids)})
    overflow = [r for r in lengths if r['tokens'] > c['cutoff_len']]
    Path('token-preflight.json').write_text(json.dumps({'samples': lengths, 'overflow': overflow}))
    if overflow: raise RuntimeError('token_overflow')
    Path('train.json').write_text(json.dumps(config))
    # LLaMA-Factory 0.9.5's JSON CLI path calls json.load(Path(...)), which is
    # invalid because json.load requires a text stream. Pass the already-loaded
    # mapping to the same public training entrypoint and keep it in a child
    # process so model imports and GPU memory are released before verification.
    entrypoint = (
        "import json\n"
        "from llamafactory.train.tuner import run_exp\n"
        "with open('train.json', encoding='utf-8') as stream:\n"
        "    run_exp(json.load(stream))\n"
    )
    process = subprocess.Popen([sys.executable, '-c', entrypoint],
                               stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    tail=b''
    while block:=process.stdout.read1(16384):
        sys.stdout.buffer.write(block);sys.stdout.buffer.flush();tail=(tail+block)[-65536:]
    if process.wait():
        code='oom' if b'out of memory' in tail.lower() or b'cudaoutofmemoryerror' in tail.lower() else 'training_failed'
        Path('failure.json').write_text(json.dumps({'code':code,'exit_code':process.returncode}))
        return process.returncode
    history_path = Path('output/trainer_state.json')
    state = json.loads(history_path.read_text())
    losses = [r for r in state['log_history'] if isinstance(r.get('eval_loss'), (int,float)) and math.isfinite(r['eval_loss'])]
    if not losses: raise RuntimeError('validation_loss_missing')
    best = min(losses, key=lambda item: item['eval_loss'])
    checkpoint = Path('output', 'checkpoint-'+str(best['step']))
    for folder in (checkpoint, Path('output')):
        if not (folder/'adapter_config.json').is_file() or not (folder/'adapter_model.safetensors').is_file():
            raise RuntimeError('adapter_incomplete')
    Path('result.json').write_text(json.dumps({'best_path': str(checkpoint), 'final_path': 'output',
        'best_metrics': best, 'final_metrics': losses[-1], 'runtime': report}, allow_nan=False))
    return 0

if __name__ == '__main__':
    try: sys.exit(run())
    except Exception as error:
        # Error class and controlled code only; no credentials or environment dumps.
        message = str(error)
        code = message if message in {'single_gpu_required','assistant_target_required','token_overflow',
            'validation_loss_missing','adapter_incomplete','runtime_version_unsupported',
            'runtime_lock_invalid','runtime_lock_mismatch'} else 'oom' if 'out of memory' in message.lower() else 'runtime_incompatible'
        Path('failure.json').write_text(json.dumps({'code': code, 'type': type(error).__name__}))
        print(code, flush=True); sys.exit(1)
