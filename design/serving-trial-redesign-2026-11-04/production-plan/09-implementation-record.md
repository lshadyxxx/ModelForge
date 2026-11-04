# Serving / 推理试用 F1.1 实施记录

Status: implemented-local / browser-verified / real-gpu-verified  
Date: 2026-11-04  
Scope: ModelForge「推理试用 / Serving」，不包含「训练 / Training」

## 1. 结论摘要

F1.1 已落实到正式前端与后端，不再只是原型：

- 左侧「推理试用」现在使用「队列 + 会话 + 运行事实」三栏工作台。
- 创建与绑定改为弹层，Trial 选择使用 URL query 深链。
- 生命周期、请求、停止和回收事实合并为可执行的用户状态。
- 详情接口只读投影进程、实例、清理与 GPU 租约事实，不改写 Trial、Worker 或数据库结构。
- 1440、1024、768、390 四个宽度完成真实浏览器检查。
- 本轮没有修改「训练 / Training」页面。

2026-11-04 17:42 至 18:12，精确推理规格库存恢复后，新的真实 GPU 闭环已完成：
实例创建、运行时校验、正式 Trial 绑定、真实 SSE、停止与释放全部通过。完整证据见
`11-live-serving-gpu-acceptance.md`。

此前 16:28 的 `ResourceEnough=false` 与 `409 cloud_selection_unavailable` 仍作为
历史阻塞事实保留，不删改；它不再是本轮最终状态。

## 2. 代码实施

### 前端

目录：`frontend/src/features/serving/`

- `Serving.tsx`：工作台编排、路由深链、队列/详情轮询、会话、SSE、动作协调。
- `serving-model.ts`：状态优先级、评分卡、路由、回执、错误文案。
- `api.ts`、`types.ts`、`conversation.ts`：传输、合同与上下文边界。
- `serving.css`：三栏布局、1024 上下文抽屉、900 以下队列抽屉、390 双抽屉、焦点与 reduced-motion。
- `components/`：
  - `ServingQueue.tsx`：队列、筛选、已加载详情 lifecycle 合并。
  - `ServingSession.tsx`：等待、准备、就绪、生成、停止、失败、结束与无实例状态。
  - `CreateTrialDialog.tsx`：Adapter 与完整实例要求。
  - `BindInstancePanel.tsx`：冻结要求、实例 ID、清理授权。
  - `StopTrialDialog.tsx`：二阶段结束。
  - `TrialContextPanel.tsx`、`LifecycleReceipt.tsx`：运行事实与四项回收回执。
  - `ServingDialog.tsx`：原生 dialog 焦点、Escape 和关闭边界。
  - `CurrentTrialHeader.tsx`、`ServingIcon.tsx`：页头与图标。

本轮浏览器发现并修复：

1. 创建弹层初始焦点落在关闭按钮；改为显式 `data-dialog-autofocus`，否则聚焦首个表单字段。
2. 未加载 lifecycle 的历史 `stopped` Trial 被队列误标为“待核对”；改为“已结束”，并把已加载详情 lifecycle 合并回队列。
3. 创建弹层内 Adapter / 实例字段下拉看似没有样式、实际被 `<dialog>` top layer 盖住；共享 `SelectMenu` 改为在弹层内挂到最近的打开 dialog，并补齐「已选 / 不可选」、焦点和禁用态。

### 后端

- `backend/src/modelforge/modules/serving/routes.py`：详情读取使用 `get_with_lifecycle()`。
- `backend/src/modelforge/modules/serving/use_cases.py`：白名单只读投影。
- `backend/tests/test_serving_lifecycle.py`：字段、失败降级和泄漏边界测试。

明确未做：

- 没有新增 migration。
- 没有修改 Worker 状态机。
- 没有新增自动购买实例。
- 没有提交 Git、没有 push、没有部署到远程。

## 3. 自动化证据

| 检查 | 结果 | 证据 |
|---|---|---|
| 前端单测 | `69/69 passed` | `npm test` |
| 前端构建 | pass | `tsc --noEmit && vite build` |
| Serving 后端测试 | `14 passed` | `tests/test_serving_lifecycle.py` + `tests/test_serving_runtime.py` |
| Compose | 5 个服务健康 | `api/web/worker/postgres/minio` |
| 生产预览 | 可访问 | `http://127.0.0.1:8092/#serving` |

构建仅有既存 chunk 体积提示：`index-*.js` 约 633 kB，未作为本轮阻塞项。

## 4. 浏览器验收

浏览器：`ego-browser` TaskSpace 17，保留 Page `p1`。  
截图目录：`.runtime/serving-f11-acceptance/20261104/`

| 场景 | 证据 | 结果 |
|---|---|---|
| 空工作台 | `01-empty-1440.png` | pass |
| 完整回收详情 | `02-complete-detail-1440.png` | pass |
| 1024 工作台与运行抽屉 | `03-complete-1024.png`、`04-complete-1024-context.png` | pass |
| 768 工作台 | `05-complete-768.png` | pass |
| 390 会话、队列、运行抽屉 | `06` 至 `08` | pass |
| 390 创建弹层 | `09-create-390.png` | pass |
| 创建弹层焦点修复 | `13-create-focus-fixed-1440.png` | pass |
| 创建弹层下拉层级与选项状态 | `../review/select-audit-2026-11-04/after-adapter-1440.png` | pass |
| 下拉键鼠与 390 适配 | `after-adapter-390.png`、`after-metrics.json` | pass |
| 无实例结束 | `14-no-instance-1440.png`、`16`、`17` | pass |
| 慢网加载 | `18-loading-1440.png` | pass |
| API 失败与陈旧数据 | `19-api-failure-stale-1440.png` | pass |
| 恢复读取 | round-07 记录 | pass |

最终浏览器断言：

- 1440 与 390 均为零页面级横向溢出。
- 每页恰好一个 `h1`。
- 创建弹层初始焦点为 Adapter combobox，不是关闭按钮。
- 无效 `?trial=` 不自动选中队首。
- API 失败保留上次结果，并显示明确的过期提示；解除阻断后可恢复。
- 最终 console/runtime error 收集为 `[]`。

## 5. 真实 GPU 门

精确要求来自运行时基线：

| 字段 | 值 |
|---|---|
| Region / Zone | `cn-bj2` / `cn-bj2-03` |
| GPU | 1 × `4090` |
| CPU / Memory | 14 核 / 65,536 MiB |
| Image | `compshareImage-1fc8fjody17l` |
| Charge | `Postpay` |
| Boot disk | 100 GB `CLOUD_SSD` |

2026-11-04 的实时检查（16:21 与 16:28 两次，结果一致）：

- `Amd/Auto`、`Intel/Auto`、`Auto` 三种平台均无精确库存。
- `CheckCompShareResourceCapacity` 精确命中行返回 `ResourceEnough=false`。
- 正式 API 创建等待实例 Trial 返回 `409 cloud_selection_unavailable`。
- Provider 精确查询：`TotalCount=0`、`UHostSet=[]`。
- 数据库：`inference_trials=4`，`leases_held=0`，`leases_released=12`。
- 本轮未成功创建实例，因此没有遗留计费资源。

历史 Trial `3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92` 的四项回收事实仍可作为
历史回收事实证据，但**不计入本轮新 GPU 闭环**，也不能证明 2026-11-04 的流式推理。

### GPU 门状态

`PASS`（新 Trial `da4dfd18-bff6-4064-9998-2ff882610405`）：

- 精确单卡 4090 实例 `<redacted-instance-id>` 已进入 `Running`。
- CUDA 13.0 / vLLM 0.32.0 / Python 3.13.5 运行时校验通过。
- 正式 API 与正式页面均收到真实 SSE，`done.completed`。
- 进程退出、实例删除、清理确认、租约释放四项事实成立。
- Provider 精确 ID 查询连续两次为 0；数据库当前持有租约为 0。

本节上方的 2026-11-04 16:21/16:28 库存不足记录是恢复前的历史证据。新的闭环
不得改写为历史推断，详见 `11-live-serving-gpu-acceptance.md`。

库存恢复后的必需顺序：

1. 用精确规格创建独立实例，名称使用 `mf-serving-...`，不自动购买。
2. 固定 SSH 主机密钥并安装公钥；不持久化临时密码。
3. 在远端运行 `ModelForge/scripts/prepare-gpu-runtime.sh serve`。
4. 核对单卡 4090、CUDA、vLLM、Python 与 `pip check`。
5. 在正式页面创建 Trial，绑定实例，等待 `preparing → ready`。
6. 通过页面发送真实短消息，确认 SSE。
7. 页面结束 Trial，核对进程退出、实例删除、清理确认、租约释放。
8. Provider 精确 ID 查询必须为 0，数据库持有租约为 0。

## 6. 边界与后续

- 当前可以评估和预览正式页面、响应式、错误恢复和历史回收回执。
- 本轮真实 GPU 推理与回收闭环已通过，证据见 `11-live-serving-gpu-acceptance.md`。
- 当前会话仍只保存在页面内存，刷新即清空，这是产品约束而非缺陷。
- 生产发布前仍需：全后端套件回归、部署目标环境 smoke test、浏览器跨版本检查。

## 7. 预览与证据

- 正式预览：`http://127.0.0.1:8092/#serving`
- 完整详情：`http://127.0.0.1:8092/?trial=3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92#serving`
- 无实例状态：`http://127.0.0.1:8092/?trial=29efb08d-f4c7-4da1-9b5c-d180c18e6334#serving`
- 截图：`ModelForge/.runtime/serving-f11-acceptance/20261104/`
- 设计原型：`ModelForge/design/serving-trial-redesign-2026-11-04/`
- 下拉控件专项审计：`ModelForge/design/serving-trial-redesign-2026-11-04/production-plan/10-select-control-audit.md`
