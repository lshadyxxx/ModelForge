# 本地运行与第一阶段验收

本批只覆盖 ticket 01 基础骨架。本机缓存镜像的真实存储复验已通过；默认全应用Compose仍有未验门槛，见[实施记录](implementation/phase-1-2026-10-29.md)及[缓存镜像复验](implementation/cached-storage-2026-10-29.md)。`designs/` 保留完整演示，`frontend/` 只开放实际实现的工作台。

## 启停

需要 Docker Desktop（Linux containers）、Compose v2+ 和 PowerShell 5.1+ / 7。首次构建需要连接 Docker Hub、PyPI、npm 和 Go module proxy。从项目根目录运行：

```powershell
./scripts/start.ps1
# 默认工作台 http://127.0.0.1:8092；API http://127.0.0.1:8102
./scripts/stop.ps1
./scripts/restart.ps1
```

Windows PowerShell 5.1 可使用 `powershell -File scripts/start.ps1`；PowerShell 7 也可使用 `pwsh -File`。

首次启动从 `.env.example` 生成被 Git 忽略的 `.env` 和随机本地凭据；不覆盖已有配置。端口可用 `MF_WEB_PORT` / `MF_API_PORT` 调整。只有 Web/API 发布回环端口，PostgreSQL、MinIO、Worker 不发布宿主端口；浏览器只通过同源 `/api` 访问。

`migrate` 等待依赖健康，执行 Alembic migration 和幂等 bucket 初始化，成功后才启动 API/Worker；应用进程本身不运行迁移。

```powershell
docker compose ps -a
docker compose logs --tail 100 migrate api worker minio
docker compose run --rm --no-deps migrate
docker compose stop worker
docker compose start worker
```

停止不删除 `docker-db/postgres` 或 `docker-db/minio`。不手工修改服务数据目录。已有 PostgreSQL 初始化后，单改 `.env` 密码不会修改数据库内密码。

## 文件读写与持久化验收

```powershell
./scripts/verify-storage.ps1 -Mode lifecycle -Probe lifecycle
./scripts/verify-storage.ps1 -Mode prepare -Probe restart
./scripts/restart.ps1
./scripts/verify-storage.ps1 -Mode verify -Probe restart
```

`lifecycle` 使用唯一 run ID 经 API 上传，直接查询 PostgreSQL 元数据，经 API/MinIO 双路回读，比对内容、大小和 SHA-256，最后确认对象与元数据均已删除。`prepare` 另建并保留对象和记录；`verify` 用宿主 `.runtime/<Probe>.json` 同一回执在容器重建后重读，核对通过才清理。回执是验收证据，不保存正式文件内容。

失败返回非零，保留回执。恢复依赖后可用 `-Mode cleanup` 重试清理。错误上传有 `file_id` 时会持久化清理回执，仍用 `-Mode cleanup -Probe <原探针名>`；若回执写入失败，先将 stderr 的 `recovery_receipt` JSON 保存到原回执再清理。不能用端口开放、容器运行或 bucket list 替代读写验收。

若连接中断导致只有 `upload_pending` 而没有 `file_id`，远端结果仍未知，不能自动丢弃或声称清理完成。可显式运行 `./scripts/verify-storage.ps1 -Mode reset-pending -Probe <原探针名>`，将回执保留为 `.unresolved-UUID` 档案，再用原探针名发起新验收。输出 `remote_cleanup_confirmed:false`，旧请求仍需结合 API 日志和 PostgreSQL/MinIO 对账；归档不算验收通过。

还必须执行并记录：迁移重复运行安全；受控迁移失败使 API/Worker 不能启动；分别停止 PostgreSQL、MinIO、Worker，在状态 API 和页面观察对应项失败并在恢复后正常；API liveness 始终只表示进程响应，Worker 故障不改变 DB/MinIO readiness。最后停止本项目服务，保留数据。

## 接口与实现选择

| 项目 | 当前实现 |
|---|---|
| API liveness | `GET /api/v1/health/live`，进程检查 |
| API readiness | `GET /api/v1/health/ready`，真实查询 PostgreSQL 和已认证 bucket 检查；失败 HTTP 503 |
| 状态 | `GET /api/v1/status`，HTTP 200 返回各项真实状态/时间/耗时/安全错误摘要 |
| Worker | 内部 `:8103/health/live`，scope=process_only；与 API readiness 分开 |
| 文件 | `POST /api/v1/files` 原始二进制；`GET /api/v1/files/{id}` 元数据、`GET /api/v1/files/{id}/content`、`DELETE /api/v1/files/{id}` |
| 文件范围 | 1 MiB 骨架验证文件；不是后续模型/数据集上传限制 |
| 存储身份 | bucket `modelforge`；key `files/<UUID>`；UTC 时间；不依赖本地路径 |
| 文件状态 | pending / available / upload_failed / deleting / delete_failed；回读 SHA-256/大小成功后才 available |
| 错误 | `{error:{code,message,details?},request_id}`；422 validation_error、404 not_found、409 conflict、413 file_too_large、503 dependency_unavailable、500 internal_error |
| 请求 ID | `X-Request-ID` 为 `[A-Za-z0-9._-]`、长度 1–64 则透传；否则生成 `req_<UUID hex>`；错误体与响应头一致 |
| 超时 | DB pool 2s、连接/查询 2s；MinIO 连接/读取各 2s，不重试；Worker 2s |
| 页面 | 请求 7s 超时、每 5s 刷新且不重叠；断连保留上次结果但标为过期 |

MinIO 与 PostgreSQL 没有跨存储事务；失败保留不完整状态和清理入口。对象删除确认后才删除元数据；未校验或不完整记录不能下载。

## 开发检查

```powershell
cd frontend
npm ci
npm run build
npm audit signatures
cd ../backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -e '.[test]'
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m pip check
```

开发前端 `npm run dev` 仅监听回环 5176，`/api` 代理至 8102。容器目标 Python 3.13，本次宿主检查环境为 3.14；宿主测试通过不代表容器兼容性已验证。

完整CLI验收（仅本项目、执行过程中会启停依赖、最终停止服务）：`python scripts/acceptance.py`。自定义端口时传 `--api` 和 `--web`；原始输出写到 `.runtime/acceptance.jsonl`，UI故障截图仍需单独核对。
