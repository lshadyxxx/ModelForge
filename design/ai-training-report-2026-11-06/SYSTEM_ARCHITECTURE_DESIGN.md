# ModelForge AI 训练诊断
## 系统架构设计

状态：本地纵向切片与真实模型单例契约已实现；黄金集、推理验收与生产发布待完成  
日期：2026-11-07（初版：2026-11-06）  
决策依据：[LANGGRAPH_ARCHITECTURE_DECISION.md](LANGGRAPH_ARCHITECTURE_DECISION.md)  
代码结论：[TECHNICAL_IMPLEMENTATION_CONCLUSION.md](TECHNICAL_IMPLEMENTATION_CONCLUSION.md)

> 实施说明：诊断模块、业务表、固定 LangGraph 图、`ChatOpenAI` 适配、
> `PostgresSaver`、Worker/API 和 A v2 前端页签已在工作区落地；
> 真实 DeepSeek 单例契约、成功/失败报告发布和不可变 trigger 已通过；黄金集、
> 人工 Rubric、独立推理验收和生产发布仍未完成。
> 证据见 [REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

## 1. 架构结论

AI 智能诊断不是一个新的训练执行器，也不是一个自由 Agent。它是一个 **训练域内的只读诊断子模块**：

```text
现有 Attempt / Metrics / Runtime / Artifact 事实
                  │
                  ▼
            EvidenceCollector
                  │ 冻结 EvidencePack + digest
                  ▼
              GateEngine
                  │ 确定性 health / delivery / coverage
                  ▼
       LangGraph StateGraph + PostgresSaver
                  │ collect → gate → generate → validate
                  │                    │
                  │                    ├─ valid → publish
                  │                    └─ repair → validate / fail
                  ▼
      ChatOpenAI(langchain-openai) 结构化候选报告
                  │
                  ▼
              Validator
                  │
                  ▼
       PostgreSQL 不可变 AdvisoryReport
                  │
                  ▼
       A v2 智能诊断页签 / 入口卡
```

一句话边界：

> GateEngine 决定“是什么”，LLM 只解释“为什么”和“下一步”，Validator 决定“能不能发布”，PostgresSaver 只帮助恢复流程。

## 2. 运行拓扑

```text
浏览器
  │ /api/v1/training/... + 同源 HTTP
  ▼
FastAPI API 进程 ────────────── PostgreSQL
  │                                  │
  │ 创建 diagnosis job               │ 业务真相：
  │ 读取 job/report                  │ jobs / evidence / reports
  │ 不运行模型                        │ lease / fencing / audit
  │                                  │
  └───────────────┬──────────────────┘
                  │ 原子领取 + lease
                  ▼
          独立 Worker 进程
                  │
                  ├── read-only 读取 Attempt、metrics、logs、Adapters
                  ├── LangGraph StateGraph
                  ├── PostgresSaver → 独立 checkpoint schema
                  ├── ChatOpenAI → OpenAI-compatible 模型服务
                  └── publish transaction → 业务报告表
```

关键约束：

- API 不执行 LangGraph 图，不调用模型；
- Worker 不直接接收浏览器请求；
- 模型服务只由后端访问，浏览器永远不见 API Key；
- PostgreSQL 业务表是报告真相；
- checkpoint 是短期恢复数据，不是业务事实；
- MinIO 只通过现有对象存储服务访问，不把模型或报告正文存入 checkpoint。

## 3. 模块落点

推荐新增独立业务模块：

```text
backend/src/modelforge/modules/diagnosis/
├── __init__.py       # 对外导出 routes/use_cases/worker 和最小契约
├── routes.py         # FastAPI 路由和 HTTP 映射
├── use_cases.py      # 创建、查询、重新生成、草稿
├── contracts.py      # Pydantic schema 和枚举
├── evidence.py       # EvidenceCollector、日志脱敏、digest
├── gates.py          # GateEngine，纯函数
├── context.py        # 受控事实投影和 Prompt Context
├── graph.py          # LangGraph 拓扑与节点装配
├── generator.py      # ChatOpenAI 结构化输出适配
├── validator.py      # 发布前硬断言
├── repository.py     # job、evidence、report、lease、fencing SQL
├── checkpoint.py     # PostgresSaver、thread/namespace、TTL
├── worker.py         # Worker 驱动、run_once、恢复
├── drafts.py         # 训练建议草稿白名单
└── prompts.py        # Prompt 版本和模板
```

文件命名是实现建议，不要求一次创建空文件。职责边界是强制的：

- `routes.py` 只做 HTTP 参数/结果映射；
- `use_cases.py` 不执行模型；
- `gates.py` 不调用数据库、网络或模型；
- `generator.py` 不查数据库、不写报告、不修改 Gate；
- `repository.py` 不解释模型输出；
- `worker.py` 只负责领取、恢复和推进；
- `drafts.py` 只返回未提交草稿，不提交训练。

## 4. 依赖方向

```text
entrypoints/api.py
  → modules.diagnosis.routes
  → modules.diagnosis.use_cases
  → modules.diagnosis.repository

entrypoints/worker.py
  → modules.diagnosis.worker
  → graph + generator + validator
  → evidence + gates
  → repository
  → checkpoint

diagnosis
  → training / models / serving 的只读契约
  → infrastructure.postgres / minio / settings

training / models / serving
  ─X→ diagnosis
```

`diagnosis` 可以读取训练域事实，但不能反向改变训练状态、Adapter 状态或 serving 状态。

## 5. 组件职责

| 组件 | 输入 | 输出 | 权限 |
|---|---|---|---|
| `DiagnosisRoutes` | HTTP 请求 | job/status/report/draft | 只能调用本模块用例 |
| `DiagnosisUseCases` | attempt_id、request_key | 幂等 job、最新报告 | 不执行模型、不写训练 |
| `EvidenceCollector` | 终态 Attempt 身份 | 冻结 EvidencePack、coverage、digest | 只读训练域；不跨 Attempt |
| `GateEngine` | EvidencePack | GateResult | 无 I/O、无网络、无模型 |
| `GraphNodes` | job_id + EvidencePack 引用 | State 增量 | 只能读冻结证据 |
| `ContextBuilder` | Gate + evidence 投影 | 有界 Prompt Context | 白名单字段、脱敏 |
| `LangChainOpenAIGenerator` | 受控 Context | CandidateReport | 无工具、无数据库写权限 |
| `ReportValidator` | Candidate + Evidence + Gate | valid 或 issues | 无模型调用 |
| `ReportRepository` | validated report + lease | 不可变 report | 事务、幂等、fencing |
| `DiagnosisCheckpointer` | thread_id、State | checkpoint | 独立 schema/角色、TTL |
| `DiagnosisWorker` | queued job | 推进/恢复/失败 | 不接收浏览器请求 |
| `DraftService` | 建议 config patch | 未提交草稿 | 白名单、不写 Attempt |

## 6. 请求时序

### 6.1 创建报告

```text
用户点击“生成 AI 诊断”
  → POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports
  → 校验 Attempt 存在且为终态
  → 计算 request_key（同一 attempt + policy + graph 版本）
  → INSERT training_diagnosis_jobs
       ├─ 已存在 ready：返回已有 job/report
       ├─ 已存在 running：返回当前 job
       └─ 新建：state=queued
  → 返回 202 + job_id
  → 前端轮询 status/latest
```

非终态 Attempt 返回 `409 attempt_not_terminal`，不创建 job。

### 6.2 Worker 执行

```text
Worker.run_once()
  → 原子领取 queued job
  → 获得 lease_owner / lease_expires_at / fencing_token
  → 打开 PostgresSaver(
       thread_id = diagnosis:{job_id},
       checkpoint_ns = graph_version
     )
  → graph.invoke(state, config, recursion_limit=8)
  → collect：读取并冻结 EvidencePack
  → gate：纯函数 GateResult
  → generate：ChatOpenAI 结构化候选
  → validate：Validator 硬断言
       ├─ valid：进入 publish
       ├─ invalid 且 repair_count=0：repair → validate
       └─ invalid 且 repair_count=1：fail
  → publish：事务校验 lease/fencing → 插入不可变报告
  → job=ready
```

### 6.3 读取报告

```text
前端：
  GET latest report
    ├─ 200 ready：渲染结论、发现、限制、建议
    ├─ 202 queued/running：显示生成中
    ├─ 404：显示空状态或生成按钮
    └─ 409/422/503：显示失败/功能关闭/证据不足
```

## 7. LangGraph 图

```text
START
  │
  ▼
collect
  │ 冻结 evidence、计算 digest
  ▼
gate
  │ 计算 health、delivery、coverage、conflicts
  ▼
generate
  │ 受控 Context → ChatOpenAI structured output
  ▼
validate
  ├──────── valid ────────────────→ publish → END
  ├──────── invalid, repair=0 ──→ repair → validate
  └──────── invalid, repair=1 ──→ fail → END
```

强制约束：

- `gate` 必须先于 `generate`；
- 不存在 `collect → generate` 的边；
- 图里没有工具节点、SQL 节点、Shell 节点、浏览器节点或动态工具注册；
- `repair` 不重新计算 Gate、不新增证据；
- 第二次 Validator 失败直接 `fail`；
- `recursion_limit=8`；
- 模型只生成候选内容，不写 PostgreSQL。

## 8. 状态机

### 8.1 Job 状态

```text
queued ──领取──→ running ──成功──→ ready
  │                  │
  │                  ├──可恢复错误──→ queued（attempt_count+1）
  │                  └──不可恢复/超过上限──→ failed
  └──功能关闭/用户不启动──→ 保持 queued 或由维护任务失败
```

Phase 1 不提供用户取消诊断报告的入口；训练 Attempt 的取消是上游事实，不是诊断 job 的取消。

### 8.2 Report 状态

业务报告只有发布态：

```text
不存在 → candidate（仅 State） → published（不可变）
```

`stale` 不是数据库状态，而是相对于当前 Attempt/Adapter/Trial 证据的展示派生状态。

## 9. 数据库和事务边界

### 9.1 业务表

```text
training_diagnosis_jobs
  └── training_diagnosis_evidence（1:1）
  └── training_diagnosis_reports（1:1）
```

- job 负责状态、租约、重试和版本；
- evidence 负责冻结输入和 digest；
- report 负责不可变输出和审计元数据；
- 报告版本按 `attempt_id, version` 保留；
- “latest”由版本和发布状态派生，不原地更新旧报告。

### 9.2 租约与 fencing

- 每个 Worker 领取 job 时获取 lease；
- lease 过期可被另一个 Worker 原子回收；
- 回收后旧 Worker 的 `fencing_token` 失效；
- 即使旧 Worker 已经拿到模型输出，也不能 publish；
- 训练执行原有 GPU 租约不因诊断报告改变；
- 诊断 Worker 不申请 GPU。

### 9.3 Checkpoint 边界

- `PostgresSaver` 使用独立 schema：`langgraph_checkpoint`；
- 独立最小权限角色；
- `setup()` 只在部署/迁移阶段执行一次；
- 现有 psycopg 连接复用时，`setup()` 前必须 `autocommit=True`；
- thread ID：`diagnosis:{job_id}`；
- namespace：`graph_version`；
- TTL 默认 24 小时；
- 失败/取消任务可缩短到 1 小时；
- checkpoint 不可用时 fail closed，不静默无 checkpoint 运行。

详细 DDL 和字段见 [DATA_CONTRACT_AND_DB_SPEC.md](DATA_CONTRACT_AND_DB_SPEC.md)。

## 10. API 边界

推荐接口：

```text
POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports/latest
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/diagnosis-jobs/{job_id}/status
POST /api/v1/training/diagnosis-jobs/{job_id}/regenerate
GET  /api/v1/training/diagnosis-reports/{report_id}
POST /api/v1/training/diagnosis-reports/{report_id}/draft
```

HTTP 语义：

| 状态 | 语义 |
|---|---|
| `200` | 已发布报告可读 |
| `202` | 已入队/生成中 |
| `404` | Attempt 或报告不存在 |
| `409` | Attempt 非终态、版本冲突或 job 不可发布 |
| `422` | 输入或草稿不合法 |
| `429` | 生成并发/额度限制 |
| `503` | 模型、checkpoint、数据库或依赖不可用 |

错误响应不能带 API Key、DSN、Authorization Header、完整 Prompt 或未脱敏日志。

## 11. 前端架构

### 11.1 路由

保留现有查询参数路由：

```text
?attempt=<attempt_id>&tab=overview
?attempt=<attempt_id>&tab=analysis
?attempt=<attempt_id>&tab=diagnosis
?attempt=<attempt_id>&tab=logs
?attempt=<attempt_id>&tab=artifacts
?attempt=<attempt_id>&tab=config
```

`tab=diagnosis` 是新增页签，不替换现有 `analysis`。原因是：

- `analysis` 保持原有原始指标能力，不阻塞可读取；
- `diagnosis` 是 advisory 解释层；
- 报告失败时训练详情仍可用；
- 重新生成不会重载整页日志。

### 11.2 组件分层

```text
page.tsx / AttemptDetail.tsx
  └── diagnosis/AiReportEntryCard.tsx
        └── diagnosis/AiDiagnosisTab.tsx
              ├── ReportHeader / dual gates
              ├── Summary
              ├── FindingLedger
              ├── EvidenceInspector
              ├── NextExperiments
              ├── Limitations
              └── ReportStates
```

### 11.3 数据来源

- 训练事实仍来自现有 `/training/attempts/{id}`；
- 诊断报告只来自 diagnosis API；
- UI 不自行计算 Gate；
- UI 不把缺失证据当作 0；
- UI 不根据 Loss 推导业务结论；
- 原型数据只能存在于 design 目录。

### 11.4 状态展示

必须区分：

- `health_status`：训练健康度；
- `delivery_status`：产物可交付性；
- `report_mode`：full / limited；
- `freshness`：current / stale；
- `integrity`：consistent / conflict；
- `generation_status`：queued / generating / ready / failed。

建议文案：

- “训练健康度：部分可判断”；
- “产物可下发，模型可用性未验证”；
- “仅有推理 Trial ready，不等于推理验收通过”；
- “该字段未上报，无法判断”；
- “建议只创建未提交草稿”。

## 12. 安全与信任边界

```text
不可信：
  - 训练日志
  - 数据集样本
  - execution manifest 中的路径
  - 模型输出
  - 用户追问

可信但需授权：
  - Attempt 冻结 snapshot
  - 平台生成的 GateResult
  - Adapter 记录
  - Validator/Repository 规则
```

日志和样本一律视为数据，不作为系统指令。模型没有工具，因此不能通过 Prompt Injection 执行外部动作；但仍必须防止报告文本被污染、泄漏密钥或生成超范围结论。

## 13. 可观察性

每个 job 至少记录：

- job_id、attempt_id；
- graph_version、policy_version、prompt_version、generator_version；
- 状态转换时间；
- 证据覆盖摘要；
- LLM 延迟、token/成本（若 provider 返回）；
- repair 次数；
- validator issue codes；
- 稳定错误码；
- checkpoint 恢复次数；
- 报告 digest；
- 是否 stale。

禁止记录：

- API Key；
- Authorization Header；
- checkpoint DSN；
- 完整 Prompt；
- 完整原始日志；
- 数据集内容；
- 签名 URL。

## 14. 故障处理

| 故障 | 行为 | 用户看到 |
|---|---|---|
| 非终态 Attempt | 不创建 job | 等待训练结束 |
| Evidence 收集失败 | job 失败或 limited review | 证据不足，保留原始详情 |
| Gate 规则异常 | job 失败 | 系统诊断不可用，不展示猜测 |
| 模型超时/429 | 有界重试槽位 | 生成中或稍后重试 |
| 结构化输出非法 | 一次 repair | 修复失败则失败 |
| Validator 第二次失败 | fail closed | 不发布半成品 |
| Checkpointer 不可用 | 失败 | 报告生成不可用 |
| lease 过期 | 新 Worker 回收 | 旧结果不可发布 |
| 数据库发布冲突 | 保留旧版本 | 报告版本冲突 |
| 模型返回证据外数字 | Validator 拒绝 | 需要重新生成 |
| 报告已 stale | 只读展示并标记 | 旧报告，不是 latest |

## 15. 未来 Agent 模块

本轮 LangGraph 只作为固定诊断图。未来若建设项目级 Agent 模块，必须新增独立架构层，不能直接给当前图添加自由工具：

```text
未来 Agent 层（尚未设计/实现）
  ├── 只读工具网关：查询 Attempt、日志摘要、产物清单
  ├── 申请式工具：创建未提交草稿、请求独立推理验收
  ├── 审批与审计：每次写操作显式授权
  ├── 沙箱/网络出口策略
  └── 独立队列、预算、取消和回放

当前 Phase 1
  └── 固定诊断图，无工具、无自主循环
```

未来 Agent 可以复用：

- EvidencePack；
- GateResult；
- Report/Validator；
- lease/fencing；
- LLM provider 配置；
- 审计和评估基础设施。

未来 Agent 不能复用：

- “模型可自行决定状态”；
- “checkpoint 即业务事实”；
- “UI 可绕过 Validator”；
- “Trial ready 等于验收通过”。

## 16. 架构验收

架构完成的必要条件：

- 图拓扑测试证明 Gate 先于 Generate；
- job 状态与报告状态分离；
- checkpoint 不可用不会生成无 checkpoint 报告；
- publish 事务校验 lease/fencing；
- Validator 拒绝伪造 Gate 和证据外数字；
- A v2 页面只读报告，不自行计算结论；
- 失败和证据不足有独立的真实状态；
- 没有接入自主工具或自动训练提交；
- 所有新增能力有测试、截图和限制记录。

## 17. 相关文档

- [LANGGRAPH_ARCHITECTURE_DECISION.md](LANGGRAPH_ARCHITECTURE_DECISION.md)
- [DATA_CONTRACT_AND_DB_SPEC.md](DATA_CONTRACT_AND_DB_SPEC.md)
- [DELIVERY_EXECUTION_PLAN.md](DELIVERY_EXECUTION_PLAN.md)
- [AI_EVALUATION_ACCEPTANCE.md](AI_EVALUATION_ACCEPTANCE.md)
- [SECURITY_OPERATIONS_RUNBOOK.md](SECURITY_OPERATIONS_RUNBOOK.md)
- [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md)
