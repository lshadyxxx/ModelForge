# ModelForge AI 训练诊断
## 历史对比数据契约与数据库规范

日期：2026-11-08
状态：本地实现契约，已通过真实页面验证
契约版本：

- `evidence-pack-v2`
- `comparison-result-v1`
- `advisory-report-v2`
- Job/API 向后兼容现有单 Attempt 报告

## 1. 不变量

1. 历史对比永远基于不可变 Snapshot。
2. subject 和 baseline 必须属于同一个 Hard Key。
3. baseline selection 由后端解析和验证。
4. ComparisonResult 不由 LLM 产生或修改。
5. `model_effect=unverified` 时不能发布模型效果升级声明。
6. 报告版本发布后不可更新。
7. 重新生成必须创建新 job 和新 report version。
8. baseline 变化不能覆盖历史报告。
9. 任何缺失、不可读、未上报不得写成 0。
10. Evidence ID 必须全局唯一，baseline 使用 `E-BASE-*` 前缀。

## 2. 类型

### 2.1 枚举

```python
ComparisonMode = Literal["none", "auto", "explicit"]

ComparabilityStatus = Literal[
    "strict",
    "conditional",
    "not_comparable",
    "no_baseline",
]

TrainingSignal = Literal[
    "improved",
    "worsened",
    "mixed",
    "flat",
    "inconclusive",
]

DeliverySignal = Literal[
    "improved",
    "worsened",
    "same",
    "inconclusive",
]

ModelEffectStatus = Literal[
    "verified_better",
    "verified_worse",
    "verified_same",
    "inconclusive",
    "unverified",
]

ComparisonConfidence = Literal["high", "medium", "low", "none"]

AdapterRole = Literal["best", "final"]
```

### 2.2 ComparisonGroup

```python
class ComparisonGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_fingerprint: str
    dataset_sha256: str
    dataset_split_sha256: str
```

所有三个字段均来自 subject/baseline 冻结 Snapshot，不从当前数据库版本重新解析。

### 2.3 BaselineSelection

```python
class BaselineSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: ComparisonMode
    requested_attempt_id: UUID | None
    resolved_attempt_id: UUID | None
    selection_rule: Literal[
        "none",
        "latest_previous_success",
        "explicit",
        "not_available",
    ]
    reason_code: str | None
```

### 2.4 ComparisonCandidate

```python
class ComparisonCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: UUID
    task_id: UUID
    task_name: str
    attempt_number: int
    state: Literal["succeeded"]
    created_at: datetime
    snapshot_sha256: str

    base_fingerprint: str
    dataset_sha256: str
    dataset_split_sha256: str

    best_eval_loss: float | None
    final_eval_loss: float | None
    eval_point_count: int
    available_adapter_roles: list[AdapterRole]

    comparability_preview: ComparabilityStatus
    changed_parameter_count: int
    confounder_preview_codes: list[str]
```

候选接口只提供轻量摘要，不返回完整日志或 EvidencePack。候选阶段的
`comparability_preview` 只用于 UI 选择，最终报告必须由完整双 EvidencePack 和
ComparisonEngine 重新计算 `comparability_status`，不能信任前端或候选摘要。

### 2.5 ParameterChange

```python
class ParameterChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal[
        "epochs",
        "learning_rate",
        "cutoff_len",
        "batch_size",
        "gradient_accumulation",
        "lora_rank",
        "lora_alpha",
        "lora_dropout",
        "scheduler",
        "warmup_ratio",
        "template",
        "seed",
    ]
    baseline_value: Any
    subject_value: Any
    classification: Literal[
        "optimization",
        "budget",
        "input_processing",
        "stochasticity",
    ]
```

### 2.6 Confounder

```python
class Confounder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Literal[
        "runtime_lock_changed",
        "training_image_changed",
        "gpu_changed",
        "template_changed",
        "seed_changed",
        "cutoff_changed",
        "multiple_parameters_changed",
        "adapter_role_mismatch",
        "baseline_metrics_missing",
        "subject_metrics_missing",
        "eval_coverage_low",
        "baseline_source_unavailable",
        "subject_source_unavailable",
    ]
    field: str | None
    baseline_value: Any
    subject_value: Any
    text: str
    blocking: bool = False
```

### 2.7 MetricDelta

```python
class MetricDelta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal[
        "best_eval_loss",
        "final_eval_loss",
        "latest_eval_loss",
        "lowest_eval_loss",
        "final_train_loss",
        "token_overflow_count",
    ]
    subject_value: float | int | None
    baseline_value: float | int | None
    absolute_delta: float | int | None
    relative_delta: float | None
    better_direction: Literal["lower", "higher", "neutral"]
    evidence_ids: list[str]
```

不得为 `None` 生成 0 或伪造差值。

### 2.8 ModelEffect

```python
class ModelEffect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: ModelEffectStatus
    reason: Literal[
        "no_comparable_downstream_evaluation",
        "evaluation_missing_on_one_side",
        "evaluation_spec_mismatch",
        "score_comparison_available",
    ]
    subject_evaluation_id: UUID | None = None
    baseline_evaluation_id: UUID | None = None
    note: str
```

首版生成 `unverified`，且
`reason=no_comparable_downstream_evaluation`。

### 2.9 ComparisonResult

```python
class ComparisonResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["comparison-result-v1"] = "comparison-result-v1"
    policy_version: str
    group: ComparisonGroup
    selection: BaselineSelection

    comparability_status: ComparabilityStatus
    confidence: ComparisonConfidence
    training_signal: TrainingSignal
    delivery_signal: DeliverySignal
    model_effect: ModelEffect

    primary_adapter_role: AdapterRole | None
    metric_deltas: list[MetricDelta]
    parameter_changes: list[ParameterChange]
    confounders: list[Confounder]
    regressions: list[dict[str, Any]]
    reason_codes: list[str]
    evidence_ids: list[str]
    comparison_digest: str | None = None
```

`comparison_digest` 对除自身外的 canonical JSON 计算 SHA-256。

### 2.10 BaselineEvidenceProjection

```python
class BaselineEvidenceProjection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: UUID
    snapshot_sha256: str
    attempt_state: Literal["succeeded"]
    facts: dict[str, Any]
    coverage: list[EvidenceCoverage]
    evidence: list[EvidenceRef]
    gate: GateResult
    source_revision: SourceRevision
    canonical_digest: str
```

基线 EvidenceRef ID 必须使用：

```text
E-BASE-ATTEMPT
E-BASE-METRICS
E-BASE-TOKEN
E-BASE-RUNTIME
E-BASE-MEMORY
E-BASE-MANIFEST
E-BASE-ADAPTER-BEST
E-BASE-ADAPTER-FINAL
E-BASE-INFERENCE-ACCEPTANCE
```

### 2.11 EvidencePack v2

现有单 Attempt 字段保持不破坏，新增 `comparison`。实现时应抽取共享的 evidence 基类，
不要通过继承旧模型后覆盖 `Literal["evidence-pack-v1"]` 的方式强行升级；读取层使用显式
discriminated union。

```python
EvidenceKind = Literal[
    "attempt",
    "metrics",
    "token_preflight",
    "runtime",
    "memory",
    "manifest",
    "provisioning",
    "logs",
    "adapter",
    "inference_trial",
    "inference_acceptance",
    "comparison",
]


class ComparisonEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comparison_result: ComparisonResult
    baseline: BaselineEvidenceProjection | None


class EvidencePackV2(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["evidence-pack-v2"] = "evidence-pack-v2"
    attempt_id: UUID
    evidence_cutoff_at: datetime
    attempt_state: Literal["succeeded", "failed", "cancelled"]
    source_revision: SourceRevision
    coverage: list[EvidenceCoverage]
    evidence: list[EvidenceRef]
    facts: dict[str, Any]
    conflicts: list[EvidenceConflict]
    redaction_version: str
    canonical_digest: str | None
    comparison: ComparisonEvidence | None = None


EvidencePackDocument = Annotated[
    Union[EvidencePackV1, EvidencePackV2],
    Field(discriminator="schema_version"),
]
```

没有基线时：

```text
comparison.comparison_result.selection.mode = none
comparison.comparison_result.comparability_status = no_baseline
comparison.baseline = null
```

### 2.12 AdvisoryReport v2

旧 `AdvisoryReport` 保持 v1。新报告使用独立模型或共享基类，不能直接覆盖旧模型的
`schema_version` Literal：

```python
class AdvisoryReportV2(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["advisory-report-v2"] = "advisory-report-v2"
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
    report_digest: str | None
    generated_at: datetime
    published_at: datetime
    baseline_attempt_id: UUID | None
    comparison: ComparisonResult


AdvisoryReportDocument = Annotated[
    Union[AdvisoryReportV1, AdvisoryReportV2],
    Field(discriminator="schema_version"),
]
```

旧 v1 报告继续可读，但新 job 只发布 v2。

v2 的 `input_digest` 必须覆盖：

```text
subject EvidencePack canonical_digest
baseline EvidencePack canonical_digest
subject GateResult gate_digest
baseline GateResult gate_digest
ComparisonResult comparison_digest
```

基线和比较输入变化不能只改变 `report_digest` 而保留旧的 `input_digest`。

## 3. Evidence ID

Subject 沿用现有：

```text
E-ATTEMPT
E-METRICS
E-TOKEN
E-RUNTIME
E-MEMORY
E-MANIFEST
E-LOGS
E-ADAPTER-BEST
E-ADAPTER-FINAL
E-INFERENCE-ACCEPTANCE
```

Baseline：

```text
E-BASE-*
```

Comparison：

```text
E-COMPARE-METRIC-BEST-EVAL
E-COMPARE-METRIC-FINAL-EVAL
E-COMPARE-PARAMETERS
E-COMPARE-CONFOUNDERS
E-COMPARE-CONCLUSION
```

所有 comparison EvidenceRef 的 `source_locator` 必须指向 subject/baseline Attempt 或
确定性结果说明，不得伪造数据库表。

## 4. 数据库迁移 `0021_diagnosis_comparison`

迁移文件名：`0021_training_diagnosis_comparison.py`。实际 revision 必须使用较短值，
因为 `alembic_version.version_num` 只有 `varchar(32)`。

### 4.1 索引

```sql
CREATE INDEX idx_training_tasks_comparison_key
ON training_tasks (
    (snapshot->'base'->>'fingerprint'),
    (snapshot->'dataset'->>'sha256'),
    (snapshot->'dataset'->>'split_sha256')
);
```

该索引只加速候选查询，不替代后端快照完整性复验。

### 4.2 Job 扩展

```sql
ALTER TABLE training_diagnosis_jobs
    ADD COLUMN comparison_mode text NOT NULL DEFAULT 'none',
    ADD COLUMN baseline_attempt_id uuid REFERENCES training_attempts(id),
    ADD COLUMN comparison_policy_version text,
    ADD COLUMN baseline_evidence_digest text;

ALTER TABLE training_diagnosis_jobs
    ADD CONSTRAINT training_diagnosis_jobs_comparison_mode_check
    CHECK (comparison_mode IN ('none', 'auto', 'explicit'));

ALTER TABLE training_diagnosis_jobs
    ADD CONSTRAINT training_diagnosis_jobs_baseline_distinct
    CHECK (
        baseline_attempt_id IS NULL
        OR baseline_attempt_id <> attempt_id
    );

CREATE INDEX idx_training_diagnosis_jobs_baseline
ON training_diagnosis_jobs (baseline_attempt_id)
WHERE baseline_attempt_id IS NOT NULL;
```

现有行默认 `comparison_mode='none'`。

### 4.3 Evidence 扩展

```sql
ALTER TABLE training_diagnosis_evidence
    ADD COLUMN baseline_attempt_id uuid REFERENCES training_attempts(id),
    ADD COLUMN baseline_evidence_digest text;

ALTER TABLE training_diagnosis_evidence
    ADD CONSTRAINT training_diagnosis_evidence_baseline_distinct
    CHECK (
        baseline_attempt_id IS NULL
        OR baseline_attempt_id <> attempt_id
    );
```

EvidencePack JSON 升级为 v2，但仍保持一行 job 一条 frozen evidence。

### 4.4 Report 扩展

```sql
ALTER TABLE training_diagnosis_reports
    ADD COLUMN baseline_attempt_id uuid REFERENCES training_attempts(id),
    ADD COLUMN comparison_status text,
    ADD COLUMN comparison_confidence text,
    ADD COLUMN training_signal text,
    ADD COLUMN delivery_signal text,
    ADD COLUMN model_effect_status text;

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_comparison_status_check
    CHECK (
        comparison_status IS NULL
        OR comparison_status IN (
            'strict', 'conditional', 'not_comparable', 'no_baseline'
        )
    );

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_baseline_distinct
    CHECK (
        baseline_attempt_id IS NULL
        OR baseline_attempt_id <> attempt_id
    );

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_confidence_check
    CHECK (
        comparison_confidence IS NULL
        OR comparison_confidence IN ('high', 'medium', 'low', 'none')
    );

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_training_signal_check
    CHECK (
        training_signal IS NULL
        OR training_signal IN (
            'improved', 'worsened', 'mixed', 'flat', 'inconclusive'
        )
    );

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_delivery_signal_check
    CHECK (
        delivery_signal IS NULL
        OR delivery_signal IN (
            'improved', 'worsened', 'same', 'inconclusive'
        )
    );

ALTER TABLE training_diagnosis_reports
    ADD CONSTRAINT training_diagnosis_reports_model_effect_check
    CHECK (
        model_effect_status IS NULL
        OR model_effect_status IN (
            'verified_better',
            'verified_worse',
            'verified_same',
            'inconclusive',
            'unverified'
        )
    );
```

现有 v1 报告这些列为 NULL。

### 4.5 不可变规则

现有 `training_diagnosis_reports` 不可变 trigger 不变。新增列不引入原地更新能力。

### 4.6 Freshness

读取 v2 报告时必须同时比较：

- subject 当前 SourceRevision 与冻结 subject revision；
- baseline 当前 SourceRevision 与冻结 baseline revision。

任一存在且不一致，报告标记 `freshness=stale`。若 baseline 已记录但当前无法读取其来源，
也不能把报告表现为 `current`。`no_baseline` 报告只校验 subject。

### 4.7 回滚

回滚仅删除新增列与索引。已生成的 v2 报告在回滚前必须先备份；不得把 v2 JSON 写入 v1
应用后继续运行。

## 5. 候选查询

### 5.1 SQL 形状

```sql
SELECT
    a.id,
    a.task_id,
    a.number,
    a.state,
    a.created_at,
    t.name,
    t.snapshot,
    t.snapshot_sha256
FROM training_tasks AS t
JOIN training_attempts AS a ON a.task_id = t.id
WHERE
    a.state = 'succeeded'
    AND a.id <> %(subject_attempt_id)s
    AND a.created_at < %(subject_created_at)s
    AND t.snapshot->'base'->>'fingerprint' = %(base_fingerprint)s
    AND t.snapshot->'dataset'->>'sha256' = %(dataset_sha256)s
    AND t.snapshot->'dataset'->>'split_sha256' = %(split_sha256)s
ORDER BY a.created_at DESC, a.number DESC, a.id DESC
LIMIT %(limit)s;
```

应用层仍需：

- 重算 Snapshot canonical hash；
- 校验 `snapshot_sha256`；
- 校验 Adapter evidence；
- 排除不可读候选。

### 5.2 排序稳定性

同一时间戳时按 `number DESC, id DESC`，保证自动基线稳定。

## 6. API

### 6.1 候选

```text
GET /api/v1/training/attempts/{attempt_id}/diagnosis-comparison-candidates?limit=20
```

响应：

```json
{
  "subject_attempt_id": "uuid",
  "group": {
    "base_fingerprint": "...",
    "dataset_sha256": "...",
    "dataset_split_sha256": "..."
  },
  "suggested_baseline_attempt_id": "uuid-or-null",
  "candidates": [
    {
      "attempt_id": "uuid",
      "task_id": "uuid",
      "task_name": "Qwen3-0.6B SFT-LoRA",
      "attempt_number": 1,
      "state": "succeeded",
      "created_at": "2026-11-07T00:00:00Z",
      "snapshot_sha256": "...",
      "base_fingerprint": "...",
      "dataset_sha256": "...",
      "dataset_split_sha256": "...",
      "best_eval_loss": 0.2147,
      "final_eval_loss": 0.2201,
      "eval_point_count": 1,
      "available_adapter_roles": ["best", "final"],
      "comparability_preview": "conditional",
      "changed_parameter_count": 1,
      "confounder_preview_codes": ["eval_coverage_low"]
    }
  ]
}
```

候选接口只对成功的 subject 开放。subject 非终态返回 `409 attempt_not_terminal`；
subject 为 `failed/cancelled` 返回 `409 subject_not_succeeded_for_comparison`。失败复盘页面
不应请求该接口。

### 6.2 创建报告

```text
POST /api/v1/training/attempts/{attempt_id}/diagnosis-reports
```

请求体可省略。省略时：

```json
{
  "comparison_mode": "auto"
}
```

显式：

```json
{
  "comparison_mode": "explicit",
  "baseline_attempt_id": "uuid"
}
```

不比较：

```json
{
  "comparison_mode": "none"
}
```

约束：

- `explicit` 必须提供 baseline；
- `auto` 和 `none` 不得提供 baseline；
- 其他字段因 `extra='forbid'` 拒绝；
- 所有模式都必须通过 AI 开关和 subject 终态校验。
- subject 为 `failed/cancelled` 时，`auto` 退化为 `no_baseline`，`none` 正常生成
  单运行复盘，`explicit` 返回 `409 subject_not_succeeded_for_comparison`。

### 6.3 创建响应

```json
{
  "job_id": "uuid",
  "attempt_id": "uuid",
  "baseline_attempt_id": "uuid-or-null",
  "comparison_mode": "auto",
  "state": "queued",
  "created": true
}
```

### 6.4 最新报告

现有：

```text
GET /api/v1/training/attempts/{attempt_id}/diagnosis-reports/latest
```

响应新增：

```json
{
  "report": {
    "schema_version": "advisory-report-v2",
    "baseline_attempt_id": "uuid",
    "comparison": {}
  },
  "evidence": {
    "schema_version": "evidence-pack-v2",
    "comparison": {}
  },
  "latest_job": {}
}
```

## 7. 幂等键

初始请求 key 必须包括：

```text
scope=initial
policy_version
graph_version
prompt_version
generator_version
subject_snapshot_sha256
comparison_mode
resolved_baseline_attempt_id
baseline_snapshot_sha256
comparison_policy_version
```

相同 subject、相同 baseline、相同版本策略重复点击返回已有 job。

重新生成继续使用 nonce 创建新 job；baseline 选择必须显式写进新 job。

## 8. Job 状态

状态机不变：

```text
queued → running → ready
   ↑          ├─ retry → queued
   └──────────┴─ failed
```

新增字段不改变 worker lease/fencing。

comparison 失败分为：

- baseline 不可比：创建期 422，不创建 job；
- baseline 读取失败：job 可重试，最终 failed；
- comparison 证据不足：job 成功，报告
  `training_signal=inconclusive`；
- comparison 证据在 freeze 时变化：job failed closed；
- LLM 比较措辞违规：repair/fail closed。

## 9. 错误码

| HTTP | code | 场景 |
|---:|---|---|
| 404 | `baseline_attempt_not_found` | 显式基线不存在 |
| 409 | `baseline_snapshot_integrity_failed` | Snapshot hash 不匹配 |
| 409 | `subject_not_succeeded_for_comparison` | 失败/取消 Attempt 请求效果对比 |
| 422 | `baseline_same_as_subject` | 基线等于 subject |
| 422 | `baseline_not_succeeded` | 基线非成功 |
| 422 | `baseline_not_comparable` | 基座/数据/split 不匹配 |
| 422 | `comparison_mode_invalid` | 请求模式非法 |
| 503 | `comparison_candidate_query_unavailable` | 候选查询依赖不可用 |
| 409 | `comparison_evidence_changed` | freeze 时比较证据变化 |
| 500 | `comparison_policy_unsupported` | 不支持的策略版本 |
| 500 | `diagnosis_validation_failed` | Validator 第二次仍失败 |

## 10. 向后兼容

- 不收 body 的旧创建请求默认 `auto`；如果没有候选，自动退化为 `no_baseline`。
- 旧 v1 EvidencePack/Report 继续读取。
- 旧 job 的 `comparison_mode=none`。
- 旧报告 latest 查询不改返回结构，只增加可选字段。
- 不修改 `training_attempts` 和 `training_tasks.snapshot` 的内容。

## 11. 安全

- API 不接受前端计算出的 comparability/result。
- Baseline ID 必须做终态、快照和 Hard Key 复验。
- Comparison 和 Gate 都是服务端可信逻辑。
- 基线投影继续使用现有脱敏逻辑。
- 不把基线完整日志发送给 LLM。
- 不把完整 Snapshot 或数据集样本发送给 LLM。
