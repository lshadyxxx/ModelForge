# ModelScope 后台导入增量

日期：2026-10-30；基准 `e80fef0`；关联 [ticket 03](../../<internal-evidence>)。用户要求先实现 ModelScope，Hugging Face 暂缓。本记录区分功能实现、受控 HTTP fixture、真实存储和真实模型验证。

## 已实现契约

- `POST /api/v1/models/modelscope-imports` 接受 `{name,repository,revision,model_id?}`。repository 为 `owner/model`，revision 必须是完整 40 位小写十六进制 commit。默认分支和可变 tag 自动解析尚未完成。
- API 匿名读取清单，检查返回结构、路径、SHA-256、数量和容量后，把完整来源快照与文件清单一次写入 PostgreSQL。清单达到 3000 项拒绝为 `manifest_incomplete`，避免已知上游静默截断。
- 独立 Worker 持久领取，按固定快照逐文件下载，磁盘仅作临时缓冲；计算大小/SHA-256，写 MinIO 后完整回读。完整目录和所需文件全部通过才 `available`，兼容性仍为 `unverified`。
- GET 版本返回 `import.state`、当前文件/字节、错误码、执行计数和固定来源。`verified_bytes` 只统计已完整回读核对的文件；当前文件下载量另列。
- POST `/model-versions/{id}/cancel` 区分请求取消与 Worker 确认停止；POST `/retry-import` 复用原快照和已验证文件，丢失或损坏对象重新下载。直接上传/完成接口不能覆盖公开导入。
- 单 importer 使用 PostgreSQL session advisory lock；领取、进度、文件发布和结算核对 attempt 代次。失效执行器不能覆盖替代执行器状态。
- 每次公开导入写入唯一对象 key，传输账本在版本删除后仍保留。迟到写入只能影响自己的对象，完成后独立清理；不能删除另一代次已发布文件。
- 删除版本时若仍有尚未结束的写入，返回 `202` 与 `storage_cleanup=pending`；`GET /model-versions/{id}/storage-cleanup` 查询实际清理状态。Worker 未确认写入结束时保持 pending，不能将元数据 GET 404 当作存储清理完成。写入进程永久消失且没有完成回执时，账本可能持续 pending，须在确认原写入进程已停止后处置，不能仅凭数据库会话消失宣称结束。
- 下载仅允许 HTTPS 的 `modelscope.cn` 和已核实的 `cdn-lfs-cn-1.modelscope.cn`，逐跳核对、限制跳数；不持久化临时签名 URL，不执行仓库代码。

## 验证状态

- 已观察真实 ModelScope 固定 commit 的 11 项清单，726 字节 `config.json` 下载、MinIO 写入/回读，SHA-256 为 `660db3b73d788119c04535e48cf9be5f55bc3100841a718637ae695b442f27dd`，与远端清单一致；验证对象已删除。首次容器 DNS 失败，后续解析恢复并成功，故障未冒充成功。
- 初轮真实 PostgreSQL/MinIO、受控外部 HTTP 的 10 项集成测试通过，包含失败重试、已验证文件复用、取消、代次接管、迟到写入、缺失对象重传、HTTP 契约及删除；最终收尾已扩展为下方 13 项。权重是 fixture 字节。
- 独立 QA 已复现并推动修复旧代次结算污染、上游数值 Path 导致 500、迟到 put 删除竞态。`0007` 迟到写入及邻接代次场景已独立复验通过；最终增量三轴审查见下方收尾状态，不将旧记录冒充最终代码验收。

## 2026-10-30 初轮收尾复验（历史）

固定基准 `e80fef01bcf4085bb3b548616fcf0590a6b23b80`，范围包含已有未提交 ModelScope 增量。先复现取消测试失败，再取消 HTTPX 的 1 MiB 聚合，让已收到的数据块及时触发取消检查；尚未收到数据时仍受 HTTP read timeout 约束，不承诺瞬时停止阻塞中的读请求。

独立 QA 和 opt-in 集成测试另发现并复现两个缺陷：损坏文件重传替换 key 后旧对象未进入清理账本；单个清理失败会阻塞无关导入。现已在发布事务中将被替代的旧 key 标记 cleanup，并逐对象保留清理失败、继续其他清理及导入；清理状态仍为 pending，日志不含 URL/凭据。

- 宿主最终全量 `backend/tests tests` 为 `104 passed, 13 skipped, 1 warning`；13 项跳过的是 opt-in 真实存储测试，另在最终镜像的隔离数据库/bucket 全部通过；镜像内后端全量 `110 passed, 1 warning`。宿主另有 3 项轮询和 4 项集成测试入口安全测试，不能把两个测试总数当同一套用例。既有 Starlette/httpx 弃用警告保留。
- 原取消测试、旧对象残留测试和清理阻塞均有 red/green；内存变异重新引入这三项缺陷后分别命中实际行为断言，不修改真实源码。
- 独立 QA 通过真实 localhost socket 观察首个 1 KiB 后、EOF 前取消；公开 API 暴露 current_bytes、请求取消、拒绝活动删除，再确认 Worker 停止、按同一 commit 重试、复用 config 和 MinIO 回读。
- 旧对象替换清理、自然产生的清理故障及恢复、旧执行器/迟到 put 隔离、删除 202/pending 到 complete 均在真实 PostgreSQL/MinIO 独立复验通过。HTTP 源映射到受控 socket，不代表真实 CDN。
- QA 仓库 snapshot 前后一致；原始报告和输出保存在 OS 临时目录 `modelforge-ms-closeout-20261030-e0c7/`，包括 `qa/report.md`、red/green、mutation 和集成输出，不提交原始 QA 材料。

三轴审查另发现两个 P2：默认集成命令可能在应用库领取真实任务；最老 20 条清理持续失败会饿死后续可删除对象。两项经同家族独立 validator 确认。现已在测试收集阶段要求显式隔离确认及专用库/桶命名，默认/混合配置在 Resources.open 前拒绝；失败清理以 clock_timestamp 轮转，保持 pending 且不覆盖其他状态。新增 21 条自然失败回归先红后绿；最终镜像独立 QA 观察第 21 条在第 2 轮清理完成，入口门禁 3 拒绝/1 接受且 Resources.open 调用均为 0。

最终 Standards、Spec、Adversarial 三个独立 OpenAI 宿主轴补审均零遗留发现，结论 Ready（仅当前授权增量）；`external peer disabled by docs/agents/cross-model.json`，无跨模型家族审查。QA 结论保持 Passes with gaps，实际 OS Worker 崩溃中的恢复、真实 CDN/整模型、GPU 和 UI 仍未覆盖。审查和 QA 前后 trusted snapshot 逐字节一致；最终值 `c36c703b1dbc6e65c9f861927344e6402e902e78605a3912e09bda3a67fbaf41`。后续仅补文档，不再改运行时代码。

最终镜像为 `sha256:a6be5a8f3be020de205c1b33e877c704cbf12f4e55ddd6da458c41c1ca7a8dfb`。先正常 Dockerfile 构建，最后使用已构建依赖镜像及一次性源码覆盖 Dockerfile（OS 临时目录）复制最终包/测试，未更改依赖或仓库 Dockerfile；覆盖构建与基镜像身份已记录，不伪装成最后一版全部通过原 Dockerfile 重新下载构建。常驻 API/Worker 均使用此镜像，26 个已安装包源码文件与工作树 SHA-256 一致，`pip check` 通过，Alembic 为 `0007_model_transfer_cleanup`。

在确认没有活动 ModelScope 导入后重建本地 API/Worker。最终常驻数据集验收 run_id=`20261030T114241Z`、目录上传验收 run_id=`20261030T114250Z` 均通过；后者包含真实 API 重启、socket 上传中断、行锁冲突、MinIO/元数据与删除核对，仍为 fixture 权重。ego-browser 工作台同源页面已打开、状态正常；未把页面健康当业务 UI 验收。项目服务按进入本轮时状态保留运行。

隔离验收数据库及两只本轮创建的 bucket 在零活动连接、对象为空后已删除；正式库/桶未清空，无一次性容器遗留。证据在上述临时目录的 `image-final-all.txt`、`resident-*-acceptance*`、`qa-followup/report.md`、三轴 followup report、source SHA-256 和 teardown 输出。ticket 03 保持开放，不将本增量通过升级为整票或 MVP 完成。

## 2026-10-30 真实整模型存储收尾

本增量基准 `8142f5e`，包含其后已有未提交的传输超时修复、观察器及测试；本次继续执行时没有再改运行时代码或依赖。当前常驻 API/Worker 镜像均为 `sha256:f75ff83bd50630ee084dfff94b5c6d11b7c1cb99fcd14f218231d5493602ed90`，独立 QA 核对每个服务的 26 个已安装 Python 源码文件与当前工作树一致。镜像来自先前大文件修复轮次，本次没有重新构建或把旧镜像声称为新构建。

### 修复与失败记录

- 原 MinIO 客户端 2 秒读取超时不足以等待真实大对象的分片完成响应。已用实际 1,503,300,328 字节临时对象复现旧配置失败，长预算下完整上传、回读、删除核验通过；临时零字节流只作为存储机制证据，不作为真实模型。
- 传输预算由 `MF_MINIO_READ_TIMEOUT` 配置，默认 120 秒，仅接受有限且大于 0、不超过 600 的值；连接超时仍为 2 秒且不自动重试。这是读取无活动超时，不承诺整个传输在该时长内结束。健康检查使用独立客户端及原 `probe_timeout`（默认 2 秒），检查后清理自己的连接池。
- 新增 `scripts/acceptance-modelscope.py` 只读观察既有导入，不创建、重试、取消或删除模型；核对固定来源、完整 manifest、最新成功状态，再独立查询 PostgreSQL、逐对象流式计算 MinIO 大小/SHA-256。非空证据目录拒绝运行，HTTP 502/503/504 在期限内重新读取，身份或摘要不一致失败退出。
- 先前 attempts 1–4 的失败保留：旧传输超时及上游下载故障不改写为通过。attempt 4 已写入真实权重，随后文件下载失败，原有 9 个文件已验证、两个 tokenizer 文件仍 pending。

### 实际成功与重启核验

2026-10-30 23:12（Asia/Shanghai）通过公开 API 重试同一版本 `51f7b869-9894-424b-bc5d-dba013723ddb`，仓库 `Qwen/Qwen3-0.6B`、commit `09b42cad3d112e832108974449ccb5e8e0f5b5d1` 不变。attempt 5 补齐 `tokenizer.json` 与 `vocab.json`，11 个文件共 **1,519,209,873 字节**达到 `available` / `import.state=succeeded`。原有 9 个已验证文件的 object key 和 SHA-256 均保留，其中真实 `model.safetensors` 为 1,503,300,328 字节、SHA-256 `f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b`。

主任务首次全量独立存储观察器通过，随后确认无活动导入，仅重启 API/Worker；重新查询 PostgreSQL 并逐对象回读全部 11 个 MinIO 文件通过，manifest、来源、对象身份、字节数和摘要不变。本批没有重启 PostgreSQL/MinIO 容器，不将此前骨架容器重建证据冒充本次整模型持久化验收。

新独立宿主 QA 再次运行完整观察器，核对全部 11 个实际对象与数据库，确认来源、9 个文件复用及重启后全部对象身份不变。其首次探针恰遇邻接目录回归的 API 重启，失败退出且未生成成功报告；新建证据目录后重新执行全量核验通过，保留中断证据，不声称首次即通过。独立观察器测试 24 项通过，另完成 21 项只读 API/CLI 检查；其前后可信源码快照一致。整体票据 QA 保持 **Passes with gaps**，当前授权的整模型存储/复用/重启收尾场景通过。

### 回归、服务与证据

- 当前宿主 `backend/tests tests`：**135 passed, 13 skipped, 1 warning**；跳过项为 opt-in 真实存储测试，不计作通过。
- 同版常驻镜像后端全量在新建隔离 PostgreSQL 数据库和 MinIO bucket 中：**117 passed, 1 warning**，包含全部 13 项真实存储集成；它与宿主根目录脚本测试不是同一测试集合，不能相加或混报。隔离初始化因管理会话沿用应用 2 秒 statement_timeout 首次失败；核对数据库未创建后，仅临时管理连接设为 60 秒并重新创建成功，没有改应用配置。测试后核对 bucket 为空、数据库无活动连接，删除本次隔离资源；应用库/桶未清空。
- 常驻数据集验收 run_id=`20261030T151553Z`、目录上传验收 run_id=`20261030T151602Z` 通过；后者使用 fixture 字节，包含实际中断/恢复、行锁冲突、API 重启和引用删除，不将其当作真实模型加载证据。
- ego-browser 已打开同源工作台，API/PostgreSQL/MinIO/Worker 显示正常；业务入口仍为后续接入。页面健康不算模型 UI 或训练/推理验收。
- 原始证据留在 OS 临时目录 `modelforge-ms-complete-20261030-2312/`：`attempt5/`、`after-restart/`、`restart-and-reuse.json`、`current-tests.txt`、`isolated-image-tests.txt`、`isolated-cleanup.txt`、`independent-qa/report.md` 及 `independent-qa/full-observer-retry/store-readback.json`。先前修复的 red/green、三轴审查及真实权重回读记录仍保留在 `modelforge-modelscope-live-391d51a5/`。原始 QA 材料不提交仓库。

## 未完成与下一步

本次只证明固定 commit 的真实整模型文件已完整存储、复用及应用重启后可核验。`compatibility_state=unverified`：尚未加载模型或 tokenizer；默认分支解析、容量测量与限额锁定、优云公共基座外部引用、MinIO 到优云实例传输、业务模型 UI 和真实训练/推理仍未完成。运行中实际 OS Worker 崩溃恢复也未覆盖。Hugging Face 暂缓，ticket 03 保持开放，产品 MVP 未完成。

后续按票据补默认 revision/外部基座契约和用户操作入口，再接优云目录、兼容性及远程传输。优云支持 SSH/SFTP 上传自有模型不等于 ModelForge 已实现该训练闭环；当前整模型存储成功也不等于容量初始上限全部实测通过。
