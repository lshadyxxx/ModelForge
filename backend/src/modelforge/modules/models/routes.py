"""Model-directory API. A request streams at most one complete file."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import uuid

from fastapi import APIRouter, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from modelforge.errors import AppError
from .manifest import ModelFile
from .registry import ModelRegistry
from .imports import ModelImports

router = APIRouter(prefix='/api/v1')


class CreateDirectory(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=120)
    model_id: uuid.UUID | None = None
    files: list[ModelFile] = Field(min_length=1, max_length=10_000)


class ResumeDirectory(BaseModel):
    model_config = ConfigDict(extra='forbid')
    files: list[ModelFile] = Field(min_length=1, max_length=10_000)


class CreateModelScope(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=120)
    repository: str = Field(min_length=3, max_length=257)
    revision: str = Field(pattern=r'^[0-9a-f]{40}$')
    model_id: uuid.UUID | None = None


@router.post('/models/modelscope-imports', status_code=201)
def create_modelscope(body: CreateModelScope, request: Request):
    return jsonable_encoder(ModelImports(request.app.state.resources).create(
        body.name, body.repository, body.revision, body.model_id))


@router.post('/model-versions/{version_id}/retry-import')
def retry_import(version_id: uuid.UUID, request: Request):
    return jsonable_encoder(ModelImports(request.app.state.resources).retry(version_id))


@router.get('/models/limits')
def limits(request: Request):
    s = request.app.state.resources.settings
    return {'file_limit_bytes': s.model_file_limit_bytes, 'total_limit_bytes': s.model_total_limit_bytes,
            'file_count_limit': s.model_file_count_limit, 'configuration_version': s.model_limits_version,
            'locked': s.model_limits_locked, 'resume_granularity': 'file'}


@router.post('/models/directory-imports', status_code=201)
def create(body: CreateDirectory, request: Request):
    return jsonable_encoder(ModelRegistry(request.app.state.resources).create(body.name, body.files, body.model_id))


@router.get('/models')
def list_models(request: Request):
    return jsonable_encoder(ModelRegistry(request.app.state.resources).list())


@router.get('/model-versions/{version_id}')
def get(version_id: uuid.UUID, request: Request):
    return jsonable_encoder(ModelRegistry(request.app.state.resources).get(version_id))


@router.put('/model-versions/{version_id}/files')
async def upload(version_id: uuid.UUID, request: Request, path: str = Query(..., min_length=1, max_length=1024)):
    resources = request.app.state.resources
    registry = ModelRegistry(resources)
    row = await run_in_threadpool(registry.get, version_id)
    file = next((f for f in row['files'] if f['path'] == path), None)
    if row['state'] != 'uploading':
        raise AppError(409, 'conflict', 'ModelVersion does not accept uploads')
    if file is None:
        raise AppError(404, 'not_found', 'File is absent from the immutable manifest')
    limit = min(file['size_bytes'], resources.settings.model_file_limit_bytes)
    if request.headers.get('content-length'):
        try:
            declared = int(request.headers['content-length'])
        except ValueError as error:
            raise AppError(422, 'validation_error', 'Invalid Content-Length') from error
        if declared != file['size_bytes']:
            raise AppError(409, 'model_checksum_mismatch', 'Content-Length differs from the manifest')
    directory = Path(resources.settings.model_temporary_directory)
    await run_in_threadpool(directory.mkdir, parents=True, exist_ok=True)
    with tempfile.TemporaryFile(dir=directory) as stream:
        size, digest = 0, hashlib.sha256()
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise AppError(413, 'file_too_large', 'Upload exceeds the declared size or configured limit')
            digest.update(chunk)
            await run_in_threadpool(stream.write, chunk)
        result = await run_in_threadpool(registry.upload, version_id, path, stream, size, digest.hexdigest())
    return result


@router.post('/model-versions/{version_id}/resume')
def resume(version_id: uuid.UUID, body: ResumeDirectory, request: Request):
    return jsonable_encoder(ModelRegistry(request.app.state.resources).resume(version_id, body.files))


@router.post('/model-versions/{version_id}/complete')
def complete(version_id: uuid.UUID, request: Request):
    return jsonable_encoder(ModelRegistry(request.app.state.resources).complete(version_id))


@router.post('/model-versions/{version_id}/cancel')
def cancel(version_id: uuid.UUID, request: Request):
    resources = request.app.state.resources
    registry = ModelRegistry(resources)
    if registry.get(version_id).get('source_kind') == 'modelscope':
        return jsonable_encoder(ModelImports(resources).cancel(version_id))
    return jsonable_encoder(registry.cancel(version_id))


@router.delete('/model-versions/{version_id}', status_code=204)
def delete(version_id: uuid.UUID, request: Request):
    result = ModelRegistry(request.app.state.resources).delete(version_id)
    if result and result['storage_cleanup'] == 'pending':
        return JSONResponse(result, status_code=202)
    return Response(status_code=204)


@router.get('/model-versions/{version_id}/storage-cleanup')
def storage_cleanup(version_id: uuid.UUID, request: Request):
    return ModelImports(request.app.state.resources).cleanup_status(version_id)
