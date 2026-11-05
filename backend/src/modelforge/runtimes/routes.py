"""Read-only compatibility contract for clients and acceptance checks."""
from fastapi import APIRouter, Request

from .compatibility import public_compatibility_baseline, public_training_image_profiles

router = APIRouter(prefix="/api/v1/runtime", tags=["runtime-compatibility"])


@router.get("/baseline")
def baseline(request: Request):
    return public_compatibility_baseline(request.app.state.resources.settings)


@router.get("/training-images")
def training_images():
    return public_training_image_profiles()
