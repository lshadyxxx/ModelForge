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

## 2026-10-30 收尾复验

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

## 未完成与下一步

真实 CDN 大权重完整下载、整模型导入和加载、容量测量与限额锁定、默认分支解析、优云公共基座外部引用、MinIO 到优云实例传输、业务模型 UI 和真实训练/推理均未验收。Hugging Face 暂缓。ticket 03 保持开放。

后续先补模型导入真实大文件证据及用户操作入口，再按票据接入优云目录和远程传输；优云支持通过 SSH/SFTP 上传自有模型不等于 ModelForge 已实现这一训练闭环。
