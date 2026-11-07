# ModelForge AI 训练智能报告
## 技术方案与具体代码实现结论

日期：2026-11-07（初版：2026-11-06）  
状态：预研结论已在工作区落地；真实模型单例契约、成功/失败报告发布和页面验收通过；
未提交、未部署  
结论：采用「训练域内的独立诊断子模块 + LangGraph 固定状态图 + langchain-openai + PostgresSaver」，不把自由生成逻辑塞进现有运行分析页，也不采用自主 Agent。

> 下方保留预研时的设计推导；实际落地与验收证据见
> [REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

LangGraph 的完整 ADR、框架比较、租约、恢复和未来 Agent 分层见
`LANGGRAPH_ARCHITECTURE_DECISION.md`。

---

## 1. 最终结论

### 1.1 推荐方案

```text
现有 Attempt 事实
  → EvidenceCollector
  → 确定性 GateEngine
  → LangGraph StateGraph
       collect → gate → generate → validate（Validator 硬门禁）
                                  ├─ valid → publish
                                  ├─ invalid 且未修复 → repair → validate
                                  └─ invalid 且已修复 → fail
  → PostgreSQL Diagnosis Job + Lease + Immutable Report
  → 独立 DiagnosisWorker 线程
  → ChatOpenAI（langchain-openai）结构化候选报告
  → PostgresSaver 短期 checkpoint（独立 schema）
  → training_diagnosis_reports（不可变版本）
  → 独立“智能诊断”页签 + 总览结论卡
```

具体判断：

1. **A v2 的产品结构保留**，包括双结论、发现账本和证据检查器。
2. **技术入口不是 `RunAnalysis.tsx`**，而是在训练详情增加独立 `diagnosis` 页签。
3. **硬门禁由 Python 规则计算**，LLM 只生成解释、发现文本、限制和实验建议。
4. **采用 LangGraph 1.2.20 的固定 StateGraph**，只使用状态图、条件边和失败闭锁；不采用自主 Agent、自由工具调用、长期记忆、向量库或 RAG。
5. **采用 `langchain-openai 1.7.4`** 作为 `ChatOpenAI` 模型适配器，使用结构化输出；不在浏览器调用模型，不把 API Key 写入 State。
6. **采用 `langgraph-checkpoint-postgres 3.2.0` 的 `PostgresSaver`** 做短期恢复；checkpoint 使用独立 schema/角色/TTL，不替代 job、evidence、report 业务表。publish 仍校验租约和 fencing。
7. **不在浏览器调用模型**。API 密钥、审计、超时、重试和版本都必须留在服务端。
8. **先交付规则版报告，再启用 LLM**。两者共用同一个 schema、UI、LangGraph 拓扑和评估夹具。
9. **报告必须版本化并持久化**；生成失败时保留上一版，不覆盖。
10. **“应用建议”只把建议配置带入现有训练创建向导**，不新建训练、不创建 GPU、不写 Attempt。

### 1.2 不推荐方案

| 方案 | 结论 | 主要原因 |
|---|---|---|
| 前端直接调用大模型 | 拒绝 | 泄密、无审计、不可控超时与重试、无法保证证据一致 |
| 把报告塞进 `RunAnalysis.tsx` | 拒绝 | 原始事实和解释混层，报告状态、版本和失败恢复无处承载 |
| 每次请求临时生成、不持久化 | 拒绝 | 无法实现报告过期、来源追踪、盲评和稳定回归 |
| LangGraph 固定 StateGraph | 采用 | 有界状态图、条件修复、可测试拓扑，便于后续受控扩展 |
| `langchain-openai` 模型适配 | 采用 | `ChatOpenAI` + 结构化输出，复用 LangChain 模型接口，不启用自主 Agent |
| `PostgresSaver` 短期 checkpoint | 采用 | 支持节点级恢复；不替代业务真相，需独立 schema/TTL |
| 引入自主 Agent 自动查日志/调参 | 拒绝 | 工具权限过大、结果不可复现、评估成本远超收益 |
| 用当前推理 Trial 的 `ready` 当验收 | 拒绝 | 现有 Trial 只证明 serving 运行，不证明质量验收 |
| 新增向量数据库做 RAG | 拒绝 | 证据字段有限且有类型，结构化注入更可靠 |

---

## 2. 现有代码事实

### 2.1 已具备的基础

| 能力 | 代码位置 |
|---|---|
| 训练 API 路由 | `backend/src/modelforge/modules/training/routes.py:6` |
| Attempt 读取与快照完整性校验 | `backend/src/modelforge/modules/training/use_cases.py:115` |
| metrics/runtime/token/manifest 更新 | `backend/src/modelforge/modules/training/use_cases.py:204` |
| 训练证据归档 | `backend/src/modelforge/modules/training/execution.py` |
| Adapter 双产物发布与存储校验 | `backend/src/modelforge/modules/models/artifacts.py` |
| Adapter 查询 API | `backend/src/modelforge/modules/serving/routes.py:18` |
| 前端运行详情页签 | `frontend/src/features/training/components/AttemptDetail.tsx:21` |
| 页签与 URL 路由白名单 | `frontend/src/features/training/types.ts:218`、`training-model.ts` |
| 指标、runtime、memory、manifest 类型 | `frontend/src/features/training/types.ts` |
| 固定 Worker 循环 | `backend/src/modelforge/entrypoints/worker.py`、`TrainingWorker.run_once()` |

训练 Attempt 已包含：

- immutable snapshot 与 SHA-256；
- state / stage / outcome / exit_code / error_code；
- Train/Eval Loss 与 learning_rate；
- `runtime_report` 和 GPU 显存；
- `token_preflight`；
- `execution_manifest`；
- provisioning 与 remote job；
- Best/Final Adapter 独立 API。

### 2.2 当前缺口

| 缺口 | 技术影响 |
|---|---|
| 没有诊断报告表 | 无法版本化、过期、审计或保留上一版 |
| 没有报告生成任务状态 | 无法可靠展示生成中/失败，也没有进程重启恢复 |
| 没有 LLM Provider 配置 | 当前尚未接入 `langchain-openai`，也没有模型超时、结构化输出和审计边界 |
| 没有报告 checkpointer | 当前没有 `PostgresSaver`，无法从 LangGraph 节点级 checkpoint 恢复 |
| 没有报告输出 schema/validator | 无法阻止数字幻觉、引用失效和越级结论 |
| 没有评估夹具 harness | 无法做可重复的 AI 报告质量门禁 |
| `inference_trials` 不是质量验收记录 | 不能把 `ready` 当作推理通过 |

最后一点是代码级硬约束：`inference_trials` 当前记录 Adapter 启动、实例绑定、请求状态和 serving 生命周期；它没有评估集、断言、通过率、质量结论或验收标准。技术实现必须把“Serving Trial ready”和“Inference Acceptance passed”分开。

---

## 3. 模块边界

### 3.1 后端目录建议

在现有训练域内增加子包，不新建微服务：

```text
backend/src/modelforge/modules/training/diagnosis/
├─ __init__.py
├─ schema.py          # Pydantic 契约与枚举
├─ evidence.py        # EvidenceCollector，只读聚合
├─ gates.py           # 纯函数规则，不调用 LLM
├─ context.py         # EvidencePack 的受控事实投影
├─ generator.py       # TemplateGenerator / LangChainOpenAIGenerator
├─ validator.py       # schema、claim、引用、禁止表达
├─ repository.py      # 报告与 source pack 持久化
├─ checkpoint.py      # PostgresSaver、thread/namespace、TTL
├─ graph.py           # LangGraph StateGraph 组装
├─ nodes.py           # 幂等节点与条件路由
├─ worker.py          # 独立 diagnosis_thread + 租约任务
├─ use_cases.py       # 请求、读取、重生成
└─ routes.py          # FastAPI 路由
```

不建议把全部逻辑放进现有 `execution.py`。`TrainingWorker` 正在承担训练、归档和资源回收，AI 报告生成不能干扰其状态推进。

### 3.2 依赖原则

```text
gates.py
  ← schema.py
  ← evidence.py

graph.py
  ← 只声明节点、边和条件路由
  ← 不访问数据库
  ← 不拼 Prompt
  ← 不做业务状态判定

generator.py
  ← 只接收 EvidencePack + GateResult
  ← 不访问数据库
  ← 不访问训练实例
  ← 不调用任意工具

validator.py
  ← 只接收候选报告 + EvidencePack + GateResult

repository.py
  ← 负责 job、租约、fencing、不可变报告与审计事务
  ← 不接受模型直接写库
```

GateEngine 是可单测的纯函数，不能包含网络调用。生成器不能直接查训练库，避免模型自行扩大读取范围。

---

## 4. 数据库实现

### 4.1 Migration

下一个版本建议为 `0018_training_diagnosis.py`。

任务、冻结证据和不可变报告分表。不要用一个持续更新的 job 行同时冒充不可变报告。

```sql
CREATE TABLE training_diagnosis_jobs (
    id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    request_key text NOT NULL,
    input_digest text NOT NULL CHECK(length(input_digest)=64),
    state text NOT NULL CHECK(state IN ('queued','running','ready','failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    repair_count integer NOT NULL DEFAULT 0 CHECK(repair_count BETWEEN 0 AND 1),
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
    ON training_diagnosis_jobs(state,next_attempt_at,created_at);

CREATE TABLE training_diagnosis_evidence (
    job_id uuid PRIMARY KEY REFERENCES training_diagnosis_jobs(id),
    evidence_pack jsonb NOT NULL CHECK(jsonb_typeof(evidence_pack)='object'),
    evidence_digest text NOT NULL CHECK(length(evidence_digest)=64),
    redaction_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE training_diagnosis_reports (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES training_diagnosis_jobs(id),
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    version integer NOT NULL CHECK(version > 0),
    report_mode text NOT NULL CHECK(report_mode IN ('full','limited')),
    health_status text NOT NULL,
    delivery_status text NOT NULL,
    source_digest text NOT NULL CHECK(length(source_digest)=64),
    schema_version text NOT NULL,
    policy_version text NOT NULL,
    graph_version text NOT NULL,
    prompt_version text,
    generator_version text,
    report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),
    report_sha256 text NOT NULL CHECK(length(report_sha256)=64),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(attempt_id, version)
);
```

规则：

1. Job 负责排队、租约、重试和失败，不承载报告正文。
2. `ready` 报告不可更新。新生成创建新 job 和 version；一个 job 最多发布一份报告。
3. `source_digest` 与 Attempt、Adapter、manifest、推理事实的摘要绑定。
4. 不复制完整训练日志，只保存脱敏、截断、引用化后的 evidence pack。
5. `latest` 由 report 的最大 ready version 决定，不维护可漂移的 current pointer。
6. `running` 必须持有 `lease_owner`、`lease_expires_at` 和递增 `fencing_token`；租约过期后只允许另一个 Worker 原子回收。
7. 每次领取递增 `attempt_count` 并写 `next_attempt_at`；超过三次转 `failed`，避免毒任务无限循环。
8. `publish` 必须在同一事务中校验租约和 fencing、插入不可变报告并更新 job 状态。

### 4.2 推理验收的独立建模

本报告功能不应改写 serving 的 Trial 表。后续需要时新增：

```text
inference_acceptance_runs
├─ id
├─ adapter_id
├─ dataset_version_id
├─ suite_version
├─ case_count
├─ passed_count
├─ result：passed / failed / inconclusive
├─ evidence_manifest
├─ created_at
└─ created_by
```

在它出现之前：

```text
无 acceptance run
→ delivery = artifact_deliverable_model_unverified
```

不能写“推理验收通过”。现有 `inference_trials.state='ready'` 只能作为“服务进程可用”的技术事实。

---

## 5. 后端代码实现

### 5.1 核心 schema

```python
class GateResult(BaseModel):
    health_status: Literal[
        "healthy", "attention", "blocked", "partial", "unknown"
    ]
    delivery_status: Literal[
        "not_deliverable",
        "artifact_deliverable_model_unverified",
        "ready_for_release_review",
        "unknown",
    ]
    coverage: list[EvidenceCoverage]
    conflicts: list[EvidenceConflict]
    evidence_ids: list[str]

class CandidateReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str
    claims: list[Claim]
    findings: list[Finding]
    limitations: list[Limitation]
    next_experiments: list[Experiment]
```

`health_status` 和 `delivery_status` 只从 `GateResult` 复制，不允许候选报告自行提交：

```python
final_report = CandidateReport.model_validate(raw)
final_report.health_status = gate.health_status
final_report.delivery_status = gate.delivery_status
```

### 5.2 EvidenceCollector

```python
class EvidenceCollector:
    def collect(self, attempt_id: uuid.UUID) -> EvidencePack:
        attempt = Training(self.resources).get(attempt_id)
        adapters = Adapters(self.resources).list(attempt_id=attempt_id)
        # Phase 1: only read serving lifecycle as a fact,
        # never as inference acceptance.
        serving_trials = self._serving_trials_for_adapters(adapters)
        logs_summary = self._redacted_log_excerpts(attempt_id)
        ...
```

实现约束：

- `Training.get()` 已经校验 immutable snapshot hash，报告采集直接复用。
- Adapter 读取失败必须是 `unknown`，不能变成空数组 `0/2`。
- 日志只读必要摘要，限制条数、行数和字符数。
- 所有证据带 `source_locator + digest + observed_at`。
- EvidencePack 规范化后计算 SHA-256；使用与现有 `canonical()` 一致的 JSON 排序策略。

### 5.3 GateEngine

GateEngine 是纯 Python，无网络、无数据库：

```python
def evaluate(pack: EvidencePack) -> GateResult:
    ...
```

建议规则：

| 事实 | Health | Delivery |
|---|---|---|
| failed 且没有 metrics/runtime | unknown | not_deliverable |
| cancelled | unknown | not_deliverable |
| runtime mismatch / snapshot 冲突 | blocked | unknown |
| 有 Train 指标、Eval 点不足 | partial | 由 Adapter 状态决定 |
| Best/Final 都 available 且存储校验完成 | 不变 | artifact_deliverable_model_unverified |
| Adapter 缺失或读取失败 | 不变 | 不展示成 0/2；读取失败为 unknown |
| 当前 Adapter 有真实验收通过记录 | 不变 | ready_for_release_review |
| 只有 serving Trial ready | 不变 | 仍为 artifact_deliverable_model_unverified |

当前 Case 的固定结果：

```text
health = partial
delivery = artifact_deliverable_model_unverified
```

### 5.4 LangGraph 编排与 ReportGenerator

固定图和最小 State：

```python
from typing import Any, Literal, TypedDict
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph


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


def build_diagnosis_graph(services, checkpointer: PostgresSaver):
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
    graph.add_conditional_edges("validate", services.nodes.route_after_validate, {
        "valid": "publish",
        "repair": "repair",
        "fail": "fail",
    })
    graph.add_edge("repair", "validate")
    graph.add_edge("publish", END)
    graph.add_edge("fail", END)
    return graph.compile(checkpointer=checkpointer)
```

约束：

- State 只存引用、枚举、计数和候选输出，不存 API Key、完整日志或完整 EvidencePack；
- 证据正文由 `job_id` 从冻结 evidence 表读取；
- `gate` 永远在 `generate` 之前，不能用模型输出回写；
- `recursion_limit=8`，最多一次 repair，不注册任意工具节点；
- `graph.compile(checkpointer=...)` 使用 `PostgresSaver`；
- 每个 job 使用 `thread_id=diagnosis:{job_id}`、`checkpoint_ns=graph_version`；
- checkpointer 使用独立 schema/角色和 TTL，不能替代 job/evidence/report 表；
- State 只放 JSON-compatible 值，不允许任意 Python 对象或 pickle 写入 checkpoint；
- 图只做编排，节点调用现有 service，不把业务真相搬进 LangGraph。

生成节点依赖以下窄接口：

```python
class ReportGenerator(Protocol):
    version: str
    def generate(
        self,
        pack: EvidencePack,
        gate: GateResult,
    ) -> dict[str, object]: ...
```

两个实现：

```text
TemplateGenerator
  - P0 即可上线内部可见的规则报告
  - 不依赖外部模型
  - 用于固化 schema、UI 和评估 harness

LangChainOpenAIGenerator
  - 使用 langchain-openai 的 ChatOpenAI
  - with_structured_output(CandidateReportModel, method="json_schema")
  - max_retries=0，由 job 层控制重试
  - 不使用工具调用、handoff 或自主 Agent
  - feature flag 默认关闭
  - 只接收已脱敏、已裁剪的 EvidencePack + GateResult
```

配置建议：

```text
MF_AI_DIAGNOSIS_ENABLED=false
MF_AI_DIAGNOSIS_MODE=template|shadow|llm
MF_AI_BASE_URL=
MF_AI_API_KEY=       # SecretStr
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

若未配置 provider：

- 仍能打开报告页；
- 返回明确的 `report_generation_unavailable`；
- 可查看规则生成的证据摘要；
- 不伪造 AI 内容。

### 5.5 Validator

Validator 是发布门禁，不是提示词的一部分：

```python
def validate(candidate, pack, gate) -> ValidatedReport:
    assert_schema(candidate)
    assert_gate_fidelity(candidate, gate)
    assert_evidence_ids_exist(candidate, pack)
    assert_numbers_are_grounded(candidate, pack)
    assert_unknowns_are_preserved(candidate, pack)
    assert_forbidden_claims_absent(candidate)
    assert_no_secret_leak(candidate, pack)
    return ValidatedReport(...)
```

任何断言失败：

```text
不发布新报告
保留上一份 ready 版本
当前任务标记 failed + error_code
UI 显示“生成失败，仍可查看上一版”
```

### 5.6 异步 Worker

不把生成放到前端，也不把生成任务混入训练执行循环。

建议在现有 `entrypoints/worker.py` 中增加一个轻量 `DiagnosisWorker`，但必须使用独立的
`diagnosis_loop`/线程：

```python
class DiagnosisWorker:
    def run_once(self):
        job = self.repository.claim_next_queued(worker_id=self.worker_id)
        if not job:
            return False
        checkpoint_config = {
            "configurable": {
                "thread_id": f"diagnosis:{job.id}",
                "checkpoint_ns": self.graph_version,
            },
            "recursion_limit": 8,
        }
        try:
            snapshot = self.graph.get_state(checkpoint_config)
            initial_state = {
                "job_id": str(job.id),
                "attempt_id": str(job.attempt_id),
                "input_digest": job.input_digest,
                "repair_count": 0,
            }
            self.graph.invoke(
                None if snapshot.values else initial_state,
                config=checkpoint_config,
            )
        except Exception as error:
            self.repository.fail(job.id, self.classify(error))
        return True
```

Worker 只负责领取和调用图。EvidenceCollector、Gate、Generator、Validator 和事务型 publish
均由节点/应用服务完成；任何节点不得绕过 repository 直接写库。

`PostgresSaver` 只在独立 diagnosis 线程中创建和使用；不要跨线程共享可变连接。若使用
checkpoint，必须先确认内部表已初始化；checkpointer 不可用时任务应失败闭锁，不应静默降级。

当前 `entrypoints/worker.py` 的 `execution_loop` 会串行调用训练和 serving；不能把可能等待
LLM 数十秒、整图最长 90 秒的 `diagnosis.run_once()` 加进这个循环，否则会延迟训练状态推进、证据归档和资源回收。
应在同一个 Worker 服务内启动独立 `diagnosis_thread`，与 import/execution 线程分别启动、分别
停止，并继续使用 PostgreSQL 任务租约实现跨线程/跨进程互斥。

任务领取：

```sql
SELECT id
FROM training_diagnosis_jobs
WHERE state='queued' AND next_attempt_at<=now()
ORDER BY created_at,id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

领取后递增 `fencing_token`、写 `lease_owner/lease_expires_at` 和 `attempt_count`。publish
必须在同一事务中复核 lease 和 fencing；租约失效的旧 Worker 即使已经拿到模型输出，也不能发布。

优点：

- API 不阻塞模型调用；
- 进程重启后 queued 任务可继续；
- 生成失败不会影响训练状态；
- 崩溃后从最近 checkpoint 恢复；如果没有可用 checkpoint 才从 collect 开始；
- publish 仍通过 lease/fencing 和报告唯一约束保证幂等；
- 不需要 Celery、Redis 或新服务。

### 5.7 API

建议挂在现有训练域：

```text
POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports/latest
GET  /api/v1/training/attempts/{attempt_id}/diagnosis-reports
GET  /api/v1/training/diagnosis-reports/{report_id}
```

语义：

- `POST`：只允许终态 Attempt；返回 `202 + report_id + queued`。
- `GET latest`：没有报告返回明确 absent 结构或 404，前端按 contract 处理。
- 重复点击生成：使用 `Idempotency-Key`，同一 input digest 返回现有当前版本。
- 重新生成：再次 POST，创建新 version，不覆盖旧版。
- 所有 GET/POST 不触发训练提交、GPU、Adapter 或 inference trial 写操作。

不单独设计“apply suggestion”后端接口。Phase 1 的“应用建议”由前端把白名单 patch 带入现有 `CreateTrainingWizard`，用户仍需完成原创建流程。

---

## 6. 前端代码实现

### 6.1 类型与路由

修改：

```ts
// types.ts
export type TrainingTab =
  | 'overview'
  | 'analysis'
  | 'diagnosis'
  | 'logs'
  | 'artifacts'
  | 'config';
```

同步更新：

- `training-model.ts` 的 `allowedTabs`
- `training-model.test.mjs`
- `AttemptDetail.tsx` 的页签数组
- `AttemptDetail` 的 content 分支

### 6.2 组件拆分

```text
frontend/src/features/training/
├─ diagnosis/
│  ├─ api.ts
│  ├─ diagnosis-model.ts
│  ├─ use-diagnosis.ts
│  ├─ AiReportEntryCard.tsx
│  ├─ AiDiagnosisTab.tsx
│  ├─ VerdictPair.tsx
│  ├─ FindingLedger.tsx
│  ├─ EvidenceInspector.tsx
│  ├─ NextExperiments.tsx
│  └─ ReportStates.tsx
├─ components/AttemptDetail.tsx     # 增加页签
├─ components/RunOverview.tsx       # 增加入口卡
└─ training.css                     # 复用现有 token 与样式语言
```

### 6.3 单一数据源

概览卡和诊断页签必须读取同一个报告资源，避免两处结论漂移：

```ts
const diagnosis = useDiagnosis(attempt);

<RunOverview diagnosis={diagnosis.summary} ... />
<AiDiagnosisTab diagnosis={diagnosis.full} ... />
```

前端状态：

```ts
type DiagnosisResource =
  | {status: 'absent'}
  | {status: 'queued' | 'generating'; jobId: string; reportId?: string; previous?: Report}
  | {status: 'ready'; report: Report; stale: boolean; conflicts: Conflict[]}
  | {status: 'failed'; jobId: string; error: string; previous?: Report};
```

UI 状态另行管理：

```ts
type DiagnosisUiState = {
  severity: 'all' | 'blocked' | 'attention' | 'passed' | 'info' | 'unknown';
  selectedEvidenceId: string | null;
  expandedFindingIds: string[];
};
```

### 6.4 关键交互

- 生成中：POST 后轮询 latest；不要伪造百分比。
- 筛选：稳定 keyed DOM + `aria-pressed`，不通过 `outerHTML` 重建。
- 证据：引用不存在时显示错误，不能回退第一条。
- 过期：顶部 stale 警示，旧报告只读，显式重新生成。
- 应用建议：打开配置差异确认框，确认后跳到创建向导；不直接提交。
- 切换 Attempt：取消当前轮询，状态按 Attempt 隔离。

### 6.5 应用建议不带服务端草稿

Phase 1 不新增 `training_drafts` 表：

```text
报告 experiment.config_patch
→ 前端校验白名单字段
→ 打开现有 CreateTrainingWizard
→ 预填当前 Attempt 快照 + patch
→ 用户重新确认兼容性、费用和提交
```

草稿只存在于当前前端会话。刷新后丢失，可接受；这比新增持久化草稿领域更简单、更安全。

---

## 7. Gate 与 LLM 的职责隔离

必须写进代码边界：

```text
GateEngine:
  决定 health / delivery / inference acceptance / coverage / conflict

LLM:
  解释事实
  组织 finding
  生成建议
  写限制表达

Validator:
  检查 LLM 没有改变 Gate
  检查数字和证据
  检查禁止表达
```

在类型层直接让 `CandidateReport` 不包含可写状态：

```python
class CandidateReport(BaseModel):
    summary: str
    findings: list[Finding]
    limitations: list[Limitation]
    next_experiments: list[Experiment]

class ValidatedReport(BaseModel):
    health_status: HealthStatus      # 来自 Gate
    delivery_status: DeliveryStatus  # 来自 Gate
    candidate: CandidateReport
    source_digest: str
```

这样即使模型输出 `health_status="healthy"`，也不会被持久化。

---

## 8. AI 报告评估如何进入代码

### 8.1 评估夹具目录

```text
backend/tests/ai_report_fixtures/
├─ g01_success_single_eval/
│  ├─ evidence_pack.json
│  ├─ expected_gate.json
│  ├─ required_claims.yaml
│  ├─ forbidden_claims.yaml
│  └─ expected_coverage.json
├─ g04_failed_bootstrap/
├─ g05_cancelled/
├─ g07_stale/
└─ g14_prompt_injection/
```

### 8.2 测试层级

**纯规则测试**

```text
evidence_pack → gates
```

验证 Gate 不依赖 LLM、可重复。

**Validator 测试**

- 不存在的 evidence ID；
- 数字与源不一致；
- `unknown` 被写成 `passed`；
- 单 Eval 点出现趋势；
- Adapter available 被写成 model usable；
- 失败错误码被写成根因；
- 报告带 prompt injection 输出；
- 过期报告继续作为 latest。

**Generator 回归**

- TemplateGenerator 无外部依赖；
- `LangChainOpenAIGenerator` 使用 fake `ChatOpenAI` 测试结构化输出；
- 测试 `json_schema`、`function_calling`、`json_mode` 的受控 fallback；
- 测试 timeout、429、半 JSON、非法 Schema 和供应商不支持 structured output；
- 所有失败必须保持上一版。

**LangGraph 契约与恢复测试**

- 图中只存在声明的节点和边；
- `gate` 永远先于 `generate`，无工具节点和自由循环；
- 模型输出不能修改 Gate；
- 第一次校验失败只允许一次 repair，第二次失败必须 fail closed；
- `recursion_limit` 和节点超时受控；
- State/异常/日志不含秘密或完整证据包；
- 两个 Worker 并发领取不会重复处理；
- 租约过期后 fencing 阻断旧 Worker 发布；
- Worker 崩溃后可从最近 checkpoint 恢复；
- 一次重复投递最多产生一个 ready 报告。
- `PostgresSaver` 独立 schema、`setup()` 幂等、thread_id/checkpoint_ns 隔离；
- checkpoint 恢复后仍然受 lease/fencing 约束；
- checkpoint TTL/清理任务可验证；
- checkpoint 不可用时 fail closed。

**Repository 测试**

- `FOR UPDATE SKIP LOCKED` 并发领取；
- lease owner、lease expiry、fencing token 校验；
- 同一 `job_id` 发布会话幂等；
- 版本唯一约束；
- publish 事务失败不留下半份报告；
- 重新生成创建新 job/version，不改写历史。

**API 测试**

- 非终态 Attempt 返回 409；
- 重复生成使用幂等键；
- 报告读取不触发训练写操作；
- 权限与 not found；
- generation failure 不覆盖 ready 版本。

**前端测试**

- `trainingRouteQuery({tab:'diagnosis'})` 往返；
- absent / generating / ready / stale / conflict 状态映射；
- 证据引用缺失不 fallback；
- 应用建议不会直接调用 `createTrainingAttempt`；
- 390/1440 无溢出、控制台无错误。

### 8.3 AI 质量门禁

代码只依赖结构化结果，不把“模型看起来写得像专家”当成通过：

```text
schema_valid = 100%
gate_fidelity = 100%
numeric_faithfulness = 100%
critical_unsupported_claim = 0
forbidden_claims = 0
stale_detection = 100%
conflict_detection = 100%
citation_precision >= 98%
abstention_recall >= 95%，关键缺失项 100%
```

LLM-as-Judge 只能辅助语义评审，不能作为数值、状态或引用门的判定器。

---

## 9. 实施顺序

### P0：规则事实层

交付：

- `diagnosis/schema.py`
- `diagnosis/evidence.py`
- `diagnosis/gates.py`
- `diagnosis/repository.py`
- migration `0018`
- TemplateGenerator
- 14–16 个核心夹具
- `langgraph==1.2.20`、`langchain-openai==1.7.4`、
  `langgraph-checkpoint-postgres==3.2.0` 与 Python 3.13 锁文件 smoke test

退出条件：

- 对成功、失败、取消、过期、冲突五类证据能稳定产出 GateResult；
- 双门禁与现有事实完全一致；
- 不依赖任何模型服务；
- 安装可复现，无未锁定依赖；
- 现有训练 API 测试全绿。

### P1：LangGraph 受控图

交付：

- `diagnosis/graph.py`
- `diagnosis/nodes.py`
- `DiagnosisWorker` 独立 `diagnosis_thread`
- `PostgresSaver` 与 `graph.compile(checkpointer=...)`
- checkpoint 独立 schema、thread/namespace、TTL 和 retention
- job 领取、租约、fencing 和幂等发布
- 图拓扑、崩溃恢复、并发领取测试

退出条件：

- `gate` 永远先于 `generate`；
- FakeGenerator 下整图可重放；
- 第二次校验失败安全 fail closed；
- 租约失效的旧 Worker 无法 publish；
- 重复领取不会生成两份 ready 报告。

### P2：真实模型与 A v2 前端

交付：

- `ReportGenerator` 接口
- `LangChainOpenAIGenerator`（`ChatOpenAI`）
- validator 正式接入
- feature flag 与安全超时
- `langchain-openai` 结构化输出和 fallback 门禁
- `TrainingTab` 增加 `diagnosis`
- 总览 AI 结论卡与独立诊断页
- finding/evidence/experiment/limit 组件
- empty/loading/failure/stale/conflict 状态
- 应用建议预填创建向导

退出条件：

- 1440/390 可用且控制台无错误；
- 预览数据全部来自后端契约或受控 fixture；
- 概览卡与报告页签同源；
- 不影响运行分析、日志和产物页；
- 生成失败不影响训练详情；
- 上一版报告不被覆盖；
- 14–16 个阻断夹具通过；
- 数字、状态、引用、stale、injection 门禁全部通过。

### P3：内部试点

交付：

- 24 个黄金 Case；
- 50 个证据包 / 150 份报告；
- 专家盲评；
- 用户决策测试；
- Shadow 对比；
- 审计后台和管理指标。

### P4：推理验收联动

在现有 Serving Trial 之外新增独立验收运行模型，再将 delivery 升级为：

```text
ready_for_release_review
```

在此之前，不允许用 `inference_trials.state=ready` 代替验收。

---

## 10. 关键风险与最终取舍

| 风险 | 最终处理 |
|---|---|
| LLM 改写门禁 | Gate 结果不进入候选报告可写字段 |
| 数字幻觉 | 数字来自 facts，validator 逐项核对 |
| 证据文本注入 | 证据只作为数据，system policy 不进模型上下文竞争 |
| 日志泄密 | 证据裁剪、脱敏、长度上限，不把完整日志注入 |
| 报告过期 | source_digest + version + stale |
| 生成任务丢失 | DB queued 状态 + 独立 DiagnosisWorker + 租约 + 重试上限 |
| Worker 崩溃后重复执行 | PostgresSaver 恢复 + 幂等 publish；fencing token 阻止旧 Worker 发布 |
| LangGraph 逐渐扩成自主 Agent | 固定节点/边、无工具节点、无自由循环；图拓扑变更需评审 |
| State 或 checkpoint 泄密 | State 最小化；独立 schema/角色；TTL；敏感信息不入 State |
| checkpoint 表无限增长 | TTL + retention job + 存储告警 |
| `json_schema` 供应商不兼容 | 受控 fallback 到 function_calling/json_mode，仍需 Pydantic 校验 |
| 升级破坏 Python 3.13 | 精确 pin 三个新增依赖，锁文件和容器 smoke test |
| 依赖新基础设施 | 不引入 Celery/Redis/向量库，复用现有 Worker 与 PostgreSQL |
| 前端重复请求 | 概览和页签共用 `useDiagnosis` |
| 应用建议误提交 | 只预填创建向导，不新增提交快捷通道 |
| Trial 被错误解释 | Serving ready 与 Inference Acceptance 分开建模 |

---

## 11. 结论摘要

### 推荐技术路线

```text
独立 diagnosis 子模块
+ 确定性 GateEngine
+ LangGraph 固定 StateGraph
+ PostgresSaver 短期 checkpoint（独立 schema/TTL）
+ Template / LangChainOpenAI 双 Generator
+ 严格 Validator
+ PostgreSQL job/evidence/immutable report + 租约/fencing
+ 独立 DiagnosisWorker 线程
+ A v2 独立前端页签
```

### 必须先做

1. EvidencePack / Report schema。
2. GateEngine 和 14–16 个夹具。
3. job/evidence/report 表与租约、fencing。
4. LangGraph 固定拓扑、PostgresSaver 与 FakeGenerator。
5. TemplateGenerator、LangChainOpenAIGenerator 和 UI 骨架。

### 可以后做

1. 更多非 OpenAI-compatible provider 适配。
2. 更丰富的建议语言。
3. 报告版本差异 UI。
4. Shadow / Canary。
5. 多轮追问使用独立 conversation thread，不替代业务报告表。
6. 独立推理验收运行模型。

### 不能提前做

1. 让 LLM 决定 health/delivery。
2. 把 Adapter available 当模型可用。
3. 把 inference serving trial 当推理验收。
4. 在前端直接调用模型。
5. 用平均分掩盖严重安全错误。
6. 用缺失指标补 0 或编造趋势。
7. 让 LangGraph 自主选择工具或修改 Gate。
8. 把 checkpoint 当业务真相。
9. 把 API Key、完整日志或原始样本写入 State/checkpoint。

这个技术方案的实质不是“接一个大模型”，也不是“造一个通用 Agent”，而是先建立一套可信的事实与证据层，再用 LangGraph + `langchain-openai` 编排受控的解释流程，并用 `PostgresSaver` 只做短期恢复。只有这条路线能同时满足工程可维护性、产品可信度和后续 AI 评估要求。
