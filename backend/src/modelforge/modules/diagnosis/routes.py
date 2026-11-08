"""HTTP routes for advisory diagnosis jobs and reports."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .contracts import ComparisonMode
from .use_cases import DiagnosisUseCases


router = APIRouter(prefix='/api/v1/training', tags=['training-diagnosis'])


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    experiment_id: str = Field(min_length=1, max_length=80)


class DiagnosisCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    comparison_mode: ComparisonMode = 'auto'
    baseline_attempt_id: uuid.UUID | None = None

    @model_validator(mode='after')
    def comparison_selection(self):
        if self.comparison_mode == 'explicit' and self.baseline_attempt_id is None:
            raise ValueError('explicit comparison requires baseline_attempt_id')
        if self.comparison_mode != 'explicit' and self.baseline_attempt_id is not None:
            raise ValueError('baseline_attempt_id is only valid for explicit comparison')
        return self


def use_cases(request: Request) -> DiagnosisUseCases:
    return DiagnosisUseCases(request.app.state.resources)


@router.get('/diagnosis/config')
def availability(request: Request):
    return DiagnosisUseCases.availability(request.app.state.resources.settings)


@router.post(
    '/attempts/{attempt_id}/diagnosis-reports',
    status_code=202,
)
def create_report(
    attempt_id: uuid.UUID,
    request: Request,
    body: DiagnosisCreateRequest | None = None,
):
    body = body or DiagnosisCreateRequest()
    return use_cases(request).create(
        attempt_id,
        comparison_mode=body.comparison_mode,
        baseline_attempt_id=body.baseline_attempt_id,
    )


@router.get('/attempts/{attempt_id}/diagnosis-comparison-candidates')
def comparison_candidates(
    attempt_id: uuid.UUID,
    request: Request,
    limit: int = Query(20, ge=1, le=20),
):
    return use_cases(request).comparison_candidates(
        attempt_id,
        limit=limit,
    )


@router.get('/attempts/{attempt_id}/diagnosis-reports/latest')
def latest_report(attempt_id: uuid.UUID, request: Request):
    service = use_cases(request)
    result = service.latest(attempt_id)
    if result is None:
        job = service.repository.find_latest_job(attempt_id)
        payload = {
            'report': None,
            'state': 'absent',
            'latest_job': job,
        }
        status = 202 if job and job['state'] in {'queued', 'running'} else 200
        return JSONResponse(status_code=status, content=jsonable_encoder(payload))
    result['latest_job'] = service.repository.find_latest_job(attempt_id)
    return result


@router.get('/attempts/{attempt_id}/diagnosis-reports')
def report_history(attempt_id: uuid.UUID, request: Request):
    return use_cases(request).reports(attempt_id)


@router.get('/diagnosis-jobs/{job_id}/status')
def job_status(job_id: uuid.UUID, request: Request):
    return use_cases(request).job(job_id)


@router.post('/diagnosis-jobs/{job_id}/regenerate', status_code=202)
def regenerate(job_id: uuid.UUID, request: Request):
    return use_cases(request).regenerate(job_id)


@router.get('/diagnosis-reports/{report_id}')
def report(report_id: uuid.UUID, request: Request):
    return use_cases(request).report(report_id)


@router.post('/diagnosis-reports/{report_id}/draft')
def draft(report_id: uuid.UUID, body: DraftRequest, request: Request):
    return use_cases(request).draft(
        report_id,
        experiment_id=body.experiment_id,
    )
