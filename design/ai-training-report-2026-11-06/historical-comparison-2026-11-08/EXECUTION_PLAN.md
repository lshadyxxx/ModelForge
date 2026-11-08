# ModelForge AI 训练诊断
## 历史训练对比实施执行计划

日期：2026-11-08
代码基线：`62e92dd0fbb69cce0125560fcc5c2b9cdd625390`
状态：**本地实现完成；自动化与真实页面验收完成，未提交、未部署。**
实施方式：在现有 ModelForge 单仓库内纵向切片，不新建项目、不复制服务、不引入新框架。

## 1. 目标

交付一个可审计的历史训练对比能力：

- 自动找到同一基座、同一数据集内容和同一 split 的最近成功运行；
- 允许用户选择另一个可比基线；
- 确定性计算参数差异、指标差异、混杂因素、训练信号和置信度；
- 将比较结果提供给现有 LangGraph + `langchain-openai` 报告流程；
- LLM 只解释，不计算、不选择基线、不修改 Gate/Comparison；
- 首版不宣称真实模型效果提升；
- UI 在现有 A v2 AI 诊断页中展示双运行证据和未提交实验草稿；
- 保持现有单运行诊断、失败复盘和不可变报告兼容。

## 2. 非目标

- 不做不同基座或不同数据集比较。
- 不做多基线排名、批量 cohort 或自动历史最佳。
- 不接入 benchmark runner。
- 不新增 task metric、throughput 或 gradient norm 采集。
- 不修改训练执行逻辑和 LLaMA-Factory 参数。
- 不自动创建 GPU、提交训练或修改历史 Attempt。
- 不新建自主 Agent。
- 不部署、不推送 GitHub、不创建云资源。

## 3. 里程碑

| 里程碑 | 内容 | 退出条件 |
|---|---|---|
| M0 | 设计与契约冻结 | 本目录文档审阅通过 |
| M1 | DB + candidate query | 迁移、索引、候选查询单测通过 |
| M2 | ComparisonEngine | 18 个策略夹具通过 |
| M3 | EvidencePack/Graph/Prompt/Validator | 固定图与 AI 禁止表达测试通过 |
| M4 | API + Frontend | 生成、选择基线、报告展示可运行 |
| M5 | 验收 | 后端、前端、浏览器和证据归档完成 |

人工串行估算：5-7 个工程日。实际以测试与验收证据为准，不做工期承诺。

## 4. 工作分解

### HC-01 · 数据库与持久化扩展

目标：

- 新增实际 revision `0021_diagnosis_comparison`；
- 扩展 job/evidence/report；
- 保持旧报告可读；
- 添加 comparison key 表达式索引。

改动：

- `backend/migrations/versions/0021_training_diagnosis_comparison.py`
- `backend/src/modelforge/modules/diagnosis/repository.py`

验收：

- 空库 upgrade/downgrade；
- 既有 v1 报告仍能读取；
- 新增 job baseline 字段写入正确；
- report v2 不可变；
- 回滚脚本不破坏既有数据。

依赖：无。

### HC-02 · 候选查询与基线选择

目标：

- 从 subject Snapshot 计算 Hard Key；
- 查询同组历史成功 Attempt；
- 自动基线 = subject 之前最近成功；
- 显式基线严格复验；
- 返回最多 20 个候选摘要。

改动：

- 新增 `backend/src/modelforge/modules/diagnosis/comparison_repository.py`
- 或把只读查询放入 `comparison.py`，但不得污染现有 job repository
- `backend/src/modelforge/modules/diagnosis/contracts.py`

验收：

- 同哈希不同 dataset ID 仍可比；
- 同 dataset ID 不同 split 不可比；
- 同时间戳排序稳定；
- subject 自身排除；
- failed/cancelled 不进入首版候选；
- 无候选返回空列表。

依赖：HC-01。

### HC-03 · ComparisonEngine

目标：

- 纯函数、无 I/O；
- 参数 diff；
- 指标 diff；
- 回归检测；
- confidence；
- training/delivery/model-effect 状态；
- canonical digest。

改动：

- 新增 `backend/src/modelforge/modules/diagnosis/comparison.py`
- `backend/src/modelforge/modules/diagnosis/contracts.py`
- 新增 `backend/tests/test_training_comparison.py`

验收：

- `comparison-golden-v1` 至少 18 案例；
- 2% 阈值固定；
- 低置信度不升级；
- 多参数不单归因；
- model_effect 固定 unverified；
- 所有差值可复现。

依赖：HC-02。

### HC-04 · EvidencePack v2

目标：

- 冻结 subject 和 baseline；
- baseline 生成 `E-BASE-*` EvidenceRefs；
- baseline projection 脱敏；
- 比较结果进入 evidence digest；
- 没有基线时保持单运行报告。

改动：

- `backend/src/modelforge/modules/diagnosis/evidence.py`
- `backend/src/modelforge/modules/diagnosis/contracts.py`
- `backend/src/modelforge/modules/diagnosis/repository.py`

验收：

- baseline 证据 digest 稳定；
- subject/baseline ID 不冲突；
- baseline 日志不完整复制进 Prompt；
- 证据变化时 fail closed；
- source revision 可检测 stale。

依赖：HC-03。

### HC-05 · LangGraph v2、Prompt v4、Validator

目标：

- 新节点 `compare`；
- 双 Gate；
- comparison 进入 Prompt；
- Prompt v4 边界；
- Validator 新规则；
- 图表版本升级。

改动：

- `backend/src/modelforge/modules/diagnosis/graph.py`
- `backend/src/modelforge/modules/diagnosis/context.py`
- `backend/src/modelforge/modules/diagnosis/prompts.py`
- `backend/src/modelforge/modules/diagnosis/validator.py`
- `backend/tests/test_training_diagnosis.py`

验收：

- 固定拓扑测试；
- comparison mode none 可生成普通报告；
- auto/explicit 生成 v2；
- 模型不能改 comparison；
- 缺少 baseline evidence 被拒绝；
- 模型效果升级被拒绝；
- repair 仍最多一次；
- fail closed。

依赖：HC-04。

### HC-06 · API 与 Use Cases

目标：

- 新增候选 API；
- 创建报告支持 optional body；
- 自动/显式/none 三种模式；
- 幂等键加入 baseline；
- job 返回 baseline 字段。

改动：

- `backend/src/modelforge/modules/diagnosis/routes.py`
- `backend/src/modelforge/modules/diagnosis/use_cases.py`
- `backend/src/modelforge/modules/diagnosis/repository.py`
- `backend/tests/test_http_contract.py`

验收：

- 无 body 自动基线；
- 显式非法基线 422；
- baseline 相同 subject 422；
- 非成功基线 422；
- 同请求幂等；
- 重新生成新 job/version；
- AI 关闭仍返回 503。

依赖：HC-05。

### HC-07 · 前端数据层

目标：

- 新增 comparison 类型；
- 候选 API；
- create body；
- hook 保存 baseline selection；
- report/evidence 类型向后兼容。

改动：

- `frontend/src/features/training/types.ts`
- `frontend/src/features/training/diagnosis/api.ts`
- `frontend/src/features/training/diagnosis/use-diagnosis.ts`
- `frontend/src/features/training/diagnosis/diagnosis-model.ts`

验收：

- v1/v2 report 均可渲染；
- 候选 abort/重试；
- baseline 变更不会覆盖已发布报告；
- TypeScript 无 `any` 漏口。

依赖：HC-06。

### HC-08 · 前端对比界面

目标：

- 基线选择器；
- 对比主卡；
- 参数 diff；
- 指标表；
- 混杂因素；
- 双证据；
- 空/加载/不可比/低置信度/stale；
- 1440 与 390。

改动：

- 新增 `frontend/src/features/training/diagnosis/ComparisonPanel.tsx`
- 新增 `frontend/src/features/training/diagnosis/BaselineSelector.tsx`
- `frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx`
- `frontend/src/features/training/diagnosis/AiReportEntryCard.tsx`
- `frontend/src/features/training/training.css`

验收：

- UI_UX_SPEC 19 项交互；
- 无横向溢出；
- console/window/rejection 为 0；
- 不使用紫色 AI 魔法视觉；
- 模型效果未验证使用中性样式。

依赖：HC-07。

### HC-09 · 自动测试、真实页面与归档

目标：

- 后端定向测试；
- 前端测试；
- production build；
- 浏览器桌面/移动；
- 文档状态更新；
- 证据截图。

改动：

- `backend/tests/test_training_comparison.py`
- `backend/tests/test_training_diagnosis.py`
- `backend/tests/test_http_contract.py`
- `frontend/tests/training-diagnosis.test.mjs`
- 本目录状态文档
- `design/.../historical-comparison-2026-11-08/evidence/`

验收：

- 所有硬门禁通过；
- 测试和截图已归档；
- 不把设计原型当实现；
- 不把 fixture 当真实模型；
- 未部署、未推送需明确记录。

依赖：HC-08。

## 5. 依赖图

```text
HC-01
  └─→ HC-02
        └─→ HC-03
              └─→ HC-04
                    └─→ HC-05
                          └─→ HC-06
                                └─→ HC-07
                                      └─→ HC-08
                                            └─→ HC-09
```

所有任务默认串行。任何并行必须由主代理明确分配且不得修改同一文件。

## 6. 文件白名单

允许新增：

```text
backend/migrations/versions/0021_training_diagnosis_comparison.py
backend/src/modelforge/modules/diagnosis/comparison.py
backend/src/modelforge/modules/diagnosis/comparison_repository.py
backend/tests/test_training_comparison.py
frontend/src/features/training/diagnosis/ComparisonPanel.tsx
frontend/src/features/training/diagnosis/BaselineSelector.tsx
design/ai-training-report-2026-11-06/historical-comparison-2026-11-08/evidence/
```

允许修改：

```text
backend/src/modelforge/modules/diagnosis/contracts.py
backend/src/modelforge/modules/diagnosis/evidence.py
backend/src/modelforge/modules/diagnosis/context.py
backend/src/modelforge/modules/diagnosis/prompts.py
backend/src/modelforge/modules/diagnosis/validator.py
backend/src/modelforge/modules/diagnosis/graph.py
backend/src/modelforge/modules/diagnosis/repository.py
backend/src/modelforge/modules/diagnosis/use_cases.py
backend/src/modelforge/modules/diagnosis/routes.py
backend/tests/test_training_diagnosis.py
backend/tests/test_http_contract.py
frontend/src/features/training/types.ts
frontend/src/features/training/diagnosis/api.ts
frontend/src/features/training/diagnosis/use-diagnosis.ts
frontend/src/features/training/diagnosis/diagnosis-model.ts
frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx
frontend/src/features/training/diagnosis/AiReportEntryCard.tsx
frontend/src/features/training/training.css
frontend/tests/training-diagnosis.test.mjs
design/ai-training-report-2026-11-06/README.md
design/ai-training-report-2026-11-06/PLANNING_INDEX.md
design/ai-training-report-2026-11-06/historical-comparison-2026-11-08/*.md
```

禁止修改：

```text
backend/src/modelforge/modules/training/execution.py
backend/src/modelforge/runtimes/executors.py
backend/src/modelforge/runtimes/train_remote.py
backend/src/modelforge/runtimes/compatibility.py
frontend/src/features/training/components/RunAnalysis.tsx
frontend/src/features/training/components/RunOverview.tsx
frontend/src/features/training/components/TrainingWorkbench.tsx
任何历史迁移 0018/0019/0020
任何正式登录、部署、云资源或 cppt-platform 文件
```

如果实现必须修改禁止路径，先停止并说明原因，再请求批准。

## 7. 实施顺序与共享文件

必须串行修改的文件：

- `contracts.py`
- `repository.py`
- `use_cases.py`
- `routes.py`
- `graph.py`
- `validator.py`
- `types.ts`
- `use-diagnosis.ts`
- `AiDiagnosisTab.tsx`

不得同时让两个 Agent 修改同一共享文件。

可以独立审阅但不直接提交的产物：

- ComparisonPolicy 夹具；
- UI 文案；
- 测试案例清单。

## 8. 验证命令

后端定向：

```powershell
docker compose run --rm --no-deps api python -m pytest `
  tests/test_training_comparison.py `
  tests/test_training_diagnosis.py `
  tests/test_http_contract.py -q
```

前端：

```powershell
cd frontend
npm test
npm run build
```

迁移：

```powershell
docker compose run --rm --no-deps api alembic upgrade head
docker compose run --rm --no-deps api alembic current
```

API smoke：

```powershell
Invoke-RestMethod `
  -Uri 'http://127.0.0.1:8102/api/v1/training/attempts/{subject}/diagnosis-comparison-candidates'
```

浏览器：

- 1440×1000；
- 390×844；
- console error、window error、unhandled rejection；
- 生成、选择基线、重新生成、切换 Attempt、展开证据、应用草稿；
- 保存截图和 JSON 结果。

## 9. Definition of Done

必须同时满足：

- Hard Key 正确；
- 自动基线稳定；
- 显式基线非法被拒绝；
- ComparisonEngine 夹具通过；
- v1 报告兼容；
- v2 报告不可变；
- LLM 无比较计算权；
- Validator 禁止模型效果升级；
- 前端覆盖所有状态；
- 1440/390 无横向溢出；
- console error = 0；
- 后端/前端测试和 build 通过；
- 有真实或 fixture 证据；
- 未部署、未提交、未推送状态披露；
- 文档状态更新，未完成项不得写成通过。

## 10. 风险与应对

| 风险 | 应对 |
|---|---|
| 只有 1 个 Eval 点 | 允许低置信度，不写稳定改善 |
| Seed 不同 | 标为随机性混杂 |
| Runtime/GPU 改变 | conditional，不单归因 |
| 多参数变化 | 禁止单参数结论 |
| 基线被结果导向选择 | 自动基线按时间，不按分数 |
| 报告数字幻觉 | Engine 预计算，Validator 限定 allowed numbers |
| 基线日志敏感 | 只给摘要，不给完整日志 |
| 选择基线导致 Prompt 膨胀 | baseline projection，不复制完整 EvidencePack |
| 旧报告不兼容 | v1/v2 union，新增字段 nullable |
| 错误地把训练信号当模型效果 | 固定 unverified，专有 Validator 规则 |

## 11. Git、部署与云边界

默认：

- 不 commit；
- 不 push；
- 不 deploy；
- 不启动云 GPU；
- 不修改 `.env`；
- 不输出 API Key；
- 不修改 `cppt-platform`。

若用户后续明确要求提交，按独立步骤执行并再次扫描 secrets。

## 12. 可复制交接提示词

```text
你在 F:\ai_2026\推训平台\ModelForge 工作，基线提交
62e92dd0fbb69cce0125560fcc5c2b9cdd625390。

任务：实现“AI 训练诊断历史对比”。

先按顺序阅读：
1. design/ai-training-report-2026-11-06/historical-comparison-2026-11-08/README.md
2. .../ARCHITECTURE.md
3. .../DATA_CONTRACT.md
4. .../COMPARISON_POLICY_AND_AI_EVAL.md
5. .../UI_UX_SPEC.md
6. .../EXECUTION_PLAN.md
7. .../TEST_ACCEPTANCE.md

只允许修改 EXECUTION_PLAN.md 的文件白名单。默认串行执行 HC-01 到 HC-09。
不得修改训练执行、runtime、LLM 框架或 cppt-platform。
不得新增依赖，不得部署，不得提交 Git，不得创建云资源。

必须实现：
- 同一 base fingerprint + dataset sha256 + split sha256 的候选；
- 自动最近成功基线和显式基线；
- 确定性 ComparisonEngine；
- evidence-pack-v2 与 advisory-report-v2；
- LangGraph v2、Prompt v4、Validator；
- AI 不决定好差、不计算差值、不宣称模型效果提升；
- A v2 历史对比 UI；
- 1440/390、交互和控制台验收。

每个 ticket 完成后运行定向测试并更新证据。未通过项保持 BLOCKED/NOT_RUN。
最终报告必须区分：设计、自动化测试、真实页面、真实模型、部署状态。
```

## 13. 启动门

本文档完成后不得自动进入 HC-01。必须等待用户明确命令，例如：

```text
开始执行历史对比 HC-01 到 HC-09
```
