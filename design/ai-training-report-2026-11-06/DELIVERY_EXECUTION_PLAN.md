# ModelForge AI 训练诊断
## 实施执行计划

状态：M0-M4 纵向切片与真实模型单例契约已落地；黄金集、人评和推理验收待完成  
日期：2026-11-07（初版：2026-11-06）  
执行前提：用户已明确启动实施。未提交、未推送、未部署，未调用云 GPU。  

## 1. 目标

在现有训练详情和运行分析之上，交付一个可审计的 AI 智能诊断功能：

- 对单次终态 Attempt 给出训练健康度和可交付性双结论；
- 只解释已有证据，缺证据时明确写“未上报/无法判断”；
- 每个关键结论可展开到原始指标、日志或产物依据；
- 生成下一步实验建议，但只允许创建未提交训练草稿；
- 支持报告生成中、空、失败、证据不足、成功但模型未验证等状态；
- 使用 LangGraph 固定状态图、`langchain-openai` 和 `PostgresSaver`；
- 不让模型决定硬门禁、不提供自主工具、不写业务真相。

## 2. 范围

### 2.1 Phase 1 范围

- 终态 Attempt：`succeeded`、`failed`、`cancelled`。
- 成功、有限复盘和证据不足三种报告模式。
- 手动生成、重新生成、轮询状态、读取最新报告。
- 证据检查、严重度筛选、复制摘要、应用建议草稿。
- Postgres 业务表、Checkpointer、Worker 和 API。
- A v2 前端页签与总览入口卡。
- Fake Generator、真实 `ChatOpenAI` Generator、Validator 与黄金集。

### 2.2 明确不做

- 不生成 running Attempt 的终态结论。
- 不做跨运行对比、批量报告、自动调参或自动提交训练。
- 不开放 SQL、Shell、浏览器、任意 HTTP 或文件写入工具。
- 不根据 Train/Eval Loss 推断业务准确率、满意度或泛化效果。
- 不把 `inference_trials.state='ready'` 当作推理验收通过。
- 不把 Best/Final Adapter `available` 写成“模型可用”。
- 不做长期记忆、多 Agent 角色协作或向量数据库。
- 不构建跨租户权限体系；沿用当前个人本机边界。

## 3. 实施原则

1. **Contract first**：先定义 EvidencePack、GateResult、CandidateReport、Validator 和数据库不变量。
2. **Gate first**：确定性门禁先于模型生成；模型永远不能改 health/delivery。
3. **Evidence first**：没有 EvidenceRef 的 claim 不得成为观测事实。
4. **Vertical slice**：每个里程碑都要有代码、测试、可观察状态和文档，不一次性铺空壳。
5. **Fail closed**：Validator、Checkpointer、租约或发布事务失败时保留上一版，不发布半成品。
6. **Unknown is a value**：缺失、读取失败、未到达和未上报必须分开建模，不能归一化到 `0` 或“正常”。
7. **No hidden autonomy**：LangGraph 拓扑静态声明，模型没有任何执行工具。
8. **Local-first**：先用 Fake Generator 和测试夹具闭合，再接真实模型；未经授权不触发云 GPU。

## 4. 里程碑总览

| 里程碑 | 目标 | 主要产物 | 预计工作量 |
|---|---|---|---|
| M0 | 依赖、环境和边界验证 | 锁文件、Python 3.13 smoke test、功能开关骨架 | 0.5–1 人日 |
| M1 | 事实层与硬门禁 | migration、契约、EvidenceCollector、GateEngine | 1.5–2 人日 |
| M2 | 任务与工作流恢复 | job/evidence/report repository、lease/fencing、LangGraph + PostgresSaver | 1.5–2 人日 |
| M3 | 报告生成与发布 | `LangChainOpenAIGenerator`、Validator、publish、错误处理 | 2–3 人日 |
| M4 | API 与 A v2 前端 | routes/API client、诊断页签、证据、筛选、草稿 | 2–3 人日 |
| M5 | AI 评估与硬化 | 黄金集、自动断言、人工 Rubric、可观察性 | 2–3 人日 |
| M6 | 推理验收联动 | 独立 acceptance 记录与 delivery 升级条件 | 1–2 人日 |

估算只用于排序，不是交付承诺。每个里程碑都必须独立可验证，不能以“后续一起测”关闭。

## 5. M0：依赖与环境

### 5.1 目标

确认新增技术栈在当前 ModelForge Python、PostgreSQL、psycopg 和 Compose 边界内可安装、可导入、可连接。

### 5.2 交付物

- 依赖版本锁定：
  - `langgraph==1.2.20`
  - `langchain-openai==1.7.4`
  - `langgraph-checkpoint-postgres==3.2.0`
- Python 3.13 容器安装记录。
- 四个导入 smoke test：
  - `langgraph`
  - `langchain_openai`
  - `langgraph.checkpoint.postgres`
  - `psycopg_pool`
- PostgreSQL 独立 checkpoint schema/role 的连接验证。
- 配置项和功能开关设计；默认关闭。
- 记录任何传递依赖冲突和解决方法。

### 5.3 文件边界

允许修改的建议范围：

```text
backend/pyproject.toml
backend/uv.lock 或既有锁文件
backend/src/modelforge/settings.py
.env.example
compose.yaml（仅在确有必要时）
backend/tests/test_dependencies.py
```

M0 历史边界：规划时约定“不创建诊断业务表、不接真实模型”。用户随后明确启动实施，
本地纵向切片已按后续里程碑创建诊断业务表和 A v2 页面，并已在受控本地环境中完成
真实模型单例契约、成功/失败报告发布和不可变 trigger 验证。

### 5.4 验证

```text
容器内 Python 版本 = 3.13.x
四个包可导入
pip/uv 锁文件可复现安装
PostgresSaver 能以独立 DSN 打开连接
不向日志输出密码或 API Key
```

### 5.5 退出条件

- 锁文件可重现；
- 导入通过；
- 连接 smoke test 通过；
- 若失败，保留日志并停止在 M0，不进入迁移和代码实现。

## 6. M1：事实层与硬门禁

### 6.1 目标

建立“Attempt 事实 → EvidencePack → GateResult”的确定性链路，完全不依赖模型。

### 6.2 交付物

- Alembic migration：
  - `training_diagnosis_jobs`
  - `training_diagnosis_evidence`
  - `training_diagnosis_reports`
- Pydantic 契约：
  - `EvidencePack`
  - `EvidenceRef`
  - `EvidenceCoverage`
  - `EvidenceConflict`
  - `GateResult`
  - `CandidateReport`
  - `AdvisoryReport`
- `EvidenceCollector`：
  - Attempt snapshot、metrics、token preflight；
  - runtime report、GPU 峰值、execution manifest；
  - provisioning、日志摘要、Adapter；
  - 推理 Trial 事实；
  - 每项证据的 locator、digest、observedAt、coverage。
- `GateEngine` 纯函数和规则夹具。
- 规范化 JSON 和 SHA-256 digest 工具。

### 6.3 文件边界

```text
backend/migrations/versions/<next>_training_diagnosis.py
backend/src/modelforge/modules/diagnosis/__init__.py
backend/src/modelforge/modules/diagnosis/contracts.py
backend/src/modelforge/modules/diagnosis/evidence.py
backend/src/modelforge/modules/diagnosis/gates.py
backend/src/modelforge/modules/diagnosis/repository.py
backend/tests/training/diagnosis/test_schema.py
backend/tests/training/diagnosis/test_evidence.py
backend/tests/training/diagnosis/test_gates.py
```

### 6.4 验证

- 成功夹具固定得到：
  - `health_status=partial`
  - `delivery_status=artifact_deliverable_model_unverified`
- 失败夹具只生成有限复盘事实，不编造根因。
- 取消夹具不生成伪 Loss 或 Adapter 零值。
- 所有缺失字段仍保持 `missing/not_reached/unavailable`。
- 证据 digest 对同一规范输入稳定。
- GateEngine 没有任何网络调用、模型调用或数据库写入。

### 6.5 退出条件

- 规则夹具 100% 通过；
- 数据结构可序列化且可验证；
- 失败和证据不足路径能给出稳定错误码；
- 没有模型参与也能解释当前真实 Attempt。

## 7. M2：任务、租约与 LangGraph 恢复

### 7.1 目标

把诊断任务变成可恢复的 PostgreSQL 作业，并用 LangGraph 固定图执行 `collect → gate → generate → validate → repair/publish/fail`。

### 7.2 交付物

- `training_diagnosis_jobs` 入队、幂等和原子领取。
- lease owner、lease expires at、fencing token。
- `PostgresSaver` 独立 schema、thread/namespace、TTL 清理。
- LangGraph 图拓扑：
  - `collect`
  - `gate`
  - `generate`
  - `validate`
  - `repair`
  - `publish`
  - `fail`
- 图状态最小化；节点不直接暴露原始日志或完整 EvidencePack。
- Worker 恢复逻辑：
  - 有 checkpoint 恢复最近节点；
  - 没有 checkpoint 从 collect 重放；
  - 恢复后仍必须通过 lease/fencing 才能 publish。

### 7.3 文件边界

```text
backend/src/modelforge/modules/diagnosis/graph.py
backend/src/modelforge/modules/diagnosis/checkpoint.py
backend/src/modelforge/modules/diagnosis/worker.py
backend/src/modelforge/modules/diagnosis/repository.py
backend/src/modelforge/entrypoints/api.py
backend/src/modelforge/entrypoints/worker.py
backend/tests/training/diagnosis/test_graph_contract.py
backend/tests/training/diagnosis/test_repository_lease.py
backend/tests/training/diagnosis/test_worker_recovery.py
```

### 7.4 验证

- 图拓扑断言：
  - `START → collect → gate → generate`
  - 不存在从 `START` 或 `collect` 直接到 `generate` 的边。
- 同一 `attempt_id + request_key` 不重复创建 job。
- 旧 lease owner 即使拿到候选报告也不能 publish。
- checkpointer 不可用时 fail closed。
- 恢复后不重复生成同一报告。
- `recursion_limit=8`，最多一次 repair。

### 7.5 退出条件

- Fake Generator 下 job 可以从 queued 到 ready/failed；
- Worker 重启用例通过；
- checkpoint TTL/清理有可运行脚本或后台任务；
- 业务表仍是唯一报告真相。

## 8. M3：模型生成、校验与发布

### 8.1 目标

接入 `langchain-openai`，让结构化候选报告在严格 Validator 和事务发布下成为不可变报告。

### 8.2 交付物

- `LangChainOpenAIGenerator`：
  - `ChatOpenAI`
  - `with_structured_output(CandidateReportModel, method="json_schema", strict=True)`
  - `temperature=0`
  - `timeout=25`
  - `max_retries=0`
- Provider 兼容性 fallback：`function_calling` 或 `json_mode`，仍需同样 Validator。
- `Validator`：
  - schema；
  - 数字与源字段一致性；
  - evidence ID 与 field path 可解析；
  - Gate 状态不可被模型改写；
  - 禁止 claim；
  - stale/conflict；
  - 敏感信息。
- 一次 repair，只修格式、引用和表达；不能新增证据。
- `publish` 事务：校验 job、lease、fencing，插入不可变报告。
- 稳定错误码和上一版保留。

### 8.3 文件边界

```text
backend/src/modelforge/modules/diagnosis/generator.py
backend/src/modelforge/modules/diagnosis/validator.py
backend/src/modelforge/modules/diagnosis/prompts.py
backend/src/modelforge/modules/diagnosis/use_cases.py
backend/tests/training/diagnosis/test_generator.py
backend/tests/training/diagnosis/test_validator.py
backend/tests/training/diagnosis/test_publish.py
```

### 8.4 验证

- `json_schema` 不支持时显式 fallback，不能静默变成自由文本。
- 模型输出缺失字段、引用 E-99、数字不一致时被拒绝。
- 模型伪造 `health/status` 时被 Validator 拒绝。
- 第二次校验失败后 job 进入 failed，不插入半成品。
- API Key、Authorization Header、完整 Prompt 和完整日志不进入 checkpoint/日志。
- 同一 report 版本不可更新。

### 8.5 退出条件

- Fake Generator 和真实 Provider 各至少一条成功路径；
- 失败路径有稳定错误码；
- Validator 硬断言 100% 通过；
- 报告可在 UI 打开前通过纯 API 读取和校验。

## 9. M4：API 与 A v2 前端

### 9.1 目标

在不破坏现有训练详情、日志和产物页的前提下，交付 A v2 诊断页面和所有状态交互。

### 9.2 交付物

- API：
  - `POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports`
  - `GET /api/v1/training/attempts/{attempt_id}/diagnosis-reports/latest`
  - `GET /api/v1/training/diagnosis-jobs/{job_id}/status`
  - `POST /api/v1/training/diagnosis-jobs/{job_id}/regenerate`
  - `GET /api/v1/training/diagnosis-reports/{report_id}`
  - `POST /api/v1/training/diagnosis-reports/{report_id}/draft`
- 前端新页签：推荐 `tab=diagnosis`。
- 入口卡：总览和运行分析中显示结论摘要或一键生成。
- 状态组件：
  - 空；
  - 生成中；
  - ready；
  - limited review；
  - failed；
  - stale；
  - 证据不足。
- 交互：
  - 严重度筛选；
  - 展开证据；
  - 复制摘要；
  - 重新生成；
  - 切换 Attempt；
  - 应用建议草稿。
- 1440 桌面和 390 移动布局，无横向溢出。

### 9.3 文件边界

```text
backend/src/modelforge/modules/diagnosis/routes.py
frontend/src/features/training/diagnosis/api.ts
frontend/src/features/training/diagnosis/use-diagnosis.ts
frontend/src/features/training/diagnosis/AiReportEntryCard.tsx
frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx
frontend/src/features/training/diagnosis/FindingLedger.tsx
frontend/src/features/training/diagnosis/EvidenceInspector.tsx
frontend/src/features/training/diagnosis/ReportStates.tsx
frontend/src/features/training/training.css
frontend/tests/training-diagnosis.test.mjs
```

### 9.4 验证

- 旧页签 `overview/analysis/logs/artifacts/config` 行为不回归。
- 新增 `tab=diagnosis` 可直接打开、刷新、返回。
- 失败 Attempt 显示有限复盘，不显示伪 Loss。
- Adapter 2/2 available + 无验收时显示“产物可下发，模型可用性未验证”。
- 生成中、空、失败和证据不足都有可访问的文本状态。
- 所有数据只来自 API；原型数据不得进入正式页面。
- 390 宽度无横向溢出，键盘焦点可见。

### 9.5 退出条件

- 所有关键交互可实际操作；
- 浏览器控制台无错误；
- 现有前端测试和构建通过；
- 新页面有至少 3 个状态截图和一份交互结果记录。

## 10. M5：AI 评估与硬化

### 10.1 目标

证明报告正确性、克制性、可追溯性和用户决策帮助，而非只证明“能生成文字”。

### 10.2 交付物

- 黄金夹具 G01–G18。
- 自动断言 harness。
- 人工 Rubric 和盲评记录。
- 真实成功、失败、取消、stale 和证据不足夹具。
- Prompt/Graph/Policy/Generator 版本记录。
- 统计报告：schema、gate fidelity、数字忠实度、引用、abstention、actionability、decision accuracy、延迟、成本。

### 10.3 强制门禁

- Schema valid = 100%；
- Gate fidelity = 100%；
- Numeric faithfulness = 100%；
- Citation resolvability = 100%；
- Unsupported critical claim = 0；
- Forbidden claim = 0；
- Dangerous decision rate = 0；
- 第二次校验失败必须 fail closed。

### 10.4 退出条件

- 阻断型用例全部通过；
- 专家复核通过；
- 5–8 人形成性测试完成；
- 记录未通过的项，不以平均分掩盖 Fail。

## 11. M6：独立推理验收联动

### 11.1 目标

只在已有真实推理验收记录时，允许 delivery 从 `artifact_deliverable_model_unverified` 升级为 `ready_for_release_review`。

### 11.2 交付物

- 推理验收数据结构，明确 `adapter_id`、基座指纹、运行时、请求样本和结果。
- 验收状态与 `inference_trials.state` 分离。
- GateEngine 新规则和黄金用例 G08/G09。
- UI 中“模型可用性未验证”到“可进入发布评审”的解释链。

### 11.3 禁止

- Trial ready 直接升级；
- Adapter available 直接升级；
- 另一个 Adapter 的 Trial 复用；
- 没有请求证据时写“通过”；
- 把可进入发布评审写成“生产可用”。

### 11.4 退出条件

- 当前 Adapter fingerprint 匹配；
- 推理运行时有真实证据；
- acceptance 记录独立可审计；
- 至少一个正向和一个反向夹具通过。

## 12. 关键依赖关系

```text
M0 依赖与环境
  ├─→ M1 事实与门禁
  │     ├─→ M2 job + LangGraph/PostgresSaver
  │     │     └─→ M3 Generator + Validator + Publish
  │     │           └─→ M4 API + A v2 前端
  │     │                 └─→ M5 AI 评估与硬化
  │     └────────────────────→ M6 推理验收联动
  └─ 任何依赖/连接 smoke test 失败：停止
```

M6 可以晚于 M5，但 GateEngine 的 delivery 语义必须在 M1/M2 预留，不能在后端强行回填。

## 13. 每阶段定义

### 13.1 Definition of Ready

- 目标规格明确；
- 依赖 ticket 已关闭或明确可并行；
- 文件边界清楚；
- 验收标准可执行；
- 失败路径已写；
- 不依赖未授权云资源。

### 13.2 Definition of Done

- 代码和迁移完成；
- 单元/集成/HTTP 测试通过；
- 日志和错误码稳定；
- 真实或受控证据已记录；
- 文档和契约同步；
- 已知限制写清楚；
- 未把模拟结果写成真实训练或真实模型验收。

## 14. 验证命令矩阵

以下是计划命令，实际执行时以 M0 和仓库当前工具为准，不预先声称已运行：

| 范围 | 命令 | 证据 |
|---|---|---|
| 后端单元 | `cd backend; python -m pytest` | pytest 结果 |
| 后端诊断夹具 | `cd backend; python -m pytest tests/training/diagnosis` | 黄金集结果 |
| 前端单测 | `cd frontend; npm test` | Node test 结果 |
| 前端构建 | `cd frontend; npm run build` | tsc + Vite 构建 |
| Compose | `docker compose config` | 配置解析 |
| 迁移 | `docker compose run --rm migrate` | 迁移日志 |
| API 健康 | `GET /api/v1/health/live` | HTTP 结果 |
| Worker 健康 | `GET /api/v1/health/dependencies` | 依赖状态 |
| 浏览器 | 1440/390 本地页面 | 截图、控制台、溢出结果 |

不在本计划中执行真实云 GPU、训练、推理或部署。

## 15. 回滚策略

### 15.1 软件回滚

- 先关闭 `MF_AI_ENABLED`，原有训练详情和运行分析保持可用；
- 前端移除/隐藏 AI 页签入口；
- Worker 停止领取诊断 job；
- API 返回功能未启用，不返回半成品。

### 15.2 数据库回滚

- `training_diagnosis_*` 表与 checkpoint schema 分开；
- downgrade 前拒绝有活动 job；
- 不删除已通过审核的不可变报告，除非有明确保留策略和备份；
- checkpoint 只允许按 TTL/运维脚本清理；
- 不把 checkpoint 清理当作业务报告删除。

### 15.3 模型回滚

- 保留 graph/policy/prompt/generator 版本；
- 新版 Graph 使用新 `checkpoint_ns`，不强行恢复旧 checkpoint；
- 旧报告仍可读；
- 失败的报告生成不会阻塞训练详情。

## 16. 变更控制

以下变化必须重新评审，不能直接塞进实现：

- 改变 Gate 语义；
- 允许模型修改 health/delivery；
- 增加任意工具或自主循环；
- 改变 checkpoint 为业务真相；
- 允许自动提交训练、创建 GPU 或写 Adapter；
- 把 inference trial ready 解释成验收通过；
- 扩大为跨运行分析或批量 Agent。

## 17. 最终交付清单

图例：`[x]` 本地纵向切片已完成；`[~]` 仅完成部分/受控验证；`[ ]` 尚未执行。

- [x] 迁移和 schema；
- [x] EvidencePack / GateResult / CandidateReport / AdvisoryReport；
- [x] EvidenceCollector；
- [x] GateEngine；
- [x] Diagnosis job + lease/fencing；
- [x] LangGraph graph；
- [x] PostgresSaver 装配和 TTL；
- [x] `LangChainOpenAIGenerator` 接线；
- [x] Validator 和 repair；
- [x] 不可变报告发布（真实成功/失败 Attempt）；
- [x] API；
- [x] A v2 诊断页签和入口；
- [x] 空/生成中/失败/证据不足/未验证状态；
- [~] 黄金集和自动断言（契约、Gate 和确定性夹具已完成，真实模型黄金集待启用）；
- [x] 1440/390 截图；
- [x] 控制台和绑定交互记录；
- [x] 真实模型单例契约（DeepSeek `deepseek-flash`）；
- [x] 成功 v1/v2 与失败 limited v1 发布；
- [x] 不可变 trigger、fail-closed job 与页面复制/筛选/证据/草稿交互；
- [x] 运维/回滚手册；
- [x] 已知限制和未验收项。

当前 Adapter 独立推理验收、真实模型黄金集、人评 Rubric、运行成本/延迟和
生产部署均未完成，不得用上述勾选项替代。真实模型单例通过不等于稳定性通过。

任何未完成项都保留为未完成，不用“设计已完成”或“UI 可打开”替代。
