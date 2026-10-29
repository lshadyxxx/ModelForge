"""Restart proof requires a fresh response, never a pre-restart success."""
import importlib.util
from pathlib import Path

import pytest


def load_script():
    path = Path(__file__).resolve().parents[1] / 'scripts/acceptance-models.py'
    spec = importlib.util.spec_from_file_location('model_acceptance', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_restart_poll_rejects_all_connection_failures(monkeypatch):
    module = load_script()
    def unavailable(*args, **kwargs):
        raise OSError('connection unavailable')
    monkeypatch.setattr(module, 'request', unavailable)
    with pytest.raises(RuntimeError, match='fresh available response'):
        module.wait_for_available('/model-versions/fixture', attempts=2, pause=lambda _: None)


def test_restart_poll_returns_only_a_fresh_available_response(monkeypatch):
    module = load_script()
    responses = iter([OSError('restarting'), (503, {'error': {'code': 'dependency_unavailable'}}),
                      (200, {'state': 'available', 'id': 'fresh-version'})])
    def recovering(*args, **kwargs):
        result = next(responses)
        if isinstance(result, Exception):
            raise result
        return result
    monkeypatch.setattr(module, 'request', recovering)
    assert module.wait_for_available('/model-versions/fixture', attempts=3, pause=lambda _: None) == {
        'state': 'available', 'id': 'fresh-version'}


def test_restart_poll_rejects_a_responding_but_unavailable_version(monkeypatch):
    module = load_script()
    monkeypatch.setattr(module, 'request', lambda *args, **kwargs: (200, {'state': 'uploading'}))
    with pytest.raises(RuntimeError, match='fresh available response'):
        module.wait_for_available('/model-versions/fixture', attempts=2, pause=lambda _: None)
