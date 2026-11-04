# Serving F1.1 技术设计

Status: planning-only  
Scope: React 前端重构与只读生命周期投影  
Hard constraint: P0 不新增数据库迁移，不修改 Worker 状态机

## 1. 设计原则

1. 保留 `frontend/src/app/App.tsx` 对 `../features/serving/Serving` 的现有导入，`Serving.tsx` 继续导出 `Serving`。
2. 后端仍是状态事实的唯一来源；前端只派生展示状态，不伪造清理完成。
3. 复用现有 `InstanceFields`、`ManualInstanceDialog`、runtime compatibility 和 shared HTTP 机制。
4. 不新增 React Router、Query、Zustand、Redux、Playwright 或 UI 组件库。
5. P0 的回收回执只读取现有 `gpu_reservations` 与 `gpu_lease_events` 事实，不写表、不新增迁移。

## 2. 现有事实

### 前端

当前关键文件：

- `frontend/src/features/serving/Serving.tsx`
- `frontend/src/features/serving/conversation.ts`
- `frontend/src/features/resources/InstanceFields.tsx`
- `frontend/src/features/resources/ManualInstanceDialog.tsx`
- `frontend/src/shared/http.ts`
- `frontend/src/shared/styles/app.css`
- `frontend/src/shared/styles/controls.css`

当前页面在一个组件内做全部事情：加载 Adapter/runtime/队列、2.5/3 秒轮询、创建、绑定、SSE、停止生成、结束回收。

### 后端

关键文件：

- `backend/src/modelforge/modules/serving/routes.py`
- `backend/src/modelforge/modules/serving/use_cases.py`
- `backend/src/modelforge/modules/resources/leases.py`
- `backend/migrations/versions/0009_gpu_leases.py`
- `backend/migrations/versions/0011_execution_workflows.py`

现有 `GET /api/v1/serving/trials/{id}` 直接返回 `inference_trials` 行。GPU 租约与事件已有完整字段，但当前未投影到 Trial 详情。

## 3. 目标文件结构

只按实际需要创建文件，不建立空目录或纯转发层。

```text
frontend/src/features/serving/
├── Serving.tsx                 # 页面装配、路由、轮询和跨区域动作
├── api.ts                      # Serving 业务端点、类型和错误映射辅助
├── serving-model.ts            # 纯函数：路由、状态派生、排序、文案
├── conversation.ts             # 保留，并补足会话边界测试
├── serving.css                 # feature 样式，类名使用 serving- 前缀
└── components/
    ├── ServingQueue.tsx
    ├── CurrentTrialHeader.tsx
    ├── ServingSession.tsx
    ├── TrialContextPanel.tsx
    ├── CreateTrialDialog.tsx
    ├── BindInstancePanel.tsx
    ├── StopTrialDialog.tsx
    └── LifecycleReceipt.tsx

frontend/tests/
├── serving-model.test.mjs
└── conversation.test.mjs       # 现有文件，仅在语义变化时补充

backend/src/modelforge/modules/serving/
├── routes.py                   # 仅 detail 路由接入只读生命周期投影
└── use_cases.py                # 增加读取方法，不改变写状态机

backend/tests/
└── test_serving_lifecycle.py   # 新建只读投影与兼容性测试
```

### 组件职责

| 文件 | 职责 |
|---|---|
| `Serving.tsx` | 读取 route；列表/详情轮询；selected Trial；创建/绑定/结束动作协调；组合桌面与移动布局 |
| `ServingQueue.tsx` | 展示和选择 Trial；过滤/搜索/排序在 P1 接入 |
| `CurrentTrialHeader.tsx` | 统一状态、Trial ID、Adapter 摘要、主操作 |
| `ServingSession.tsx` | 会话、部分输出、停止生成、清空、输入与参数 |
| `TrialContextPanel.tsx` | Adapter/基座/指纹、实例、空闲回收、结束入口、回执入口 |
| `CreateTrialDialog.tsx` | Adapter 选择、`InstanceFields`、运行时摘要、手动创建确认 |
| `BindInstancePanel.tsx` | 实例要求、实例 ID、授权清理、绑定错误 |
| `StopTrialDialog.tsx` | 结束后果确认，不直接拼业务请求 |
| `LifecycleReceipt.tsx` | 进程、实例、清理、租约事实与不完整状态 |

## 4. 路由设计

### 类型与解析

```ts
type ServingRoute = {
  trialId: string;
  create: boolean;
};
```

纯函数：

```ts
parseServingRoute(search: string): ServingRoute
servingRouteQuery(route: ServingRoute): string
```

规则：

- `trial` 去除首尾空白；空值表示未选择。
- `view=create` 表示创建弹层打开。
- 不把 UUID 格式作为前端路由有效性的唯一条件；非法格式由 API `404/422` 统一映射为 `invalid_route` 视图。
- 未知 query 不解释。

### URL 形式

```text
?trial=<uuid>#serving
?view=create#serving
?trial=<uuid>&view=create#serving
```

### 导航

- 首次挂载：`parseServingRoute(location.search)`。
- 选择 Trial：`history.pushState(null, '', location.pathname + servingRouteQuery(next) + '#serving')`。
- 打开创建：使用 `pushState`，保留当前 Trial。
- 关闭创建：使用 `replaceState` 去掉 `view=create`，避免直接打开深链时按关闭却退出整个页面。
- 点击“回到队列”：清除 `trial`，保留当前 `create` 状态；不自动选第一条。
- 创建成功：在新 Trial 详情返回后 `pushState` 到 `?trial=<new-id>#serving` 并关闭 create。
- 监听 `popstate`，重新解析 route。
- 页面卸载或 `#serving` 不再是当前页时终止轮询和 SSE。

### 出错规则

- 详情 `404 not_found` 或 UUID 格式导致的 `422 validation_error`：`invalid_route`。
- 网络错误且已有上一次详情：保留数据并标 `stale`，不转成 `invalid_route`。
- 创建弹层打开时 Trial 被删除：保留弹层，关闭后详情区显示 `invalid_route`。

## 5. 数据模型

### 原始 Trial

```ts
type RawTrialState =
  | 'queued'
  | 'waiting_instance'
  | 'preparing'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'blocked';

type RequestState = 'idle' | 'running' | 'cancelling' | 'unknown';

type Trial = {
  id: string;
  state: RawTrialState | string;
  adapter_id: string;
  instance_id?: string | null;
  error_code?: string | null;
  stop_requested: boolean;
  request_state: RequestState | string;
  request_cancel_requested: boolean;
  last_activity_at: string;
  snapshot: {
    base: {id: string; fingerprint: string};
    instance: InstanceSpec;
    adapter_fingerprint: string;
    config?: {template?: string; cutoff_len?: number; lora_rank?: number};
  };
  lifecycle?: TrialLifecycle;
};
```

### 生命周期投影

后端 `GET /api/v1/serving/trials/{id}` 在保留现有顶层字段的同时增加：

```ts
type LifecycleEvent = {
  action:
    | 'reserved'
    | 'creation_requested'
    | 'instance_bound'
    | 'execution_requested'
    | 'process_exited'
    | 'cleanup_allowed'
    | 'instance_stopped'
    | 'deletion_failed'
    | 'deletion_confirmed'
    | 'released';
  recorded_at: string;
};

type TrialLifecycle =
  | {status: 'not_reserved'}
  | {status: 'unavailable'; error_code: 'lifecycle_unavailable'}
  | {
      status: 'tracked';
      creation: {
        state: 'not_requested' | 'requested' | 'bound';
      };
      process: {
        state: 'not_started' | 'unknown' | 'exited';
        exit_code: number | null;
        cancelled: boolean;
        exited_at: string | null;
      };
      instance: {
        state: 'none' | 'unknown' | 'stopped' | 'deleted';
        stopped_at: string | null;
        deleted_at: string | null;
      };
      cleanup: {
        policy: 'discard' | 'outputs_persisted' | null;
        state: 'not_requested' | 'pending' | 'failed' | 'confirmed';
        error_code: 'instance_delete_failed' | null;
      };
      lease: {
        state: 'held' | 'released';
        created_at: string;
        released_at: string | null;
      };
      events: LifecycleEvent[];
    };
```

字段来源：

| 输出 | 来源 |
|---|---|
| `status=not_reserved` | `inference_trials.lease_id IS NULL` |
| `creation.state` | `gpu_reservations.create_state` |
| `process.state/exit_code/cancelled` | `gpu_reservations.process_state/exit_code/process_cancelled` |
| `process.exited_at` | 最后一条 `process_exited` 事件时间 |
| `instance.state` | `gpu_reservations.instance_state` |
| `instance.stopped_at` | 最后一条 `instance_stopped` 事件时间 |
| `instance.deleted_at` | 最后一条 `deletion_confirmed` 事件时间 |
| `cleanup.policy/state/error_code` | `cleanup_policy/cleanup_state/cleanup_error_code` |
| `lease.state/created_at/released_at` | `state/created_at/released_at` |
| `events` | `gpu_lease_events` 白名单动作 |

不输出：

- `owner_kind`、`owner_id`、`generation`
- `create_operation_id`
- `provider_instance_id`
- `region`
- `heartbeat_at`
- 任何运行时 token、云凭据或内部进程参数

`renewed` 心跳事件不进入默认回执，避免每 2.5 秒响应包含大量无意义记录。其余事件最多返回最近 50 条，按记录时间正序。

### 结束结论判定

```ts
type ReceiptConclusion =
  | 'reclaimed'
  | 'no_instance'
  | 'incomplete';

function classifyReceipt(lifecycle?: TrialLifecycle): ReceiptConclusion {
  if (!lifecycle) return 'incomplete';
  if (lifecycle.status === 'not_reserved') return 'no_instance';
  if (lifecycle.status === 'unavailable') return 'incomplete';
  if (lifecycle.lease.state !== 'released' || !lifecycle.lease.released_at) {
    return 'incomplete';
  }

  const neverCreated = lifecycle.creation.state === 'not_requested'
    && lifecycle.instance.state === 'none'
    && lifecycle.process.state === 'not_started'
    && lifecycle.cleanup.state === 'not_requested';
  if (neverCreated) return 'no_instance';

  const instanceReclaimed = lifecycle.process.state !== 'unknown'
    && lifecycle.instance.state === 'deleted'
    && lifecycle.cleanup.state === 'confirmed';
  return instanceReclaimed ? 'reclaimed' : 'incomplete';
}
```

`no_instance` 允许两种可核实情形：

- `status=not_reserved`：Trial 从未持有租约。
- `status=tracked + creation.state=not_requested + instance.state=none + process.state=not_started + cleanup.state=not_requested + lease.state=released`：曾持有租约，但在创建或启动实例前已安全释放。

两种都只能显示“已结束 · 未占用实例 / 未创建云实例”，不能显示“云实例已删除”。

## 6. 统一 UI 状态

`serving-model.ts` 输出 discriminated union：

```ts
type TrialViewState =
  | {kind: 'loading'}
  | {kind: 'invalid_route'; trialId: string}
  | {kind: 'queued'}
  | {kind: 'waiting_instance'}
  | {kind: 'preparing'}
  | {kind: 'ready'}
  | {kind: 'generating'}
  | {kind: 'cancelling'}
  | {kind: 'request_unknown'}
  | {
      kind: 'ending';
      phase: 'stop_requested' | 'process_exited' | 'cleanup_pending' | 'lease_pending';
    }
  | {kind: 'blocked'}
  | {kind: 'ended'; receipt: 'complete' | 'no_instance' | 'incomplete'}
  | {kind: 'unknown'; rawState: string; rawRequestState: string};
```

### 派生顺序

```text
route/404
→ blocked
→ stopped
→ request_state=unknown
→ stop_requested 或 stopping
→ cancelling / request_cancel_requested
→ running
→ waiting_instance
→ preparing
→ queued
→ ready + idle
→ unknown
```

派生函数只依赖输入对象，不使用 `Date.now()`；空闲倒计时由独立格式化函数在渲染时计算。

### 结束阶段

```text
process != unknown + lease released + instance deleted + cleanup confirmed
  → ended.complete

lease released + creation not_requested + instance none + process not_started + cleanup not_requested
  → ended.no_instance

instance deleted && lease held
  → ending.lease_pending

process exited || cleanup.state != not_requested
  → ending.cleanup_pending

其他 stop_requested/stopping
  → ending.stop_requested
```

`request_state=unknown` 优先于 `ending` 时，页面仍显示结束回执，同时在主区提示“上一次生成状态未知”，禁止发送。

## 7. 前端 API

继续使用现有端点，不新增写接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/v1/serving/trials` | 队列，最多 200 条 |
| `GET` | `/api/v1/serving/trials/{id}` | 当前详情 + `lifecycle` |
| `POST` | `/api/v1/serving/trials` | 创建 Trial |
| `POST` | `/api/v1/serving/trials/{id}/instance` | 绑定手动实例 |
| `POST` | `/api/v1/serving/trials/{id}/stop` | 请求结束与回收 |
| `POST` | `/api/v1/serving/trials/{id}/chat` | SSE 生成 |
| `POST` | `/api/v1/serving/trials/{id}/cancel-request` | 停止当前生成 |

`api.ts` 只封装 Serving 业务端点与响应类型；底层请求仍通过 `../../shared/http`。

### 兼容性

- `lifecycle` 是新增可选字段，旧客户端应忽略。
- 列表接口不增加 `lifecycle`，避免 N+1 查询。
- `GET detail` 在无租约时返回 `lifecycle: {status: 'not_reserved'}`，而不是 `null`。
- 如果 `lease_id` 存在但租约记录缺失或无法安全投影：HTTP 仍返回 `200`，`lifecycle` 为 `{status:'unavailable', error_code:'lifecycle_unavailable'}`。这样保留 Trial 基本数据，同时不伪造空回执或成功态；事件投影失败不改变顶层详情。

## 8. 后端只读投影

建议增加读取方法，不改变内部 `get()` 的轻量行为：

```py
Serving.get_with_lifecycle(identifier)
```

步骤：

1. 复用 `Serving.get(identifier)` 读取 Trial，保持 `404` 行为。
2. `lease_id` 为空时附加 `not_reserved`。
3. 通过 `GpuLeases(self.pool).get(lease_id)` 取得资源模块公开快照。
4. 用纯投影函数只选择允许字段并补充事件时间。
5. `routes.py` 的 `detail()` 改为调用该方法；`list()` 保持原样。

禁止：

- 直接在 `routes.py` 拼接 SQL。
- 在 `serving` 中重写租约状态机。
- 调用 `renew`、`cleanup`、`reconcile` 或其他写操作。
- 把回执计算放进轮询用的轻量 `get()`，以免 Worker 内部每次读取产生额外查询。

## 9. 轮询与数据一致性

### 队列

- 间隔 3 秒。
- 仅 `document.visibilityState === 'visible'` 时请求。
- `inFlight` 锁保证不重叠。
- 请求失败保留上一次成功数据，记录 `lastLoadedAt`。
- 使用 `AbortController` 在卸载或重新进入时取消旧请求。

### 详情

- 间隔 2.5 秒。
- 只在有 `trialId` 且 Trial 不处于最终稳定错误时请求；已结束但事实不完整仍继续低频刷新，以便 Worker 对账后恢复完整事实。
- 切换 Trial 时立即清除旧详情、会话、绑定表单与流状态。
- 不因轮询结果覆盖用户正在编辑的输入框。
- 创建、绑定、停止等动作返回后立即刷新一次详情。

### 过期

首次加载失败与刷新失败区分：

- 首次失败：显示错误状态。
- 刷新失败：继续显示旧数据，顶部/局部标记“数据已过期”与最后成功时间。

## 10. SSE 状态机

### 发送前

只有以下条件全部成立：

- `state=ready`
- `request_state=idle`
- `stop_requested=false`
- 本页未在发送或取消
- 输入非空且在长度限制内

### 发送

```text
ready
→ 本地 loading_delta
→ POST chat
→ event: request
→ event: delta...
→ event: done(partial=false|true)
→ preparing idle refresh
→ ready
```

### SSE 帧处理

- 必须按 `\n\n` 拆帧。
- 支持一个网络 chunk 内多个事件、一个事件跨多个 chunk。
- 只处理 `request`、`delta`、`done`、`error`。
- `data` JSON 解析失败时保留已收输出并显示“响应格式无法确认”，不把最后一条消息标为完成。
- 无 terminal event 就断开连接时，标记部分输出并调用 `cancel-request`，随后通过详情轮询核对。

### 停止生成

```text
idle → running → 用户点击停止
→ 本地 cancelling
→ POST cancel-request
→ 服务端 request_cancel_requested=true
→ SSE done(partial=true) 或详情 request_state=idle
→ 恢复 ready/idle，保留 partial 消息
```

竞态规则：

- 使用递增 generation 标记；Trial 切换或新请求使旧流失效。
- 旧流迟到的 delta 不得写入新 Trial。
- 同一 Trial 同时只保留一个 `AbortController`。
- 页面卸载时中止 fetch；不要假设中止已在服务端结束请求。
- 停止按钮成功后不立即把后端状态改成本地 `idle`。

### 会话上下文

沿用 `requestMessages`：

- 只发送非 `partial` 且内容非空的 user/assistant 消息。
- 部分输出留在当前页面，但不进入下一轮上下文。
- 清空只清本地 `messages`，只允许在 `request_state=idle` 时执行。

## 11. 错误映射

| HTTP / code | UI 处理 |
|---|---|
| `404 not_found` | `invalid_route` 或队列项失效 |
| `422 base_region_mismatch` | 创建表单提示必须使用基座固定地域 |
| `409 gpu_busy` | 创建禁用；说明已有训练/试用持有 GPU |
| `409 trial_not_waiting` | 刷新 Trial，提示绑定窗口已变化 |
| `422 manual_binding_ack_required` | 高亮授权勾选，未确认归属不得绑定 |
| `409 manual_instance_not_running` | 实例不存在、非 Running 或规格不匹配；保留输入 |
| `409 manual_binding_conflict` | 该实例或租约已有绑定关系；刷新并核对 |
| `409 gpu_instance_conflict` / `gpu_creation_conflict` | 保留实例提示，不可重复绑定 |
| `409 trial_busy` | 禁止并发生成；刷新详情等待 idle |
| `409 gpu_release_unverified` | 显示回执缺失，不显示成功 |
| `409 gpu_runtime_incompatible` | 实例运行时不符合 lock；保留实例并要求核对 |
| `503 adapter_probe_pending` | 准备中，不误报 ready |
| `503 remote_launch_unconfirmed` | 远端启动/退出事实缺失；保留实例 |
| `503 remote_process_unknown` | 运行事实未知；禁止再次发送 |
| `request_state_unknown` | 专用未知状态；等待对账 |
| `remote_request_unconfirmed` | 部分输出 + 请求结果未确认 |
| `lifecycle.status=unavailable` | 回执暂不可读；保留 Trial，显示待核对，不显示绿色完成态 |
| 网络错误 | 保留输入和已加载数据，提供重试 |

原始 `error_code` 可展开显示，但不作为唯一用户文案。

## 12. 创建和绑定实现

- `CreateTrialDialog` 内部复用 `InstanceFields` 与 `emptyInstance`。
- 不修改资源模块字段定义。
- `runtime` 未加载时禁用创建，并显示加载失败原因。
- Adapter 列表来自现有 `listAdapters`，筛选 `state=available`；不兼容项保留并禁用。
- 基础/高级分组只影响展示，不改变提交结构。
- 确认提交前复用 `ManualInstanceDialog purpose="独立推理"`。
- 创建成功后使用接口返回的 Trial；不依赖下一次轮询才选择。
- 绑定使用 `snapshot.instance`，不接受当前创建表单草稿替代。

## 13. 样式隔离

- 新 CSS 文件为 `features/serving/serving.css`。
- 根容器 `.serving-page` 内定义 feature CSS variables。
- 新类名统一 `serving-` 前缀，避免与全局 `.panel`、`.notice`、`.badge`、`.form-grid` 冲突。
- 可以复用全局按钮、输入基础和 `SelectMenu` 行为，不在 feature 内重写全局标签选择器。
- 不修改 `app.css` 的全局 token，除非另立跨模块设计系统票据。

## 14. 测试接点

### `serving-model.test.mjs`

- 路由解析与 query 往返。
- 创建弹层保留 `trial`。
- 所有 raw 状态到 `TrialViewState` 的优先级。
- `request_state=unknown` 禁止发送。
- `state=stopped` + 完整 lifecycle → `ended.complete`。
- `state=stopped` + 缺 lifecycle → `ended.incomplete`。
- instance 已删除但 lease 未释放 → `ending.lease_pending`。
- `not_reserved` 结束态。
- 队列排序稳定性与 selected 固定（P1）。
- 回执缺项文案与不泄露字段。

### `conversation.test.mjs`

- partial assistant 不进入下一轮。
- 空内容被过滤。
- 顺序保持 user/assistant。

### 后端

- `GET detail` 保持旧字段。
- 无租约返回 `not_reserved`。
- 有租约时只返回白名单字段。
- 是否过滤 `renewed`、事件上限、时间字段。
- `stopped` 不因投影查询而被写回或改变。
- `lifecycle.status=unavailable` 不伪造默认成功。

### 浏览器

- 路由刷新恢复。
- 无效 URL。
- 创建、绑定、ready、SSE、停止、清空、结束与回执。
- 四档视口和键盘焦点。

## 15. 明确禁止

- 新增 Alembic migration。
- 修改 `inference_trials`、`gpu_reservations` 或 `gpu_lease_events` 写入逻辑。
- 修改 Worker 调度、停止、清理或租约释放顺序。
- 在 UI 中把 `stop_requested=true` 直接解释成实例已删除。
- 持久化聊天或人工评级。
- 增加运行时依赖。
- 修改 Training 模块。
- 把设计原型 HTML 原样复制进 React 生产代码。
