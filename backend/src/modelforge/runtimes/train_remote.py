"""Copied to an isolated remote workspace; reports facts, never platform SQL."""
import importlib.metadata
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time


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


def parse_device_memory_bytes(output):
    values = []
    for line in output.splitlines():
        value = line.strip().split(',', 1)[0].strip()
        if not value:
            continue
        mib = int(value)
        if mib < 0:
            raise ValueError('negative GPU memory sample')
        values.append(mib * 1024 * 1024)
    if not values:
        raise ValueError('missing GPU memory sample')
    return values


class DeviceMemorySampler:
    def __init__(self, interval_seconds=0.25):
        self.interval_seconds = interval_seconds
        self.samples = []
        self.error = None
        self.started = time.monotonic()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name='gpu-memory-sampler', daemon=True)

    def start(self):
        self.thread.start()

    def _run(self):
        command = ['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits']
        while not self.stop_event.is_set():
            try:
                result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=2)
                used_bytes = max(parse_device_memory_bytes(result.stdout))
                self.samples.append({
                    'elapsed_ms': round((time.monotonic() - self.started) * 1000),
                    'used_bytes': used_bytes,
                })
            except Exception as error:
                # Preserve only the exception class; command output can contain host
                # details and is not needed to diagnose a sampling failure.
                self.error = type(error).__name__
            self.stop_event.wait(self.interval_seconds)

    def stop(self):
        if self.thread.is_alive():
            self.stop_event.set()
            self.thread.join(timeout=3)
        return self.samples


def write_training_memory(process, sampler, runtime_report):
    sampler.stop()
    torch_peaks = None
    peaks_path = Path('gpu/torch-peaks.json')
    if peaks_path.is_file():
        try:
            candidate = json.loads(peaks_path.read_text())
            allocated = candidate.get('peak_memory_allocated_bytes')
            reserved = candidate.get('peak_memory_reserved_bytes')
            if (type(allocated) is int and type(reserved) is int
                    and 0 <= allocated <= reserved):
                torch_peaks = candidate
        except (OSError, ValueError, TypeError):
            torch_peaks = None
    device_samples = sampler.samples
    device_peak = max((sample['used_bytes'] for sample in device_samples), default=None)
    measured = torch_peaks is not None or device_peak is not None
    report = {
        'schema': 1,
        'status': 'measured' if measured else 'unavailable',
        'sample_interval_ms': round(sampler.interval_seconds * 1000),
        'device_samples': device_samples,
        'device_peak_used_bytes': device_peak,
        'torch_peaks': torch_peaks,
        'sampler_error': sampler.error,
        'process_exit_code': process.returncode,
    }
    Path('gpu-memory.json').write_text(json.dumps(report, sort_keys=True, allow_nan=False))
    runtime_report['training_memory'] = {
        'status': report['status'],
        'sample_interval_ms': report['sample_interval_ms'],
        'sample_count': len(device_samples),
        'device_peak_used_bytes': device_peak,
        'torch_peak_memory_allocated_bytes': (
            torch_peaks['peak_memory_allocated_bytes'] if torch_peaks else None
        ),
        'torch_peak_memory_reserved_bytes': (
            torch_peaks['peak_memory_reserved_bytes'] if torch_peaks else None
        ),
        'sampler_error': report['sampler_error'],
    }
    Path('runtime-baseline.json').write_text(json.dumps(runtime_report, sort_keys=True, allow_nan=False))
    return report


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
        "from pathlib import Path\n"
        "import torch\n"
        "from llamafactory.train.tuner import run_exp\n"
        "try:\n"
        "    with open('train.json', encoding='utf-8') as stream:\n"
        "        run_exp(json.load(stream))\n"
        "finally:\n"
        "    try:\n"
        "        torch.cuda.synchronize()\n"
        "    finally:\n"
        "        Path('gpu').mkdir(exist_ok=True)\n"
        "        Path('gpu/torch-peaks.json').write_text(json.dumps({\n"
        "            'peak_memory_allocated_bytes': torch.cuda.max_memory_allocated(),\n"
        "            'peak_memory_reserved_bytes': torch.cuda.max_memory_reserved(),\n"
        "            'device_name': torch.cuda.get_device_name(0)}))\n"
    )
    process = subprocess.Popen([sys.executable, '-c', entrypoint],
                               stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    sampler = DeviceMemorySampler()
    sampler.start()
    tail=b''
    try:
        while block:=process.stdout.read1(16384):
            sys.stdout.buffer.write(block);sys.stdout.buffer.flush();tail=(tail+block)[-65536:]
        process.wait()
    finally:
        memory_report = write_training_memory(process, sampler, report)
    if process.returncode:
        code='oom' if b'out of memory' in tail.lower() or b'cudaoutofmemoryerror' in tail.lower() else 'training_failed'
        Path('failure.json').write_text(json.dumps({
            'code': code, 'exit_code': process.returncode,
            'memory_evidence': memory_report['status']}))
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
