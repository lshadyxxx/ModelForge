#!/usr/bin/env bash
set -euo pipefail
# Run on a manually created single-GPU instance. No platform/cloud credentials.
mode="${1:-}"
if [[ "$mode" != train && "$mode" != serve ]]; then
  echo 'usage: bash prepare-gpu-runtime.sh train|serve' >&2; exit 2
fi
# LLaMA-Factory 0.9.5 requires Python >=3.11. Some GPU images expose an
# older system python3 on PATH even though a supported interpreter is present.
python_bin="${MODELFORGE_PYTHON:-}"
candidates=("$python_bin" python3.13 python3.12 python3.11 python3 /usr/local/miniconda3/bin/python)
selected=""
for candidate in "${candidates[@]}"; do
  [[ -n "$candidate" ]] || continue
  if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    selected="$candidate"
    break
  fi
done
if [[ -z "$selected" ]]; then
  echo 'ModelForge requires Python >=3.11; set MODELFORGE_PYTHON to a supported interpreter.' >&2
  exit 2
fi

"$selected" -m venv --system-site-packages /opt/modelforge-venv
if [[ "$mode" == train ]]; then
  # Official distribution: github.com/hiyouga/LLaMA-Factory
  /opt/modelforge-venv/bin/python -m pip install \
    'accelerate==1.11.0' 'datasets==4.0.0' 'huggingface-hub==1.33.0' \
    'llamafactory==0.9.5' 'numpy==2.5.4' 'peft==0.18.1' 'protobuf==7.36.2' \
    'pyarrow==26.0.0' 'safetensors==0.8.0' 'sentencepiece==0.2.2' \
    'tokenizers==0.22.2' 'torch==2.15.0' 'transformers==5.6.0' 'trl==0.24.0'
else
  # Official distribution: docs.vllm.ai; isolated from training environment.
  /opt/modelforge-venv/bin/python -m pip install \
    'fastapi==0.136.3' 'huggingface-hub==2.4.0' 'numpy==2.4.6' \
    'pydantic==2.14.2' 'safetensors==0.8.0' 'starlette==1.10.0' \
    'tokenizers==0.23.3' 'torch==2.13.0' 'transformers==5.19.0' \
    'uvicorn==0.54.0' 'vllm==0.32.0'
fi
/opt/modelforge-venv/bin/python -m pip check
MODELFORGE_RUNTIME_MODE="$mode" /opt/modelforge-venv/bin/python - <<'PY'
import importlib.metadata
import json
import os
import platform
import torch

expected = {
    'accelerate': '1.11.0', 'datasets': '4.0.0', 'huggingface-hub': '1.33.0',
    'llamafactory': '0.9.5', 'numpy': '2.5.4', 'peft': '0.18.1',
    'protobuf': '7.36.2', 'pyarrow': '26.0.0', 'safetensors': '0.8.0',
    'sentencepiece': '0.2.2', 'tokenizers': '0.22.2', 'torch': '2.15.0',
    'transformers': '5.6.0', 'trl': '0.24.0',
}
if os.environ['MODELFORGE_RUNTIME_MODE'] == 'train':
    actual = {name: importlib.metadata.version(name) for name in expected}
    mismatches = {name: {'expected': version, 'actual': actual[name]}
                  for name, version in expected.items() if actual[name] != version}
    if platform.python_version() != '3.13.5' or torch.version.cuda != '13.2' or mismatches:
        raise SystemExit(json.dumps({'python': platform.python_version(), 'cuda': torch.version.cuda,
                                     'mismatches': mismatches}, sort_keys=True))
else:
    expected = {
        'fastapi': '0.136.3', 'huggingface-hub': '2.4.0',
        'numpy': '2.4.6', 'pydantic': '2.14.2', 'safetensors': '0.8.0',
        'starlette': '1.10.0', 'tokenizers': '0.23.3', 'torch': '2.13.0',
        'transformers': '5.19.0', 'uvicorn': '0.54.0', 'vllm': '0.32.0',
    }
    actual = {name: importlib.metadata.version(name) for name in expected}
    mismatches = {name: {'expected': version, 'actual': actual[name]}
                  for name, version in expected.items() if actual[name] != version}
    if (platform.python_version() != '3.13.5' or torch.version.cuda != '13.0'
            or mismatches):
        raise SystemExit(json.dumps({'python': platform.python_version(), 'cuda': torch.version.cuda,
                                     'mismatches': mismatches}, sort_keys=True))
assert torch.cuda.is_available() and torch.cuda.device_count() == 1
print(torch.cuda.get_device_name(0))
PY
