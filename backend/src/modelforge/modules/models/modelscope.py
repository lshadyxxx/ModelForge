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
    def validate_source(repository: str, revision: str):
        segment = r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}'
        if (not re.fullmatch(segment + '/' + segment, repository)
                or not re.fullmatch(r'[0-9a-f]{40}', revision)):
            raise AppError(422, 'model_source_invalid',
                           'Use an owner/model repository ID and a full lowercase 40-character commit')

    @staticmethod
    def _url(repository, revision, path=None):
        return httpx.URL(f'https://modelscope.cn/api/v1/models/{repository}/repo'
                         + ('/files' if path is None else ''),
                         params={'Revision': revision, **({'Recursive': 'true'} if path is None else {'FilePath': path})})

    def snapshot(self, repository: str, revision: str):
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
        return {'repository': repository, 'revision': revision, 'files': files}

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
