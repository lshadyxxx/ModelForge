# 本地运行与第一阶段验收

当前开放工作台、数据集、模型管理、计算环境、训练和独立试用入口。数据集/模型页面调用实际 API；优云凭据由后端环境注入，未配置时显示明确提示，不提供演示目录。真实 Qwen3-0.6B SFT/LoRA、Best/Final、独立 vLLM Adapter 生成、多轮 SSE、取消、Worker 重启、断流恢复、十五分钟空闲回收和页面手动结束均已通过；所有训练/推理实例均已停止、删除并核对租约释放。首页工作台已在提交 `b8987dd` 中改为真实资产、GPU、最近训练、Loss、下一步动作和最近活动视图，并通过桌面及 390px 隔离浏览器验收。版本化兼容基线已绑定模型/Adapter 指纹、完整训练与推理实例规格和数值容量；容量边界及训练 GPU 峰值仍未实测，基线保持 `partial`。完整兼容矩阵仍开放，见[运行时兼容记录](implementation/runtime-compatibility-2026-11-02.md)。真实存储与基础设施结果见[基础骨架验收](implementation/full-compose-2026-10-29.md)，历史增量见[连续记录](implementation/progress-2026-10-31.md)和[优云目录](implementation/ucloud-catalog-2026-10-31.md)。

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
npm test
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

## 运行兼容基线

`GET /api/v1/runtime/baseline` 返回当前版本化基线、运行时 lock、完整实例规格、锁定训练预设、推理会话边界、数值容量和开放缺口，并带 `Cache-Control: no-store`。基线加载时会与当前 runtime lock 文件和运行时容量设置逐项核对；任何数值、配置版本或 lock 漂移都会使服务拒绝返回兼容契约。

训练或推理提交与基线不匹配时返回 `422`，稳定错误码为 `runtime_model_unsupported`、`runtime_model_version_unsupported`、`runtime_parameters_unsupported`、`runtime_hardware_unsupported` 或 `runtime_baseline_changed`。`details.mismatches` 同时给出字段、expected 和 actual。服务健康只说明进程与依赖可用，不能替代这些提交门禁。

```powershell
backend\.venv\Scripts\python.exe scripts\acceptance-runtime-baseline.py --api http://127.0.0.1:8102
backend\.venv\Scripts\python.exe scripts\acceptance-runtime-baseline.py --api http://127.0.0.1:8102 --require-complete
```

默认模式允许 `partial`，但要求训练峰值和容量边界缺口显式声明；`--require-complete` 只用于票据最终关闭前，还要求峰值与容量证据已实测并锁定。

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

数据集容量初始值由后端环境配置和兼容基线共同锁定：100 MiB 单文件、100000 个有效样本、1 MiB 单物理行、最多 100 个校验错误和 20 个预览样本。基线中的真实观测不得大于声明上限；当前 `locked=false`，尚未替代后续真实传输性能验证。

## 模型目录上传验收

已有 Compose 服务启动后运行：

```powershell
backend/.venv/Scripts/python.exe scripts/acceptance-models.py
```

脚本使用 fixture 字节验证传输与登记，执行真实 HTTP 中断、文件级恢复、MinIO 回读、PostgreSQL 核对、API 重启、行锁冲突和引用删除保护；最后清理本次数据，输出证据的 OS 临时目录。可以用 `--output-dir <目录>` 指定证据位置。脚本默认工作台端口 8092；自定义端口时需先调整脚本。不会租卡或加载真实模型。

模型目录 API：先 `POST /api/v1/models/directory-imports` 提交 `{name,model_id?,files:[{path,size_bytes,sha256}]}`；随后对 `/api/v1/model-versions/{id}/files?path=...` 按文件 PUT 原始字节，再 POST `/complete`。POST `/resume` 提交原 files 清单，返回 reusable_paths/upload_paths；POST `/cancel` 可取消待上传版本。GET 版本或 `/api/v1/models` 查询，DELETE 未引用版本。文件改变时新建版本。

`GET /api/v1/models/limits` 返回初始限制及未锁定状态。初始为 20 GiB/文件、100 GiB/目录、10000 文件；这些数值同时写入兼容基线，环境配置漂移会使 `/runtime/baseline` fail closed。临时文件位于容器可重建目录。存储检查全部通过的 available 仍为兼容性未验证。忙碌写操作返回 `409 model_busy`，表示未接受；稍后重试。取消不强行打断已经执行中的文件存储操作。优云公共 Qwen3-0.6B 已在真实实例上按固定指纹完成训练和独立 vLLM 加载；更广泛的兼容性仍需逐项验证。

## ModelScope 后台导入

API 与 Worker 必须运行同版源码，先执行迁移任务；Hugging Face 暂缓。请求示例中的 commit 仅用于已核实的公开清单，不是建议自动下载该模型或费用承诺：

```json
{"name":"Qwen3-0.6B","repository":"Qwen/Qwen3-0.6B","revision":"09b42cad3d112e832108974449ccb5e8e0f5b5d1"}
```

将 JSON POST 到 `/api/v1/models/modelscope-imports` 后，API 固化清单，Worker 逐文件执行。revision 当前必须是完整 commit，空值或 `master` 被拒绝；达到上游 3000 项清单边界明确拒绝，不静默导入部分文件。

GET `/api/v1/model-versions/{id}` 查看 `import.state`、当前文件字节和已校验文件总量。POST `/cancel` 请求取消，POST `/retry-import` 恢复失败/取消的同一快照。Worker 重启可重新领取未完成导入；下载文件重新从头传输，已验证文件经 MinIO 回读后复用。

DELETE 仍受活动导入及引用保护；取消后 Worker 确认停止才可删除。若有失效执行器的写入尚未结束，DELETE 返回 `202` 和 `storage_cleanup=pending`；GET `/api/v1/model-versions/{id}/storage-cleanup` 独立跟踪清理。版本 GET 404 不代表文件清理完成。已结束写入的清理由 Worker 重试；进程永久消失且未确认的 writing 账本保持 pending，不能仅以 PostgreSQL 会话断开判定写入结束。

真实 PostgreSQL/MinIO 集成测试必须使用独立的一次性数据库和 bucket；仅停止其他 Worker 不能保护数据库里已有的任务。测试会全局领取导入，禁止对应用默认库/桶运行。以下示例先创建唯一测试数据库，初始化隔离存储后运行；不要把任何正式 Worker 指向这些测试目标：

```powershell
$id = [guid]::NewGuid().ToString('N')
$db = "modelforge_test_$id"
$bucket = "modelforge-test-$id"
docker compose exec -T postgres sh -c 'exec createdb -U "$POSTGRES_USER" "$1"' sh $db
if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed; do not reuse an existing database' }
docker compose run --rm --no-deps -e "MF_PG_DATABASE=$db" -e "MF_MINIO_BUCKET=$bucket" migrate
if ($LASTEXITCODE -ne 0) { throw 'Test migration failed; retain test identities for cleanup' }
docker compose run --rm --no-deps -e "MF_PG_DATABASE=$db" -e "MF_MINIO_BUCKET=$bucket" -e MF_TEST_INTEGRATION=1 -e MF_TEST_ISOLATED_STORES=1 api python -m pytest tests/test_model_imports.py -q -p no:cacheprovider
# Record the test exit code before cleanup; cleanup success must not hide a failed test.
$testExit = $LASTEXITCODE
```

测试在收集阶段拒绝缺少隔离确认或命名不符合 `modelforge_test_*` / `modelforge-test-*` 的目标。该门禁不创建隔离资源，也不证明任意同名前缀资源可安全删除；只清理由本次成功创建的唯一 ID 对应的资源。测试后通过 MinIO 客户端列举并确认该测试 bucket 无待保留数据，再删除其对象和 bucket；使用 PostgreSQL `dropdb` 删除本次 `$db`。失败/中断时保留这两个身份和原始输出，不对应用默认库/桶或未知来源目标自动清理。

集成测试用受控仓库 HTTP fixture；真实 ModelScope 小文件、整模型下载和 GPU 验证分别报告，见[实施记录](implementation/modelscope-2026-10-30.md)。

### 既有真实导入的只读验收

先通过公开 API 创建或重试所需的真实 ModelScope 导入，再对其固定来源运行观察器（将占位值替换为实际身份）：

```powershell
backend/.venv/Scripts/python.exe scripts/acceptance-modelscope.py --version-id <version-uuid> --repository <owner/model> --revision <40-character-lowercase-commit>
```

观察器不创建、重试、取消或删除模型，也不加载仓库代码。它仅接受新取得的完整 `available/succeeded` 版本，随后通过 API 容器独立查询 PostgreSQL，并逐对象流式回读全部 MinIO 文件大小/SHA-256，再次读取 API 确认来源未变。需本地 Docker Compose 及默认同源端口 8092；自定义端口尚无命令行选项，不可把脚本误指其他服务。默认等待 7200 秒，`--timeout-seconds` / `--poll-seconds` 调整状态轮询；完成后的独立存储探针另有 1800 秒上限，轮询期限不是全脚本总时长上限。

证据默认写入新的 OS 临时目录；`--output-dir <目录>` 必须为空，避免沿用旧成功报告。HTTP 502/503/504 可在轮询期内重试；存储探针中断或校验失败会失败退出，不发布成功报告，重新运行时使用新目录。

`MF_MINIO_READ_TIMEOUT` 默认 120 秒，取值须有限且大于 0、不超过 600，控制传输与分片完成响应的读取无活动预算；不是整个文件传输的截止时间。连接超时仍为 2 秒，健康检查使用独立客户端和短 `probe_timeout`，不继承长传输预算。

2026-10-30 Qwen3-0.6B 已完成 11 文件、1,519,209,873 字节的真实整模型存储、原有文件复用和 API/Worker 重启后核验。该状态只表示正式文件可用，`compatibility_state=unverified`；不能据此宣称模型可加载、训练/GPU 或业务 UI 已完成。

## 优云只读目录

在被 Git 忽略的 `.env` 配置 `MF_UCLOUD_PUBLIC_KEY`、`MF_UCLOUD_PRIVATE_KEY`；可选 `MF_UCLOUD_REGION`、`MF_UCLOUD_PROJECT_ID`、`MF_UCLOUD_TIMEOUT`（默认 20 秒，最大 60 秒）。网关配置 `MF_UCLOUD_API_URL` 仅接受官方 HTTPS `https://api.compshare.cn`。不要在前端代码或浏览器输入凭据。保存配置后按现有启动脚本重建应用容器；单纯 restart 不重新加载 env_file。

进入“计算环境”，先刷新地域/可用区，再查 GPU 规格、平台镜像及公共模型；库存查询必须选定可用区、单卡型号、镜像、CPU 自动平台、计费模式和规格目录支持的系统盘。库存只反映查询时刻，不保留资源。目录可见不代表训练/推理已兼容。

接口前缀 `/api/v1/resources/ucloud`：`GET /configuration` 仅返回配置布尔值/默认地域/只读模式；`GET /zones`、`/specs`、`/images`、`/models`、`/instances`、`/monitor` 以及 `POST /capacity` 均为只读查询。镜像按单一类型分页：API 和页面默认 `System`，可选 `App`，不提供跨类型混合分页；供应商会对每类分别应用 offset/limit。实例支持 offset/limit，公共模型按名称/标签筛选；实例响应移除密码、登录命令等敏感字段。本轮不提供创建、启动、停止或删除云实例接口。

`cloud_not_configured`、`cloud_credentials_rejected`、`cloud_credentials_expired`、`cloud_permission_denied`、`cloud_unavailable`、`cloud_timeout`、`cloud_rate_limited`、`cloud_invalid_response`、`cloud_out_of_stock`、`cloud_incompatible` 分别说明配置、鉴权、权限、连接、协议或库存问题。供应商未说明原因时返回 `cloud_api_error`，不推测凭据过期；供应商原始错误正文不返回浏览器。成功响应包含 fetched_at、filters、total、state 和 compatibility=unverified。无后台静默重试，用户可显式刷新。

浏览器验收不得置前窗口、调整窗口、使用桌面坐标或全局输入。后台驱动无法完成的文件选择/页面验收保留缺口，继续 HTTP 与测试。


## 优云外部只读基座

进入模型页，读取地域并选择公共目录条目后登记。API 会再次查询目录；登记为待实例核对，不复制权重到 MinIO。`POST /api/v1/models/external-bases` 接受 name/region/path；详情可查看来源、空或已固定的指纹和最近核对状态。删除只移除未引用的平台登记。

完整文件探针可在明确的本地 fixture 上用 `python -m modelforge.infrastructure.model_probe <directory>` 执行；不要把此命令运行在未知大目录，也不要把其输出手动提交给浏览器作为核对证明。实际公共挂载和服务器远程核对通道尚未接通，页面没有伪造成功的“验证”按钮。扫描上限、固化/漂移/重试契约和证据见[实施记录](implementation/external-bases-2026-10-31.md)。

## 手动 GPU 实例与 SSH

平台不会自动创建收费实例。训练或独立推理提交前会弹出确认窗口，展示固定的单GPU规格并说明平台只保存要求、不购买或预留资源；确认后任务才进入“等待手动创建实例”。请按页面规格在优云控制台手动创建，确认 Running 后关联实例ID并明确授权停止/删除。训练和独立试用使用不同实例身份。

后端只读挂载 `.runtime/ssh` 到 `/run/modelforge/ssh`。在被Git忽略的 `.runtime/ssh/endpoints.json` 按实例ID配置：

```json
{
  "human-instance-id": {
    "host": "verified-host.example", "port": 22, "user": "root",
    "private_key": "/run/modelforge/ssh/instance_key",
    "known_hosts": "/run/modelforge/ssh/known_hosts",
    "root": "/var/tmp/modelforge", "python": "/opt/modelforge-venv/bin/python"
  }
}
```

`known_hosts` 必须经可信渠道核实主机指纹。私钥及指纹只放本地后端配置；不要放前端、聊天、SQL快照或Git。容器用户10001必须能读取私钥，私钥权限须满足OpenSSH要求。未配置或指纹不符时任务保留实例，不将断线当作退出。

在人工实例上运行 `bash prepare-gpu-runtime.sh train` 或 `serve`（脚本见仓库scripts目录）。脚本要求Python >=3.11，并会依次检查`MODELFORGE_PYTHON`、`python3.13`、`python3.12`、`python3.11`、`python3`和镜像常见的Miniconda路径；镜像中的旧`python3`不能满足LLaMA-Factory 0.9.5时应显式设置`MODELFORGE_PYTHON`。安装与平台协议对应的固定候选运行时，再实际核对CUDA、依赖与单GPU。训练与推理分属独立实例。安装成功和`pip check`不替代真实模型兼容验收。远程实例不注入云AccessKey或平台数据库/MinIO凭据。

失败/取消已确认退出后，诊断回传失败会显示日志缺口并继续回收；成功输出未校验入库时继续保留实例。未知远程进程或云状态必须核对，不强行释放。
