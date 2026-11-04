# Serving F1.1 票据清单

Status: planning-only  
Important: 本文件不是 `.scratch` 正式票据；用户批准开工后才写入本地 issue tracker

## 1. 执行规则

- 一次只把一个票据标为 `ready-for-agent`。
- 每票先读 `README.md`、`01-execution-plan.md`、`02-product-ux-spec.md`、`03-technical-design.md`、本文件对应条目。
- 只改该票文件白名单。发现必须跨白名单修改时停止并上报。
- 不修改 `features/training`、Training 路由或 Training CSS。
- 不新增 migration、运行时依赖、UI 框架或状态管理库。
- 不修改 Worker 状态机、租约规则或后端写路径。
- 不以原型 HTML 直接替代 React 实现。
- Git 操作按用户当次命令执行；本计划不自动授权 commit、push、PR 或部署。
- 验收证据按 `05-acceptance-plan.md` 分层记录，缺证据保持 `NOT_RUN`。

## 2. 依赖关系

```text
P0-01
  ├── P0-02
  │     └── P0-03
  │           └── P0-04
  │                 └── P0-06
  └── P0-05 ─────────┘

P0-02/P0-03/P0-04/P0-06
  └── P1-01
  └── P1-02
  └── P1-03
        ├── P2-01
        └── P2-02
```

默认串行执行 P0-02 → P0-03 → P0-04。P0-05 可与 P0-02/P0-03 并行，但 P0-06 必须等待 P0-05 响应字段冻结。

---

## P0-01 状态模型与 Trial 路由

**目标**  
建立 `serving-model.ts`、Serving API/type 基线和 `?trial=` / `?view=create` 纯函数路由，统一所有原始状态的派生规则。

**依赖**  
无。

**文件白名单**

- `frontend/src/features/serving/serving-model.ts`（新增）
- `frontend/src/features/serving/api.ts`（新增，仅类型与只读/端点薄封装）
- `frontend/tests/serving-model.test.mjs`（新增）

**禁止**

- 不修改 `Serving.tsx`；本票先冻结纯逻辑与测试。
- 不修改 `App.tsx`。
- 不修改后端。
- 不添加路由库。

**验收**

- `parseServingRoute` / `servingRouteQuery` 覆盖常见和非法输入。
- `deriveTrialView` 覆盖状态表全部优先级。
- `stopped` 完整/不完整回执分流正确。
- `request_state=unknown` 永不显示可发送。
- 未知 raw 值显示 `unknown`。
- `npm test` 通过。

**证据**

- 新增测试名与输出。
- 每条状态映射对应的 test case。
- `npm run build` 结果；若本票没有组件接入，至少记录类型检查通过。

**规模**  
M

---

## P0-02 F1.1 工作台壳与队列

**目标**  
把纵向页面改成三栏工作台；接入路由选择、队列、统一 Trial 标题和运行事实栏；保留现有创建/会话/结束能力直到后续票抽离。

**依赖**  
P0-01。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/serving.css`（新增）
- `frontend/src/features/serving/serving-model.ts`
- `frontend/src/features/serving/components/ServingQueue.tsx`（新增）
- `frontend/src/features/serving/components/CurrentTrialHeader.tsx`（新增）
- `frontend/src/features/serving/components/TrialContextPanel.tsx`（新增）
- `frontend/tests/serving-model.test.mjs`

**禁止**

- 不改全局 `app.css` / `controls.css`。
- 不改 `InstanceFields.tsx` 或 `ManualInstanceDialog.tsx`。
- 不新增后端请求。
- 移除功能前必须有对应替代入口。

**验收**

- 选择 Trial 更新 URL；刷新恢复；Back/Forward 正确。
- 无选中时显示空工作区，不自动选首条。
- 1440/1024/768/390 无水平溢出。
- 1024 以下运行事实栏进入可打开的抽屉入口。
- 队列当前项使用 `aria-current`。
- 现有创建、绑定、聊天、结束功能不被静默移除。
- 页面只保留一个 `h1`。

**证据**

- 三档桌面 + 390px 截图。
- URL 往返与 Back/Forward 记录。
- `npm test`、`npm run build`。
- console/runtime error 列表。

**规模**  
L

---

## P0-03 创建弹层与手动实例绑定

**目标**  
将 11 个常驻实例表单控件（含 10 个持久字段）从首屏移到分层创建弹层；接入 Adapter 选择、手动创建确认、`waiting_instance` 要求和绑定流程。

**依赖**  
P0-02。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/api.ts`
- `frontend/src/features/serving/serving-model.ts`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/components/CreateTrialDialog.tsx`（新增）
- `frontend/src/features/serving/components/BindInstancePanel.tsx`（新增）
- `frontend/tests/serving-model.test.mjs`

**只读复用**

- `frontend/src/features/resources/InstanceFields.tsx`
- `frontend/src/features/resources/ManualInstanceDialog.tsx`
- `frontend/src/features/runtime/*`
- `frontend/src/features/models/*`

**禁止**

- 不删除或重命名任何 `InstanceSpec` 字段。
- 不修改 `InstanceFields` / `ManualInstanceDialog`；确需修改时另开票据。
- 不新增自动购买、自动创建或云厂商写接口。
- 不绕过 `acknowledge_cleanup`。
- 不用客户端校验代替服务端错误。

**验收**

- 创建入口和 `?view=create` 均可用。
- Adapter 只允许 available；不兼容项可见但禁用。
- 基础/高级字段沿用真实依赖顺序。
- 提交前显示“平台不会自动购买”的手动创建确认。
- 成功后 URL 指向新 Trial 并显示 `waiting_instance`。
- 绑定面板读取 `snapshot.instance`，不读取草稿。
- 实例 ID 校验、授权勾选、`trial_not_waiting` 与冲突错误就地展示。
- 绑定成功立即进入 `preparing`。

**证据**

- 创建表单各阶段截图。
- 缺失字段、无效 Adapter、`gpu_busy`、`base_region_mismatch`。
- 手动创建弹层截图。
- 绑定前后 API 响应摘要。
- 1440 与 390 布局。

**规模**  
M

---

## P0-04 会话、SSE 与生成控制

**目标**  
抽出会话组件，保留完整 SSE 行为；实现完成、部分输出、停止生成、未知状态、清空和切换 Trial 清理。

**依赖**  
P0-03。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/serving-model.ts`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/conversation.ts`
- `frontend/src/features/serving/components/ServingSession.tsx`（新增）
- `frontend/tests/serving-model.test.mjs`
- `frontend/tests/conversation.test.mjs`

**禁止**

- 不改后端 chat 路由。
- 不持久化聊天。
- 不新增 markdown/parser 依赖。
- 不把 partial 消息送入下一轮。
- 不在停止点击后立即把状态改成 idle。

**验收**

- ready + idle 才可发送。
- SSE 多 chunk/多事件解析稳定。
- delta 只写入当前 Trial。
- `done(partial=false)` 标完成；`partial=true` 标部分输出。
- `error` 保留已收文本并显示错误码。
- 无 terminal event 后不会误标完成。
- 停止生成先进入 cancelling，收到 done/详情 idle 后恢复。
- request_unknown 禁止再次发送。
- 清空只清页面会话。
- 切换 Trial、刷新、离开页面清空会话。
- 固定验收问题只填输入框，不自动发送。

**证据**

- 流式生成截图/录制摘要。
- 正常完成、停止生成、SSE 中断、unknown 四类证据。
- cancel-request 请求与最终详情状态。
- `conversation.test.mjs` 与 `serving-model` 状态测试。

**规模**  
L

---

## P0-05 生命周期只读投影 API

**目标**  
在 `GET /api/v1/serving/trials/{id}` 增加白名单只读 `lifecycle`，供回收回执展示；保持所有既有字段，不新增数据库迁移。

**依赖**  
P0-01 的类型命名冻结。可与 P0-02/P0-03 并行。

**文件白名单**

- `backend/src/modelforge/modules/serving/use_cases.py`
- `backend/src/modelforge/modules/serving/routes.py`
- `backend/tests/test_serving_lifecycle.py`（新增）

**禁止**

- 不新增 migration。
- 不改 `gpu_reservations` / `gpu_lease_events` schema。
- 不改 Worker、`ServingWorker`、停止或释放顺序。
- 不暴露 owner、generation、provider ID、region、token。
- 不在 `list()` 上逐条附加 lifecycle。
- 不写任何 lifecycle 测试结果到数据库。

**验收**

- Trial 无租约返回 `{status:'not_reserved'}`。
- 有租约返回 creation/process/instance/cleanup/lease/events 白名单。
- `renewed` 默认过滤，其他事件最多 50 条。
- 事件时间为 ISO 8601。
- 原有详情字段保持不变。
- 仅 GET 后 `updated_at`、租约状态、事件数量不变。
- 租约事实不可读时保持 HTTP 200，返回 `lifecycle.status=unavailable`；顶层 Trial 仍可读，不返回伪成功。

**证据**

- 新测试文件与完整输出。
- 真实 disposable PostgreSQL 合同测试记录，或明确 `BLOCKED`。
- 无 migration 的 diff 证明。
- API 响应示例已脱敏。

**规模**  
M

---

## P0-06 结束确认与真实回收回执

**目标**  
添加结束确认弹层和回执组件；把“停止已请求”“进程已退出”“实例已删除”“租约已释放”分层呈现，禁止假成功。

**依赖**  
P0-04、P0-05。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/api.ts`
- `frontend/src/features/serving/serving-model.ts`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/components/StopTrialDialog.tsx`（新增）
- `frontend/src/features/serving/components/LifecycleReceipt.tsx`（新增）
- `frontend/tests/serving-model.test.mjs`

**禁止**

- 不新增 stop/retry/force-release 后端接口。
- 不在 `stop_requested=true` 时显示绿色成功。
- 不在 `state=stopped` 但事实缺失时显示“实例已回收”。
- 不自行轮询后端表或猜事件。
- 不把 `cleanup.error_code` 隐藏。

**验收**

- 点击结束先出现确认；取消不发请求。
- 确认内容包含 Trial、Adapter、实例、活动生成提示。
- 提交后显示 ending 子阶段。
- 进程退出显示 exit code。
- 删除失败显示 `instance_delete_failed`。
- 实例删除但租约未释放显示 `lease_pending`。
- 完整事实才出现绿色成功。
- 不完整结束显示“已结束，回收事实待核对”。
- 未占用实例如有关系成立，显示独立成功态。
- 曾持有租约但未创建实例时显示“未创建云实例”，不退化为回收失败。
- `lifecycle.status=unavailable` 时继续保持待核对并保留 Trial 摘要。

**证据**

- 确认弹层截图。
- stop 请求与随后详情生命周期样本。
- 完整成功、删除失败、租约未释放、`stopped` 缺事实四套截图。
- `serving-model` 回执分支测试。

**规模**  
M

---

## P1-01 队列排序、过滤与搜索

**目标**  
在队列 200 条限制内加入稳定排序、状态过滤和本地搜索，保持当前 Trial 与焦点稳定。

**依赖**  
P0-06。

**文件白名单**

- `frontend/src/features/serving/serving-model.ts`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/components/ServingQueue.tsx`
- `frontend/tests/serving-model.test.mjs`

**禁止**

- 不新增服务端搜索接口。
- 不改 200 条上限。
- 不让轮询导致选中项移动或滚动跳动。
- 不把筛选条件写入 URL，除非另开范围。

**验收**

- 全部/需关注/进行中/已结束筛选。
- Trial ID、来源 Attempt、实例 ID 本地搜索。
- 当前项固定；其余按文档优先级和更新时间排序。
- 无匹配结果有清除筛选入口。
- 列表更新后焦点仍在原项。
- 纯函数测试覆盖排序稳定性和过滤。

**证据**  
排序测试、200 条性能样本、1440/390 截图。

**规模**  
M

---

## P1-02 响应式、键盘与 ARIA 收口

**目标**  
完成移动抽屉、焦点管理、触控目标、读屏和 reduced-motion；保障 1024/768/390 的完整主流程。

**依赖**  
P0-06。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/components/ServingQueue.tsx`
- `frontend/src/features/serving/components/CurrentTrialHeader.tsx`
- `frontend/src/features/serving/components/ServingSession.tsx`
- `frontend/src/features/serving/components/TrialContextPanel.tsx`
- `frontend/src/features/serving/components/CreateTrialDialog.tsx`
- `frontend/src/features/serving/components/BindInstancePanel.tsx`
- `frontend/src/features/serving/components/StopTrialDialog.tsx`
- `frontend/src/features/serving/components/LifecycleReceipt.tsx`
- `frontend/src/features/serving/components/ServingDrawer.tsx`（仅在确有复用时新增）

**禁止**

- 不新增浏览器或 UI 依赖。
- 不通过全局 CSS 修复局部问题。
- 不改变业务状态机。
- 不把移动抽屉实现成背景可聚焦的伪模态。

**验收**

- 1180/1024/768/640/390 布局符合 `04-visual-system.md`。
- 队列和运行事实抽屉支持 Escape、焦点返回、背景 inert。
- 所有触控目标 >= 44px。
- 创建弹层和结束确认焦点正确。
- 状态 `aria-live` 不重复噪声。
- 200% 缩放主要流程可用。
- reduced-motion 生效。

**证据**  
四档及以上截图、键盘路径记录、焦点位置记录、无障碍检查结果。

**规模**  
L

---

## P1-03 浏览器验收与旧实现清理

**目标**  
完成隔离浏览器闭环、残余样式/旧代码清理和最终实施记录；仅在等价验收后删除旧实现。

**依赖**  
P1-01、P1-02。

**文件白名单**

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/serving.css`
- `frontend/src/features/serving/components/**`
- `frontend/tests/**`
- `production-plan/09-implementation-record.md`（新增）

**禁止**

- 不因清理删除仍被其他 feature 引用的样式或类型。
- 不做无关格式化或全局重构。
- 不在浏览器隔离无法证明时标浏览器通过。
- 不把模拟证据写成真实 GPU 验收。

**验收**

- 所有主流程与异常路径按 `05-acceptance-plan.md` 执行。
- 旧页面/旧 CSS 无引用后删除。
- `rg` 证明 Training 未被修改。
- 验收记录逐项写 `PASS/FAIL/BLOCKED/NOT_RUN`。
- 无新增依赖、无 migration。

**证据**  
完整验收索引、截图目录、命令输出、残余风险。

**规模**  
M

---

## P2-01 F2 验收实验子视图

**状态**  
未排期，需用户单独批准。

**目标**  
在 F1 的 ready 会话中增加“固定业务问题 + 会话内人工判断”的实验子视图。

**前置条件**

- P0/P1 稳定。
- 明确是否只保存在会话内，还是另立后端持久化票据。
- 若只做前端，必须标注“本页标记，不作为验收事实”。

**禁止**

- 不把人工评级偷偷写入未定义的数据库字段。
- 不为实验引入第三方 UI 组件库。

**规模**  
L

---

## P2-02 高级运行检查器

**状态**  
未排期，需用户单独批准。

**目标**  
为管理员提供 F3 的生命周期事件、退出码、清理和租约事实检查器，可从 F1 的“高级运行事实”进入。

**前置条件**

- 明确操作者权限或仍保持本机单用户。
- 明确日志/事件敏感字段过滤。
- 不改变主工作台默认密度。

**禁止**

- 不为检查器把整站改成深色。
- 不暴露 token、owner、provider instance ID、region。
- 不增加“强制释放”等绕过租约安全的按钮。

**规模**  
L

## 3. 建议实施批次

| 批次 | 票据 | 目标 |
|---|---|---|
| 批次 1 | P0-01 | 状态、路由、测试基线 |
| 批次 2 | P0-02 | 三栏壳与队列 |
| 批次 3 | P0-03 | 创建、绑定 |
| 批次 4 | P0-04 | 会话与 SSE |
| 批次 5 | P0-05 | 只读回执 API |
| 批次 6 | P0-06 | 结束与回执 |
| 批次 7 | P1-01、P1-02 | 质量收口 |
| 批次 8 | P1-03 | 验收与清理 |

P0-05 若资源允许，可与批次 2/3 并行；除此之外默认串行，减少 `Serving.tsx` 和 `api.ts` 冲突。
