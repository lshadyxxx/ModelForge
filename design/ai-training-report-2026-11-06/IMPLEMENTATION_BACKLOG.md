# ModelForge AI 训练诊断
## 实施任务种子

状态：M0-M4 与真实模型单例 smoke 已实施；黄金集、人评和成本门禁未关闭  
日期：2026-11-07（初版：2026-11-06）  
说明：本轮按用户启动命令直接完成本地纵向切片；本文继续作为后续拆票、验收和
真实模型质量试点的任务种子，未完成项不得因代码已存在而被视为通过。

## 1. 使用规则

本文件不是已授权的 ticket 列表，而是可直接转成 ticket 的计划种子。

正式实施时：

- 每个 ticket 一个文件；
- 明确 `Status:`、`Category:`、`Blocked by:`；
- 从 01 开始编号；
- 只允许完成当前 ticket 文件边界内的改动；
- 测试和证据写入 ticket；
- 未满足验收不得关闭；
- 跨 ticket 共享文件先协调，不能并行抢改。

## 2. 依赖图

```text
D01
 └─→ D02
       ├─→ D03
       │     ├─→ D04
       │     └─→ D09
       ├─→ D05
       │     └─→ D06
       │           ├─→ D07
       │           │     └─→ D08
       │           │           └─→ D09
       └─→ D10
             └─→ D11
                   ├─→ D12
                   └─→ D13

D09 + D13 → D14 → D15
D07 + D08 + D14 → D16
D03 + D04 + D06 → D17
```

## 3. Ticket 列表

### D01 — 依赖锁定与 Python 3.13 smoke test

目标：

- 固定 LangGraph、`langchain-openai`、`langgraph-checkpoint-postgres` 版本；
- 在项目目标 Python 3.13 容器验证安装、导入和连接。

建议文件边界：

```text
backend/pyproject.toml
backend/uv.lock 或仓库现有锁文件
backend/src/modelforge/settings.py
.env.example
backend/tests/test_dependencies.py
```

交付：

- 依赖版本和传递依赖记录；
- Python 3.13 安装记录；
- `ChatOpenAI` 和 `PostgresSaver` import smoke test；
- `PostgresSaver` 独立 DSN 连接 smoke test；
- 功能开关默认关闭。

验收：

- 安装可复现；
- 不引入 Python 3.14-only API；
- 不打印密钥；
- 锁文件可重建；
- 失败时保留完整错误，不进入后续 ticket。

依赖：无。  
风险：Provider SDK 与项目现有 httpx/psycopg 版本冲突。

### D02 — Diagnosis 数据库迁移与不变量

目标：

- 建立 job、evidence、report 三张表；
- 建立 lease/fencing、唯一性、不可变和索引约束。

建议文件边界：

```text
backend/migrations/versions/<next>_training_diagnosis.py
backend/tests/training/diagnosis/test_schema.py
```

交付：

- `training_diagnosis_jobs`；
- `training_diagnosis_evidence`；
- `training_diagnosis_reports`；
- publish 幂等约束；
- report 不可变 trigger；
- attempt/version 唯一索引；
- up/down 测试。

验收：

- 迁移在隔离 PostgreSQL 通过；
- up/down 可重复；
- 旧 report 不能 UPDATE；
- 一个 job 最多一个 report；
- 一个 attempt 的 version 不重复；
- 没有活动 job 时才允许相关 downgrade。

依赖：D01。  
风险：未来 Alembic revision 链冲突。

### D03 — 核心契约与 EvidencePack

目标：

- 把 Attempt 事实转换成可验证、可冻结的 EvidencePack。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/contracts.py
backend/src/modelforge/modules/diagnosis/evidence.py
backend/tests/training/diagnosis/test_evidence.py
```

交付：

- Pydantic contract；
- EvidenceRef/coverage/conflict；
- metrics/token/runtime/memory/manifest/logs/adapter/inference 投影；
- canonical JSON 和 SHA-256；
- redaction version；
- 跨 Attempt 拒绝。

验收：

- 成功夹具得到 22 Train / 1 Eval；
- 失败夹具保留 unknown；
- 取消夹具不伪造 Adapter；
- 读取失败是 unavailable，不是 empty；
- digest 稳定；
- 不包含完整日志、API Key、DSN、签名 URL。

依赖：D02。  
风险：现有 Training.get 返回字段过大，需严格投影。

### D04 — GateEngine 双门禁

目标：

- 用纯函数实现训练健康和可交付性。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/gates.py
backend/tests/training/diagnosis/test_gates.py
```

交付：

- health 规则；
- delivery 规则；
- coverage/conflict 处理；
- policy version；
- gate digest；
- 固定夹具。

验收：

- 成功夹具：partial + artifact_deliverable_model_unverified；
- 失败夹具：unknown + not_deliverable；
- 取消夹具：unknown + 无交付结论；
- 只有 Trial ready：不升级 delivery；
- 当前 Adapter 独立验收通过：ready_for_release_review；
- 无网络、无数据库、无模型。

依赖：D03。  
风险：把“部分可判断”误写成“训练健康”。

### D05 — Job Repository 与租约

目标：

- 实现创建、领取、心跳、重试、失败、查询。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/repository.py
backend/tests/training/diagnosis/test_repository_lease.py
```

交付：

- 幂等创建；
- `FOR UPDATE SKIP LOCKED` 领取；
- lease owner/expiry；
- fencing token；
- 可恢复错误重试；
- 失败上限；
- 最新报告查询。

验收：

- 同 request_key 幂等；
- 两个 Worker 竞争只有一个领取成功；
- 过期 lease 可回收；
- 旧 token publish 被拒绝；
- attempt 非终态返回 409；
- 不申请 GPU。

依赖：D02。  
风险：与现有 training worker 的 advisory lock 混用。

### D06 — LangGraph 固定图与 PostgresSaver

目标：

- 装配 collect/gate/generate/validate/repair/publish/fail；
- 使用独立 checkpoint schema。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/graph.py
backend/src/modelforge/modules/diagnosis/checkpoint.py
backend/src/modelforge/modules/diagnosis/worker.py
backend/src/modelforge/entrypoints/worker.py
backend/tests/training/diagnosis/test_graph_contract.py
backend/tests/training/diagnosis/test_worker_recovery.py
```

交付：

- StateGraph；
- conditional edge；
- `thread_id=diagnosis:{job_id}`；
- `checkpoint_ns=graph_version`；
- `recursion_limit=8`；
- `setup()` 部署期初始化；
- TTL 清理接口；
- fail closed。

验收：

- Gate 永远先于 Generate；
- 没有工具节点；
- 一次 repair；
- 第二次校验失败 fail；
- checkpointer 不可用时不执行图；
- 恢复后不重复 publish。

依赖：D04、D05。  
风险：图 State 携带过多证据导致 checkpoint 膨胀。

### D07 — LangChain OpenAI Generator

目标：

- 用 `langchain-openai` 返回严格结构化的 CandidateReport。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/generator.py
backend/src/modelforge/modules/diagnosis/prompts.py
backend/tests/training/diagnosis/test_generator.py
```

交付：

- `ChatOpenAI` 初始化；
- `with_structured_output`；
- `max_retries=0`；
- timeout；
- provider 兼容性 fallback；
- 受控 Context；
- 稳定错误码。

验收：

- `json_schema` 优先；
- 不支持时显式 fallback；
- 不启用 tools/handoff/memory；
- Key 不进入 State/log；
- 超时/429 可恢复；
- 模型输出不直接写库。

依赖：D01、D06。  
风险：Provider 对 `json_schema` 或 strict schema 支持不一致。

### D08 — Validator 与 repair

目标：

- 阻止数字幻觉、引用失效、Gate 篡改和越级结论。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/validator.py
backend/tests/training/diagnosis/test_validator.py
```

交付：

- schema 校验；
- 数字与 field path；
- evidence ID 解析；
- Gate 一致性；
- forbidden claim；
- unknown/abstention；
- sensitive data；
- 一次 repair 输入/输出；
- issue codes。

验收：

- E-99 引用被拒绝；
- 模型伪造 health 被拒绝；
- Loss 推 business accuracy 被拒绝；
- 无验收写模型可用被拒绝；
- 冲突证据静默忽略被拒绝；
- 缺失数据写成 0 被拒绝；
- 第二次失败 fail closed。

依赖：D03、D04、D07。  
风险：规则过严导致合法解释也被拒绝，需要黄金集校准。

### D09 — Publish 事务与 Worker 整合

目标：

- 在 lease/fencing 有效时发布不可变报告。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/repository.py
backend/src/modelforge/modules/diagnosis/worker.py
backend/tests/training/diagnosis/test_publish.py
backend/tests/training/diagnosis/test_worker_recovery.py
```

交付：

- publish 事务；
- report version；
- report digest；
- job ready；
- failed 路径；
- 上一版保留；
- 恢复/竞争。

验收：

- 旧 lease 无法发布；
- 旧 fencing 无法发布；
- 同一 job 幂等；
- report UPDATE 被 trigger 拒绝；
- 新版本不覆盖旧版本；
- 写失败不留下半成品。

依赖：D05、D06、D08。  
风险：过度依赖 checkpoint 导致业务真相错误。

### D10 — Diagnosis HTTP API

目标：

- 暴露创建、状态、最新报告、重新生成和草稿接口。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/routes.py
backend/src/modelforge/modules/diagnosis/drafts.py
backend/src/modelforge/entrypoints/api.py
backend/tests/training/diagnosis/test_routes.py
backend/tests/test_http_contract.py
```

交付：

- 创建/查询/最新/重生成；
- 202/200/404/409/422/503；
- 草稿接口；
- request schema；
- 响应脱敏；
- 功能开关。

验收：

- 非终态 attempt 409；
- 同 request_key 幂等；
- 报告返回 evidence index；
- 草稿不提交训练；
- 错误不泄漏内部 stack/secret；
- 旧 API 不受影响。

依赖：D02、D05、D09。  
风险：HTTP 接口先于确定性层实现会造成返工。

### D11 — A v2 诊断页签与入口

目标：

- 在现有训练详情中增加 AI 诊断入口和独立页签。

建议文件边界：

```text
frontend/src/features/training/diagnosis/api.ts
frontend/src/features/training/diagnosis/use-diagnosis.ts
frontend/src/features/training/diagnosis/AiReportEntryCard.tsx
frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx
frontend/src/features/training/components/AttemptDetail.tsx
frontend/src/features/training/types.ts
frontend/src/features/training/training-model.ts
frontend/src/features/training/training.css
frontend/tests/training-diagnosis.test.mjs
```

交付：

- `tab=diagnosis`；
- 总览入口卡；
- 双结论；
- 摘要；
- 关键发现；
- 证据；
- 限制；
- 下一步实验。

验收：

- 旧 tab 不回归；
- 路由可刷新；
- 失败状态不丢失；
- 入口文案不夸大；
- 1440/390 无溢出；
- 无真实报告时显示空状态，不显示原型假数据。

依赖：D10。  
风险：在现有 `AttemptDetail.tsx` 中直接堆叠复杂逻辑。

### D12 — 报告状态与交互

目标：

- 完善空、生成中、失败、limited、stale、conflict、未验证状态。

建议文件边界：

```text
frontend/src/features/training/diagnosis/ReportStates.tsx
frontend/src/features/training/diagnosis/FindingLedger.tsx
frontend/src/features/training/diagnosis/EvidenceInspector.tsx
frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx
frontend/src/features/training/training.css
frontend/tests/training-diagnosis.test.mjs
```

交付：

- 筛选；
- evidence 展开；
- 复制；
- 重新生成；
- 应用建议草稿；
- 状态文案；
- 焦点管理；
- 移动端吸顶导航。

验收：

- 生成中不重复提交；
- 筛选不丢数据；
- evidence 切换同步；
- 草稿明确“未提交、未创建 GPU”；
- stale/limited 视觉可辨；
- 键盘和屏幕阅读器可操作。

依赖：D11。  
风险：交互组件与数据 hook 耦合，难以单测。

### D13 — 应用建议草稿

目标：

- 把 AI 建议转换为白名单训练配置草稿，但不提交。

建议文件边界：

```text
backend/src/modelforge/modules/diagnosis/drafts.py
frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx
frontend/src/features/training/training-model.ts
backend/tests/training/diagnosis/test_routes.py
frontend/tests/training-diagnosis.test.mjs
```

交付：

- 白名单字段；
- 草稿响应；
- UI 确认对话框；
- 复用现有创建向导；
- 不写 Attempt；
- 不触发云资源。

验收：

- 未知字段拒绝；
- 超范围 patch 拒绝；
- 草稿不自动提交；
- 用户必须重新经过兼容性检查；
- 任何失败不改训练状态。

依赖：D10、D11。  
风险：被误实现成“一键开始训练”。

### D14 — 黄金夹具与自动断言

目标：

- 把 G01–G18 转成可重复测试。

建议文件边界：

```text
backend/tests/training/diagnosis/fixtures/**
backend/tests/training/diagnosis/evaluate.py
backend/tests/training/diagnosis/test_generator.py
backend/tests/training/diagnosis/test_validator.py
```

交付：

- 18 个 case；
- 真实/合成标记；
- required/forbidden claims；
- coverage；
- rubric；
- 自动断言报告；
- 失败样例。

验收：

- 阻断型 case 100% 通过；
- Gate fidelity 100%；
- 数字/引用检查通过；
- 失败样例保留；
- 不以平均分掩盖 Fail。

依赖：D09、D13。  
风险：合成夹具被误认为真实训练事实。

### D15 — 真实模型兼容性与质量试点

当前进度（2026-11-07）：真实 provider smoke test 已通过，成功/失败报告已发布；
p50/p95 延迟、token/成本、黄金集和人工质量评估仍未完成。证据见
[REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

目标：

- 在受控 provider 上验证结构化输出、延迟、成本和报告质量。

建议文件边界：

```text
backend/tests/training/diagnosis/test_generator.py
design/ai-training-report-2026-11-06/qa/**
```

交付：

- 真实 provider smoke test；
- structured output fallback 结果；
- p50/p95 延迟；
- token/成本；
- 真实 quality eval；
- 未通过项。

验收：

- 真实模型输出通过 Validator；
- 关键黄金集通过；
- 无 provider 密钥泄漏；
- 结果区分真实与合成；
- 未运行项明确写未运行。

依赖：D07、D14。  
风险：provider 变更导致结果不稳定。

### D16 — AI 评估运行手册与观测

目标：

- 让后续每次变更都能重复评估，不依赖人工记忆。

建议文件边界：

```text
design/ai-training-report-2026-11-06/AI_EVALUATION_ACCEPTANCE.md
design/ai-training-report-2026-11-06/SECURITY_OPERATIONS_RUNBOOK.md
backend/tests/training/diagnosis/evaluate.py
```

交付：

- eval 命令；
- 输出目录格式；
- 版本元数据；
- 指标汇总；
- 失败归因；
- 发布门禁检查表。

验收：

- 任何人可重复运行；
- 结果可追溯到代码/模型/prompt 版本；
- 不把在线点击率当质量；
- 评估结果与 UI 原型截图区分。

依赖：D14、D15。  
风险：评估脚本只测 happy path。

### D17 — 推理验收独立联动

目标：

- 把独立推理验收从 Trial ready 中拆出。

建议文件边界：

```text
backend/migrations/versions/<next>_inference_acceptance.py
backend/src/modelforge/modules/diagnosis/evidence.py
backend/src/modelforge/modules/diagnosis/gates.py
backend/tests/training/diagnosis/fixtures/G08/
backend/tests/training/diagnosis/fixtures/G09/
frontend/src/features/training/diagnosis/**
```

交付：

- acceptance 数据模型；
- adapter fingerprint 校验；
- 基座/runtime 关联；
- Gate 新规则；
- UI 说明；
- G08/G09 测试。

验收：

- Trial ready 不升级；
- Adapter available 不升级；
- 其他 Adapter Trial 不升级；
- 当前 Adapter + 独立验收证据才升级；
- 仍不能写“生产可用”。

依赖：D03、D04、D11。  
风险：改动 serving 边界，需要单独评审。

## 4. 推荐执行顺序

```text
第 1 波：D01
第 2 波：D02
第 3 波：D03 + D05
第 4 波：D04 + D06
第 5 波：D07 + D08
第 6 波：D09
第 7 波：D10 + D11
第 8 波：D12 + D13
第 9 波：D14
第 10 波：D15 + D16
可选后置：D17
```

D17 不应阻塞 Phase 1 的 AI 报告读取；没有验收时 delivery 固定为未验证。

## 5. 共享文件协调

高风险共享文件：

```text
backend/src/modelforge/settings.py
backend/src/modelforge/entrypoints/api.py
backend/src/modelforge/entrypoints/worker.py
backend/migrations/versions/**
frontend/src/features/training/types.ts
frontend/src/features/training/training-model.ts
frontend/src/features/training/components/AttemptDetail.tsx
frontend/src/features/training/training.css
```

这些文件不能由多个 ticket 无协调并行修改。每轮开始前：

- 固定当前 SHA；
- 记录工作区已有修改；
- 指定唯一 owner；
- 先提交接口/常量，再并行实现；
- 避免覆盖用户已有改动。

## 6. 关闭条件

每个 ticket 关闭时必须附：

- 实际修改文件；
- 验证命令；
- 通过/失败结果；
- 截图或 API 证据；
- 未运行项；
- 剩余风险；
- 若为设计/原型，明确“不是真实训练验收”。

未满足时保持 open。
