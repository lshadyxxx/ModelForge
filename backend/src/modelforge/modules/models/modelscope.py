"""Anonymous ModelScope HTTP boundary. No repository code or SDK is executed."""
from __future__ import annotations

import hashlib
import json
import re

import httpx
from pydantic import ValidationError

from modelforge.errors import AppError
from .manifest import ModelFile, safe_path


class ModelScope:
    def __init__(self, client: httpx.Client):
        self.client = client

    @staticmethod
    def _repository(repository):
        segment = r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}'
        if not isinstance(repository, str) or not re.fullmatch(segment + '/' + segment, repository):
            raise AppError(422, 'model_source_invalid', 'Use an owner/model repository ID')

    @classmethod
    def validate_source(cls, repository: str, revision: str):
        cls._repository(repository)
        if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise AppError(422, 'model_source_invalid',
                           'Use an owner/model repository ID and a full lowercase 40-character commit')

    @staticmethod
    def _url(repository, revision, path=None):
        return httpx.URL(f'https://modelscope.cn/api/v1/models/{repository}/repo'
                         + ('/files' if path is None else ''),
                         params={'Revision': revision, **({'Recursive': 'true'} if path is None else {'FilePath': path})})

    @staticmethod
    def _refname(name):
        if (not name.startswith('refs/') or len(name) > 255
                or not re.fullmatch(r'[A-Za-z0-9_./-]+', name) or '..' in name or name.endswith('.')
                or any(not part or part.startswith('.') or part.endswith('.lock') for part in name.split('/'))):
            raise ValueError('Invalid or unsupported ref name')

    @staticmethod
    def _branch(revision):
        name = revision.removeprefix('refs/heads/')
        try:
            ModelScope._refname('refs/heads/' + name)
            if (name.startswith('-') or (revision.startswith('refs/') and not revision.startswith('refs/heads/'))
                    or (not revision.startswith('refs/heads/') and re.fullmatch(r'[0-9a-fA-F]{4,64}', name))):
                raise ValueError('Not an unambiguous branch')
        except ValueError as error:
            raise AppError(422, 'model_source_invalid',
                           'Use a full lowercase commit or ASCII branch name; tags and abbreviated commits are not supported') from error
        return 'refs/heads/' + name

    def _resolve(self, repository, revision):
        branch = None if revision in {None, '', 'HEAD'} else self._branch(revision)
        url = httpx.URL(f'https://modelscope.cn/models/{repository}.git/info/refs',
                        params={'service': 'git-upload-pack'})
        try:
            with self.client.stream('GET', url, follow_redirects=False,
                                    headers={'User-Agent': 'git/2.0 (ModelForge; refs-only)'}) as response:
                self._status(response)
                if response.headers.get('content-type') != 'application/x-git-upload-pack-advertisement':
                    raise ValueError('Not a Git advertisement')
                data = bytearray()
                for chunk in response.iter_bytes(64 * 1024):
                    data.extend(chunk)
                    if len(data) > 1024**2:
                        raise ValueError('Advertisement exceeds the response limit')
            refs, head = self._refs(bytes(data))
            if branch is None:
                if not head or not head.startswith('refs/heads/') or refs.get('HEAD') != refs.get(head):
                    raise ValueError('Default branch identity is not confirmed')
                try:
                    self._branch(head)
                except AppError as error:
                    raise ValueError('Invalid advertised default branch') from error
                branch = head
            elif (branch in refs and not revision.startswith('refs/heads/')
                  and 'refs/tags/' + revision in refs):
                raise AppError(422, 'model_revision_ambiguous', 'Branch/tag name is ambiguous; use refs/heads/<branch>')
            if branch not in refs:
                raise AppError(422, 'model_revision_not_found', 'Branch is not advertised; tags are not supported, or use a full commit')
            return refs[branch], branch
        except httpx.HTTPError as error:
            raise AppError(502, 'model_source_unavailable', 'Cannot resolve ModelScope revision; retry later') from error
        except (ValueError, KeyError, UnicodeError) as error:
            raise AppError(502, 'model_revision_unverifiable',
                           'ModelScope did not advertise a complete immutable branch identity; use a full commit') from error

    @staticmethod
    def _refs(data):
        offset, packets = 0, 0
        def packet():
            nonlocal offset, packets
            packets += 1
            if packets > 16384:
                raise ValueError('Advertisement exceeds the packet limit')
            header = data[offset:offset + 4]
            if not re.fullmatch(b'[0-9a-fA-F]{4}', header):
                raise ValueError('Invalid packet header')
            size = int(header, 16)
            offset += 4
            if size == 0:
                return None
            if not 4 <= size <= 65520 or offset + size - 4 > len(data):
                raise ValueError('Incomplete packet')
            result = data[offset:offset + size - 4]
            offset += size - 4
            return result
        if packet() != b'# service=git-upload-pack\n' or packet() is not None:
            raise ValueError('Invalid Git service header')
        refs, head, previous = {}, None, None
        while True:
            line = packet()
            if line is None:
                break
            line = line.removesuffix(b'\n')
            if not refs:
                line, separator, capabilities = line.partition(b'\0')
                if not separator:
                    raise ValueError('Missing capabilities')
                capabilities = capabilities.decode('ascii').split(' ')
                if (any(not c or any(ord(char) < 33 or ord(char) > 126 for char in c)
                        for c in capabilities) or len(capabilities) != len(set(capabilities))):
                    raise ValueError('Invalid or duplicate capability')
                formats = [c for c in capabilities if c.startswith('object-format=')]
                if formats and formats != ['object-format=sha1']:
                    raise ValueError('Unsupported object format')
                heads = [c.removeprefix('symref=HEAD:') for c in capabilities if c.startswith('symref=HEAD:')]
                if len(heads) > 1:
                    raise ValueError('Ambiguous default branch')
                head = heads[0] if heads else None
                for capability in capabilities:
                    if capability.startswith('symref='):
                        source, target = capability.removeprefix('symref=').split(':', 1)
                        if source != 'HEAD':
                            ModelScope._refname(source)
                        ModelScope._refname(target)
            oid, name = line.decode('utf-8').split(' ', 1)
            if name != 'HEAD':
                ModelScope._refname(name.removesuffix('^{}'))
            if name.endswith('^{}') and previous != name[:-3]:
                raise ValueError('Peeled value must immediately follow its originating ref')
            if (not re.fullmatch(r'[0-9a-f]{40}', oid) or oid == '0' * 40
                    or name in refs or any(c.isspace() or ord(c) < 32 for c in name)
                    or not (name == 'HEAD' or name.startswith('refs/'))
                    or (name == 'HEAD' and refs)):
                raise ValueError('Invalid or duplicate advertised ref')
            refs[name] = oid
            previous = name
        if offset != len(data) or not refs:
            raise ValueError('Incomplete or trailing advertisement')
        return refs, head

    def snapshot(self, repository: str, revision: str | None = None):
        requested_revision, resolved_ref = revision, None
        self._repository(repository)
        if revision is None or (isinstance(revision, str) and not re.fullmatch(r'[0-9a-f]{40}', revision)):
            revision, resolved_ref = self._resolve(repository, revision)
        self.validate_source(repository, revision)
        try:
            with self.client.stream('GET', self._url(repository, revision), follow_redirects=False) as response:
                self._status(response)
                data = bytearray()
                for chunk in response.iter_bytes(64 * 1024):
                    data.extend(chunk)
                    if len(data) > 4 * 1024**2:
                        raise AppError(422, 'manifest_incomplete', 'Repository manifest exceeds the bounded response limit')
                payload = json.loads(data)
        except httpx.HTTPError as error:
            raise AppError(502, 'model_source_unavailable', 'Cannot read ModelScope repository; retry later') from error
        except (ValueError, UnicodeError) as error:
            raise AppError(502, 'model_source_unavailable', 'ModelScope returned an invalid manifest response') from error
        if not isinstance(payload, dict) or payload.get('Success') is not True or payload.get('Code') != 200:
            raise AppError(502, 'model_source_unavailable', 'ModelScope did not confirm repository access')
        entries = payload.get('Data', {}).get('Files') if isinstance(payload.get('Data'), dict) else None
        if not isinstance(entries, list):
            raise AppError(502, 'model_manifest_invalid', 'ModelScope did not return a file list')
        if len(entries) >= 3000:
            raise AppError(422, 'manifest_incomplete', 'ModelScope may truncate lists at 3000 entries; this repository is not supported yet')
        files = []
        try:
            for item in entries:
                if not isinstance(item, dict):
                    raise ValueError('Invalid repository entry')
                if not isinstance(item.get('Path'), str):
                    raise ValueError('Repository path must be a string')
                safe_path(item['Path'])
                if item['Type'] == 'tree':
                    continue
                if item['Type'] != 'blob' or not isinstance(item.get('Sha256'), str):
                    raise ValueError('Unverifiable repository entry')
                file = ModelFile(path=item['Path'], size_bytes=item['Size'], sha256=item['Sha256'])
                files.append({**file.model_dump(), 'source_revision': item.get('Revision')})
        except (KeyError, ValueError, TypeError, ValidationError) as error:
            raise AppError(422, 'model_manifest_invalid', 'Repository paths, sizes and SHA-256 must all be verifiable') from error
        return {'repository': repository, 'requested_revision': requested_revision,
                'resolved_ref': resolved_ref, 'revision': revision, 'files': files}

    @staticmethod
    def _status(response):
        if response.status_code != 200:
            raise AppError(502, 'model_source_unavailable',
                           'ModelScope request failed; verify the public repository and commit',
                           {'upstream_status': response.status_code})

    @staticmethod
    def _approved(url):
        return (url.scheme == 'https' and url.host in {'modelscope.cn', 'cdn-lfs-cn-1.modelscope.cn'}
                and url.port in {None, 443} and not url.userinfo and not url.fragment)

    def download(self, repository, revision, file, output, checkpoint):
        """Checkpoint receives actual current-file bytes and can interrupt every chunk."""
        self.validate_source(repository, revision)
        safe_path(file['path'])
        url = self._url(repository, revision, file['path'])
        try:
            for _ in range(6):
                if not self._approved(url):
                    raise AppError(502, 'model_source_redirect_rejected', 'Repository redirect target is not approved')
                checkpoint(0)
                with self.client.stream('GET', url, follow_redirects=False,
                                        headers={'Accept-Encoding': 'identity'}) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get('location')
                        if not location:
                            raise AppError(502, 'model_source_redirect_rejected', 'Repository redirect has no target')
                        url = url.join(location)
                        continue
                    self._status(response)
                    size, digest = 0, hashlib.sha256()
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > file['size_bytes']:
                            raise AppError(409, 'model_checksum_mismatch', 'Downloaded file exceeds the fixed manifest size')
                        digest.update(chunk)
                        output.write(chunk)
                        checkpoint(size)
                    if size != file['size_bytes'] or digest.hexdigest() != file['sha256']:
                        raise AppError(409, 'model_checksum_mismatch', 'Downloaded file differs from the fixed manifest')
                    return
            raise AppError(502, 'model_source_redirect_rejected', 'Repository exceeded the redirect limit')
        except (httpx.HTTPError, ValueError) as error:
            raise AppError(502, 'model_source_unavailable', 'ModelScope download failed; retry the fixed snapshot') from error
