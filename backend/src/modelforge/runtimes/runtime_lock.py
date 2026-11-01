"""Immutable validated GPU runtime identities."""
import hashlib
import json
from pathlib import Path

_TRAINING_LOCK_PATH = Path(__file__).with_name('training-runtime.lock.json')
_INFERENCE_LOCK_PATH = Path(__file__).with_name('inference-runtime.lock.json')


def _lock_bytes(path):
    return path.read_bytes()


def _load_lock(path):
    try:
        lock = json.loads(_lock_bytes(path))
        if (not isinstance(lock, dict)
                or lock.get('schema') != 1
                or not isinstance(lock.get('id'), str)
                or not lock['id']
                or not isinstance(lock.get('python'), str)
                or not isinstance(lock.get('cuda'), str)
                or not isinstance(lock.get('packages'), dict)
                or not lock['packages']
                or any(not isinstance(name, str) or not name
                       or not isinstance(version, str) or not version
                       for name, version in lock['packages'].items())):
            raise ValueError('invalid runtime lock')
        return lock
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise RuntimeError('runtime_lock_invalid') from None


def _sha256(path):
    return hashlib.sha256(_lock_bytes(path)).hexdigest()


def training_runtime_lock_bytes():
    return _lock_bytes(_TRAINING_LOCK_PATH)


def training_runtime_lock():
    return _load_lock(_TRAINING_LOCK_PATH)


def training_runtime_lock_sha256():
    return _sha256(_TRAINING_LOCK_PATH)


def inference_runtime_lock_bytes():
    return _lock_bytes(_INFERENCE_LOCK_PATH)


def inference_runtime_lock():
    return _load_lock(_INFERENCE_LOCK_PATH)


def inference_runtime_lock_sha256():
    return _sha256(_INFERENCE_LOCK_PATH)
