import re
import uuid
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


def error_response(request: Request, status: int, code: str, message: str, details=None):
    request_id = getattr(request.state, "request_id", "req_" + uuid.uuid4().hex)
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status, content={"error": error, "request_id": request_id},
                        headers={"X-Request-ID": request_id})


def configure_errors(app: FastAPI):
    @app.middleware("http")
    async def request_identity(request: Request, call_next):
        proposed = request.headers.get("x-request-id", "")
        request.state.request_id = proposed if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", proposed) else "req_" + uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(AppError)
    async def application_error(request, error):
        return error_response(request, error.status, error.code, error.message, error.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        details = [{"path": ".".join(map(str, entry["loc"])), "message": entry["msg"]}
                   for entry in error.errors()]
        return error_response(request, 422, "validation_error", "Request validation failed", details)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        code = {404: "not_found", 409: "conflict", 405: "method_not_allowed"}.get(error.status_code, "http_error")
        return error_response(request, error.status_code, code, {404: "Resource not found", 405: "Method not allowed"}.get(error.status_code, "Request failed"))

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        return error_response(request, 500, "internal_error", "Unexpected server error")
