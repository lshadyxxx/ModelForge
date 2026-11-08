# ModelForge AI 训练诊断
## 历史训练对比架构设计

日期：2026-11-08
状态：本地实现完成，真实页面验收通过
代码基线：`62e92dd0fbb69cce0125560fcc5c2b9cdd625390`
关联文档：[DATA_CONTRACT.md](DATA_CONTRACT.md)、
[COMPARISON_POLICY_AND_AI_EVAL.md](COMPARISON_POLICY_AND_AI_EVAL.md)

## 1. 架构结论

历史对比是在现有“单 Attempt AI 诊断”之上增加一个只读、确定性的比较层：

```text
当前 Attempt                          历史 Attempt
     │                                      │
     └────────── 同一比较组 ────────────────┘
         base fingerprint
         dataset sha256
         dataset split sha256
                       │
                       ▼
              ComparisonCollector
         冻结当前证据 + 冻结基线投影
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
      GateEngine               GateEngine
      subject Attempt          baseline Attempt
          └────────────┬────────────┘
                       ▼
               ComparisonEngine
        eligibility / signal / confidence
        parameter diff / confounders
                       │
                       ▼
              LangGraph StateGraph
             compare → generate → validate
                                │
                                ├─ valid → publish
                                └─ repair → validate / fail
                       │
                       ▼
              AdvisoryReport v2
         不可变版本 + 双证据引用
```

核心原则：

1. **LLM 不寻找基线。** 基线由 SQL 查询和确定性策略选择。
2. **LLM 不判断好差。** 训练信号、置信度和混杂因素由 `ComparisonEngine` 计算。
3. **LLM 不计算差值。** 绝对差、相对差和方向先由代码计算，再进入冻结上下文。
4. **LLM 不拥有模型效果结论。** `model_effect` 在首版固定为 `unverified`。
5. **双运行证据分别冻结。** 当前和基线的证据都不能在发布后被静默替换。
6. **报告仍不可变。** 重新生成产生新 job、新版本，不覆盖历史报告。
7. **继续使用固定 LangGraph。** 不注册工具、不做自主规划、不引入通用 Agent。

## 2. 现状与缺口

### 2.1 当前已具备

- `training_tasks.snapshot` 保存不可变输入。
- `training_attempts` 通过 `task_id` 关联 Task，并允许重试 Attempt。
- Attempt 冻结了 metrics、token preflight、runtime report、manifest 和 Adapter。
- `adapter_versions.metrics` 已包含 `best_metrics` / `final_metrics`。
- 诊断模块已具备 EvidencePack、GateEngine、LangGraph 和 Validator。
- 报告发布后不可变，且读取时会检测来源是否 stale。

### 2.2 当前缺少

- Attempt 之间没有跨 Task 的显式实验血缘。
- Retry 复用同一 Task snapshot，无法表达“参数发生变化”的实验关系。
- 诊断 job 没有 baseline 字段。
- EvidencePack 只保存单 Attempt。
- AI 上下文没有基线指标、参数差异和混杂因素。
- Report schema 没有 comparison 区块。
- Validator 没有“禁止无证据比较”的规则。
- UI 没有基线选择、参数 diff 和对比证据。

### 2.3 因此不能依赖的字段

- 不能依赖 `task_id` 判断参数实验关系。
- 不能依赖 `attempt.number` 选择历史基线。
- 不能仅依赖 `dataset.id` 或 `base.id`，因为它们不等于内容同一性。
- 不能把 Retry 当成超参数实验。

## 3. 逻辑分层

### 3.1 Training History Query

职责：

- 根据当前 Attempt 的 Snapshot 计算比较组；
- 查询同一比较组中的历史 Attempt；
- 返回候选列表和自动基线；
- 只返回后端已经验证过硬匹配关系的候选。

比较组：

```text
base.fingerprint
+ dataset.sha256
+ dataset.split_sha256
```

具体 SQL、索引和响应见 [DATA_CONTRACT.md](DATA_CONTRACT.md)。

### 3.2 Baseline Evidence Collector

职责：

- 复用现有 `EvidenceCollector` 读取基线 Attempt；
- 只保存对比较和审计必要的投影，避免把第二份完整日志复制进报告；
- 为每个基线事实生成独立 EvidenceRef；
- 计算基线 EvidencePack digest；
- 验证基线 Attempt 属于当前比较组。

基线投影至少包含：

- Attempt ID、Task ID、编号、时间、状态、退出码；
- Snapshot SHA-256；
- 基座指纹、数据集哈希、切分哈希；
- 完整 TrainingConfig；
- 指标数量与 Adapter Best/Final metrics；
- Token 预检摘要与溢出数量；
- Runtime lock、GPU、ready、mismatch；
- 显存采样摘要；
- Manifest 缺口与产物摘要；
- Best/Final Adapter 状态与指纹；
- 独立推理验收摘要。

成功基线不需要复制完整日志。若基线不是成功状态，首版不做效果对比。

### 3.3 GateEngine

当前 GateEngine 继续分别评估 subject 和 baseline：

- subject 的 health/delivery 是当前报告主结论；
- baseline 的 health/delivery 只用于比较；
- comparison 不能改写任一 GateResult；
- 任何 blocking conflict 仍按现有规则处理。

需要避免把两个 GateResult 合成一个“平均健康分”。

### 3.4 ComparisonEngine

这是新增的确定性领域服务，输入为：

- subject EvidencePack；
- baseline EvidencePack；
- subject GateResult；
- baseline GateResult；
- `ComparisonPolicy`；
- 参数差异；
- 运行时和硬件差异。

输出为：

- `comparability_status`；
- `confidence`；
- `training_signal`；
- `delivery_signal`；
- `model_effect`；
- `metric_deltas`；
- `parameter_changes`；
- `confounders`；
- `reason_codes`；
- `comparison_digest`。

它没有 I/O，不允许调用模型，输出可完全由夹具复现。

### 3.5 LangGraph

现有图：

```text
collect → gate → generate → validate
                         ├─ publish
                         ├─ repair → validate
                         └─ fail
```

新增图：

```text
collect_subject
→ collect_baseline
→ gate_subject
→ gate_baseline
→ compare
→ generate
→ validate
   ├─ publish
   ├─ repair → validate
   └─ fail
```

`comparison_mode=none` 时，`collect_baseline` 和 `gate_baseline` 返回
`not_requested`，`compare` 返回 `no_baseline`，仍可生成普通单运行报告。

图版本升级为 `training-diagnosis-graph-v2`。

### 3.6 AI Generator

模型继续通过 `langchain-openai` 的结构化输出生成 `CandidateReport v2`。

模型只收到：

- 当前冻结事实；
- 基线冻结投影；
- 两个 GateResult；
- ComparisonResult；
- 允许引用的证据 ID；
- 明确的边界与禁止表达；
- 参数差异和混杂因素。

模型不会收到：

- 数据库连接；
- 任意 SQL、Shell、HTTP 或训练工具；
- 未裁剪的基线完整日志；
- API Key、DSN、签名 URL；
- 可以修改 comparison 或 gate 的控制字段。

### 3.7 Validator

Validator 在现有规则上增加：

- 比较 Claim 必须引用 subject 和 baseline 两侧证据；
- comparison 状态必须与 ComparisonResult 完全一致；
- 所有差值必须出现在冻结 comparison facts；
- `model_effect=unverified` 时禁止“模型效果更好”；
- 多参数变化时禁止单参数因果归因；
- `confidence=low` 时禁止“稳定提升”；
- 不存在可比基线时禁止任何历史比较断言。

### 3.8 Persistence

继续使用业务表作为真相：

- `training_diagnosis_jobs`：记录 subject、baseline 和比较模式；
- `training_diagnosis_evidence`：保存 subject pack + baseline projection；
- `training_diagnosis_reports`：保存不可变 AdvisoryReport v2；
- `langgraph_checkpoint`：只保存短期图状态，不是比较结果真相。

新增迁移 revision 为 `0021_diagnosis_comparison`，迁移文件名为
`0021_training_diagnosis_comparison.py`。

### 3.9 Frontend

继续复用 A v2 诊断页签，在结论区内新增：

- 基线选择器；
- 可比性状态；
- 训练信号和置信度；
- 模型效果未验证提示；
- 参数变化表；
- 指标对比表；
- 混杂因素；
- 双证据检查器；
- 将建议应用为未提交草稿。

见 [UI_UX_SPEC.md](UI_UX_SPEC.md)。

## 4. 数据流

### 4.1 候选加载

```text
打开 AI 诊断页
→ GET comparison-candidates
→ 后端读取 subject snapshot
→ 计算比较组
→ 查询最近 20 个成功候选
→ 对候选做快照硬匹配校验
→ 返回 comparability 摘要与建议基线
```

该请求不调用模型。

### 4.2 报告生成

```text
用户点击“生成 AI 诊断”
→ POST diagnosis-reports
→ API 解析 comparison_mode/baseline_attempt_id
→ API 校验终态、AI 开关和基线硬匹配
→ 幂等创建 queued job
→ Worker 领取 job
→ 冻结 subject evidence
→ 冻结 baseline projection
→ 双 Gate
→ ComparisonEngine
→ 组装 Prompt
→ LLM 结构化生成
→ Validator
→ 发布 AdvisoryReport v2
→ 前端轮询并展示
```

### 4.3 重新生成

```text
用户选择新基线或点击重新生成
→ 新 job
→ 新 baseline FK
→ 新 evidence digest
→ 新 report version
→ 旧报告保持不可变
```

## 5. 比较组与候选选择

自动基线规则：

1. 只查 `succeeded` Attempt。
2. 只查同一比较组。
3. 排除 subject 自身。
4. 只保留 subject `created_at` 之前的候选。
5. 按 `created_at DESC, number DESC, id DESC` 排序。
6. 第一条为 `suggested_baseline_attempt_id`。

显式基线必须：

- 出现在同一 hard-key 候选集合；
- 是成功 Attempt；
- 不等于 subject；
- 快照哈希可验证；
- 不依赖前端自行判断。

首版不提供“历史最佳”自动选择，避免用结果反向挑基线造成 cherry-picking。

## 6. 可比性与信号

### 6.1 可比性

| 状态 | 条件 |
|---|---|
| `strict` | hard key 相同，Runtime lock、GPU 类型、Template 和评估样本一致或可证明 |
| `conditional` | hard key 相同，但存在 Runtime、GPU、Seed、Template 或评估覆盖混杂 |
| `not_comparable` | hard key 不一致、基线缺失、基线非成功或快照不可信 |
| `no_baseline` | 用户选择不比较或没有候选 |

### 6.2 训练信号

`improved / worsened / mixed / inconclusive / flat`

以 Best Adapter Eval Loss 为主，Final Adapter Eval Loss 和健康度回归为辅助。

### 6.3 交付信号

`improved / worsened / same / inconclusive`

只看 Adapter 完整性和独立推理验收状态，不等于模型质量。

### 6.4 模型效果

`unverified` 是首版唯一正常输出；接口预留：

```text
verified_better
verified_worse
verified_same
inconclusive
unverified
```

只有未来两次 Adapter 在同一评测规范、同一测试集和同一分数定义下都有结果，才允许输出
`verified_*`。

## 7. 安全与信任边界

### 7.1 不可信输入

- 训练日志；
- Manifest 路径；
- 数据集元数据；
- 用户选择的 baseline ID；
- 模型输出；
- Provider 错误正文。

### 7.2 受信逻辑

- 比较组计算；
- 候选硬匹配；
- GateEngine；
- ComparisonEngine；
- 参数 diff；
- Validator；
- job lease/fencing；
- 不可变报告 trigger。

### 7.3 模型权限

模型没有工具，不能：

- 查询其他 Attempt；
- 自行选择基线；
- 重算 Gate；
- 重算 Comparison；
- 修改 evidence IDs；
- 提交训练或草稿。

## 8. 失败模式

| 失败 | 行为 |
|---|---|
| 没有成功基线 | 报告生成 `comparison=no_baseline`，仍可单运行诊断 |
| baseline ID 无权限/不存在 | `404 not_found` |
| baseline 与 subject 不可比 | `422 baseline_not_comparable` |
| baseline 非成功 | `422 baseline_not_succeeded` |
| baseline 快照完整性失败 | `409 baseline_snapshot_integrity_failed` |
| baseline 在排队后改变 | freeze 时 digest 不一致，job fail closed |
| 模型输出比较错误 | repair 一次，仍失败则 `diagnosis_validation_failed` |
| 基线 evidence 不可读 | comparison `inconclusive`，报告仍可发布但明确缺失 |
| checkpoint 丢失 | 重新执行固定图；业务 evidence/report 仍为真相 |

## 9. 可观测性

Job usage 继续记录：

- model_calls；
- prompt/completion/total tokens；
- latency；
- cost_estimate=null，除非 provider 价格显式配置；
- comparison_policy_version；
- baseline_attempt_id；
- evidence_digest；
- report_version。

禁止把完整 Prompt、日志、API Key 或未脱敏证据写入日志。

## 10. 扩展路径

### Phase 2

- 多基线 cohort；
- 历史趋势图；
- 用户收藏基线；
- 失败 vs 成功的运行回归；
- 参数变化单变量标记。

### Phase 3

- 接入独立 benchmark/eval result；
- 同一评测集 digest 和分数；
- 统计置信区间；
- 真实 `model_effect=verified_*`；
- 自动建议下一轮单变量实验，但仍只生成草稿。

## 11. 实施边界

本文档不授权编码。收到用户明确命令后，按
[EXECUTION_PLAN.md](EXECUTION_PLAN.md) 的顺序执行；所有文件改动必须落在其白名单内。
