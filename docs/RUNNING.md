# 本地运行与第一阶段验收

当前运行包括 ticket 01 基础骨架、数据集后端及模型目录上传后端。完整 Compose、真实存储与故障恢复结果见[基础骨架验收](implementation/full-compose-2026-10-29.md)，模型能力边界见[模型实施记录](implementation/models-2026-10-30.md)。`designs/` 保留完整演示，`frontend/` 目前只开放实际实现的工作台；数据集/模型管理 UI 尚未接通。

## 启停

需要 Docker Desktop（Linux containers）、Compose v2+ 和 PowerShell 5.1+ / 7。首次构建需要获取 Docker 基础镜像、PyPI、npm 和 Go modules。网络受限时见下方构建说明。从项目根目录运行：

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

开发前端 `npm run dev` 仅监听回环 5176，`/api` 代理至 8102。容器目标 Python 3.13，本次宿主检查环境为 3.14。完整 Compose 复验已实际运行 Linux Python 3.13.18；宿主和容器检查分别保留记录。

完整CLI验收包含 PostgreSQL 持续断开至少 40 秒并持续轮询，恢复后在原 API 容器核对状态与实际文件读写；不能通过重启 API 绕过恢复缺陷。仅本项目、执行过程中会启停依赖、最终停止服务：`python scripts/acceptance.py`。自定义端口时传 `--api` 和 `--web`；原始输出写到 `.runtime/acceptance.jsonl`，UI故障截图仍需单独核对。

## 构建网络受限时

本次 Docker Hub 不可达时，从 AWS ECR Public 的 Docker Official Images 命名空间取得同名基础镜像并本地重标记，没有改 Docker 全局配置。可在项目根目录按需执行；每步失败应停止：

```powershell
$baseImages = @('python:3.13-slim', 'node:22-slim', 'golang:1', 'debian:bookworm-slim', 'nginx:stable-alpine', 'postgres:17')
foreach ($image in $baseImages) {
    docker pull "public.ecr.aws/docker/library/$image"
    if ($LASTEXITCODE -ne 0) { throw "Base image pull failed: $image" }
    docker tag "public.ecr.aws/docker/library/$image" $image
    if ($LASTEXITCODE -ne 0) { throw "Base image tag failed: $image" }
}
$env:MF_GOPROXY = 'https://goproxy.cn,direct'
try { ./scripts/start.ps1 } finally { Remove-Item Env:MF_GOPROXY }
```

`MF_GOPROXY` 只传给 MinIO 构建；未设置时仍使用 `https://proxy.golang.org,direct`。Go checksum database 保持启用。镜像标签会变化，本次实际 digest、工具版本和构建输出保存在 `.runtime/full-compose-20261029/`。重新构建时应重新记录，旧记录不能证明新镜像身份。

MinIO 由已选官方 release 的 Go module 构建；`go install` 产物的版本字符串为 `DEVELOPMENT.GOGET`，不能用它确认 release。应读取二进制的 Go module build information 并对照本次构建记录。

## 数据集生命周期验收

ticket 02 的真实验收脚本需要 API、Worker、PostgreSQL 和 MinIO 已经由 Compose 启动：

```powershell
backend\.venv\Scripts\python.exe -m pytest -q backend/tests
backend\.venv\Scripts\python.exe scripts/acceptance-datasets.py
```

脚本会上传有效和无效 messages JSONL，直接核对 PostgreSQL DatasetVersion 元数据，使用 API 容器内客户端回读 MinIO 原始对象和 split manifest，验证 10%/seed 42 拆分、发布、下载 checksum、无效版本清理、引用保护及最终删除。它通过真实读写和内容摘要判断结果，端口开放、健康状态或模拟数据不能替代这些步骤。详细结果见[数据集实施记录](implementation/datasets-2026-10-29.md)。

数据集 API 入口：

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/api/v1/datasets?name=...` | 创建数据集及首个版本，上传 messages JSONL |
| `GET` | `/api/v1/datasets/limits` | 查看服务端容量限制、配置版本和是否已锁定 |
| `POST` | `/api/v1/datasets/{dataset_id}/versions` | 为已有数据集创建新版本 |
| `GET` | `/api/v1/datasets` | 列出数据集版本 |
| `GET` | `/api/v1/dataset-versions/{version_id}` | 查看校验、预览、拆分和引用状态 |
| `GET` | `/api/v1/dataset-versions/{version_id}/content` | 下载并核对原始文件 |
| `POST` | `/api/v1/dataset-versions/{version_id}/split` | 创建或复用确定性验证集拆分 |
| `POST` | `/api/v1/dataset-versions/{version_id}/publish` | 发布有效不可变版本 |
| `DELETE` | `/api/v1/dataset-versions/{version_id}` | 删除未引用版本及其对象 |

数据集容量初始值由后端环境配置提供：100 MiB 单文件、100000 个有效样本、1 MiB 单物理行、最多 100 个校验错误和 20 个预览样本。这些限制用于首版实现，尚未替代后续真实传输性能验证。

## 模型目录上传验收

已有 Compose 服务启动后运行：

```powershell
backend/.venv/Scripts/python.exe scripts/acceptance-models.py
```

脚本使用 fixture 字节验证传输与登记，执行真实 HTTP 中断、文件级恢复、MinIO 回读、PostgreSQL 核对、API 重启、行锁冲突和引用删除保护；最后清理本次数据，输出证据的 OS 临时目录。可以用 `--output-dir <目录>` 指定证据位置。脚本默认工作台端口 8092；自定义端口时需先调整脚本。不会租卡或加载真实模型。

模型目录 API：先 `POST /api/v1/models/directory-imports` 提交 `{name,model_id?,files:[{path,size_bytes,sha256}]}`；随后对 `/api/v1/model-versions/{id}/files?path=...` 按文件 PUT 原始字节，再 POST `/complete`。POST `/resume` 提交原 files 清单，返回 reusable_paths/upload_paths；POST `/cancel` 可取消待上传版本。GET 版本或 `/api/v1/models` 查询，DELETE 未引用版本。文件改变时新建版本。

`GET /api/v1/models/limits` 返回初始限制及未锁定状态。初始为 20 GiB/文件、100 GiB/目录、10000 文件；临时文件位于容器可重建目录。存储检查全部通过的 available 仍为兼容性未验证。忙碌写操作返回 `409 model_busy`，表示未接受；稍后重试。取消不强行打断已经执行中的文件存储操作。公开仓库下载、优云外部引用及模型加载验收另行实现。
