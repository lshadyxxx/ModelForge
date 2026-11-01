"""Linux-only standard-library agent. No platform credentials or SQL."""
from __future__ import annotations
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import sys
import time
import uuid

MAX_CHUNK = 1024 * 1024

def atomic(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as target:
        json.dump(value, target, allow_nan=False)
        target.flush(); os.fsync(target.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)

def root_path(value):
    root = Path(value)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('Absolute workspace root required')
    for parent in reversed([root, *root.parents]):
        if parent.exists() and (parent.is_symlink() or not parent.is_dir()):
            raise ValueError('Workspace path is not a regular directory')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o022:
        raise ValueError('Workspace must be privately owned')
    return root

def workspace(root, identifier):
    identifier = str(uuid.UUID(identifier))
    directory = root_path(root) / identifier
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.getuid():
        raise ValueError('Invalid workspace')
    return directory

def file_path(directory, name):
    p = PurePosixPath(name)
    if (p.is_absolute() or not p.parts or '..' in p.parts or '\\' in name
            or any(not re.fullmatch(r'[A-Za-z0-9_.-]{1,180}', part) for part in p.parts)):
        raise ValueError('Invalid relative file path')
    path = directory.joinpath(*p.parts)
    for parent in [path, *path.parents]:
        if parent == directory: break
        if parent.is_symlink(): raise ValueError('Linked files are unsupported')
    return path

@contextlib.contextmanager
def locked(directory):
    with (directory / 'operation.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield

def identity(pid):
    try:
        # comm may contain parentheses and spaces. Fields after final ')' start at 3.
        parts = Path('/proc', str(pid), 'stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': int(pid), 'start': parts[19],
                'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                'state': parts[0], 'group': int(parts[2])}
    except (OSError, ValueError, IndexError): return None

def same(record):
    observed = identity(record['pid']) if record else None
    return bool(observed and observed['boot'] == record['boot']
                and observed['start'] == record['start'] and observed['state'] != 'Z')

def group_alive(record):
    if not record or record['boot'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        return None
    for path in Path('/proc').iterdir():
        if path.name.isdigit():
            member = identity(int(path.name))
            if member and member['group'] == record['pid'] and member['state'] != 'Z': return True
    return False

def status(directory):
    path = directory / 'receipt.json'
    if not path.exists(): return {'state': 'not_started'}
    record = json.loads(path.read_text())
    if record['state'] == 'exited': return record
    supervisor = record.get('supervisor')
    if supervisor and same(supervisor): return {**record, 'state': 'running'}
    return {**record, 'state': 'unknown'}

def supervise(directory):
    directory = Path(directory)
    with locked(directory):
        record = json.loads((directory / 'receipt.json').read_text())
        if record['state'] != 'launching': return
        record['supervisor'] = identity(os.getpid())
        atomic(directory / 'receipt.json', record)
    # The supervising process is deliberately detached from the SSH session.
    with (directory / 'process.log').open('ab', buffering=0) as log:
        try:
            child = subprocess.Popen(record['argv'], cwd=directory, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                env={**os.environ, 'PYTHONUNBUFFERED': '1', 'TOKENIZERS_PARALLELISM': 'false'})
            child_identity = identity(child.pid)
            if child_identity is None: raise RuntimeError('Missing child process identity')
            with locked(directory):
                record.update(state='running', child=child_identity)
                atomic(directory / 'receipt.json', record)
            cancelled = False
            while True:
                if (directory / 'cancel.request').exists():
                    cancelled = True
                    if group_alive(child_identity):
                        os.killpg(child.pid, signal.SIGTERM)
                        deadline = time.monotonic() + 5
                        while group_alive(child_identity) and time.monotonic() < deadline: time.sleep(.05)
                        if group_alive(child_identity): os.killpg(child.pid, signal.SIGKILL)
                code = child.poll()
                if code is not None:
                    if group_alive(child_identity):
                        os.killpg(child.pid, signal.SIGKILL)
                        deadline = time.monotonic() + 5
                        while group_alive(child_identity) and time.monotonic() < deadline: time.sleep(.05)
                    if group_alive(child_identity) is not False:
                        record['state'] = 'unknown'
                    else:
                        record.update(state='exited', exit_code=code, cancelled=cancelled,
                                      exited_at=time.time(), group_exited=True)
                    with locked(directory): atomic(directory / 'receipt.json', record)
                    return
                time.sleep(.1)
        except BaseException:
            # An absent receipt or a supervisor failure is never proof of exit.
            with locked(directory):
                record['state'] = 'unknown'; atomic(directory / 'receipt.json', record)

def dispatch(request):
    directory = workspace(request['root'], request['job_id'])
    operation = request['operation']
    if operation == 'ensure_token':
        import secrets
        path=directory/'runtime.token'
        with locked(directory):
            if not path.exists():
                with path.open('x') as target:target.write(secrets.token_urlsafe(32))
                path.chmod(0o600)
        return {'configured':True}
    if operation == 'http':
        import urllib.request
        if request['route'] not in ('/health','/chat/start','/chat/poll','/chat/cancel'):
            raise ValueError('Unsupported runtime operation')
        token=file_path(directory,'runtime.token').read_text().strip()
        route=request['route']; method='GET' if route=='/health' else 'POST'
        data=None if method=='GET' else json.dumps(request.get('body',{})).encode()
        connection=urllib.request.Request('http://127.0.0.1:18180'+route,data=data,method=method,
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(connection,timeout=25) as response:
            data=response.read(2*1024**2+1)
        if len(data)>2*1024**2:raise ValueError('Runtime response too large')
        return json.loads(data)
    if operation == 'probe':
        if not request['path'].startswith('/model/') or '..' in Path(request['path']).parts:
            raise ValueError('Invalid public model source')
        source = base64.b64decode(request['source'], validate=True)
        if len(source) > 100000: raise ValueError('Invalid probe')
        result = subprocess.run([sys.executable, '-c', source, request['path']],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3600)
        if result.returncode or len(result.stdout) > 8*1024**2: raise ValueError('Directory verification failed')
        return json.loads(result.stdout)
    if operation == 'status': return status(directory)
    if operation == 'cancel':
        with locked(directory):
            atomic(directory / 'cancel.request', {'requested_at': time.time()})
        return status(directory)
    if operation == 'put':
        path = file_path(directory, request['path'])
        path.parent.mkdir(parents=True, exist_ok=True)
        size = request['size']
        if type(size) is not int or not 0 <= size <= 100 * 1024**3: raise ValueError('Invalid size')
        temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
        digest = hashlib.sha256(); remaining = size
        try:
            with temporary.open('xb') as target:
                while remaining:
                    data = sys.stdin.buffer.read(min(MAX_CHUNK, remaining))
                    if not data: raise ValueError('Incomplete transfer')
                    remaining -= len(data); target.write(data); digest.update(data)
                target.flush(); os.fsync(target.fileno())
            if digest.hexdigest() != request['sha256']: raise ValueError('Transfer digest mismatch')
            with locked(directory):
                if status(directory)['state'] != 'not_started': raise ValueError('Inputs are sealed')
                previous=hashlib.sha256()
                if path.exists():
                    with path.open('rb') as source:
                        while block:=source.read(MAX_CHUNK):previous.update(block)
                if path.exists() and previous.hexdigest() != digest.hexdigest():
                    raise ValueError('Input already has a different identity')
                os.replace(temporary, path)
            return {'size': size, 'sha256': digest.hexdigest()}
        finally:
            temporary.unlink(missing_ok=True)
    if operation == 'start':
        argv = request['argv']
        if (not isinstance(argv, list) or not argv or len(argv) > 100
                or any(not isinstance(value, str) or len(value) > 4096 or '\x00' in value for value in argv)):
            raise ValueError('Invalid server command')
        if argv[0] == 'python3': argv[0] = sys.executable
        signature = hashlib.sha256(json.dumps(argv, separators=(',', ':')).encode()).hexdigest()
        with locked(directory):
            record = status(directory)
            if record['state'] != 'not_started':
                if record.get('command_sha256') != signature: raise ValueError('Conflicting launch')
                return record
            if (directory / 'cancel.request').exists():
                record = {'state': 'exited', 'exit_code': -15, 'cancelled': True, 'group_exited': True,
                          'command_sha256': signature}
                atomic(directory / 'receipt.json', record); return record
            for item in request.get('inputs', []):
                path = file_path(directory, item['path']); digest = hashlib.sha256()
                with path.open('rb') as source:
                    while data := source.read(MAX_CHUNK): digest.update(data)
                if path.stat().st_size != item['size'] or digest.hexdigest() != item['sha256']:
                    raise ValueError('Input integrity mismatch')
            record = {'state': 'launching', 'argv': argv, 'command_sha256': signature, 'requested_at': time.time()}
            atomic(directory / 'receipt.json', record)
            # Never retry after an ambiguous Popen. Receipt was persisted first.
            subprocess.Popen([sys.executable, __file__, '--supervise', str(directory)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True, close_fds=True)
            return record
    if operation == 'read':
        path = file_path(directory, request['path'])
        offset = request.get('offset', 0); limit = request.get('limit', MAX_CHUNK)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= MAX_CHUNK:
            raise ValueError('Invalid read range')
        if not path.exists(): return {'data': '', 'offset': offset, 'next_offset': offset, 'missing': True}
        size = path.stat().st_size
        if offset > size: return {'data': '', 'offset': offset, 'next_offset': size, 'gap': True}
        with path.open('rb') as source:
            source.seek(offset); data = source.read(limit)
        return {'data': base64.b64encode(data).decode(), 'offset': offset,
                'next_offset': offset + len(data), 'size': size, 'sha256': hashlib.sha256(data).hexdigest()}
    if operation == 'manifest':
        if status(directory)['state'] != 'exited': raise ValueError('Output process is not confirmed exited')
        folder = file_path(directory, request['path']); files = []
        for path in sorted(folder.rglob('*')):
            if path.is_symlink(): raise ValueError('Linked output unsupported')
            if path.is_file():
                digest = hashlib.sha256()
                with path.open('rb') as source:
                    while data := source.read(MAX_CHUNK): digest.update(data)
                files.append({'path': str(path.relative_to(directory)), 'size': path.stat().st_size, 'sha256': digest.hexdigest()})
                if len(files) > 10000: raise ValueError('Too many output files')
        return {'files': files}
    raise ValueError('Unsupported operation')

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--supervise': supervise(sys.argv[2])
    else:
        try:
            request = json.loads(sys.stdin.buffer.readline(1024 * 1024))
            response = {'ok': True, 'result': dispatch(request)}
        except Exception:
            response = {'ok': False, 'error': 'remote_operation_failed'}
        print(json.dumps(response, allow_nan=False))
