# Serving F1.1 验收计划

Status: planning-only  
Rule: 没有证据的项目保持 `NOT_RUN`，不得用原型、模拟数据或健康检查替代真实业务验收

## 1. 验收层级

| 层级 | 证明什么 | 不能证明什么 |
|---|---|---|
| D0 文档检查 | 范围、字段、路径和依赖一致 | 功能已实现 |
| F1 前端单元测试 | 状态派生、路由、排序和会话纯逻辑正确 | 页面已经可用 |
| F2 构建 | TypeScript 与 Vite 可编译 | 业务流程正确 |
| B1 后端单元测试 | 投影函数和错误映射符合合同 | 真实数据库或 GPU 正常 |
| B2 PostgreSQL 合同测试 | 只读投影能读取真实表结构且不写状态 | 云实例真实回收 |
| U1 隔离浏览器验收 | 指定视口中的 UI 流程可操作 | 全浏览器、全平台兼容 |
| S1 隔离服务验收 | 真实 API/Worker 合同与状态推进可解释 | 真实 GPU 推理质量 |
| G1 真实 GPU 验收 | 指定 GPU、模型、实例和时间内真实推理与回收 | 生产稳定性和多环境兼容 |

通过记录必须写清层级。例如：

- `PASS · U1 · 1440×1000 · create/bind/ready`
- `BLOCKED · G1 · 当前没有可用 GPU`
- `NOT_RUN · B2 · 未提供 disposable PostgreSQL`

## 2. 测试环境与安全边界

### 前端

```powershell
Set-Location '<project-root>\frontend'
npm test
npm run build
```

要求：

- Node / npm 版本与项目当前锁定环境一致。
- 不新增 Playwright、Testing Library 或浏览器依赖。
- 若 `npm test` 已存在无关失败，保留原始输出并单列，不修改无关测试。

### 后端

基本测试：

```powershell
Set-Location '<project-root>\backend'
python -m pytest -q
```

需要真实 PostgreSQL 的租约/生命周期合同测试必须具备一次性数据库：

```powershell
$env:MF_TEST_LEASE_INTEGRATION = '1'
$env:MF_TEST_ISOLATED_STORES = '1'
$env:MF_PG_DATABASE = 'modelforge_test_serving_20261104'
python -m pytest tests/test_serving_lifecycle.py tests/test_gpu_leases.py -q
```

执行后清除：

```powershell
Remove-Item Env:MF_TEST_LEASE_INTEGRATION -ErrorAction SilentlyContinue
Remove-Item Env:MF_TEST_ISOLATED_STORES -ErrorAction SilentlyContinue
Remove-Item Env:MF_PG_DATABASE -ErrorAction SilentlyContinue
```

硬性禁止：

- 把测试指向现有开发库、个人库或任何非 `modelforge_test_*` 数据库。
- 用真实用户实例做清理失败实验。
- 在合同测试中调用云厂商写接口。
- 通过测试脚本伪造 `cleanup_state=confirmed` 后宣称真实回收通过。

### 浏览器

- 仅使用已证明隔离、不激活系统窗口、不抢焦点的浏览器驱动。
- 若无法证明隔离，浏览器步骤标 `BLOCKED`，改用 HTTP、代码和自动化测试，并记录缺口。
- 每个关键路径保存截图、URL、视口、时间、浏览器版本和 console/runtime error。
- 浏览器证据存于 `ModelForge/.runtime/serving-f11-acceptance/<run-id>/`，不提交 Git。

建议证据文件：

```text
metadata.json
console.log
network-notes.md
01-empty-1440.png
02-create-1440.png
03-waiting-1440.png
04-ready-streaming-1440.png
05-stopping-1440.png
06-stopped-complete-1440.png
07-ended-incomplete-1440.png
08-ready-390.png
09-queue-drawer-390.png
10-context-drawer-390.png
```

## 3. D0 文档与范围检查

- [ ] 只修改 `ModelForge`。
- [ ] 不改 Training 页面、Training 路由或 Training 组件。
- [ ] 不新增 migration。
- [ ] 不修改 Worker 状态机。
- [ ] 不新增运行时依赖。
- [ ] `Serving` 的 App import 仍为 `features/serving/Serving`。
- [ ] 所有设计引用路径存在。
- [ ] 字段清单与 `InstanceFields.tsx` 一致。
- [ ] 原始枚举没有重新并列显示在默认 UI。
- [ ] “已结束，回收事实待核对”与“已结束，实例已回收”有独立文案。
- [ ] 计划中的 P0/P1/P2 文件白名单与实际改动一致。

文档检查命令示例：

```powershell
$root = '<project-root>\design\serving-trial-redesign-2026-11-04\production-plan'
Get-ChildItem $root -Filter '*.md' | ForEach-Object {
  "--- $($_.Name)"
  Select-String -Path $_.FullName -Pattern 'TODO|TBD|待补' -SimpleMatch
}
```

本检查只能证明没有明显占位文本，不证明实现正确。

## 4. F1 前端纯逻辑测试

### 路由

- [ ] 空 search → `{trialId:'', create:false}`。
- [ ] `?trial=abc` → 保留 `abc`。
- [ ] `?view=create` → 打开创建。
- [ ] `?trial=abc&view=create` 往返不丢字段。
- [ ] 关闭创建保留 Trial。
- [ ] 清除 Trial 保留创建状态。
- [ ] 未知 query 不导致页面崩溃。
- [ ] 重复挂载不会把 URL 改写成自动选择第一条。

### 状态派生

- [ ] `queued`。
- [ ] `waiting_instance`。
- [ ] `preparing`。
- [ ] `ready + idle` 可发送。
- [ ] `ready + running` 为 generating。
- [ ] `ready + cancelling` 为 cancelling。
- [ ] `ready + unknown` 为 request_unknown，禁止发送。
- [ ] `stop_requested=true` 优先于 ready/running。
- [ ] `state=stopped` 优先于 `stop_requested=true` 与 `request_state=unknown`，进入 ended 分支而不是 ending/unknown。
- [ ] `stopping` 无回执 → ending.stop_requested。
- [ ] 进程退出 → ending.process_exited / cleanup_pending。
- [ ] 实例已删除、租约 held → ending.lease_pending。
- [ ] process 非 unknown + instance deleted + cleanup confirmed + lease released → ended.complete。
- [ ] `state=stopped` 无 lifecycle → ended.incomplete。
- [ ] `not_reserved + stopped` → `no_instance` 成功结束。
- [ ] 曾持有租约但 creation not_requested + instance none + process not_started + cleanup not_requested + lease released → `no_instance`。
- [ ] lease released 但创建/实例事实冲突 → incomplete。
- [ ] 未知 raw 值 → unknown，不默认 ready。
- [ ] 缺 `request_state` → unknown，不默认 idle。

### 生命周期回执

- [ ] 未完成事实不会触发绿色完成。
- [ ] `instance_delete_failed` 保留错误码。
- [ ] `process.state=unknown` 保留“待核对”。
- [ ] 事件按时间可读，不显示 `renewed` 噪声。
- [ ] 投影字段中不含 owner、generation、provider ID、region。

### 会话

- [ ] partial assistant 不进入下一轮。
- [ ] 用户连续消息保持顺序。
- [ ] 空 assistant 占位不进入请求。
- [ ] 清空后消息列表和空状态同时恢复。

## 5. F2 构建

- [ ] `npm run build` 退出码 0。
- [ ] 无新增 TypeScript 错误。
- [ ] Vite 产物正常。
- [ ] 改变的文件没有引入未使用导出。
- [ ] CSS 没有全局 `body`、`button`、`.panel` 等覆盖。
- [ ] CSS 变量只在 `.serving-page` 生效。

## 6. B1/B2 后端与 API 合同

### 响应兼容

- [ ] `GET /trials/{id}` 保留原有 `id/state/adapter_id/instance_id/error_code/stop_requested/request_state/request_cancel_requested/last_activity_at/snapshot`。
- [ ] 新增 `lifecycle`，旧读取逻辑不会因多字段失败。
- [ ] `GET /trials` 不因投影产生 N+1 查询。
- [ ] 编辑 `lifecycle` 代码不调用任何写接口。

### `not_reserved`

- [ ] Trial 的 `lease_id` 为空 → `{"status":"not_reserved"}`。
- [ ] `state=stopped` 且未占用 GPU 可显示“未占用实例”，但必须来自该字段。

### `tracked`

- [ ] 字段一一对应 `gpu_reservations`。
- [ ] 事件时间映射正确。
- [ ] `renewed` 默认过滤。
- [ ] 事件上限生效。
- [ ] `cleanup_error_code` 映射到 `cleanup.error_code`。
- [ ] `released_at` 与 `lease.state=released` 同时出现。
- [ ] `create_state` 映射到 `creation.state`。

### 错误

- [ ] 404 仍为 `not_found`。
- [ ] `lease_id` 存在但读取不到租约 → HTTP 200 + `lifecycle.status=unavailable`，Trial 顶层字段仍可读。
- [ ] 该错误不会修改 Trial 或租约。
- [ ] 前端不会把 `unavailable` 回执读成成功。

### 无写入验证

测试前后比较：

- `inference_trials.updated_at`
- `gpu_reservations.state`
- `gpu_reservations.cleanup_state`
- `gpu_lease_events` 数量

仅执行 GET 后这些值不得因投影读取而改变。

## 7. U1 浏览器主流程

### 7.1 空与加载

- [ ] 队列 0 条：说明从训练产物创建，不显示空白表格。
- [ ] 首次详情加载：三栏骨架，不闪出旧 Trial。
- [ ] 列表刷新时：已有内容不整页卸载。
- [ ] 刷新失败：保留旧数据，显示“已过期”和最后成功时间。

### 7.2 路由

- [ ] 直接打开 `?trial=<id>#serving`，刷新后仍是同一 Trial。
- [ ] 选择第二条 Trial，地址更新；Back 返回第一条。
- [ ] `?view=create` 直接打开弹层；关闭后 URL 去掉 view。
- [ ] 非法 ID 显示“找不到这条试用记录”，不自动改选。
- [ ] 复制 Trial ID 显示成功反馈。

### 7.3 创建

- [ ] 未选 Adapter 时提交，错误在弹层内。
- [ ] 不兼容 Adapter 禁用且展示原因。
- [ ] 地域未选时可用区禁用。
- [ ] GPU 未选时 CPU/内存禁用。
- [ ] 高级项展开后，10 个 `InstanceSpec` 持久字段及镜像目录/筛选辅助控件都可操作。
- [ ] 手动实例确认明确写出“不自动购买”。
- [ ] 创建成功进入新 Trial `waiting_instance`。
- [ ] `gpu_busy` 保留表单并解释已有 GPU 持有者，不提供绕过。
- [ ] 请求失败后可重试且没有重复 Trial。

### 7.4 绑定

- [ ] 显示 `snapshot.instance` 的要求，不显示草稿临时值。
- [ ] 空实例 ID、非法字符有就地错误。
- [ ] 未勾选授权不能提交。
- [ ] 绑定成功进入 preparing。
- [ ] 绑定冲突刷新后不重复提交。

### 7.5 生成

- [ ] ready 前输入框禁用。
- [ ] 固定问题只填入输入框，不自动发送。
- [ ] 发送后用户消息立即出现，助手占位存在。
- [ ] delta 增量正确追加。
- [ ] 完成消息可进入下一轮。
- [ ] 停止生成显示 cancelling，不立即回 idle。
- [ ] 取消完成后保留部分输出并标 `partial`。
- [ ] 部分输出不出现在下一轮 messages 请求体中。
- [ ] 网络中断保留已收文本，按钮恢复策略可解释。
- [ ] request_unknown 禁止再次发送。
- [ ] 清空只清当前页面，不影响 Trial。
- [ ] 切换 Trial、刷新、离开页面会清空会话。

### 7.6 结束与回执

- [ ] 点击结束时出现确认，不直接发请求。
- [ ] 有活动生成时确认识别该事实。
- [ ] 提交后显示“停止请求已提交”，不显示已回收。
- [ ] 进程退出后显示退出码。
- [ ] 实例删除失败显示 `instance_delete_failed`。
- [ ] 实例已删除、租约未释放显示 `lease_pending`。
- [ ] process 非 unknown + cleanup confirmed + instance deleted + lease released 才显示成功。
- [ ] `stopped` 但事实缺失显示“已结束，回收事实待核对”。
- [ ] `lifecycle.status=unavailable` 时不显示绿色成功，并保留 Trial 摘要。
- [ ] 从未持有租约的结束显示“未占用实例”。
- [ ] 曾持有租约但未创建实例的结束显示“未创建云实例”，不显示“实例已删除”。

## 8. 四档布局验收

在 `1440×1000`、`1024×768`、`768×1024`、`390×844` 至少覆盖：

- empty
- loading
- waiting_instance
- ready
- generating
- blocked
- ending
- ended.complete
- ended.no_instance
- ended.incomplete
- create
- invalid_route

每档检查：

- [ ] `document.documentElement.scrollWidth <= clientWidth`，无水平溢出。
- [ ] 只有一个 `h1`。
- [ ] 当前可见状态恰好一个。
- [ ] 队列、主会话、运行事实入口在首屏可发现。
- [ ] 390px 输入区不与浮层/状态条重叠。
- [ ] 390px 队列抽屉和运行事实抽屉可独立打开、关闭。
- [ ] 长 Adapter 指纹、长实例 ID、长错误码可换行或复制。
- [ ] 1024px 右栏为抽屉，不是被压到 40px。
- [ ] 768px 下无固定宽度表格。

## 9. 键盘、焦点与可访问性

- [ ] Tab 顺序：队列 → 新建入口 → 会话 → 运行事实 → 结束。
- [ ] 当前队列项可用 Enter/Space 选择。
- [ ] 创建弹层打开后焦点进入首个字段。
- [ ] Escape 关闭创建/绑定/结束弹层；焦点返回触发按钮。
- [ ] 结束确认默认焦点为取消，不是危险动作。
- [ ] 移动抽屉打开后可关闭，焦点不会跑到背景内容。
- [ ] 状态变化 `aria-live` 不每 2.5 秒重复播报。
- [ ] 倒计时不每秒触发读屏播报。
- [ ] 所有图标按钮有 `aria-label`。
- [ ] 颜色不是唯一状态信号。
- [ ] 200% 浏览器缩放时主要操作仍可到达。
- [ ] `prefers-reduced-motion` 下无脉冲和自动滚动动画。

## 10. 负向与服务异常

必须构造并记录：

- Trial 已删除但页面仍保留旧详情。
- 列表成功、详情失败。
- 详情成功、runtime baseline 失败。
- 创建过程中 API 409。
- 绑定过程中 `trial_not_waiting`。
- chat 返回 409 `trial_busy`。
- SSE 先收到 delta 后收到 error。
- SSE 没有任何 terminal event 就关闭。
- `request_state=unknown`。
- `cleanup.state=failed`。
- `instance.state=deleted` + `lease.state=held`。
- `state=stopped` + 缺 lifecycle。
- `lifecycle` API 503。

每个负向场景必须写明：

- 用户看到什么。
- 哪些数据被保留。
- 能否重试。
- 是否可能重复消耗 GPU 或误删实例。

## 11. S1 隔离服务验收

在不连接真实 GPU 的受控服务中：

- 使用现有 Fake/受控 runtime 验证 HTTP、SSE、停止、取消和状态推进。
- 使用 disposable PostgreSQL 验证租约投影。
- 记录实际 API 响应样本、Worker 状态和浏览器截图。

此层通过只能标为“隔离服务链路通过”，不能写“真实 GPU 推理通过”。

## 12. G1 真实 GPU 验收

只有用户另行提供真实 GPU 和云环境时执行。至少记录：

- 日期、操作者、GPU 型号/地域/可用区。
- 基座 ID 与指纹、Adapter ID 与指纹、runtime lock。
- 实例 ID 和创建来源。
- 实际推理请求、流式输出与停止结果。
- 进程退出码。
- 云控制台删除确认。
- `lifecycle.cleanup.state=confirmed`、`instance.state=deleted`、`lease.state=released`。
- 训练与推理互斥证据。

真实 GPU 验收失败或未执行时，验收结论保持未完成。不得因为原型演示、Fake Executor 或数据库事件完整就替代。

## 13. 完成判定

### P0 可合并

- D0、F1、F2、相关 B1/B2 有证据。
- 主流程 U1 通过。
- 无 P0 阻断缺陷。
- 回收成功与不完整状态均有截屏。
- 无 migration、无 Worker 写逻辑变化、无新增依赖。
- 每一票只改白名单文件。

### P0 可交给用户验收

- 四档布局通过。
- 键盘主路径通过。
- 创建、等待、绑定、ready、生成、停止、结束、回执完整。
- 未执行项明确列 `NOT_RUN`。

### P1 可关闭

- 队列筛选/搜索/排序稳定。
- 抽屉和无障碍完整。
- 浏览器证据与样式残余清理完成。

真实 GPU 验收是独立门，不阻塞代码评审，但不允许在最终报告中省略其状态。
