# GPU 租约内核实施记录（2026-11-01）

## 范围与当前状态

本轮实现 PostgreSQL 单 GPU 租约内核，作为产品 ticket 05 的准备性增量。独立规格为 `<internal-evidence>`。产品 ticket 04 仍开放，ticket 05 仍受 01/04 依赖约束，不因本轮内核完成而关闭。

资源目录与 GPU 租约都归 `modules/resources`；公开入口导出 `GpuLeases`、`LeaseToken`，现有 Catalog/router 保留。新增迁移 `0009_gpu_leases` 接续 `0008_external_base_models`，创建 `gpu_reservations`、唯一 `gpu_slots` 和 `gpu_lease_events`。没有新增第三方依赖。

## 已实现的契约

- 训练 attempt 与推理 trial 共用一个持久槽，通过 PostgreSQL 行锁互斥；相同 owner 活跃预留幂等，已完成 owner 必须使用新的 Attempt/trial UUID。尚未关联真实业务实体。
- 每个修改检查 reservation UUID、owner kind/UUID 与 generation；旧令牌不能修改或释放新的归属。心跳过期、连接或客户端重启均不会自动放开占用。
- 创建意图先持久化，同意图重试返回同一 operation UUID 且不再授权派发。未知创建保持占用，只有匹配的正向实例身份能够绑定。没有执行任何供应商写操作。
- 创建、执行请求、进程退出、实例停止、删除确认及租约释放分别记录。未知进程或未同步成功产物阻止清理；删除失败保留实例 ID、错误码及占用；确认删除后可完成释放。
- 删除确认后同/不同清理策略均不能回退终态；成功输出的 discard 请求继续拒绝。事件仅保存固定 action/时间，不保存供应商原始错误或凭据。
- current/get 在只读 REPEATABLE READ 事务内返回一致的状态和事件；无效 owner/policy/UUID/令牌对象返回明确 validation_error。
- 迁移可重复升级；存在 held reservation 时拒绝破坏性降级，释放后可降至0008并再次升级。

## 验证记录

真实 PostgreSQL 使用本轮独立的 modelforge_test_ 数据库；全量回归使用独立 MinIO bucket。测试通过公开资源接口驱动，云实例、进程退出和产物持久化确认均是明确标识的 synthetic 输入。没有将这些输入称为真实云或 GPU 验收。

- 初始定向54项通过；QA修复后60项通过；审查修复后最终61项通过（20.42s）。各纵向切片保留red/green与变异证据。
- 初次全量尝试265通过、1跳过、54错误：隔离容器使用旧 installed initialize，只迁移至0008。显式设置 PYTHONPATH=/work/src 并执行 alembic upgrade head 后，319通过、1跳过；失败日志保留。
- 独立初验29组：20 PASS/9 FAIL，归并三项P2：不同policy回退删除终态、坏输入逸出AppError、状态与事件并发读取不一致。均已先复现失败测试，再做最小修复；初验结果不抹除。
- 最终全后端隔离PostgreSQL/MinIO回归：326 passed / 1 skipped / 1 warning（46.21s）。跳过项为既有Web-origin opt-in测试，本轮无UI变更；warning为既有Starlette TestClient/httpx弃用提示，未升级依赖。此前325项结果仅对应令牌守卫修复前版本。
- 独立QA修复复验：26组PASS/0 FAIL，加两条精确受控并发读取race通过；六进程争用、实际Python进程重启及迁移等未变路径明确沿用初验证据。
- 三轴host-only初审：Standards零发现，Spec一项P2（非LeaseToken输入AttributeError），Adversarial零发现；同家族独立validator确认P2。共享_locked增加两行类型检查，新增回归先红再绿。独立QA再复验15组PASS/0 FAIL，包括378次非法token调用、每次三张SQL表完整无变更、36个伪造typed-token及合法相邻生命周期。
- 三轴定向补审均零遗留发现，原P2已修复。host-only同家族覆盖，不声称跨模型家族。初审、validator及修复补审前后可信快照一致；初始190/修复190/最终191个冻结文件hash无漂移。
- 变异：初始9项租约逻辑、QA修复6项、审查令牌守卫1项和迁移降级保护1项均被预期断言检出，副本恢复与最终源码一致。首次CRLF目标不匹配、一次命中非目标self.owner_kind导致GREEN及多行CRLF未匹配的配置失败均保留，已精确修正重跑；不把配置错误计作检出。

隔离测试命令：容器使用 `PYTHONPATH=/work/src`、`MF_TEST_LEASE_INTEGRATION=1`、`MF_TEST_INTEGRATION=1`、`MF_TEST_ISOLATED_STORES=1`，明确指定本轮唯一数据库/bucket，先 `python -m alembic upgrade head`，再 `python -m pytest tests -q -p no:cacheprovider`。定向仅运行 `tests/test_gpu_leases.py`。

最终原始日志：`backend-token-fixed-final.txt`、`review-fix-green-full.txt`；独立报告：`qa-independent/report-initial.md`、`report-followup.md`、`report-token-followup.md`；审查汇总：`review-aggregate.md`。初次失败证据保留。

原始证据在本机 OS 临时目录 `<home>/AppData/Local/Temp/modelforge-leases-20261101-c2835c04`，指针为 ignored `.runtime/lease-evidence-path.txt`。证据含失败原始日志、迁移、变异、独立QA、审查、快照和最终回归。

清理与最终检查：本轮6个专属测试容器、4个modelforge_test_lease数据库和独立测试bucket已删除并二次确认不存在；常驻业务库/桶与服务保留。冻结源码、脚本及原始证据保留。删除临时mutation-backend、空scratch及__pycache__的递归清理命令被自动审批策略拒绝，未执行、未绕过重试；这些目录仍在OS临时证据目录。精确凭据值扫描、Git差异格式、范围及常驻健康的最终结果保存在final-audit.json。未提交或推送。

## 尚未实现与部署边界

没有 provider create/stop/delete 写适配器、fresh capacity及创建参数快照、云端对账、SSH/SFTP、远程任务通道、HTTP写入口、Worker驱动、真实Attempt/trial关联及GPU训练/推理。完整生命周期仍归产品ticket05及后续票。浏览器隔离未验证，页面验收继续blocked；本轮未调用浏览器或桌面。

常驻API/Worker仍运行原有external-base-fixed镜像，业务库仍0008；本轮0009只应用隔离数据库。没有部署、创建收费实例、Git提交或远程操作。

下一步：先补足供应商生命周期/对账与远程通道规格；解决ticket04剩余验收和具体资源组合/费用选择后，再接Attempt调度、真实挂载指纹、受控SFT/LoRA、Best/Final回传和独立vLLM试用。
