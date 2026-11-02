"""HTTP mapping for the dataset module."""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from modelforge.errors import AppError
from modelforge.infrastructure.http import read_bounded_body
from .registry import DatasetRegistry


router = APIRouter(prefix="/api/v1")


class DatasetEditMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str


class DatasetDerivedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: uuid.UUID
    expected_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    line: int = Field(ge=1)
    messages: list[DatasetEditMessage] = Field(min_length=1)


async def _dataset_body(request: Request) -> bytes:
    resources = request.app.state.resources
    return await read_bounded_body(
        request,
        resources.settings.dataset_file_limit_bytes,
        too_large_message="Dataset file exceeds the configured limit",
        empty_message="Dataset file must not be empty",
    )


@router.get("/datasets/limits")
def dataset_limits(request: Request):
    settings = request.app.state.resources.settings
    return {
        "file_limit_bytes": settings.dataset_file_limit_bytes,
        "sample_limit": settings.dataset_sample_limit,
        "line_limit_bytes": settings.dataset_line_limit_bytes,
        "validation_error_limit": settings.dataset_validation_error_limit,
        "preview_samples": settings.dataset_preview_samples,
        "configuration_version": settings.dataset_limits_version,
        "locked": settings.dataset_limits_locked,
    }


@router.post("/datasets", status_code=201)
async def create_dataset(request: Request, name: str = Query(..., min_length=1, max_length=120)):
    data = await _dataset_body(request)
    registry = DatasetRegistry(request.app.state.resources)
    return jsonable_encoder(await run_in_threadpool(registry.create, data, name))


@router.post("/datasets/{dataset_id}/versions", status_code=201)
async def create_dataset_version(dataset_id: uuid.UUID, request: Request):
    data = await _dataset_body(request)
    registry = DatasetRegistry(request.app.state.resources)
    return jsonable_encoder(await run_in_threadpool(registry.create_version, data, dataset_id))


@router.get("/datasets")
def list_datasets(request: Request):
    return jsonable_encoder(DatasetRegistry(request.app.state.resources).list())


@router.get("/dataset-versions/{version_id}")
def dataset_version(version_id: uuid.UUID, request: Request):
    return jsonable_encoder(DatasetRegistry(request.app.state.resources).get(version_id))


@router.get("/dataset-versions/{version_id}/content")
def dataset_content(version_id: uuid.UUID, request: Request):
    row, data = DatasetRegistry(request.app.state.resources).download(version_id)
    return Response(data, media_type="application/x-ndjson", headers={"X-Content-SHA256": row["sha256"]})


@router.get("/dataset-versions/{version_id}/samples")
def dataset_samples(
    version_id: uuid.UUID,
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    return jsonable_encoder(DatasetRegistry(request.app.state.resources).samples(version_id, offset, limit))


@router.post("/dataset-versions/{version_id}/derived", status_code=201)
async def derive_dataset_version(
    version_id: uuid.UUID,
    request: Request,
    payload: DatasetDerivedRequest,
):
    registry = DatasetRegistry(request.app.state.resources)
    messages = [message.model_dump() for message in payload.messages]
    return jsonable_encoder(await run_in_threadpool(
        registry.derive,
        version_id,
        payload.request_id,
        payload.expected_sha256,
        payload.line,
        messages,
    ))


@router.post("/dataset-versions/{version_id}/split")
def split_dataset(version_id: uuid.UUID, request: Request, ratio: float = Query(0.1, ge=0.05, le=0.30), seed: int = Query(42, ge=0, le=2147483647)):
    return jsonable_encoder(DatasetRegistry(request.app.state.resources).split(version_id, ratio, seed))


@router.post("/dataset-versions/{version_id}/publish")
def publish_dataset(version_id: uuid.UUID, request: Request, ratio: float = Query(0.1, ge=0.05, le=0.30), seed: int = Query(42, ge=0, le=2147483647)):
    return jsonable_encoder(DatasetRegistry(request.app.state.resources).publish(version_id, ratio, seed))


@router.delete("/dataset-versions/{version_id}", status_code=204)
def delete_dataset(version_id: uuid.UUID, request: Request):
    DatasetRegistry(request.app.state.resources).delete(version_id)
    return Response(status_code=204)
