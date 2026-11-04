# Serving F1.1 代理交接提示词

Status: planning-only  
Usage: 用户明确下达“开始实施”后，按票复制对应提示词；当前不要执行

## 1. 交接边界

所有实施代理必须知道：

- 目标是 ModelForge 左侧「推理试用 / Serving」，不是上方「训练 / Training」。
- 文档目录只用于规划和交接；正式代码位于 `frontend/` 与 `backend/`。
- P0 不新增数据库迁移，不修改 Worker 状态机，不接入云厂商写操作。
- 不新增运行时依赖、UI 框架或状态管理库。
- 不把 `stop_requested` 或 `state=stopping` 显示成回收成功。
- 不把原型、Fake runtime、隔离测试或数据库事件说成真实 GPU 验收。
- 不自动 commit、push、PR 或部署；仅执行用户当次明确授权。
- Windows 环境使用 PowerShell，不使用 WSL/bash。

## 2. 总控提示词

```text
你是 ModelForge「推理试用 / Serving」F1.1 实施总控代理。目标不是继续设计，而是在用户当前授权范围内，把 F1.1 分票实现、验证和交付供人工验收。

工作根目录：<project-root>
设计包：<project-root>\design\serving-trial-redesign-2026-11-04
规划包：<设计包>\production-plan

第一步必须读取：
1. ModelForge\AGENTS.md
2. ModelForge\docs\PROJECT_STRUCTURE.md
3. ModelForge\docs\agents\review-policy.md
4. production-plan\README.md
5. production-plan\01-execution-plan.md
6. production-plan\02-product-ux-spec.md
7. production-plan\03-technical-design.md
8. production-plan\05-acceptance-plan.md
9. production-plan\06-ticket-backlog.md

然后执行 git status --short，记录已有未提交文件。不得清理、恢复或覆盖无关改动，不得使用 git add -A。

执行规则：
- 一次只推进一个 P0/P1 票据。
- 只修改票据白名单文件。
- 不修改 features/training、Training 路由或 Training 样式。
- 不新增 migration、依赖或全局设计 token。
- 不改 Worker 状态机、GPU 租约规则或后端写路径。
- 不自作主张 commit/push/PR/部署；没有用户明确授权时只保留工作区改动。
- 每票先运行相关最小检查，再做前端测试、构建和必要的后端测试。
- 浏览器检查必须遵守 AGENTS.md 的隔离边界；不能证明隔离时标 BLOCKED。
- 报告必须列出：改动文件、核心行为、命令与结果、截图/API 证据、未跑项、残余风险。
- 使用中文；保留路径、标识符、错误码和原始输出。

顺序：
P0-01 → P0-02 → P0-03 → P0-04
P0-05 可与 P0-02/P0-03 并行，但 P0-06 必须等 P0-05 字段冻结。
然后 P0-06 → P1-01 → P1-02 → P1-03。
P2 不在当前授权内。

如果发现需要跨白名单、改状态机、加 migration、加依赖或现有接口事实不足，停止并报告，不要猜。
```

## 3. P0-01

```text
执行 Serving F1.1 的 P0-01：状态模型与 Trial 路由。

工作根：<project-root>
先读 production-plan 下的 README、01、02、03、05、06，再读现有 Serving.tsx、conversation.ts、resources 类型和 training-model.ts 的 query 路由范式。
执行 git status --short；不要碰无关改动。

只允许修改/新增：
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/api.ts
- frontend/tests/serving-model.test.mjs

本票不修改 Serving.tsx、App.tsx、后端、全局 CSS 或其他 feature。

实现：
- parseServingRoute / servingRouteQuery，支持 ?trial=<id> 与 ?view=create。
- 与 03-technical-design.md 完全一致的 Trial 类型、TrialViewState、状态优先级。
- stopped 完整/不完整回收分流；request_state=unknown 禁止发送；未知枚举兜底。
- API 薄封装只包含现有 serving 端点，不新增后端请求。
- 纯函数测试覆盖所有状态、URL 往返和边界。

禁止：
- 路由库、mock 库、依赖升级。
- 自动选择第一条 Trial。
- 把 stop_requested 推导成回收完成。

验收：
- cd frontend
- npm test
- npm run build

完成后只报告 changed files、测试名、输出和未跑项。不要 commit/push。
```

## 4. P0-02

```text
执行 Serving F1.1 的 P0-02：F1.1 工作台壳与队列。

依赖 P0-01 已通过。
先读 production-plan 的 02、03、04、05、06，以及现有 Serving.tsx、app.css。执行 git status --short。

只允许修改/新增：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/components/ServingQueue.tsx
- frontend/src/features/serving/components/CurrentTrialHeader.tsx
- frontend/src/features/serving/components/TrialContextPanel.tsx
- frontend/tests/serving-model.test.mjs

实现：
- 保留 App 对 Serving 的 import，继续导出 Serving。
- 三栏：队列、当前 Trial、运行事实；1024/768/390 改为抽屉或单栏。
- 接入 Trial 路由选择、刷新恢复、Back/Forward、无效/空选中状态。
- 队列使用 button、aria-current，无横向表格。
- 统一状态 badge/状态页，不并列展示原始 state/request_state/stop_requested。
- 现有创建、绑定、聊天、结束功能不得被静默删掉；本票可以保留临时组合，后续票抽离。
- 轮询仅可见页运行、请求不重叠、失败保留旧数据和过期提示。

禁止：
- 改全局 app.css/controls.css。
- 改 resources 表单。
- 引入组件库。
- 改后端或 Worker。

验收：
- npm test
- npm run build
- 1440/1024/768/390 无水平溢出，每页一个 h1。
- 直接打开、选择、刷新、Back/Forward、404。
- console/runtime error 必须记录。

不要 commit/push。浏览器驱动不能证明隔离就标 BLOCKED。
```

## 5. P0-03

```text
执行 Serving F1.1 的 P0-03：创建弹层与手动实例绑定。

依赖 P0-02。
先读 production-plan 的 02、03、04、05、06、resources/InstanceFields.tsx、ManualInstanceDialog.tsx、runtime compatibility 和现有 Serving 创建逻辑。

只允许修改/新增：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/api.ts
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/components/CreateTrialDialog.tsx
- frontend/src/features/serving/components/BindInstancePanel.tsx
- frontend/tests/serving-model.test.mjs

只读复用 resources/runtime/models 文件；不要修改它们。

实现：
- ?view=create 弹层，Adapter 选择 + 基础/高级实例要求 + 手动创建确认。
- 10 个 InstanceSpec 持久字段全部保留，镜像目录/筛选辅助控件继续服务 `image_id` 选择；依赖顺序保持 region→zone→GPU→cpu/memory，zone→image。
- 复用 ManualInstanceDialog 的“不自动购买”约束。
- 创建成功进入新 Trial 的 waiting_instance 深链。
- 绑定面板从 snapshot.instance 展示要求，实例 ID 校验 + acknowledge_cleanup。
- 所有错误就地显示：gpu_busy、base_region_mismatch、trial_not_waiting、冲突。

禁止：
- 删除字段、改共享表单、发云厂商创建请求、自动购买。
- 新增依赖、migration、后端写接口。

验收：
- npm test
- npm run build
- 创建校验、手动确认、创建成功、绑定成功路径。
- gpu_busy / base_region_mismatch / trial_not_waiting 至少各一条负向证据。
- 1440 与 390 截图。

不要 commit/push。
```

## 6. P0-04

```text
执行 Serving F1.1 的 P0-04：会话、SSE 与生成控制。

依赖 P0-03。
先读 production-plan 的 02、03、05、06，以及现有 Serving.tsx 的 send/cancel 和 conversation.ts。

只允许修改/新增：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/conversation.ts
- frontend/src/features/serving/components/ServingSession.tsx
- frontend/tests/serving-model.test.mjs
- frontend/tests/conversation.test.mjs

实现：
- 抽出会话区、空会话、固定验收问题 chips、参数折叠和输入控制。
- 保留真实 /chat SSE：request/delta/done/error、多 chunk 解析、部分输出、unknown。
- 停止生成调用 cancel-request，先进入 cancelling，不立即改成 idle。
- partial 保存在页面但不进入下一轮 requestMessages。
- 切换 Trial、刷新、离开页面清空会话；清空只清页面。
- stale generation 的 delta 不得污染新 Trial。

禁止：
- 改后端 chat、持久化会话、markdown/parser 依赖、把错误吞成成功。

验收：
- npm test
- npm run build
- 正常完成、停止生成、SSE 中断、request_state=unknown 四类流程。
- 验证下一轮请求 messages 不含 partial。
- 桌面与 390 输入区截图。

不要 commit/push。
```

## 7. P0-05

```text
执行 Serving F1.1 的 P0-05：生命周期只读投影 API。

可以独立于前端 P0-02/P0-03，先读 production-plan 的 03、05、06，再读 backend serving/routes.py、use_cases.py、resources/leases.py、migrations 0009/0011。
执行 git status --short。

只允许修改/新增：
- backend/src/modelforge/modules/serving/use_cases.py
- backend/src/modelforge/modules/serving/routes.py
- backend/tests/test_serving_lifecycle.py

实现：
- 保留 Serving.get() 的轻量内部行为，新增 get_with_lifecycle() 或等价只读方法。
- detail 路由在原有字段外增加 lifecycle；list 不变。
- 通过 GpuLeases 公开契约读取，不直接跨模块写 SQL。
- 白名单投影 creation/process/instance/cleanup/lease/events；过滤 renewed；最多 50 个事件。
- 无租约返回 status=not_reserved。
- 事实读不到时保持 HTTP 200，返回 lifecycle.status=unavailable；顶层 Trial 仍可读，不伪造成功。

严禁：
- 新 migration、改 schema、改 Worker、renew/cleanup/reconcile、暴露 owner/generation/provider/region/token。

验收：
- python -m pytest -q
- 真实 disposable PostgreSQL 合同测试：
  MF_TEST_LEASE_INTEGRATION=1
  MF_TEST_ISOLATED_STORES=1
  MF_PG_DATABASE=modelforge_test_<一次性名称>
- 若一次性数据库不可用，明确 BLOCKED，不得指向普通开发库。
- GET 前后确认 inference_trials.updated_at、lease 状态、event 数不变。

不要 commit/push。
```

## 8. P0-06

```text
执行 Serving F1.1 的 P0-06：结束确认与真实回收回执。

依赖 P0-04 和 P0-05。先读 production-plan 的 02、03、04、05、06，以及已冻结的 lifecycle API。

只允许修改/新增：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/api.ts
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/components/StopTrialDialog.tsx
- frontend/src/features/serving/components/LifecycleReceipt.tsx
- frontend/tests/serving-model.test.mjs

实现：
- 点击结束先打开确认；内容含 Trial、Adapter、实例、活动生成提示。
- 成功后进入 ending，分停止请求、进程退出、实例清理、租约释放展示。
- 完整成功条件严格为 process 非 unknown + cleanup confirmed + instance deleted + lease released。
- 曾持有租约但未创建实例时，只有 creation not_requested + instance none + process not_started + cleanup not_requested + lease released 才显示“未创建云实例”。
- stopped 缺事实显示“已结束，回收事实待核对”。
- lifecycle_unavailable / unknown / failed 不得绿色成功。
- 不新增 retry/force 接口；提供刷新和复制事实。

禁止：
- stop_requested=true 即成功。
- 改后端状态机、新增接口、加 migration。

验收：
- npm test
- npm run build
- 完整成功、实例删除失败、实例已删除但租约 held、stopped 缺事实四套 UI 证据。
- lifecycle.status=unavailable 且 Trial 顶层字段仍可读的场景。
- 1440 与 390 截图。

不要 commit/push。
```

## 9. P1-01

```text
执行 Serving F1.1 的 P1-01：队列排序、过滤与搜索。

依赖 P0-06。先读 production-plan 的 02、05、06。

只允许修改：
- frontend/src/features/serving/serving-model.ts
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/components/ServingQueue.tsx
- frontend/tests/serving-model.test.mjs

实现全部/需关注/进行中/已结束筛选；Trial/Adapter/实例本地搜索；当前项固定，其余按需处理→生成中→ready→等待/准备→结束中→已结束且稳定排序；空结果可清除筛选。

禁止：服务端搜索接口、修改 200 上限、筛选写 URL、轮询时抢焦点/跳滚动。

验收：npm test、npm run build、排序稳定性测试、200 条样本、1440/390 截图。
不要 commit/push。
```

## 10. P1-02

```text
执行 Serving F1.1 的 P1-02：响应式、键盘与 ARIA 收口。

依赖 P0-06。先读 production-plan 的 04、05、06 和 AGENTS.md 浏览器边界。

文件白名单：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/components/ServingQueue.tsx
- frontend/src/features/serving/components/CurrentTrialHeader.tsx
- frontend/src/features/serving/components/ServingSession.tsx
- frontend/src/features/serving/components/TrialContextPanel.tsx
- frontend/src/features/serving/components/CreateTrialDialog.tsx
- frontend/src/features/serving/components/BindInstancePanel.tsx
- frontend/src/features/serving/components/StopTrialDialog.tsx
- frontend/src/features/serving/components/LifecycleReceipt.tsx
- frontend/src/features/serving/components/ServingDrawer.tsx（仅在复用时新增）

实现 1180/1024/768/640/390 布局、队列/运行事实抽屉、Escape、焦点返回、背景 inert、44px 触控、aria-live 降噪、200% 缩放和 reduced-motion。

禁止：新增浏览器/UI 依赖、全局 CSS 覆盖、改状态机、伪模态。

验收：npm test、npm run build、四档截图、键盘与焦点记录、无障碍检查。隔离浏览器不能证明则标 BLOCKED。
不要 commit/push。
```

## 11. P1-03

```text
执行 Serving F1.1 的 P1-03：浏览器验收与旧实现清理。

依赖 P1-01、P1-02。先读 production-plan 的 05、06 和 AGENTS.md。

文件白名单：
- frontend/src/features/serving/Serving.tsx
- frontend/src/features/serving/serving.css
- frontend/src/features/serving/components/**
- frontend/tests/**
- production-plan/09-implementation-record.md（新增）

执行：
- 按 05-acceptance-plan.md 跑主流程、异常、四档布局、键盘和证据记录。
- 用 rg 找旧 Serving 实现、旧 CSS、未使用导出，确认无引用后再删。
- 只做与本轮直接相关的清理，不做无关格式化。
- 最终记录逐项使用 PASS/FAIL/BLOCKED/NOT_RUN，明确模拟、隔离服务与真实 GPU 证据边界。

禁止：无证据删除、无关重构、新增依赖、migration、把模拟称为真实验收。

验收：npm test、npm run build、相关 pytest、浏览器证据索引、Training 未改证明。
不要 commit/push。
```

## 12. P2 交接原则

P2-01 与 P2-02 不包含在本次开工授权中。只有 P0/P1 验收完成，用户再次明确批准后，才单独创建票据和提示词。

## 13. 交付报告模板

```text
票据：P0-xx
结论：DONE / BLOCKED / PARTIAL

改动文件：
- ...

实现结果：
- ...

验证：
- PASS · F1 · <命令与结果>
- PASS · F2 · <命令与结果>
- BLOCKED · U1 · <隔离浏览器原因>
- NOT_RUN · G1 · 未连接真实 GPU

证据路径：
- ...

未完成 / 风险：
- ...

Git：
- 未 commit / 未 push（或按用户当次授权说明）
```
