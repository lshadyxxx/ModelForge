# 优云实例生命周期适配器实施记录（2026-11-01）

## 范围与当前状态

接续单 GPU PostgreSQL 租约内核，实现独立准备性规格 `<internal-evidence>`。产品 ticket04 仍未完成，ticket05/07 的依赖及开放状态不变。未增加 HTTP 写入口、Worker 调度、真实 Attempt/trial 关联或远程进程通道；未部署、创建收费实例或执行 GPU 任务。

`modules/resources/instances.py` 通过包入口公开 `InstanceLifecycle`、严格冻结的 `InstanceSpec`；参数、创建标签和清理请求/确认事实归资源模块及 PostgreSQL。`infrastructure/ucloud.py` 的 `UCloud.query` 保留只读 allowlist，独立 `UCloudInstances` 显式提供 create/stop/terminate。迁移0010接续0009，保存不可变参数并拒绝存在 held 适配器租约时降级。没有新增第三方依赖。

## 已实现契约

- 单GPU、单实例、单块新系统盘；不自动收编已有实例，不支持本增量中的数据盘或既有盘挂载。创建规格固定地域、可用区、GPU/CPU/内存/镜像/CPU平台/付费与系统盘参数；当前付费仅Month/Day/Postpay，Spot的默认手动停止限制与现有清理链不兼容，Dynamic不在Create文档支持范围。入口重新验证 Pydantic 构造或复制后的对象。
- 参数与标签先持久化，再查 fresh capacity；精确核对 Gpu=1、CPU 和容量 Mem(GB)×1024=创建 Memory(MB)。持久创建意图提交后才派发，并发重复调用至多一次。创建返回未知时保留占用，不自动重发创建。
- 未知创建使用完整有界分页扫描，标签为 mf-<reservation UUID hex>。唯一标签候选必须匹配规格、地域/可用区、镜像及不早于预留的创建时间。标签不是供应商幂等 token 或所有权证明；外部人工改名/克隆及分页非事务一致性仍是实际验收限制。
- 绑定实例按 UHostIds 精确查询；错误身份、规格、总数及异常字段阻止变更。旧内核 requested/bound 且无适配器记录的创建/清理请求，在任何写入前明确拒绝，原内核接口继续可用。
- 清理先核对远程进程退出与成功产物持久化策略。Running 仅发 Stop，响应不视为已停止；观察 Stopped 后才发 TerminateCompShareInstance，显式 ReleaseUDisk=false。
- 有效且匹配实例 ID 的终止响应须持久化；2026-11-02 实测 CompShare 容器实例成功响应只返回 `UHostId`，SDK v0.22.142 契约也未声明 `InRecycle`，因此后者允许缺失，存在时必须为 Yes/No。其后精确实例查询成功且 TotalCount=0/空列表，才能确认删除并释放匹配租约。超时后即使查询为空也继续占用。删除失败保留实例 ID、失败状态和显式同实例重试能力。
- 返回值/数据库不保存云端密码、SSH命令或原始响应；供应商错误脱敏。reconcile 对供应商只读。

## 契约与验证

2026-11-01 核对 CompShare 官方 Create/Capacity/Describe/Stop/Terminate 文档，原文保存在证据目录，研究入口 `<internal-evidence>`。Create 无幂等token；不接受其文档未列的 Dynamic。真实回收站行为、费用和实例一致性尚未验收。

测试使用专用 PostgreSQL 数据库与 MinIO bucket，HTTP 采用签名 httpx.MockTransport；实例/进程/产物确认均明确为 synthetic 输入。命令：`python -m alembic upgrade head`，再 `python -m pytest tests -q -p no:cacheprovider`，设置 `PYTHONPATH=/app/src`、`MF_TEST_LEASE_INTEGRATION=1`、`MF_TEST_INTEGRATION=1`、`MF_TEST_ISOLATED_STORES=1` 及唯一测试数据库/桶。

- 初始生命周期/旧租约/目录联合回归149通过；首次因新FK阻止旧fixture TRUNCATE失败，保留日志后以CASCADE修复。
- 初始全后端371 passed / 1 skipped；新增迁移保护测试单独通过。
- 独立初验29组：25通过、4失败，归并3根因。分别是缺少适配器记录时清理部分写入后崩溃、Pydantic可信构造绕过验证、旧实例静默收编。均先保留独立复现和红测试，再局部修复。
- 修复定向13通过，先前两项修复联合159通过。审查修复前完整后端383 passed / 1 skipped / 1既有warning。skip为Web-origin opt-in；warning为既有Starlette/httpx弃用提示，未升级依赖。
- 初始9项变异均有预期行为断言失败；QA修复3项及迁移保护另做定向变异。CRLF目标路径及多行选择器未命中的配置失败保留，修正后重跑；不将配置错误当作保护检出。

独立修复复验20组全部通过，原3根因已解除；564次非法规格调用无SQL/provider副作用，197个冻结文件hash及真实工作树前后快照均一致。原始初验失败报告保留。额外字段在可信构造/序列化中被规范化丢弃，未落库或派发，不声称extra-only一定返回错误。初轮三轴各确认1项P2：InRecycle永久回归缺口、Spot清理不支持、降级检查/删表竞态。同家族独立validator逐项确认；原57项测试下删除InRecycle检查仍GREEN，新增7项非法确认回归后相同变异全部失败。Spot与降级竞态先保留失败回归，再限制付费模式并于降级检查前加ACCESS EXCLUSIVE锁。修复后新独立复验9组必需检查及1组扩展诊断通过、0项当前失败；198个冻结文件hash及真实树前后快照一致。三轴host-only补审确认原3项P2已修复，无新增发现；审查前后可信快照完全一致。审查修复最终全后端393 passed / 1 skipped / 1既有warning（85.45秒），67项永久生命周期测试；初始371与修复前383保留为历史结果。补审者和validator均为OpenAI同家族，不代表跨家族审查。原始证据路径：`<home>/AppData/Local/Temp/modelforge-lifecycle-20261101-8b666020`；ignored指针 `.runtime/lifecycle-evidence-path.txt`。保留失败日志、官方原文、冻结源码manifest、独立场景与报告、变异及最终回归。

## 最终收尾与边界

- 本轮3个专用runner、3个测试数据库及1个MinIO测试桶已清理，并二次确认不存在；额外review数据库此前已删除，本次再次核对不存在。固定名称和原始清理输出见证据目录cleanup-final.json、cleanup-test-stores-final.txt。常驻业务库、桶和服务未重建或迁移。
- 实际降级并发扩展诊断出现PostgreSQL DeadlockDetected/40P01，云请求为0、无新增intent、原租约仍not_requested；回滚后显式重试一次成功。它是降级与业务创建并行时的操作协调关注点，不是活跃实例快照丢失。首次future.done错误oracle、之后optional探查的setup PoolTimeout及成功重跑均保留；不把异常完成当成创建成功。在线降级无中断、真实生产迁移协调仍未验收。
- 独立准备票01按限定验收关闭；产品04/05/07均保持开放，05的04依赖未解除。所有实际云/GPU、供应商一致性/回收费用、HTTP/Worker、远程进程和文件同步及安全浏览器验收缺口保留。
- 本地HEAD与staged未变；仅本轮规定的5个tracked文档和10个untracked源码/规格路径相对开始改变。运行时代码与最终393测试、冻结验收源码hash一致；最终差异、凭据精确值扫描及常驻健康审计见final-closeout-audit.json。不提交、不push、不部署。

## 未完成与下一步

常驻API/Worker仍使用external-base-fixed-20261031版本，业务库保持0008；0009/0010仅应用于独立测试库。HTTP健康不构成实例、训练或页面验收。浏览器隔离尚未证明，继续保留ticket04的页面验收缺口。

后续先完成远程执行/文件通道的具体契约与恢复/退出证明方案，再接真实Attempt、Worker与本适配器。实际单GPU规格、镜像、模型挂载和费用选择后，才能开展受控云实例、SFT/LoRA、Best/Final回传及独立vLLM推理闭环。产品04/05/07保持开放。
