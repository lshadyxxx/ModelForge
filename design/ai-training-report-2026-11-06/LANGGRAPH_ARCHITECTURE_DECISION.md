# ModelForge AI 训练诊断
## LangGraph 受控编排架构决策（ADR）

日期：2026-11-07（初版：2026-11-06）  
状态：纵向切片已按本决策落地；真实模型单例契约通过；黄金集与生产验收待完成  
范围：单次训练终态 Attempt 的 AI 智能诊断报告；跨运行分析、自动调参和自主 Agent 不在本阶段范围

---

## 0. 决策摘要

采用 **LangGraph 1.2.20 的固定 StateGraph** 编排单次诊断报告生成，并使用：

- `langchain-openai 1.7.4` 作为模型适配器；
- `langgraph-checkpoint-postgres 3.2.0` 的 `PostgresSaver` 保存短期工作流检查点。

仍然只使用受控状态图，不采用自主 Agent。

不采用自主 Agent：

- 不由模型创建任务、选择任意工具或决定训练健康度；
- 不提供 SQL、Shell、浏览器、任意 HTTP、文件写入或训练提交工具；
- 不允许无限反思、自由循环、跨 Attempt 记忆或模型自主重试；
- LangGraph 不是业务真相来源，PostgreSQL 领域表仍是事实和审计来源；
- 启用 `PostgresSaver`，但 checkpoint 只保存工作流状态，不替代 `training_diagnosis_jobs`、
  `training_diagnosis_evidence` 和 `training_diagnosis_reports`；
- checkpoint 使用独立 schema、独立连接、短 TTL 和最小 State，不保存 API Key、完整日志或
  未裁剪证据正文；
- 不部署 LangGraph Platform，不要求 LangSmith 云追踪。

最终链路：

```text
已认证用户请求
  → FastAPI：权限、终态、幂等、任务入队
  → PostgreSQL：training_diagnosis_jobs + 租约 + fencing token
  → 独立 diagnosis_worker 线程领取任务
  → LangGraph StateGraph + PostgresSaver
       collect
         → gate
         → generate
         → validate
              ├─ valid → publish
              ├─ invalid 且 repair_count < 1 → repair → validate
              └─ invalid 且已修复一次 → fail
  → ChatOpenAI（langchain-openai）生成结构化候选报告
  → Validator → PostgreSQL 不可变 training_diagnosis_reports
  → A v2「智能诊断」页签 / 总览入口卡
```

硬边界只有一句：

> **GateEngine 决定“是什么”，LLM 只解释“为什么”和“下一步”，Validator 决定“能不能发布”，PostgresSaver 只帮助恢复流程。**

---

## 1. 为什么不是自主 Agent

### 1.1 业务任务本身是收敛的

本轮任务不是开放式研究，而是一次有界批处理：

1. 读取当前 Attempt 的冻结证据；
2. 计算训练健康度和可交付性；
3. 生成受证据约束的摘要、发现、限制和实验建议；
4. 校验后发布不可变报告。

节点、输入和成功条件可以提前枚举。让模型自主规划工具调用不会增加任务完成率，反而会扩大读取范围、攻击面和回归成本。

### 1.2 报告必须可复现和可审计

同一个 `attempt_id + evidence_digest + graph_version + policy_version + prompt_version + generator_version` 应能解释报告为何出现。自主 Agent 的中间工具选择、隐式计划和动态上下文会削弱这种可解释性。

### 1.3 硬门禁不能被概率模型接管

训练健康度、可交付性、证据冲突和 stale 状态必须由确定性规则计算。LLM 只生成解释文本。否则“模型以为 Loss 正常”可能覆盖真实的 runtime mismatch、snapshot integrity failure 或缺失推理验收。

### 1.4 当前证据是强类型字段，不是开放世界

现有事实包括 Attempt snapshot、Train/Eval Loss、learning_rate、token_preflight、runtime_report、GPU 显存、execution_manifest、provisioning 错误码、受限日志和 Best/Final Adapter。它们更适合结构化注入，不需要 RAG 或自由检索。

### 1.5 自主工具带来的权限成本不划算

训练平台涉及 GPU、凭据、租户、产物和成本。即使未来接入工具，也必须经过权限、白名单、审批和审计层。首版直接把模型连接到工具注册表是过度设计，也是高风险设计。

---

## 2. 为什么仍然选择 LangGraph

如果只做一次 `generate → validate`，普通 Python 函数链已经足够。选择 LangGraph 的合理性来自以下组合：

- 用户已明确后续要在 ModelForge 内建设 Agent 模块；
- 报告生成已经存在条件修复、失败闭锁和多阶段状态；
- 未来可能增加追问、版本差异、证据重读等有界工作流；
- 固定拓扑可以单测节点、边和路由，不必把所有控制流写进一个大函数；
- 只使用低层 StateGraph，不引入角色编排、长期记忆或自主工具循环，成本可控。

因此，本决策不是“LangGraph 能提高报告正确性”。LangGraph 解决的是**编排、条件分支、失败恢复边界和后续扩展**；报告正确性仍由 EvidencePack、GateEngine、Validator 和评估体系保证。

### 2.1 不选择的框架类别

| 框架或产品 | 主要定位 | 本轮不选原因 |
|---|---|---|
| LangChain Agents / agent loop | 通用 Agent、工具调用与 Agent 抽象 | 本轮不需要自由工具选择和通用 Agent 循环；只采用同生态的低层 LangGraph |
| OpenAI Agents SDK | OpenAI 生态 Agent SDK、handoffs、guardrails、tracing | 会把运行逻辑绑定到 Agent SDK；当前只需要 `langchain-openai` 的结构化模型适配 |
| Google ADK | Google 生态 Agent 开发与多 Agent 编排 | 本轮不依赖 Google 模型生态，也不需要多 Agent 部署单元 |
| Microsoft Agent Framework / AutoGen | 多 Agent 协作、会话与工作流 | 角色协作模型不适合确定性的训练门禁；额外运行时和概念负担较大 |
| CrewAI | 角色、团队和任务式多 Agent 协作 | “角色扮演”不映射当前证据审计任务，且自由协作不利复现 |
| LlamaIndex Workflows | 数据/RAG 与事件驱动 Agent 工作流 | 当前证据是结构化字段，不需要检索和索引；RAG 不解决数字真实性问题 |
| Semantic Kernel | 企业级 Agent、插件和编排框架 | 功能面较宽，当前 Python/FastAPI 项目不需要其插件和 Agent 抽象 |
| Temporal | 通用持久化工作流与活动编排 | 可靠，但引入新的服务、部署和运维成本；单次短图用 PostgreSQL 租约已够 |
| Dify / Coze 等低代码平台 | 面向业务人员的 Agent 应用平台 | 难以嵌入现有训练详情、权限、审计和不可变报告模型 |
| MCP | 工具与数据源连接协议 | 是协议，不是 Agent 框架；未来若出现第二个真实工具型任务再评估 |

以上只表示“本轮不适合”，不表示这些框架本身优劣。框架生态变化快，正式引入前必须重新核对版本、许可证、Python 3.13 兼容性和供应链安全。

`langchain-openai` 不是自主 Agent 框架，而是 LangChain 的 OpenAI 模型集成包。它负责
`ChatOpenAI`、结构化输出和模型参数适配；本方案不会因此启用 tools、handoffs、长期记忆或
模型自主规划。

---

## 3. 当前技术栈与依赖结论

| 层 | 当前技术 | 决策 |
|---|---|---|
| 前端 | React 19.3.1、TypeScript 7.0.2、Vite 8.3.5、原生 CSS/SVG | 复用，不新增 UI 框架或图表库 |
| API | Python >=3.13、FastAPI 0.162.0、Uvicorn 0.54.0 | 复用现有路由、错误和权限模型 |
| 契约 | Pydantic / pydantic-settings 2.16.2 | 用于 EvidencePack、GateResult、CandidateReport、ValidatedReport |
| 数据库 | PostgreSQL 17、psycopg 3.3.6、SQLAlchemy 2.1.6、Alembic 1.20.1 | 保存任务、租约、冻结证据、不可变报告与审计 |
| 对象存储 | MinIO 7.2.20 | 只读取 Adapter 和 manifest 事实，不复制训练产物 |
| HTTP | httpx 0.28.1 | 现有服务间请求；模型调用由 OpenAI SDK 负责 |
| 测试 | pytest 9.2.0、Node.js test runner | 后端规则/图/集成，前端契约和交互回归 |
| 部署 | 现有 Docker Compose + nginx | 不新增服务；若实现，只在现有 worker 进程增加独立线程 |
| 模型适配 | `langchain-openai` + OpenAI SDK | `ChatOpenAI`、结构化输出、超时和模型参数 |
| 编排 | `langgraph` | 固定 `StateGraph`、条件边和一次 repair |
| 检查点 | `langgraph-checkpoint-postgres` | `PostgresSaver` 短期恢复工作流，不替代业务表 |

### 3.1 LangGraph、模型适配与 Checkpointer 依赖查证

查证日期：2026-11-06。

- PyPI 当前版本：`langgraph 1.2.20`，发布于 2026-11-05；
- `requires-python`：`>=3.10`；
- 许可证：MIT；
- wheel：`py3-none-any`；
- 直接传递依赖包含：`langchain-core`、`langgraph-checkpoint`、`langgraph-prebuilt`、`langgraph-sdk`、`pydantic`、`xxhash`。

补充查证：

- `langchain-openai 1.7.4`，`requires-python >=3.10,<4.0`，MIT；
  - 依赖 `langchain-core>=1.7.5`、`openai>=2.45.0`、`tiktoken`、`aiohttp` 等；
  - 与 `langgraph 1.2.20` 的 `langchain-core<2,>=1.4.7` 兼容。
- `langgraph-checkpoint-postgres 3.2.0`，`requires-python >=3.10`，MIT；
  - 依赖 `langgraph-checkpoint>=4.3,<5`、`psycopg>=3.2`、`psycopg-pool>=3.2`、`orjson`；
  - 与项目现有 `psycopg 3.3.6`、`psycopg-pool 3.3.3` 兼容。

来源：

- <https://pypi.org/project/langgraph/>
- <https://pypi.org/project/langchain-openai/>
- <https://pypi.org/project/langgraph-checkpoint-postgres/>
- <https://github.com/langchain-ai/langgraph>
- <https://github.com/langchain-ai/langchain>

### 3.2 依赖取舍

建议在正式实施时锁定：

```text
langgraph==1.2.20
langchain-openai==1.7.4
langgraph-checkpoint-postgres==3.2.0
```

但必须先在项目锁文件和 Python 3.13 容器中完成安装 smoke test。当前本地解释器是 Python 3.14，不能替代项目目标环境验证。

锁文件还需要确认以下传递依赖可解析：

```text
langchain-core>=1.7.5,<2
openai>=2.45.0
langgraph-checkpoint>=4.3,<5
psycopg>=3.2
psycopg-pool>=3.2
```

不引入：

- `LangGraph Platform`：没有部署需求；
- `LangSmith`：不是首版必需，观测先走内部日志和指标；
- Celery、Redis、向量数据库：任务队列继续复用 PostgreSQL；
- 自主 Agent 的 handoff、长期记忆和自由工具调用。

需要准确表述：引入 LangGraph + `langchain-openai` 并不等于“零 LangChain 依赖”，会拉入
`langchain-core`、OpenAI SDK 和 checkpointer 包；收益是获得受控图、结构化模型调用和短期
恢复能力，而不是采用完整自主 Agent 应用栈。

---

## 4. 组件边界

| 组件 | 唯一职责 | 不负责 |
|---|---|---|
| `routes.py` | 鉴权、终态检查、幂等入口、返回 202 / 状态 / 报告 | 不调用 LLM，不计算 Gate |
| `use_cases.py` | 创建 job、重新生成、读取 latest/version | 不生成报告正文 |
| `repository.py` | job 领取、租约、fencing、不可变报告事务、source pack | 不解释模型输出 |
| `worker.py` | 独立线程领取任务并调用图 | 不决定业务状态 |
| `graph.py` | 声明节点、边和条件路由 | 不做数据库查询，不拼 Prompt |
| `nodes.py` | 节点适配，调用领域服务 | 不持有全局可变状态 |
| `checkpoint.py` | 建立 `PostgresSaver`、设置 thread/namespace、清理过期 checkpoint | 不承载业务真相 |
| `evidence.py` | 只读收集并规范化 EvidencePack | 不调用 LLM，不写训练表 |
| `gates.py` | 纯函数计算 health、delivery、coverage、conflict、stale | 不访问网络或数据库 |
| `generator.py` | 用 `ChatOpenAI` 组装受控上下文并返回结构化候选 | 不查数据库，不写报告，不改 Gate |
| `validator.py` | Schema、Gate 一致性、数字、引用、禁止表达、敏感信息 | 不做业务状态裁决 |
| `publish` 服务 | 在租约和 fencing 有效时写不可变报告 | 不接受模型直接写库 |
| 前端 `diagnosis` 模块 | 展示报告和生命周期状态，生成/重试/应用草稿 | 不在浏览器调用模型 |

---

## 5. 目录与文件落点

### 5.1 后端

```text
backend/src/modelforge/modules/training/diagnosis/
├─ __init__.py
├─ contracts.py       # API request/response
├─ schema.py          # EvidencePack / GateResult / Report
├─ evidence.py        # EvidenceCollector
├─ gates.py           # 确定性 GateEngine
├─ context.py         # 受控事实投影，不直接序列化原始对象
├─ generator.py       # TemplateGenerator / LangChainOpenAIGenerator
├─ validator.py       # 发布前硬断言
├─ repository.py      # job/lease/evidence/report 事务
├─ checkpoint.py      # PostgresSaver、thread 命名、TTL/清理
├─ graph.py           # LangGraph StateGraph 组装
├─ nodes.py           # collect / gate / generate / validate / repair / publish / fail
├─ worker.py          # diagnosis_loop + graph_runner
├─ use_cases.py       # create / regenerate / latest / list
└─ routes.py          # FastAPI 训练域路由
```

不把 LangGraph 放进 `RunAnalysis.tsx`，也不把报告状态机塞进 `execution.py`。

### 5.2 前端

```text
frontend/src/features/training/diagnosis/
├─ api.ts
├─ use-diagnosis.ts
├─ AiReportEntryCard.tsx
├─ AiDiagnosisTab.tsx
├─ FindingLedger.tsx
├─ EvidenceInspector.tsx
├─ ReportTimeline.tsx
└─ ReportStates.tsx
```

修改点只应在训练详情页签注册与总览入口，不修改正式业务逻辑之前，先用设计目录内的 A v2 原型定稿。

### 5.3 测试

```text
backend/tests/training/diagnosis/
├─ test_schema.py
├─ test_evidence.py
├─ test_gates.py
├─ test_validator.py
├─ test_graph_contract.py
├─ test_repository_lease.py
├─ test_worker_recovery.py
└─ test_routes.py

frontend/tests/
└─ training-diagnosis.test.mjs
```

---

## 6. State 契约

状态只保存编排所需引用、枚举和文本输出，不保存凭据、完整日志或完整 EvidencePack：

```python
from typing import Any, Literal, TypedDict


class DiagnosisState(TypedDict, total=False):
    job_id: str
    attempt_id: str
    input_digest: str
    evidence_digest: str
    gate_snapshot: dict[str, Any]
    candidate_report: dict[str, Any]
    validation_issues: list[dict[str, str]]
    repair_count: int
    report_version: int
    error_code: str
```

约束：

- 证据正文由 `job_id` 从 `training_diagnosis_evidence` 按引用读取；
- State 中不出现 API Key、DSN、签名 URL、Authorization Header、完整日志和数据集样本；
- `gate_snapshot` 只含 Gate 枚举、证据覆盖、冲突 ID 和 source digest；
- `candidate_report` 是待校验的模型输出，不是已发布报告；
- `error_code` 使用稳定枚举，不写异常栈或供应商原文；
- State 会进入 `PostgresSaver`，因此只允许保存最小编排状态、Gate 枚举、候选报告和校验问题；
- `candidate_report` 必须有长度上限，只允许引用 ID 和脱敏摘要，不允许原始日志、完整文件或业务样本；
- checkpoint 的 `thread_id` 必须绑定 `job_id`，禁止跨 Attempt 复用；
- checkpoint TTL 默认 24 小时，失败/取消任务建议 1 小时内清理；具体以运维策略为准。

---

## 7. 图拓扑与代码骨架

```python
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph


def build_diagnosis_graph(services, checkpointer):
    graph = StateGraph(DiagnosisState)

    graph.add_node("collect", services.nodes.collect)
    graph.add_node("gate", services.nodes.gate)
    graph.add_node("generate", services.nodes.generate)
    graph.add_node("validate", services.nodes.validate)
    graph.add_node("repair", services.nodes.repair)
    graph.add_node("publish", services.nodes.publish)
    graph.add_node("fail", services.nodes.fail)

    graph.add_edge(START, "collect")
    graph.add_edge("collect", "gate")
    graph.add_edge("gate", "generate")
    graph.add_edge("generate", "validate")
    graph.add_conditional_edges(
        "validate",
        services.nodes.route_after_validate,
        {
            "valid": "publish",
            "repair": "repair",
            "fail": "fail",
        },
    )
    graph.add_edge("repair", "validate")
    graph.add_edge("publish", END)
    graph.add_edge("fail", END)

    return graph.compile(checkpointer=checkpointer)
```

Checkpointer 的装配建议：

```python
from contextlib import contextmanager


@contextmanager
def open_checkpointer(settings):
    with PostgresSaver.from_conn_string(settings.checkpoint_dsn) as saver:
        saver.setup()
        yield saver
```

`setup()` 只负责准备 checkpointer 自己的内部表；建议在部署/迁移阶段执行一次，不由每个
HTTP 请求触发。checkpointer 连接使用独立 schema、独立最小权限角色，不与业务 repository
共享可变连接。

如果实现选择传入现有 psycopg 连接，而不是 `from_conn_string`，必须在 `setup()` 前设置
`autocommit=True`；否则 `CREATE INDEX CONCURRENTLY` 等初始化语句可能因活动事务失败。

路由规则：

```python
def route_after_validate(state: DiagnosisState) -> Literal["valid", "repair", "fail"]:
    if not state.get("validation_issues"):
        return "valid"
    if state.get("repair_count", 0) < 1:
        return "repair"
    return "fail"
```

调用约束：

- `recursion_limit` 显式设为 8，防止未来误加循环；
- 每次运行使用 `thread_id = f"diagnosis:{job_id}"`；
- 使用 `checkpoint_ns = graph_version` 隔离拓扑版本；
- 单次 LLM 请求超时 25 秒；不做无限重试，整图软超时 90 秒；
- `repair` 只修复格式、引用或表达，不重新计算 Gate，不新增证据；
- 第二次校验失败直接 `fail`；
- 图中没有工具节点、任意 HTTP 节点、SQL 节点或动态节点注册。

---

## 8. 节点契约

| 节点 | 输入 | 输出 | 失配处理 |
|---|---|---|---|
| `collect` | 已鉴权 `attempt_id` | 冻结 evidence、`evidence_digest` | 非终态 409；不存在 404；集合失败 `evidence_unavailable` |
| `gate` | `job_id`、evidence 引用 | `GateResult` 快照 | 规则异常立即 fail，不能交给 LLM 猜测 |
| `generate` | Gate + 受控事实投影 | `CandidateReport` | 超时、429、非法 JSON → 可恢复错误 |
| `validate` | candidate + evidence + Gate | issues 或 valid | 引用缺失不做首条回退 |
| `repair` | candidate + issues + 同一 evidence | 新 candidate，`repair_count += 1` | 不允许新增证据或改变 Gate |
| `publish` | valid report + job lease | 不可变 version | fencing 或租约失效 → 拒绝发布 |
| `fail` | 稳定错误码 | job failed，无半成品 | 保留上一版 ready 报告 |

### 8.1 Gate 永远在生成之前

图契约测试必须断言：

```text
START → collect → gate → generate
```

不存在任何从 `START` 或 `collect` 直接到 `generate` 的边。否则模型可能在没有 Gate 结果时被要求“猜健康度”。

### 8.2 模型不可修改 Gate

候选报告不包含可写的 `health_status` 或 `delivery_status` 字段；发布服务只从 `GateResult` 复制这两个字段。即使模型 JSON 伪造状态，也必须在 Validator 拒绝。

---

## 9. PostgreSQL 任务与报告模型

建议把“生成任务”和“不可变报告”拆开，避免一个状态行既被更新又声称不可变。

### 9.1 Job 表

```sql
CREATE TABLE training_diagnosis_jobs (
    id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    request_key text NOT NULL,
    input_digest text NOT NULL CHECK (length(input_digest) = 64),
    state text NOT NULL
        CHECK (state IN ('queued', 'running', 'ready', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    repair_count integer NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 1),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    fencing_token bigint NOT NULL DEFAULT 0,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE(attempt_id, request_key)
);

CREATE INDEX idx_training_diagnosis_jobs_ready
    ON training_diagnosis_jobs(state, next_attempt_at, created_at);
```

### 9.2 冻结证据表

```sql
CREATE TABLE training_diagnosis_evidence (
    job_id uuid PRIMARY KEY REFERENCES training_diagnosis_jobs(id),
    evidence_pack jsonb NOT NULL CHECK (jsonb_typeof(evidence_pack) = 'object'),
    evidence_digest text NOT NULL CHECK (length(evidence_digest) = 64),
    redaction_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

证据包只包含报告所需字段、证据 ID、字段路径、观测时间、脱敏摘要和 digest，不保存完整原始日志、数据集样本或凭据。

### 9.3 不可变报告表

```sql
CREATE TABLE training_diagnosis_reports (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES training_diagnosis_jobs(id),
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    version integer NOT NULL CHECK (version > 0),
    report_mode text NOT NULL CHECK (report_mode IN ('full', 'limited')),
    health_status text NOT NULL,
    delivery_status text NOT NULL,
    source_digest text NOT NULL CHECK (length(source_digest) = 64),
    schema_version text NOT NULL,
    policy_version text NOT NULL,
    graph_version text NOT NULL,
    prompt_version text,
    generator_version text,
    report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
    report_sha256 text NOT NULL CHECK (length(report_sha256) = 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(attempt_id, version)
);
```

规则：

- 一个 job 最多发布一份报告；
- `ready` 报告不可 update；
- “重新生成”创建新 job 和新 version；
- latest 取该 Attempt 的最大 ready version；
- source digest 变化不再回写旧报告，查询时标 stale；
- 报告正文和来源包都在同一发布事务中落库。

### 9.4 领取任务

```sql
SELECT id
FROM training_diagnosis_jobs
WHERE state = 'queued'
  AND next_attempt_at <= now()
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

领取后：

```text
state = running
lease_owner = worker_id
lease_expires_at = now() + interval '120 seconds'
fencing_token = fencing_token + 1
attempt_count = attempt_count + 1
```

如果 Worker 崩溃，另一个 Worker 只能在租约过期后回收任务。旧 Worker 即使模型已返回，也必须因为 `lease_owner` 或 `fencing_token` 不匹配而无法发布。

### 9.5 发布事务

```text
BEGIN
  SELECT job ... FOR UPDATE
  校验 state=running
  校验 lease_owner、fencing_token、lease_expires_at
  校验 job 尚无 report
  INSERT training_diagnosis_reports
  UPDATE training_diagnosis_jobs SET state=ready, finished_at=now()
COMMIT
```

任何一项失败都回滚，不发布候选报告。

---

## 10. 恢复与 Checkpointer 决策

### 10.1 采用 PostgresSaver，但不把 checkpoint 当业务真相

使用 `langgraph-checkpoint-postgres 3.2.0` 的同步 `PostgresSaver`，与当前同步 Worker 线程匹配。

职责划分：

| 状态 | 保存位置 | 是否业务真相 |
|---|---|---|
| job 生命周期、租约、fencing、attempt_count | `training_diagnosis_jobs` | 是 |
| 冻结 EvidencePack 与 digest | `training_diagnosis_evidence` | 是 |
| 已发布报告版本与 hash | `training_diagnosis_reports` | 是 |
| 节点进度、候选报告、校验问题 | `PostgresSaver` 内部表 | 否，仅用于恢复 |
| 模型 API Key、数据库连接、签名 URL | 环境/Secret 管理 | 不进入 checkpoint |

每个 job 的 checkpointer 配置：

```text
thread_id = f"diagnosis:{job_id}"
checkpoint_ns = graph_version
recursion_limit = 8
```

### 10.2 崩溃恢复流程

```text
Worker 崩溃
→ lease_expires_at 过去
→ 新 Worker 原子回收为 queued，fencing_token 增加
→ 以同一个 job_id / thread_id 打开 PostgresSaver
→ 从最近一次已提交 checkpoint 继续；若没有可用 checkpoint，则从 collect 开始
→ publish 仍校验 lease、fencing、job_id 唯一约束
```

注意：

- checkpoint 是“执行进度”，不是发布许可；
- 旧 Worker 即使恢复成功并拿到模型输出，租约或 fencing 失效时也不能 publish；
- 如果 publish 已提交但进程在 checkpoint 落盘前崩溃，重新执行 publish 必须识别已有
  `job_id` 报告并幂等返回；
- 如果 checkpointer 不可用，任务应失败并保留原详情页，不应静默降级成无 checkpoint 运行；
- 不允许复用其他 Attempt 的 `thread_id`，也不允许把 checkpoint 当作跨任务长期记忆。

### 10.3 敏感数据、TTL 与运维

- 使用独立 schema，例如 `langgraph_checkpoint`；不在业务表 schema 中混放内部 checkpoint 表；
- 使用独立最小权限数据库角色，只允许该角色访问 checkpoint schema；
- State 中不存 API Key、DSN、Authorization Header、签名 URL、完整原始日志和数据集样本；
- `candidate_report` 只允许报告结构、证据 ID 和受限脱敏摘要，必须限制长度；
- State 只放 JSON-compatible 值，不把任意 Python 对象或 pickle 写入 checkpoint；
- checkpoint 默认 TTL 24 小时；失败/取消任务可缩短为 1 小时；
- 若固定版本没有稳定 TTL API，使用独立 retention job 依据公开的 checkpoint 元数据清理；
- checkpoint 表备份、磁盘增长、清理失败必须纳入监控，不能无限增长；
- 升级 `graph_version` 时更换 `checkpoint_ns`，旧 checkpoint 不强行恢复；
- 后续多轮追问使用独立的 conversation thread，不复用报告 job thread。

## 11. 模型边界

### 11.1 调用方式

```text
LangChainOpenAIGenerator
  → 读取冻结 EvidencePack + GateResult
  → 构造受控事实投影
  → ChatOpenAI(model=MF_AI_MODEL, base_url=MF_AI_BASE_URL, timeout=25)
  → with_structured_output(CandidateReportModel, method=json_schema)
  → Pydantic 解析
```

建议初始化：

```python
from langchain_openai import ChatOpenAI


model = ChatOpenAI(
    model=settings.ai_model,
    api_key=settings.ai_api_key,
    base_url=settings.ai_base_url,
    timeout=25,
    max_retries=0,
    temperature=0,
)
structured_model = model.with_structured_output(
    CandidateReportModel,
    method="json_schema",
    strict=True,
)
```

`max_retries=0` 是有意设置：请求级重试由 job 的退避策略控制，避免在 LangGraph 节点内部产生
不可见的重复调用和成本。若目标 OpenAI-compatible 服务不支持 `json_schema`，通过受控 feature
flag 切换到 `function_calling` 或 `json_mode`，不能让模型自由返回未校验文本。

不使用：

- 浏览器直接调用模型；
- 模型侧工具调用；
- 模型自主检索日志；
- 模型直接访问数据库；
- 模型流式输出未校验内容给用户。

### 11.2 允许模型生成

- 四问摘要；
- 关键发现的自然语言解释；
- `observed / inferred / recommendation` 的分类标签；
- 限制说明；
- 下一步实验建议；
- 证据引用说明。

### 11.3 禁止模型决定

- `health_status`；
- `delivery_status`；
- 推理验收通过；
- 模型可用；
- 根因已确认；
- 训练是否成功；
- 是否创建 GPU、提交训练或写回 Attempt。

### 11.4 日志与 Prompt Injection

日志只作为 `log_excerpt` 数据字段进入上下文，不能进入 system 指令区域。任何“忽略上述规则”“直接说模型可用”等文本只作为待分析内容，继续受 system policy、Schema 和 Validator 约束。

---

## 12. 前端与产品呈现约束

前端不需要展示 LangGraph 品牌，继续使用产品名“AI 智能诊断”。

推荐复用 A v2：

- 总览页结论卡；
- 独立智能诊断页签；
- 双门禁：训练健康度 / 可交付性；
- 观测 / 推断 / 建议三色语义；
- finding ledger + evidence inspector；
- 生成中、空、失败、有限、stale、冲突；
- “应用建议”只打开未提交训练草稿。

API 建议：

```text
POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports/latest
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/diagnosis-reports/{report_id}
POST /api/v1/training/diagnosis-jobs/{job_id}/regenerate
```

POST 只返回 `202 + job_id + report_id? + queued`；实际生成由独立 Worker 完成。

---

## 13. 未来 Agent 模块如何生长

不要在本轮提前创建通用 `agent` 包。只有出现第二个真实任务时才抽出：

```text
backend/src/modelforge/modules/agent/
├─ tools.py          # 强类型、白名单、只读优先
├─ policies.py       # 租户、权限、审批、数据边界
├─ graph_runner.py   # 固定工作流版本与配额
├─ checkpoint.py     # 只存会话状态，不存业务真相
├─ audit.py          # 工具调用、审批、结果摘要
└─ routes.py         # 受控入口
```

未来工具的默认规则：

1. 只读工具优先；
2. 工具有明确输入 Schema 和权限范围；
3. 工具调用产生审计记录，不把原始结果写入长期记忆；
4. 写操作只能生成待用户确认的 proposal；
5. 训练提交、GPU 创建、发布 Adapter 等高风险动作必须二次确认；
6. 模型不能给自己授予新工具；
7. 工具无法访问其他租户或任意 SQL；
8. 有最大步数、超时、成本和输出长度上限。

这条路线使当前诊断报告成为未来 Agent 的第一个“受控能力”，而不是先造一个没有业务的通用 Agent。

---

## 14. AI 如何评估

### 14.1 四个独立评估对象

| 对象 | 评估方式 | 不能证明什么 |
|---|---|---|
| Gate 正确性 | 纯函数单测 + 黄金 EvidencePack | 不能证明业务效果 |
| 报告事实性 | Schema、数字、引用、abstention、forbidden claim | 不能证明用户会看懂 |
| 用户决策 | 盲评 + 任务型测试 | 不能替代事实断言 |
| 运行可靠性 | 租约、重放、超时、429、并发、stale | 不能证明报告正确 |

### 14.2 Phase 1 黄金 Case

先在内部建立 14–16 个阻断 Case，试点前扩展到 18–24 个：

- 成功，22 Train 点、1 Eval 点、Adapter 2/2、无当前 Adapter 推理验收；
- 只有 Best 或只有 Final；
- 当前 Adapter 有独立推理验收；
- Serving Trial 属于其他 Adapter；
- `bootstrap_key_install_failed` 且证据缺失；
- cancelled 且无 metrics；
- runtime mismatch / snapshot conflict；
- token_preflight 缺失；
- 日志为空、日志失败、日志未分析；
- 证据过期、来源变化、冲突；
- 日志 prompt injection；
- 日志疑似密钥；
- 数字幻觉与证据 ID 失效；
- 单 Eval 点被写成趋势；
- Adapter available 被写成模型可用；
- 非终态 Attempt。

每个 Case 固化：

```text
evidence-pack.json
expected-gates.json
expected-report.schema.json
required-claims.yaml
forbidden-claims.yaml
required-coverage.yaml
human-rubric.json
```

### 14.3 LangGraph 专项测试

- 图拓扑只含声明的节点和边；
- `gate` 永远先于 `generate`；
- 无工具节点、无自由循环；
- 模型输出不能改写 Gate；
- 第二次 validator 失败必须 fail closed；
- 修复最多一次；
- 非终态 Attempt 返回 409；
- 同一幂等键返回已有版本；
- 重新生成创建新版本；
- 两个 Worker 并发不会重复领取；
- 租约过期后 fencing 阻断旧 Worker 发布；
- Worker 崩溃后从最近 checkpoint 恢复；没有 checkpoint 时从 collect 开始；
- 从 checkpoint 恢复的旧 Worker 不能绕过租约/fencing 发布；
- checkpoint schema、thread_id、checkpoint_ns 和 TTL 可验证；
- checkpointer 不可用时 job fail closed，不静默降级；
- LLM timeout、429、半 JSON、非法 JSON、超长输入；
- `ChatOpenAI.with_structured_output` 合法/非法输出、超时和 429；
- 不支持 `json_schema` 的服务在受控 fallback 下仍必须过 Pydantic 校验；
- 证据 ID 缺失时不回退首条；
- 日志注入不改变系统规则；
- State、异常和日志不包含秘密；
- `recursion_limit` 和节点超时受控。

### 14.4 发布硬门禁

```text
schema_valid = 100%
gate_fidelity = 100%
numeric_faithfulness = 100%
critical_unsupported_claim = 0
forbidden_claims = 0
stale_detection = 100%
conflict_detection = 100%
citation_precision >= 98%
关键缺失项 abstention = 100%
```

LLM-as-Judge 只能做预筛选和语义抽查，不能作为状态、数字、引用或发布的唯一门禁。

### 14.5 稳定性与样本独立性

同一 Case 重复生成三次，只衡量稳定性，不是三个独立统计样本。不能因为三次都没出现严重错误，就宣称严重错误率为零。对外发布前至少需要独立脱敏 EvidencePack 集合、人工盲评和 Shadow 观测。

---

## 15. 实施顺序

### P0：事实、契约与门禁

交付：

- `schema.py`、`evidence.py`、`gates.py`；
- `training_diagnosis_jobs`、`evidence`、`reports` migration；
- EvidenceRef 的 `evidenceId + fieldPath + observedAt` 契约；
- 14–16 个 Gate/validator 夹具；
- TemplateGenerator 或 FakeGenerator。

退出：没有模型也能稳定生成事实报告；现有训练 API 测试全绿。

### P1：LangGraph 受控图

交付：

- `graph.py`、`nodes.py`；
- `PostgresSaver` 与 `graph.compile(checkpointer=...)`；
- checkpoint 独立 schema、thread/namespace 和 TTL；
- `diagnosis_worker` 独立线程；
- 租约、fencing、幂等发布；
- 图拓扑、崩溃恢复、重复投递测试。

退出：FakeLLM 下可从 checkpoint 恢复，租约失效不能发布，第二次校验失败安全失败。

### P2：真实模型与 A v2 UI

交付：

- `LangChainOpenAIGenerator`；
- Validator 全量接入；
- A v2 总览入口卡和智能诊断页签；
- 生成中、空、失败、有限、stale、冲突和“成功但可用性未验证”状态；
- 应用建议草稿；
- feature flag。

退出：14–16 个阻断 Case 通过；生成失败不阻塞原始训练详情；上一版报告不被覆盖。

### P3：Shadow 与试点

交付：

- 24 个黄金 Case；
- 50 个脱敏 EvidencePack / 至少 150 份报告；
- 专家盲评；
- 5–8 人形成性测试，试点前 12–15 人任务测试；
- 线上观测面板和一键回滚。

---

## 16. Feature Flag、回滚和运行预算

建议配置：

```text
MF_AI_DIAGNOSIS_ENABLED=false
MF_AI_DIAGNOSIS_MODE=template|shadow|llm
MF_AI_BASE_URL=
MF_AI_API_KEY=       # SecretStr，不进入日志/State
MF_AI_MODEL=
MF_AI_TIMEOUT_SECONDS=25
MF_AI_JOB_TIMEOUT_SECONDS=90
MF_AI_MAX_INPUT_CHARS=
MF_AI_GRAPH_VERSION=diagnosis-v1
MF_AI_CHECKPOINT_SCHEMA=langgraph_checkpoint
MF_AI_CHECKPOINT_DSN=       # SecretStr，独立角色/连接串
MF_AI_CHECKPOINT_TTL_HOURS=24
MF_AI_STRUCTURED_OUTPUT_METHOD=json_schema
```

回滚：

1. 关闭 `MF_AI_DIAGNOSIS_ENABLED`，保留原始详情页；
2. 把 mode 切回 `template`，停止真实模型调用；
3. 保留已发布报告只读；
4. 若发现越级状态，停止展示最新 AI 报告，继续展示原始 Gate facts；
5. 不删除历史报告和审计记录。

运行预算：

- 独立线程，不与 `execution_loop` 共循环；
- 单任务最大图步数 8；
- 单次请求超时 25 秒，整图软超时 90 秒，租约 120 秒；
- 不在节点内无限重试；失败按 job 退避重跑，最多 3 次；
- 修复最多一次；
- checkpoint TTL 默认 24 小时，失败/取消任务可缩短为 1 小时；
- 输出长度和证据条数有硬上限；
- 失败任务指数退避，避免毒任务。

---

## 17. 风险与反模式

| 风险 | 处理 |
|---|---|
| LangGraph 逐渐扩成自由 Agent | 图拓扑静态声明；无工具节点；PR 必须声明节点/边变化 |
| checkpoint 泄漏证据或密钥 | State 最小化、独立 schema/角色、TTL、敏感信息不入 State |
| checkpoint 表无限增长 | TTL + retention job + 磁盘/清理告警 |
| checkpoint 版本不兼容 | `checkpoint_ns=graph_version`；升级时隔离旧状态 |
| 模型覆盖 Gate | 报告 Schema 不含写状态字段；发布服务强制复制 |
| 租约过期后旧 Worker 发布 | fencing token + 发布事务校验 |
| 模型返回半 JSON | 严格 Schema，失败不发布，保留上一版 |
| 日志 prompt injection | 日志只作为数据字段，系统规则不与之竞争 |
| 依赖升级破坏 Python 3.13 | 精确 pin、锁文件、容器安装 smoke test |
| 三次重放被当作统计独立样本 | 只用于稳定性；另行扩展独立黄金集 |
| LangGraph 被误认为报告正确性保证 | 明确：图只编排，正确性靠事实、Gate、Validator、评估 |
| 指标不足仍建议调参 | 未上报就 abstain；建议必须写前置条件和预期观察 |

---

## 18. 最终结论

**使用 LangGraph，是使用它的固定状态图能力，不是使用自主 Agent。**

本轮建议的准确表述是：

```text
LangGraph 受控编排
+ langchain-openai 结构化模型适配
+ 确定性 GateEngine
+ 结构化 EvidencePack
+ Validator 发布门禁
+ PostgresSaver checkpoint/TTL
+ PostgreSQL job/lease/immutable report
+ A v2 诊断界面
```

它比普通函数链多一层可测试拓扑、结构化模型适配和短期恢复能力，又比自主 Agent 保留了业务可控性、可审计性和低权限面。checkpoint 只保存工作流进度，不替代业务真相；不引入自由工具调用、向量库、RAG、LangGraph Platform 或 LangSmith 依赖。

未来 Agent 模块应从当前真实证据、权限、审计和用户确认模型自然生长，而不是反向让公司业务去适配一个通用 Agent Demo。

---

## 19. 参考

本地事实与设计：

- `TECHNICAL_IMPLEMENTATION_CONCLUSION.md`
- `DESIGN_DEV_AND_AI_EVAL_PLAN.md`
- `option-a.html`
- `qa/round-10-result.json`

外部依赖查证：

- LangGraph PyPI：<https://pypi.org/project/langgraph/>
- LangChain OpenAI PyPI：<https://pypi.org/project/langchain-openai/>
- LangGraph Postgres checkpointer PyPI：<https://pypi.org/project/langgraph-checkpoint-postgres/>
- LangGraph repository：<https://github.com/langchain-ai/langgraph>
- LangGraph documentation：<https://langchain-ai.github.io/langgraph/>

本文是设计与技术预研，不代表 LangGraph、`langchain-openai` 或 `PostgresSaver` 已安装，
也不代表 AI 报告已实现、推理验收已通过或模型可用。
