"""Server-configured OpenSSH channel; browser data cannot choose endpoints or commands."""
from __future__ import annotations
import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from modelforge.errors import AppError

@dataclass(frozen=True)
class Endpoint:
    host: str
    user: str
    port: int
    private_key: str
    known_hosts: str
    root: str = '/var/tmp/modelforge'
    python: str = '/opt/modelforge-venv/bin/python'

    def validate(self):
        if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]{0,252}', self.host)
                or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,31}', self.user)
                or type(self.port) is not int or not 1 <= self.port <= 65535
                or not re.fullmatch(r'/[A-Za-z0-9_/-]+', self.python)
                or not re.fullmatch(r'/[A-Za-z0-9_/-]+', self.root) or '..' in self.root.split('/')):
            raise AppError(503, 'ssh_configuration_invalid', 'SSH endpoint configuration is invalid')
        for name in (self.private_key, self.known_hosts):
            path = Path(name)
            if not path.is_absolute() or not path.is_file():
                raise AppError(503, 'ssh_configuration_missing', 'Configure backend SSH key and verified known_hosts files')
        return self

class RemoteChannel:
    def __init__(self, settings):
        self.settings = settings

    def endpoint(self, instance_id):
        try:
            data = json.loads(Path(self.settings.ssh_endpoints_file).read_text(encoding='utf-8-sig'))
            return Endpoint(**data[instance_id]).validate()
        except AppError: raise
        except Exception:
            raise AppError(503, 'ssh_not_configured', 'Configure this instance in the backend-only SSH endpoint file') from None

    def command(self, endpoint):
        endpoint.validate()
        source = Path(__file__).with_name('remote_agent.py').read_bytes()
        encoded = base64.b64encode(source).decode()
        digest = hashlib.sha256(source).hexdigest()
        # Values are validated; source and path travel only as base64/literal strings.
        bootstrap = (
            'import base64,hashlib,os,pathlib,subprocess,sys;'
            f'p=pathlib.Path({endpoint.root!r});'
            'p.mkdir(parents=True,exist_ok=True,mode=448);'
            'assert not p.is_symlink() and p.stat().st_uid==os.getuid() and not p.stat().st_mode&18;'
            f'b=base64.b64decode({encoded!r});f=p/"agent-{digest}.py";'
            'assert not f.is_symlink();'
            'f.write_bytes(b) if not f.exists() else None;'
            'assert hashlib.sha256(f.read_bytes()).hexdigest()==hashlib.sha256(b).hexdigest();'
            'sys.exit(subprocess.run([sys.executable,str(f)],stdin=sys.stdin.buffer).returncode)'
        )
        remote = endpoint.python + ' -c ' + __import__('shlex').quote(bootstrap)
        return [self.settings.ssh_executable, '-F', os.devnull, '-T',
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
            '-o', 'PermitLocalCommand=no', '-o', 'ClearAllForwardings=yes',
            '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
            '-o', 'GlobalKnownHostsFile=' + os.devnull,
            '-o', 'UserKnownHostsFile=' + endpoint.known_hosts,
            '-i', endpoint.private_key, '-p', str(endpoint.port),
            endpoint.user + '@' + endpoint.host, remote]

    def call(self, instance_id, job_id, operation, *, stream=None, timeout=40, **values):
        endpoint = self.endpoint(instance_id)
        request = {'root': endpoint.root, 'job_id': str(job_id), 'operation': operation, **values}
        try:
            with tempfile.TemporaryFile() as payload:
                payload.write(json.dumps(request, allow_nan=False).encode() + b'\n')
                if stream is not None:
                    while chunk := stream.read(1024 * 1024): payload.write(chunk)
                payload.seek(0)
                # stdout is bounded by the protocol (one chunk plus metadata).
                result = subprocess.run(self.command(endpoint), stdin=payload, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, timeout=timeout, check=False,
                    env={k: v for k,v in os.environ.items() if not k.startswith('SSH_')})
            if result.returncode or len(result.stdout) > 3 * 1024**2: raise ValueError()
            response = json.loads(result.stdout)
            if response.get('ok') is not True: raise ValueError()
            return response['result']
        except Exception:
            raise AppError(503, 'remote_state_unknown', 'Remote operation could not be confirmed; instance and lease are retained') from None

    def upload(self, instance_id, job_id, path, stream, size, sha256):
        return self.call(instance_id, job_id, 'put', path=path, stream=stream, size=size,
                         sha256=sha256, timeout=self.settings.ssh_transfer_timeout)

    def download(self, instance_id, job_id, item, target):
        offset = 0; digest = hashlib.sha256()
        while offset < item['size']:
            block = self.call(instance_id, job_id, 'read', path=item['path'], offset=offset)
            data = base64.b64decode(block['data'], validate=True)
            if (not data or block.get('gap') or block.get('missing')
                    or block['offset'] != offset or block['next_offset'] != offset + len(data)
                    or hashlib.sha256(data).hexdigest() != block['sha256']):
                raise AppError(503, 'remote_transfer_invalid', 'Incomplete or invalid output transfer')
            target.write(data); digest.update(data); offset += len(data)
        if offset != item['size'] or digest.hexdigest() != item['sha256']:
            raise AppError(503, 'remote_transfer_invalid', 'Output integrity verification failed')

    def probe(self, instance_id, job_id, path):
        source = Path(__file__).with_name('model_probe.py').read_bytes()
        return self.call(instance_id, job_id, 'probe', source=base64.b64encode(source).decode(),
                         path=path, timeout=self.settings.ssh_transfer_timeout)

    def runtime_check(self, instance_id, job_id, runtime_lock):
        """Prove the configured interpreter, packages, dependencies, CUDA and GPU before inputs."""
        try:
            report = self.call(
                instance_id,
                job_id,
                'runtime_check',
                lock=runtime_lock,
                timeout=90,
            )
        except AppError as error:
            raise AppError(
                409,
                'gpu_runtime_not_ready',
                'The instance runtime is not installed or the backend SSH endpoint is not ready.',
                {'cause': error.code},
            ) from None
        if (
            not isinstance(report, dict)
            or type(report.get('ready')) is not bool
            or not isinstance(report.get('mismatches'), list)
            or report.get('lock_id') != runtime_lock.get('id')
        ):
            raise AppError(502, 'runtime_probe_invalid', 'The instance runtime probe returned an invalid report')
        return report
