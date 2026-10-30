import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from modelforge.bootstrap import Resources
from modelforge.settings import get_settings
from modelforge.errors import AppError, configure_errors
from modelforge.infrastructure.http import read_bounded_body
from modelforge.infrastructure.minio import create_store
from modelforge.modules.models import FileRegistry
from modelforge.modules.models import router as models_router
from modelforge.modules.datasets import router as datasets_router


def now():
    return datetime.now(timezone.utc).isoformat()


@asynccontextmanager
async def lifespan(app):
    app.state.resources = Resources.open(get_settings())
    try:
        yield
    finally:
        app.state.resources.close()


app = FastAPI(title="ModelForge API", version="0.1.0", lifespan=lifespan)
configure_errors(app)
app.include_router(datasets_router)
app.include_router(models_router)


@app.get("/api/v1/health/live")
def live():
    return {"status": "alive", "service": "api", "checked_at": now()}


async def dependency_status(request: Request, include_worker=True):
    resources = request.app.state.resources
    def check_postgres():
        with resources.pool.connection() as connection:
            return connection.execute("SELECT 1 AS connected").fetchone()["connected"] == 1
    def check_minio():
        store = create_store(resources.settings, read_timeout=resources.settings.probe_timeout)
        try:
            return store.bucket_exists(resources.settings.minio_bucket)
        finally:
            store._http.clear()
    async def check_worker():
        async with httpx.AsyncClient(timeout=resources.settings.probe_timeout, trust_env=False) as client:
            response = await client.get(resources.settings.worker_url + "/health/live")
            response.raise_for_status()
            result = response.json()
            return result.get("service") == "worker" and result.get("status") == "alive"
    async def probe(name, check, threaded=True):
        started = time.monotonic()
        try:
            success = await run_in_threadpool(check) if threaded else await check()
            state = "up" if success else "down"
        except Exception:
            state = "down"
        return name, {"state": state, "checked_at": now(),
                      "duration_ms": round((time.monotonic()-started)*1000),
                      "code": "ok" if state == "up" else "dependency_unavailable",
                      "message": "检查通过" if state == "up" else {
                          "postgres": "数据库查询失败，请检查 PostgreSQL 容器与配置",
                          "minio": "已认证存储检查失败，请检查 MinIO、凭据与 bucket",
                          "worker": "Worker 探针不可达，请检查独立 Worker 进程"}[name]}
    checks = [probe("postgres", check_postgres), probe("minio", check_minio)]
    if include_worker:
        checks.append(probe("worker", check_worker, False))
    components = dict(await asyncio.gather(*checks))
    components["api"] = {"state": "up", "checked_at": now(), "duration_ms": 0, "code": "ok", "message": "API 进程正在响应"}
    ready = all(components[name]["state"] == "up" for name in ["postgres", "minio"])
    return {"ready": ready, "checked_at": now(), "components": components}


@app.get("/api/v1/status")
async def status(request: Request):
    return await dependency_status(request)


@app.get("/api/v1/health/ready")
async def ready(request: Request):
    result = await dependency_status(request, include_worker=False)
    return JSONResponse(result, status_code=200 if result["ready"] else 503)


@app.post("/api/v1/files", status_code=201)
async def upload(request: Request):
    resources = request.app.state.resources
    data = await read_bounded_body(
        request,
        resources.settings.file_limit_bytes,
        too_large_message="Foundation verification files must not exceed 1 MiB",
        empty_message="File must not be empty",
    )
    row = await run_in_threadpool(FileRegistry(resources).upload, bytes(data), "application/octet-stream")
    return jsonable_encoder(row)


@app.get("/api/v1/files/{file_id}")
def metadata(file_id: uuid.UUID, request: Request):
    return FileRegistry(request.app.state.resources).get(file_id)


@app.get("/api/v1/files/{file_id}/content")
def download(file_id: uuid.UUID, request: Request):
    row, data = FileRegistry(request.app.state.resources).download(file_id)
    return Response(data, media_type=row["content_type"], headers={"X-Content-SHA256": row["sha256"]})


@app.delete("/api/v1/files/{file_id}", status_code=204)
def delete(file_id: uuid.UUID, request: Request):
    FileRegistry(request.app.state.resources).delete(file_id)
    return Response(status_code=204)
