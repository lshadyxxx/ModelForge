"""The live observer must not confuse API success with fixed, verified storage."""
from copy import deepcopy
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import subprocess
import sys
import threading

import pytest


def load_script():
    path = Path(__file__).resolve().parents[1] / 'scripts/acceptance-modelscope.py'
    spec = importlib.util.spec_from_file_location('modelscope_acceptance', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def version():
    files = [{'path': 'config.json', 'size_bytes': 3, 'sha256': 'a' * 64,
              'state': 'verified', 'object_key': 'fixture-key'}]
    return {'id': 'fixture', 'state': 'available', 'source_kind': 'modelscope',
            'total_bytes': 3, 'verified_bytes': 3, 'files': files,
            'bucket': 'fixture', 'manifest_sha256': 'b' * 64, 'compatibility_state': 'unverified',
            'import': {'state': 'succeeded', 'source_snapshot':
                       {'repository': 'owner/model', 'revision': 'c' * 40, 'files': deepcopy(files)}}}


def test_accepts_only_fresh_complete_version(version):
    module = load_script()
    assert module.wait_for_available('fixture', 'owner/model', 'c' * 40, fetch=lambda _: version) == version


@pytest.mark.parametrize('change,expected', [
    (lambda v: v.update(id='different'), 'identity changed'),
    (lambda v: v['import']['source_snapshot'].update(revision='d' * 40), 'source identity'),
    (lambda v: v['import']['source_snapshot'].update(repository='other/model'), 'source identity'),
    (lambda v: v['files'][0].update(sha256='d' * 64), 'differs from fixed snapshot'),
    (lambda v: v.update(total_bytes=4), 'total byte'),
    (lambda v: v.update(verified_bytes=0), 'Verified byte'),
    (lambda v: v['files'][0].update(state='pending'), 'unverified files'),
    (lambda v: v['import'].update(state='running'), 'freshly available'),
    (lambda v: v['import'].update(state='failed'), 'Import stopped'),
])
def test_rejects_inconsistent_or_drifted_success(version, change, expected):
    module = load_script()
    change(version)
    with pytest.raises(RuntimeError, match=expected):
        module.wait_for_available('fixture', 'owner/model', 'c' * 40, fetch=lambda _: version)


def test_manifest_cannot_drift_between_polls(version):
    module = load_script()
    pending = deepcopy(version)
    pending.update(state='uploading')
    pending['import']['state'] = 'running'
    version['files'][0]['sha256'] = 'd' * 64
    version['import']['source_snapshot']['files'][0]['sha256'] = 'd' * 64
    responses = iter([pending, version])
    with pytest.raises(RuntimeError, match='changed while observing'):
        module.wait_for_available('fixture', 'owner/model', 'c' * 40, fetch=lambda _: next(responses), pause=lambda _: None)


def test_connections_never_reuse_a_stale_success():
    module = load_script()
    ticks = iter([0, 0, 1, 2])
    def unavailable(_):
        raise OSError('restarting')
    with pytest.raises(RuntimeError, match='fresh available response'):
        module.wait_for_available('fixture', 'owner/model', 'c' * 40, fetch=unavailable,
                                  timeout=2, clock=lambda: next(ticks), pause=lambda _: None)


@pytest.mark.parametrize('change', [
    lambda p: p['files'][0].update(actual_sha256='d' * 64),
    lambda p: p['files'][0].update(actual_size_bytes=2),
    lambda p: p['files'][0].update(object_key='another-key'),
    lambda p: p['files'][0].update(state='pending'),
    lambda p: p['version'].update(state='uploading'),
    lambda p: p['import']['source_snapshot'].update(revision='d' * 40),
    lambda p: p['files'].clear(),
])
def test_independent_probe_rejects_store_mismatch(version, change):
    module = load_script()
    probe = {'version': deepcopy(version), 'import': deepcopy(version['import']),
             'files': [{**version['files'][0], 'actual_size_bytes': 3, 'actual_sha256': 'a' * 64}]}
    module.validate_probe(version, probe)
    change(probe)
    with pytest.raises(RuntimeError):
        module.validate_probe(version, probe)


@pytest.mark.parametrize('files', [[], [{'path': '../escape', 'size_bytes': 3, 'sha256': 'a' * 64}],
                                    [{'path': 'x', 'size_bytes': True, 'sha256': 'a' * 64}]])
def test_rejects_invalid_manifest(files):
    with pytest.raises(RuntimeError):
        load_script().manifest(files)


def test_cli_rejects_nonempty_evidence_directory_without_network(tmp_path):
    report = tmp_path / 'report.json'
    report.write_text('{"result": "passed"}', encoding='utf-8')
    script = Path(__file__).resolve().parents[1] / 'scripts/acceptance-modelscope.py'
    launcher = (
        'import runpy,sys,urllib.request; '
        'urllib.request.urlopen=lambda *a,**k: (_ for _ in ()).throw(OSError("no network")); '
        f'sys.argv=[{str(script)!r},"--version-id","00000000-0000-0000-0000-000000000001",'
        '"--repository","owner/model","--revision","' + 'c' * 40 + '",'
        f'"--output-dir",{str(tmp_path)!r},"--timeout-seconds","1","--poll-seconds","0.01"]; '
        f'runpy.run_path({str(script)!r},run_name="__main__")'
    )
    result = subprocess.run([sys.executable, '-B', '-c', launcher], capture_output=True, text=True, timeout=20)
    assert result.returncode == 2, result.stderr
    assert 'Output directory must be empty' in result.stderr
    assert report.read_text(encoding='utf-8') == '{"result": "passed"}'


def test_poll_recovers_from_real_http_503(version, monkeypatch):
    module = load_script()
    class Handler(BaseHTTPRequestHandler):
        attempts = 0
        def do_GET(self):
            type(self).attempts += 1
            self.send_response(503 if self.attempts == 1 else 200)
            self.end_headers()
            self.wfile.write(json.dumps(version).encode())
        def log_message(self, *_):
            pass
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(module, 'BASE', f'http://127.0.0.1:{server.server_port}')
    try:
        try:
            result = module.wait_for_available('fixture', 'owner/model', 'c' * 40,
                                               timeout=2, interval=0.01, fetch=module.read_version)
        except RuntimeError as error:
            result = str(error)
        assert result == version
        assert Handler.attempts == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
