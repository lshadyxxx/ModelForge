"""Directory transport acceptance with fixture bytes, real PostgreSQL/MinIO."""
from __future__ import annotations

from datetime import datetime, timezone
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('dataset_acceptance', ROOT / 'scripts/acceptance-datasets.py')
dataset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dataset)


def request(method, path, value=None, *, raw=None):
    body = json.dumps(value).encode() if value is not None else raw
    req = urllib.request.Request('http://127.0.0.1:8092/api/v1' + path, data=body, method=method,
                                 headers={'Content-Type': 'application/json' if value is not None else 'application/octet-stream'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def ensure(value, message):
    if not value:
        raise RuntimeError(message)


def wait_for_available(path, *, attempts=30, pause=time.sleep):
    for _ in range(attempts):
        try:
            status, result = request('GET', path)
            if status == 200 and result.get('state') == 'available':
                return result
        except (OSError, ValueError):
            pass
        pause(1)
    raise RuntimeError('No fresh available response after API restart')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=None, help='Evidence directory; defaults to an OS temporary directory')
    args = parser.parse_args()
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    content = {'config.json': b'{"model_type":"fixture-only"}', 'tokenizer.json': b'{}',
               'weights/model-00001.safetensors': b'x' * (3 * 1024**2),
               'model.safetensors.index.json': b'{"weight_map":{"layer":"weights/model-00001.safetensors"}}'}
    manifest = [{'path': path, 'size_bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                for path, data in content.items()]
    created = []
    events = []
    output = args.output_dir or Path(tempfile.mkdtemp(prefix='modelforge-model-acceptance-'))
    output.mkdir(parents=True, exist_ok=True)
    try:
        status, version = request('POST', '/models/directory-imports', {'name': f'acceptance-{run_id}', 'files': manifest})
        ensure(status == 201, f'create: {status} {version}')
        identifier = version['id']
        created.append(identifier)
        prefix = f'/model-versions/{identifier}'
        keys = [(f['path'], f['object_key']) for f in version['files']]
        for path in ('config.json', 'tokenizer.json', 'model.safetensors.index.json'):
            status, result = request('PUT', prefix + '/files?path=' + urllib.parse.quote(path), raw=content[path])
            ensure(status == 200 and result['state'] == 'verified', f'upload: {status} {result}')
        # Declare a complete file but disconnect before it is fully transmitted.
        with socket.create_connection(('127.0.0.1', 8092), timeout=5) as connection:
            path = urllib.parse.quote('weights/model-00001.safetensors')
            connection.sendall((f'PUT /api/v1{prefix}/files?path={path} HTTP/1.1\r\nHost: localhost\r\n'
                                f'Content-Length: {len(content["weights/model-00001.safetensors"])}\r\n'
                                'Content-Type: application/octet-stream\r\nConnection: close\r\n\r\n').encode() + b'x' * 64)
        status, resumed = request('POST', prefix + '/resume', {'files': manifest})
        ensure(status == 200 and resumed['upload_paths'] == ['weights/model-00001.safetensors'], f'resume: {status} {resumed}')
        ensure(sorted(resumed['reusable_paths']) == sorted(set(content) - {'weights/model-00001.safetensors'}), 'verified files were not reused')
        events.append('actual connection interruption and file-granularity recovery')
        changed = [dict(f) for f in manifest]
        changed[0]['sha256'] = 'f' * 64
        status, result = request('POST', prefix + '/resume', {'files': changed})
        ensure(status == 409 and result['error']['code'] == 'model_manifest_changed', 'changed file silently reused')
        status, result = request('POST', prefix + '/complete')
        ensure(status == 409 and result['error']['code'] == 'model_incomplete', 'partial directory became available')
        # Hold the same PostgreSQL row lock as a storage operation for longer
        # than the configured SQL timeout. Reads must remain observable, while
        # conflicting writes must explicitly decline the operation.
        code = (
            'import time; from modelforge.bootstrap import Resources; from modelforge.settings import get_settings; '
            'r=Resources.open(get_settings()); c=r.pool.connection(); conn=c.__enter__(); '
            f'conn.execute("SELECT id FROM model_versions WHERE id=%s FOR UPDATE",({identifier!r},)); '
            'print("locked",flush=True); time.sleep(4); c.__exit__(None,None,None); r.close()'
        )
        holder = subprocess.Popen(dataset.BASE + ['exec', '-T', 'api', 'python', '-u', '-c', code],
                                  cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            ensure(holder.stdout.readline().strip() == 'locked', 'could not acquire test lock')
            started = time.monotonic()
            status, result = request('GET', prefix)
            ensure(status == 200 and time.monotonic() - started < 1.5, 'status read blocked behind model storage lock')
            for action in ('cancel', 'delete'):
                started = time.monotonic()
                status, result = request('DELETE' if action == 'delete' else 'POST',
                                         prefix if action == 'delete' else prefix + '/cancel')
                ensure(status == 409 and result['error']['code'] == 'model_busy' and
                       time.monotonic() - started < 1.5, f'busy {action} was accepted or blocked: {status} {result}')
            ensure(request('GET', prefix)[1]['state'] == 'uploading', 'busy mutation changed version state')
        finally:
            _, stderr = holder.communicate(timeout=15)
            ensure(holder.returncode == 0, f'lock holder failed: {stderr}')
        ensure(request('POST', prefix + '/cancel')[1]['state'] == 'cancelled', 'cancel retry after lock release failed')
        ensure(request('PUT', prefix + '/files?path=config.json', raw=content['config.json'])[0] == 409, 'cancelled version accepted upload')
        status, resumed = request('POST', prefix + '/resume', {'files': manifest})
        ensure(status == 200 and len(resumed['reusable_paths']) == 3, 'cancel/resume did not preserve verified files')
        events.append('real PostgreSQL row-lock concurrency: nonblocking read, explicit 409 writes, cancel/resume after release')
        long_path = 'x' * 929
        status, result = request('POST', '/models/directory-imports', {
            'name': 'invalid-key-' + run_id, 'files': [{'path': long_path, 'size_bytes': 0, 'sha256': hashlib.sha256(b'').hexdigest()}]})
        ensure(status == 422 and result['error']['code'] == 'model_manifest_invalid', 'oversized complete object key accepted')
        status, result = request('PUT', prefix + '/files?path=weights/model-00001.safetensors', raw=content['weights/model-00001.safetensors'])
        ensure(status == 200 and not result['reused'], f'file retry failed: {status} {result}')
        events.append('3 MiB upload through same-origin Nginx, beyond foundation 2 MiB limit')
        status, result = request('POST', prefix + '/complete')
        ensure(status == 200 and result['state'] == 'available' and result['compatibility_state'] == 'unverified', f'complete: {status} {result}')
        for path, key in keys:
            ensure(dataset.minio_probe(version['bucket'], key) == {'size': len(content[path]), 'sha256': hashlib.sha256(content[path]).hexdigest()}, f'MinIO mismatch: {path}')
        count = dataset.psql(f"SELECT count(*) FROM model_versions WHERE id='{identifier}'::uuid AND state='available';")
        ensure(count == '1', 'PostgreSQL available metadata missing')
        events.append('real PostgreSQL metadata and independent MinIO file readback')
        # Restart only the local application container; persistent services remain.
        dataset.run_command(['restart', 'api'])
        result = wait_for_available(prefix)
        for path, key in keys:
            ensure(dataset.minio_probe(version['bucket'], key)['sha256'] == hashlib.sha256(content[path]).hexdigest(), 'MinIO object changed after restart')
        events.append('API restart preserves metadata and verified objects')
        reference = 'model-acceptance-' + run_id
        code = (
            'import uuid; from modelforge.bootstrap import Resources; from modelforge.settings import get_settings; '
            'from modelforge.modules.models import ModelRegistry; r=Resources.open(get_settings()); '
            f'c=r.pool.connection(); conn=c.__enter__(); ModelRegistry(r).add_reference(uuid.UUID({identifier!r}),"acceptance",{reference!r},connection=conn); '
            'c.__exit__(None,None,None); r.close(); print("reference added")'
        )
        dataset.run_command(['exec', '-T', 'api', 'python', '-c', code])
        status, result = request('DELETE', prefix)
        ensure(status == 409 and result['error']['code'] == 'model_in_use', 'referenced model was deleted')
        dataset.psql(f"DELETE FROM model_version_references WHERE model_version_id='{identifier}'::uuid AND reference_id='{reference}';")
        status, result = request('DELETE', prefix)
        ensure(status == 204, f'deletion: {status} {result}')
        ensure(request('GET', prefix)[0] == 404, 'deleted version remains readable')
        for path, key in keys:
            code = (
                'from modelforge.settings import get_settings; from modelforge.infrastructure.minio import create_store; '
                'from minio.error import S3Error; s=get_settings(); m=create_store(s);\n'
                f'try: m.stat_object({version["bucket"]!r},{key!r})\n'
                'except S3Error as e: assert e.code in {"NoSuchKey","NoSuchObject"}; print("absent")\n'
                'else: raise RuntimeError("object remains")'
            )
            ensure(dataset.run_command(['exec', '-T', 'api', 'python', '-c', code]) == 'absent', 'object deletion not verified')
        created.remove(identifier)
        events.append('reference-protected deletion, metadata removed, MinIO absence confirmed')
        evidence = {'run_id': run_id, 'result': 'passed', 'scope': 'fixture bytes with real PostgreSQL/MinIO; no model load or GPU', 'events': events}
        (output / f'models-{run_id}.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        print(f'Evidence: {output}')
    finally:
        for identifier in created:
            dataset.psql(f"DELETE FROM model_version_references WHERE model_version_id='{identifier}'::uuid;")
            request('DELETE', f'/model-versions/{identifier}')
        if 'version' in locals() and version.get('model_id'):
            model_id = version['model_id']
            dataset.psql(f"DELETE FROM models WHERE id='{model_id}'::uuid AND name='acceptance-{run_id}' AND NOT EXISTS (SELECT 1 FROM model_versions WHERE model_id='{model_id}'::uuid);")


if __name__ == '__main__':
    main()
