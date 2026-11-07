# ModelForge AI 训练诊断
## 数据契约与数据库规范

状态：纵向切片已落地；迁移 0018、真实成功/失败报告发布和不可变约束已验证  
日期：2026-11-07（初版：2026-11-06）  
适用范围：Phase 1 单 Attempt AI 诊断

> 实施说明：本地已创建 `training_diagnosis_jobs`、`training_diagnosis_evidence`、
> `training_diagnosis_reports` 和独立 `langgraph_checkpoint` schema。本文保留目标契约；
> 真实模型单例契约和本地成功/失败报告发布已通过；表中结果仍不是黄金集、独立推理
> 验收或生产环境验收。完整记录见
> [REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

## 1. 核心原则

1. Attempt 是不可变训练事实，不因生成报告而改变。
2. EvidencePack 是冻结输入，不是实时视图。
3. GateResult 由确定性代码产生，模型不能覆写。
4. CandidateReport 只存在于工作流 State，Validator 通过后才发布。
5. AdvisoryReport 发布后不可原地修改。
6. 缺失、读取失败、未到达和未上报必须分开表达，不能归一化为 `0`。
7. checkpoint 只保存编排状态，不是 job、evidence 或 report 的业务真相。
8. 所有报告数字必须能追溯到 EvidenceRef。
9. 推理 Trial 的运行事实与独立推理验收是两个概念。
10. 建议配置只生成草稿，不写回训练 Attempt。

## 2. 枚举

### 2.1 训练健康度

```text
health_status:
  healthy
  attention
  blocked
  partial
  unknown
```

含义：

- `healthy`：证据覆盖足够，训练内信号无明显异常；
- `attention`：存在可解释的训练内风险；
- `blocked`：状态、快照或运行时完整性冲突；
- `partial`：有部分可读证据，但不能形成完整健康结论；
- `unknown`：没有足够证据判断。

### 2.2 可交付性

```text
delivery_status:
  not_deliverable
  artifact_deliverable_model_unverified
  ready_for_release_review
  unknown
```

固定语义：

- `artifact_deliverable_model_unverified`：Best/Final Adapter 产物齐全且完成存储校验，但没有当前 Adapter 的独立推理验收；
- `ready_for_release_review`：有当前 Adapter 的独立验收记录，可进入发布评审，不等于生产可用；
- `not_deliverable`：产物缺失、不可用或存在阻断；
- `unknown`：无法读取产物或验收状态。

### 2.3 证据覆盖

```text
evidence_coverage:
  available
  missing
  not_reached
  not_applicable
  conflict
  unavailable
```

语义：

- `missing`：应该存在但接口返回为空；
- `not_reached`：训练未到达该阶段；
- `not_applicable`：当前执行模式不适用；
- `conflict`：多个来源不一致；
- `unavailable`：读取失败或依赖不可用。

### 2.4 报告层级

```text
report_layer:
  observation
  inference
  recommendation
  limitation
```

UI 上必须区分“观测”“推断”“建议”“限制”。

## 3. EvidencePack v1

### 3.1 顶层结构

```python
class EvidencePack(BaseModel):
    schema_version: Literal["evidence-pack-v1"]
    attempt_id: UUID
    evidence_cutoff_at: datetime
    attempt_state: Literal["succeeded", "failed", "cancelled"]
    source_revision: SourceRevision
    coverage: list[EvidenceCoverage]
    evidence: list[EvidenceRef]
    facts: EvidenceFacts
    conflicts: list[EvidenceConflict]
    redaction_version: str
    canonical_digest: str
```

### 3.2 EvidenceRef

```python
class EvidenceRef(BaseModel):
    id: str                    # E-01, E-02...
    kind: Literal[
        "attempt", "metrics", "token_preflight", "runtime", "memory",
        "manifest", "provisioning", "logs", "adapter", "inference_trial",
        "inference_acceptance"
    ]
    source_locator: str
    field_path: str | None
    observed_at: datetime | None
    source_version: str | None
    source_digest: str | None
    excerpt: str | None
    coverage: EvidenceCoverage
    unavailable_reason: str | None
```

约束：

- `id` 在单个 EvidencePack 内唯一；
- `source_locator` 不允许是签名 URL 或云端凭据；
- `excerpt` 限长并脱敏；
- 读取失败必须 `coverage=unavailable`，不能返回空数组并解释为“0”；
- 每个 claim 的 evidence ID 必须在此集合内解析。

### 3.3 SourceRevision

```python
class SourceRevision(BaseModel):
    attempt_updated_at: datetime
    snapshot_sha256: str
    metrics_digest: str | None
    runtime_digest: str | None
    manifest_digest: str | None
    adapter_revision: str | None
    inference_revision: str | None
```

任何 revision 改变都可能使已发布报告变为 stale。stale 不是删除报告，而是当前展示必须标记“依据已过期”。

### 3.4 EvidenceFacts

`facts` 只放允许进入报告的字段投影，不直接放完整原始对象：

```text
attempt:
  id
  task_id
  number
  state
  outcome
  created_at
  finished_at
  error_code
  exit_code

inputs:
  base_model_identity
  dataset_version_id
  config_projection
  training_runtime_lock_id
  training_runtime_lock_sha256

metrics:
  train_points[]
  eval_points[]
  learning_rate_points[]
  first_train
  last_train
  best_eval
  latest_train
  counts

token_preflight:
  status
  overflow_count
  sampled_count
  reason

runtime:
  phase
  ready
  lock_id
  lock_sha256
  gpu
  python
  cuda
  mismatches[]
  training_memory

manifest:
  diagnostic_gap
  files[]

provisioning:
  provider_state
  runtime_state
  artifact_state
  last_error_code

logs:
  chunks_received
  gap
  diagnostic_excerpts[]

adapters:
  best
  final
  readback_state
  fingerprints

inference:
  linked_trials[]
  acceptance_records[]
```

不放入 `facts`：

- API Key；
- DSN；
- 完整原始日志；
- 数据样本正文；
- 签名 URL；
- 未脱敏的环境变量；
- 任意不可 JSON 序列化对象。

### 3.5 EvidenceCoverage

```python
class EvidenceCoverage(BaseModel):
    category: str
    status: Literal[
        "available", "missing", "not_reached",
        "not_applicable", "conflict", "unavailable"
    ]
    reason: str | None
    evidence_ids: list[str]
```

必须覆盖至少：

- attempt；
- metrics；
- token_preflight；
- runtime；
- memory；
- manifest；
- provisioning；
- logs；
- adapter；
- inference trial；
- inference acceptance。

### 3.6 EvidenceConflict

```python
class EvidenceConflict(BaseModel):
    code: str
    left_ref: str
    right_ref: str
    description: str
    blocking: bool
```

示例：

- Attempt `succeeded` 但 runtime report mismatch；
- Best/Final 文件指纹与 manifest 不一致；
- 同一 Adapter 出现不同 fingerprint；
- 当前 Adapter ID 与 Trial 关联 ID 不一致。

冲突不得静默选择一侧。

## 4. GateResult

```python
class GateResult(BaseModel):
    policy_version: str
    health_status: Literal[
        "healthy", "attention", "blocked", "partial", "unknown"
    ]
    delivery_status: Literal[
        "not_deliverable",
        "artifact_deliverable_model_unverified",
        "ready_for_release_review",
        "unknown"
    ]
    health_reasons: list[GateReason]
    delivery_reasons: list[GateReason]
    coverage: list[EvidenceCoverage]
    conflicts: list[EvidenceConflict]
    evidence_ids: list[str]
    gate_digest: str
```

Gate 规则优先级：

1. 结构性冲突和快照不一致；
2. 未到达/不可用证据；
3. 训练内信号；
4. 产物完整性；
5. 独立推理验收。

推荐固定结果：

```text
成功 Attempt + 22 Train / 1 Eval + 无完整泛化证据
→ health_status = partial

Best/Final 2/2 available + 无当前 Adapter 验收
→ delivery_status = artifact_deliverable_model_unverified

failed + 无 metrics/runtime/manifest/logs
→ health_status = unknown
→ delivery_status = not_deliverable

只有 inference_trial.state = ready
→ delivery_status 仍为 artifact_deliverable_model_unverified
```

## 5. CandidateReport

### 5.1 模型可生成的字段

模型可以生成：

- `summary`；
- `claims`；
- `findings`；
- `limitations`；
- `next_experiments`；
- 引用已有 evidence ID 的解释；
- 观测/推断/建议文本。

模型不可生成或修改：

- `health_status`；
- `delivery_status`；
- 推理验收状态；
- 训练状态；
- Adapter 是否可用；
- 证据之外的数字；
- 证据 ID；
- 审计版本号；
- report digest。

### 5.2 Claim

```python
class Claim(BaseModel):
    id: str
    layer: Literal["observation", "inference", "recommendation", "limitation"]
    text: str
    evidence_ids: list[str]
    basis_claim_ids: list[str]
    confidence: Literal["high", "medium", "low"]
    limitations: list[str]
```

规则：

- `observation` 必须有 evidence；
- `inference` 必须有 evidence 或 basis claim；
- `recommendation` 必须有前置条件；
- 没有证据的内容只能是 limitation；
- 不得以 confidence 代替证据。

### 5.3 Finding

```python
class Finding(BaseModel):
    id: str
    category: Literal[
        "loss_eval", "runtime", "token", "memory",
        "artifact", "failure", "coverage"
    ]
    severity: Literal["blocked", "attention", "passed", "info"]
    epistemic_status: Literal["observed", "inferred", "unknown"]
    title: str
    observation: Claim
    inference: Claim | None
    recommendation: Claim | None
    evidence_ids: list[str]
```

每个 finding 至少有一个可解析 EvidenceRef；`unknown` 不能渲染成 `passed`。

### 5.4 NextExperiment

```python
class NextExperiment(BaseModel):
    id: str
    priority: Literal["P0", "P1", "P2"]
    title: str
    hypothesis: str
    evidence_ids: list[str]
    preconditions: list[str]
    config_patch: dict[str, Any] | None
    draft_only: Literal[True]
```

`config_patch` 白名单：

- `num_train_epochs`；
- `learning_rate`；
- `cutoff_len`；
- `per_device_train_batch_size`；
- `gradient_accumulation_steps`；
- LoRA 相关现有配置项。

不允许：

- 修改历史 Attempt；
- 绕过兼容性检查；
- 提交 GPU 创建；
- 自动上传数据；
- 自动开始训练。

## 6. AdvisoryReport

### 6.1 发布结构

```python
class AdvisoryReport(BaseModel):
    schema_version: Literal["advisory-report-v1"]
    id: UUID
    job_id: UUID
    attempt_id: UUID
    version: int
    report_mode: Literal["full", "limited"]
    freshness: Literal["current", "stale"]
    integrity: Literal["consistent", "conflict"]
    health: GateAxis
    delivery: GateAxis
    summary: str
    claims: list[Claim]
    findings: list[Finding]
    limitations: list[Limitation]
    next_experiments: list[NextExperiment]
    source_revision: SourceRevision
    policy_version: str
    graph_version: str
    prompt_version: str
    generator_version: str
    model_name: str
    input_digest: str
    report_digest: str
    generated_at: datetime
    published_at: datetime
```

`health` 与 `delivery` 的 status/label/rationale：

- status 只从 GateResult 复制；
- rationale 可由报告生成，但必须通过 Validator；
- UI 不能重新解释 status。

### 6.2 不可变规则

- report ready 后不能原地修改；
- 重新生成产生新 job 和新 report version；
- 同一 job 最多一张 report；
- 同一 attempt 可保留多个历史版本；
- “latest”由 `attempt_id + version desc` 派生；
- report digest 必须可由规范化内容复算；
- 旧 report 不因新版本出现而被删除。

## 7. PostgreSQL 业务表

下面的 DDL 是规划草案，实施时按 Alembic 和现有风格调整；字段语义不可自行删减。

### 7.1 Job 表

```sql
CREATE TABLE training_diagnosis_jobs (
    id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    request_key text NOT NULL,
    policy_version text NOT NULL,
    graph_version text NOT NULL,
    state text NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'running', 'ready', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    repair_count integer NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 1),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE (attempt_id, request_key),
    CHECK (state <> 'running' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX idx_training_diagnosis_jobs_pick
    ON training_diagnosis_jobs (state, next_attempt_at, created_at);
```

`request_key` 建议包含：

```text
policy_version
graph_version
prompt_version
generator_version
attempt snapshot digest
```

### 7.2 Evidence 表

```sql
CREATE TABLE training_diagnosis_evidence (
    job_id uuid PRIMARY KEY REFERENCES training_diagnosis_jobs(id),
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    schema_version text NOT NULL,
    evidence_pack jsonb NOT NULL
        CHECK (jsonb_typeof(evidence_pack) = 'object'),
    evidence_digest text NOT NULL
        CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
    redaction_version text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now()
);
```

EvidencePack 是冻结输入。后续读取报告时，不重新查询可变训练接口来替换旧证据。

### 7.3 Report 表

```sql
CREATE TABLE training_diagnosis_reports (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL UNIQUE REFERENCES training_diagnosis_jobs(id),
    attempt_id uuid NOT NULL REFERENCES training_attempts(id),
    version integer NOT NULL CHECK (version > 0),
    schema_version text NOT NULL,
    report_mode text NOT NULL CHECK (report_mode IN ('full', 'limited')),
    health_status text NOT NULL
        CHECK (health_status IN ('healthy', 'attention', 'blocked', 'partial', 'unknown')),
    delivery_status text NOT NULL
        CHECK (delivery_status IN (
            'not_deliverable',
            'artifact_deliverable_model_unverified',
            'ready_for_release_review',
            'unknown'
        )),
    report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
    report_digest text NOT NULL CHECK (report_digest ~ '^[0-9a-f]{64}$'),
    evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
    policy_version text NOT NULL,
    graph_version text NOT NULL,
    prompt_version text NOT NULL,
    generator_version text NOT NULL,
    model_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, version)
);

CREATE INDEX idx_training_diagnosis_reports_attempt
    ON training_diagnosis_reports (attempt_id, version DESC);
```

报告不可变触发器：

```sql
CREATE OR REPLACE FUNCTION mf_diagnosis_report_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Published diagnosis reports are immutable';
END $$;

CREATE TRIGGER training_diagnosis_report_no_update
BEFORE UPDATE ON training_diagnosis_reports
FOR EACH ROW EXECUTE FUNCTION mf_diagnosis_report_immutable();
```

是否禁止 DELETE 由保留策略决定；默认不允许应用程序删除。

## 8. 领取任务与 fencing

推荐原子领取语义：

```text
BEGIN
  SELECT job FOR UPDATE SKIP LOCKED
  WHERE state='queued'
    AND next_attempt_at <= now()
  ORDER BY created_at
  LIMIT 1;

  UPDATE job
  SET state='running',
      lease_owner=<worker_id>,
      lease_expires_at=now()+lease_ttl,
      fencing_token=fencing_token+1,
      started_at=COALESCE(started_at, now())
  WHERE id=<job_id>
    AND state='queued';
COMMIT
```

发布事务：

```text
BEGIN
  校验 job.id / state='running'
  校验 lease_owner=当前 worker
  校验 lease_expires_at > now()
  校验 fencing_token=当前 token
  校验 report 不存在
  INSERT report
  UPDATE job SET state='ready', finished_at=now()
  COMMIT
```

旧 Worker 即使已经生成报告，只要 lease 或 fencing 不匹配，就必须放弃发布。

## 9. Checkpoint schema

### 9.1 不是业务表

以下内容不写入业务表：

- LangGraph 节点游标；
- checkpoint thread；
- checkpoint state；
- 恢复元数据；
- 临时候选报告状态。

这些由 `langgraph-checkpoint-postgres` 在独立 schema 管理。

### 9.2 配置

```text
MF_AI_CHECKPOINT_DSN=postgresql://<diagnosis_worker>:<secret>@postgres/modelforge
MF_AI_CHECKPOINT_SCHEMA=langgraph_checkpoint
MF_AI_CHECKPOINT_TTL_HOURS=24
```

要求：

- 独立最小权限角色；
- `setup()` 只在部署/迁移阶段执行；
- 若传入现有 psycopg 连接，`setup()` 前必须 `autocommit=True`；
- 每个 job：`thread_id=diagnosis:{job_id}`；
- `checkpoint_ns=graph_version`；
- 失败/取消任务 checkpoint TTL 缩短到 1 小时；
- 没有稳定 TTL API 时使用独立保留 job；
- checkpoint schema 行数、磁盘增长和清理失败必须监控。

### 9.3 State 最小化

```python
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

不允许：

- API Key / DSN；
- Authorization Header；
- 签名 URL；
- 完整日志；
- 数据集样本；
- 任意 Python 对象或 pickle。

## 10. 推理验收模型

当前 `inference_trials` 可以证明：

- 某个 Adapter 被用于启动 Trial；
- 服务曾进入 ready；
- Adapter probe 曾执行。

它不能自动证明：

- 当前 Adapter 达到验收标准；
- 生成质量达标；
- 模型可发布；
- 模型可用于生产。

Phase 1 读取 Trial 只作为事实。若需要 `ready_for_release_review`，必须有独立的 acceptance 记录，至少包含：

```text
acceptance_id
adapter_id
adapter_fingerprint
base_model_identity
runtime_lock_id
inference_trial_id
request_evidence_digest
result
accepted_at
accepted_by
```

`inference_trial_id` 必须指向同一 `adapter_id`，不能用其他 Adapter 的 Trial。

## 11. API 响应最小字段

### 11.1 Job status

```json
{
  "job_id": "uuid",
  "attempt_id": "uuid",
  "state": "queued|running|ready|failed",
  "error_code": null,
  "created_at": "2026-11-06T00:00:00Z",
  "started_at": null,
  "finished_at": null,
  "latest_report_id": null
}
```

### 11.2 Latest report

至少返回：

- report id/version；
- generation status；
- report mode；
- freshness/integrity；
- health/delivery；
- summary；
- findings/claims；
- evidence index；
- limitations；
- next experiments；
- source revision；
- versions/hash。

不返回：

- 模型内部 reasoning；
- 完整 prompt；
- 供应商原始响应；
- 任何密钥。

## 12. 保留策略

建议初始值，最终由用户确认：

| 数据 | 保留 |
|---|---|
| ready 报告 | 不随 checkpoint TTL 删除；至少保留与 Attempt 同周期 |
| failed job 和错误码 | 90 天 |
| evidence pack | 随 job/report 保留；可按隐私策略缩短 |
| checkpoint | 24 小时；失败/取消 1 小时 |
| 诊断访问审计 | 90 天 |

任何清理任务必须区分：

- checkpoint；
- job；
- evidence；
- published report；
- 源日志。

四者不能一起删除。

## 13. 数据验收

- 迁移 up/down 可在隔离 PostgreSQL 运行；
- 同一输入 digest 稳定；
- 报告不可变触发器生效；
- `UNIQUE(attempt_id, version)` 阻止覆盖；
- 同一 job 发布幂等；
- lease/fencing 竞争测试通过；
- checkpoint schema 与业务 schema 隔离；
- 缺失字段保持 `unknown/missing`；
- 推理 Trial ready 不会自动改变 delivery；
- 任何证据外数字被 Validator 拒绝。
