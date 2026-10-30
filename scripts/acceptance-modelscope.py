"""Read-only acceptance of an existing, real ModelScope import in local Compose.

Create the import through the public API first. This observer never creates,
retries, cancels or deletes a version, and never loads repository code.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8092/api/v1'


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def manifest(files):
    ensure(isinstance(files, list) and files, 'Missing model file manifest')
    result = []
    for item in files:
        ensure(isinstance(item, dict), 'Invalid manifest entry')
        path, size, digest = (item.get(key) for key in ('path', 'size_bytes', 'sha256'))
        ensure(isinstance(path, str) and path and not path.startswith('/')
               and '\\' not in path and all(p not in {'', '.', '..'} for p in path.split('/')),
               'Invalid manifest path')
        ensure(type(size) is int and size >= 0, 'Invalid manifest size')
        ensure(isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest),
               'Invalid manifest SHA-256')
        result.append((path, size, digest))
    ensure(len({item[0] for item in result}) == len(result), 'Duplicate manifest path')
    return sorted(result)


def validate_version(version, identifier, repository, revision, expected=None, *, complete=False):
    ensure(isinstance(version, dict) and version.get('id') == identifier, 'Model version identity changed')
    ensure(version.get('source_kind') == 'modelscope', 'Not a ModelScope import')
    job = version.get('import')
    ensure(isinstance(job, dict), 'Missing import state')
    snapshot = job.get('source_snapshot')
    ensure(isinstance(snapshot, dict) and snapshot.get('repository') == repository
           and snapshot.get('revision') == revision, 'Fixed source identity changed')
    current = manifest(version.get('files'))
    ensure(current == manifest(snapshot.get('files')), 'File manifest differs from fixed snapshot')
    ensure(expected is None or current == expected, 'File manifest changed while observing')
    total = sum(size for _, size, _ in current)
    ensure(version.get('total_bytes') == total, 'Incorrect total byte count')
    if complete:
        ensure(version.get('state') == 'available' and job.get('state') == 'succeeded',
               'Import is not freshly available and succeeded')
        ensure(all(file.get('state') == 'verified' for file in version['files']),
               'Available version contains unverified files')
        ensure(version.get('verified_bytes') == total, 'Verified byte count is incomplete')
    return current


def read_version(identifier):
    try:
        with urllib.request.urlopen(BASE + '/model-versions/' + identifier, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in {502, 503, 504}:
            raise OSError(f'Model API temporarily unavailable: HTTP {error.code}') from None
        raise RuntimeError(f'Model API returned HTTP {error.code}') from None


def wait_for_available(identifier, repository, revision, *, timeout=7200, interval=5,
                       observe=lambda version: None, fetch=read_version,
                       clock=time.monotonic, pause=time.sleep):
    deadline, expected = clock() + timeout, None
    while clock() < deadline:
        try:
            version = fetch(identifier)
        except (OSError, ValueError):
            pause(interval)
            continue
        current = validate_version(version, identifier, repository, revision, expected)
        if expected is None:
            expected = current
        observe(version)
        state = version['import']['state']
        ensure(state not in {'failed', 'cancelled'},
               f'Import stopped: {state} ({version["import"].get("error_code")})')
        if version['state'] == 'available':
            validate_version(version, identifier, repository, revision, expected, complete=True)
            return version
        pause(interval)
    raise RuntimeError('Timed out without a fresh available response')


# The probe is intentionally independent of ModelRegistry verification helpers.
# Large objects are streamed with bounded memory, never read_object().
PROBE = '''
import hashlib,json,sys
from modelforge.bootstrap import Resources
from modelforge.settings import get_settings
v=json.loads(sys.stdin.read())
r=Resources.open(get_settings())
try:
    with r.pool.connection() as c:
        db=c.execute("SELECT id,state,bucket,manifest_sha256,compatibility_state FROM model_versions WHERE id=%s",(v['id'],)).fetchone()
        job=c.execute("SELECT state,source_snapshot FROM model_imports WHERE model_version_id=%s",(v['id'],)).fetchone()
        files=c.execute("SELECT path,size_bytes,sha256,object_key,state FROM model_version_files WHERE model_version_id=%s ORDER BY path",(v['id'],)).fetchall()
    if db is None or job is None:
        raise RuntimeError('Missing PostgreSQL version or import')
    result={'version':db,'import':job,'files':[]}
    for f in files:
        stream=r.store.get_object(db['bucket'],f['object_key'])
        size,digest=0,hashlib.sha256()
        try:
            while True:
                chunk=stream.read(1024*1024)
                if not chunk: break
                size+=len(chunk)
                if size>f['size_bytes']: raise RuntimeError('Stored object exceeds manifest')
                digest.update(chunk)
        finally:
            stream.close();stream.release_conn()
        result['files'].append({**f,'actual_size_bytes':size,'actual_sha256':digest.hexdigest()})
    print(json.dumps(result,default=str))
finally:
    r.close()
'''


def probe_store(version):
    result = subprocess.run(
        ['docker', 'compose', '--project-directory', str(ROOT), 'exec', '-T',
         'api', 'python', '-c', PROBE],
        cwd=ROOT, input=json.dumps({'id': version['id']}), capture_output=True,
        text=True, encoding='utf-8', errors='replace', timeout=1800,
    )
    # Do not echo arbitrary subprocess errors, which might contain signed URLs.
    ensure(result.returncode == 0, 'Independent PostgreSQL/MinIO probe failed')
    return json.loads(result.stdout)


def validate_probe(version, probe):
    db = probe['version']
    ensure(db['id'] == version['id'] and db['state'] == 'available', 'Stored version identity/state differs')
    for key in ('bucket', 'manifest_sha256', 'compatibility_state'):
        ensure(db[key] == version[key], f'Stored {key} differs from API')
    ensure(probe['import']['state'] == 'succeeded'
           and probe['import']['source_snapshot'] == version['import']['source_snapshot'],
           'Stored source snapshot/state differs')
    ensure(manifest(probe['files']) == manifest(version['files']), 'Stored manifest differs')
    by_path = {file['path']: file for file in version['files']}
    for file in probe['files']:
        ensure(file['object_key'] == by_path[file['path']]['object_key'], 'Stored object key differs')
        ensure(file['state'] == 'verified' and file['actual_size_bytes'] == file['size_bytes']
               and file['actual_sha256'] == file['sha256'], 'Independent MinIO checksum mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version-id', required=True, type=uuid.UUID)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--timeout-seconds', type=int, default=7200)
    parser.add_argument('--poll-seconds', type=float, default=5)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    segment = r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}'
    if not re.fullmatch(segment + '/' + segment, args.repository) or not re.fullmatch('[0-9a-f]{40}', args.revision):
        parser.error('Use owner/model and a full lowercase 40-character commit')
    if args.timeout_seconds <= 0 or args.poll_seconds <= 0:
        parser.error('Timeout and poll interval must be positive')
    output = args.output_dir or Path(tempfile.mkdtemp(prefix='modelforge-modelscope-acceptance-'))
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error('Output directory must be empty; use a new directory for each run')
    started = time.monotonic()

    def observe(version):
        event = {'at': datetime.now(timezone.utc).isoformat(), 'state': version['state'],
                 'verified_bytes': version['verified_bytes'], 'total_bytes': version['total_bytes'],
                 **{key: version['import'].get(key) for key in
                    ('state', 'current_path', 'current_bytes', 'attempt_count', 'error_code')}}
        event['version_state'] = version['state']
        with (output / 'progress.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event) + '\n')
        print(json.dumps(event), flush=True)

    version = wait_for_available(str(args.version_id), args.repository, args.revision,
                                 timeout=args.timeout_seconds, interval=args.poll_seconds, observe=observe)
    (output / 'available.json').write_text(json.dumps(version, indent=2), encoding='utf-8')
    probe = probe_store(version)
    (output / 'store-readback.json').write_text(json.dumps(probe, indent=2), encoding='utf-8')
    validate_probe(version, probe)
    fresh = read_version(str(args.version_id))
    validate_version(fresh, str(args.version_id), args.repository, args.revision,
                     manifest(version['files']), complete=True)
    ensure(fresh['manifest_sha256'] == version['manifest_sha256'], 'Manifest identity changed after readback')
    report = {'result': 'passed', 'version_id': str(args.version_id), 'repository': args.repository,
              'revision': args.revision, 'file_count': len(version['files']),
              'verified_bytes': version['verified_bytes'], 'elapsed_seconds': round(time.monotonic() - started, 3),
              'compatibility_state': fresh['compatibility_state'],
              'not_tested': ['model loading', 'GPU', 'training', 'business UI', 'capacity limit locking']}
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'report': report, 'evidence': str(output)}))


if __name__ == '__main__':
    main()
