# 训练工作台 B2 生产化实施记录

日期：2026-11-03
范围：将已评审的 B2「训练工作台」设计落入 ModelForge 前端生产代码，并保持真实训练数据、真实 Adapter 与原有创建/取消/重试能力。
状态：本地实现、只读真实验证、测试与构建已完成；提交与部署范围仅限本地。

## 1. 入口与回退

- 默认入口：`#training`，渲染新的训练工作台。
- 旧页面回退：`?training=legacy#training`，原训练页面保留为 `TrainingLegacy.tsx`。
- `frontend/src/features/training/index.ts` 仍导出 `Training`，未把训练业务状态扩散到 `App.tsx`。
- 训练内部详情切换使用 `attempt`、`tab` query，不改变全局路由。

## 2. 已落地

### 2.1 训练工作台

- 四个摘要指标：活动运行、等待实例、已成功、需要关注。
- 当前 Attempt 主卡：真实状态、阶段、Step、Epoch、Train Loss、Eval Loss、Learning Rate。
- 五阶段生命周期：排队、实例准备、训练、产物、回收；失败/取消只标记实际到达的阶段。
- Loss / Eval Loss / Learning Rate 图只使用 `attempt.metrics` 中已上报的真实采样。
- 待处理事项、运行事实和 Attempt 账本均来自 `GET /training/attempts` 的真实 summary。
- 状态筛选、名称/ID/错误代码搜索可组合；无结果有独立空态。
- 列表约 3 秒、详情和日志约 2.5 秒轮询；页面隐藏时暂停；刷新失败保留上一份成功快照并标记过期风险。

### 2.2 新建训练

- 保留原有四步流程：输入、计算环境、参数、冻结确认。
- 保留 `InstanceFields`、手动实例确认、数据版本、基座兼容性、配置复用和原有 payload 字段。
- 字段级错误、顶部错误摘要、`aria-invalid`、`aria-describedby` 和错误摘要焦点定位已连接。
- 第 4 步为冻结输入的只读复核；提交成功进入新 Attempt，失败保留当前输入。
- 提交仍经过既有 `ManualInstanceDialog`，不会自动购买 GPU 或启动真实训练。

### 2.3 运行详情

五个页签：

1. 运行总览：状态、五阶段、动作、运行事实、手动实例绑定与清理授权。
2. 运行分析：Train/Eval Loss、Learning Rate、结束后 GPU 显存峰值快照。
3. 训练日志：分页、级别筛选、文本搜索、follow tail、缺口和读取失败区分。
4. 训练产物：通过真实 Adapter 列表接口加载当前 Attempt 的 Best / Final；门禁只在 `2 / 2` 时显示可用。
5. 冻结输入：数据集、基座、参数、实例、兼容性分组；raw JSON 只在可展开区域出现。

详情页头支持安全取消与终端状态下的重试；两者都使用二次确认，不自动发送请求。

### 2.4 数据契约

- 列表接口 `GET /training/attempts` 不返回完整 `snapshot`，只返回 `snapshot_sha256`；列表只使用 summary。
- 详情接口 `GET /training/attempts/{id}` 才返回完整 `snapshot`。
- `learning_rate` 是可选前端字段；缺失时不生成零值曲线。
- GPU 显存只读取 `runtime_report.training_memory` 的结束后峰值快照，不把它画成实时显存曲线。
- Gradient Norm、吞吐、实时显存、Accuracy / F1 在当前接口未上报时显示能力边界，不伪造数据。

## 3. 设计与组件

### 3.1 视觉 token

| 用途 | 值 |
|---|---|
| 页面画布 | `#f6f8fb` |
| 面板 | `#ffffff` |
| 边框 | `#dfe5ed` |
| 主文字 | `#172033` |
| 次文字 | `#667386` |
| 主蓝 | `#245ad0` |
| 成功 | `#247553` |
| 警告 | `#9b6512` |
| 危险 | `#b23a37` |
| 字体 | `"Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif` |
| 数字 / ID | `Consolas, "SFMono-Regular", monospace` |
| 控件圆角 | `6px` |
| 卡片圆角 | `8px` |

深色只用于 Loss 图和日志控制台，不扩展到页面壳层。页面不使用营销式 hero、玻璃拟态或装饰性渐变。

### 3.2 组件拆分

```text
frontend/src/features/training/
  page.tsx                      视图切换、轮询、动作与错误边界
  api.ts                        训练与 Adapter 只读请求
  types.ts                      Attempt / Snapshot / Metric / Log 契约
  training-model.ts             状态字典、生命周期、摘要、筛选、图表与日志纯函数
  components/
    TrainingWorkbench.tsx       工作台、摘要、当前运行、账本
    CreateTrainingWizard.tsx    四步创建与校验
    AttemptDetail.tsx           详情壳层、页签、取消/重试
    RunOverview.tsx             总览、生命周期、实例绑定
    RunAnalysis.tsx             指标页与能力边界
    MetricChart.tsx             真实采样 SVG 图与空态
    TrainingLogs.tsx            日志分页、筛选、跟随
    ArtifactsPanel.tsx          Best / Final 门禁
    FrozenInputs.tsx            冻结输入
    TrainingDialog.tsx          原生 modal dialog + 焦点恢复
    TrainingStatusBadge.tsx     状态标签
    LifecycleRail.tsx           五阶段生命周期
```

### 3.3 关键交互修复

- 失败详情不再使用裸 `.danger` class，避免被全局按钮 `.danger` 背景样式染成整片红色。
- `dialog` 显式设置 `role="dialog"`、`aria-modal="true"`；Escape 关闭后焦点返回触发按钮。
- 1024 / 768 宽度下，Training 页不再因账本表格最小宽度产生页面级横向滚动。
- 1280 宽度下生命周期标签允许换行，不再出现“实例 / 准...”截断。
- 390 宽度下生命周期隐藏视觉标签，但每个节点保留 `aria-label` 与 `title`，读屏和悬停仍能得到阶段名与状态。

## 4. 自动化验证

在 `frontend/` 执行：

```powershell
npm test
npm run build
```

结果：

- `npm test`：59 项通过，0 失败。
- `npm run build`：TypeScript `--noEmit` 与 Vite 生产构建通过。
- 构建保留既有的单 chunk 体积提示：主 JS 约 568 kB（gzip 约 162 kB）；本轮未做代码分割。
- `git diff --check` 无空白错误。

测试覆盖摘要、当前 Attempt 选择、生命周期、metrics 清洗、日志筛选和训练 query 解析等纯函数。

## 5. 浏览器验收

使用 Ego Lite 驱动真实本地页面，只读真实 API；未提交训练、未创建 GPU、未写数据库。

### 5.1 宽度与溢出

| 视口 | 页面宽度 | 页面级横向溢出 |
|---|---:|---|
| 1440 | 1440 / 1440 | 0 |
| 1280 | 1280 / 1280 | 0 |
| 1024 | 1014 / 1014 | 0 |
| 768 | 758 / 758 | 0 |
| 390 | 390 / 390 | 0 |
| 720 CSS px @ 2x（200% 代理） | 710 / 710 | 0 |

在 1024 宽度下账本表格仍保留 17px 的内部横向滚动，但不会撑开页面；在 768 及以下切为卡式信息行。

### 5.2 已实测交互

- 默认工作台加载真实 5 个 Attempt，当前选择为成功 Attempt `#3`。
- 创建页空表单点击“下一步”：显示 3 项错误摘要，摘要获得焦点，3 个字段带 `aria-invalid`。
- 日志搜索 `eval_loss`：显示 `2 / 2` 行；ERROR 筛选显示 `0 / 0` 与空态。
- 重试弹窗：`role="dialog"`、`aria-modal="true"`、标题关联正确；Escape 关闭后焦点回到“创建重试 Attempt”。
- 训练产物：真实 Adapter 显示 `Best / Final 2 / 2`，Best 与 Final 均可下载/核对/进入推理试用。
- 失败 Attempt `9235ba4d…`：显示 `runtime_incompatible` 错误与空指标，不显示伪造曲线。
- 旧入口 `?training=legacy#training` 可打开原训练页面，新工作台不渲染。
- 当前浏览器 `console.error = 0`、`pageerror = 0`。

### 5.3 截图

目录：

```text
<project-root>\.scratch\ego\training-workbench-final-20261103\
```

- `workbench-1440.png`
- `workbench-final.png`
- `workbench-1280.png`
- `workbench-1024.png`
- `workbench-768.png`
- `workbench-390.png`
- `workbench-1440-zoom200.png`
- `create-1440.png`
- `create-validation-1440.png`
- `create-390.png`
- `detail-overview-1440.png`
- `analysis-1440.png`
- `analysis-390.png`
- `logs-1440.png`
- `logs-filtered-1440.png`
- `logs-390.png`
- `artifacts-1440.png`
- `frozen-1440.png`
- `failed-overview-1440.png`
- `failed-analysis-1440.png`
- `dialog-retry-1440.png`
- `legacy-fallback-1440.png`
- `qa-report.json`

## 6. 真实数据基线

成功 Attempt：

- ID：`fbbe9980-1b83-44b9-9880-422efb4a1f4d`
- 名称：`Qwen3-0.6B GPU peak measurement r1 20261102`
- Attempt `#3`，`succeeded / finished`
- 22 个 Train 点、1 个 Eval 点、22 个 Learning Rate 点
- 最新 Train Loss：`0.1998`
- Eval Loss：`0.2147834300994873`
- 最后 Learning Rate：约 `1.0178558e-6`
- GPU 显存峰值：Device `2.40 GiB` / Torch allocated `1.55 GiB` / Torch reserved `1.57 GiB`，92 次采样，间隔 250 ms
- Best / Final：`2 / 2`
  - Best `a515ea2c-74f9-5982-b5aa-5c4985eb3604`
  - Final `ffb81e74-67bd-543c-b03f-b9e151e40cf1`

失败 Attempt：

- ID：`9235ba4d-aa92-4d32-b56e-c3ce835dd831`
- `runtime_incompatible`
- 无 metrics；运行分析显示真实空态，不生成 Loss / LR 曲线。

## 7. 未覆盖与限制

- 没有提交真实训练任务，没有购买或绑定真实 GPU，没有消耗 GPU。
- 没有构造 `waiting_instance` 的数据库 fixture；实例 ID 与清理授权表单只通过代码路径和既有真实数据检查。
- 没有执行取消确认后的真实远程回收；本轮只验证弹窗、请求前置条件和焦点行为。
- 没有修改后端、数据库、迁移、MinIO、Compose 或 runtime lock。
- Gradient Norm、吞吐、实时 GPU 显存、Accuracy / F1 仍受当前接口能力限制。
- 390 宽度的共享顶部导航仍为横向滚动，属于 App shell 既有行为；训练详情页签在窄屏也保持横向滚动。
- 页面构建仍有 500 kB chunk 提示，不影响本轮功能验证。

## 8. 修改文件

生产代码：

- `frontend/src/features/training/index.ts`
- `frontend/src/features/training/page.tsx`
- `frontend/src/features/training/TrainingLegacy.tsx`
- `frontend/src/features/training/api.ts`
- `frontend/src/features/training/types.ts`
- `frontend/src/features/training/training-model.ts`
- `frontend/src/features/training/training.css`
- `frontend/src/features/training/components/*`

测试与记录：

- `frontend/tests/training-model.test.mjs`
- `docs/implementation/training-workbench-redesign-2026-11-03.md`

原 `frontend/src/features/training/Training.tsx` 已由 `TrainingLegacy.tsx` 承接旧页面，`index.ts` 的对外导出名保持不变。

## 9. 当前结论

B2 已作为默认 `#training` 生产入口落地；旧入口可回退。真实成功数据、失败空态、创建校验、日志筛选、产物门禁和弹窗焦点均已实际验证。当前工作区未 commit、未 push、未部署。
