"""Read-only compatibility contract for clients and acceptance checks."""
from fastapi import APIRouter, Request

from .compatibility import public_compatibility_baseline

router = APIRouter(prefix="/api/v1/runtime", tags=["runtime-compatibility"])


@router.get("/baseline")
def baseline(request: Request):
    return public_compatibility_baseline(request.app.state.resources.settings)
