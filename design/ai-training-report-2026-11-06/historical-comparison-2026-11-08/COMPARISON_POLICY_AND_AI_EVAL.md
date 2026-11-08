# ModelForge AI 训练诊断
## 历史对比策略与 AI 评估规范

日期：2026-11-08
状态：目标策略，ComparisonEngine 与页面验收已完成
策略版本：`training-comparison-policy-v1`
Prompt 目标版本：`training-diagnosis-prompt-v4`
适用范围：同一基座、同一数据集内容和同一 split 的成功 Attempt 对比

## 1. 不可妥协的结论边界

### 1.1 可以判断

- 两次训练是否满足硬可比条件；
- 参数发生了什么变化；
- Best/Final Adapter Eval Loss 的方向和幅度；
- Token 溢出、Runtime、显存和日志缺口是否出现回归；
- Best/Final Adapter 和独立推理验收状态是否变化；
- 训练信号改善、恶化、混合、持平或无法判断；
- 结论的置信度和混杂因素。

### 1.2 不能判断

- 业务准确率；
- 用户满意度；
- 线上收益；
- 未在相同独立评测集上测过的模型泛化质量；
- 单一参数与最终模型效果之间的确定因果关系。

因此首版固定：

```text
model_effect = unverified
```

除非未来接入 `EvaluationScore` 并满足同一测试集、同一指标、同一判据。

## 2. 比较组

### 2.1 Hard Key

以下三项必须完全相等：

```text
snapshot.base.fingerprint
snapshot.dataset.sha256
snapshot.dataset.split_sha256
```

含义：

- 基座模型文件内容一致；
- 数据集内容一致；
- Train/Validation 行集合一致。

`dataset.id`、`base.id`、Task 名称和 Attempt 编号都不作为硬同一性依据。

### 2.2 首版基线资格

基线必须：

- `state=succeeded`；
- 与 subject 属于同一 Hard Key；
- `attempt_id != subject_attempt_id`；
- `created_at < subject.created_at`；
- Snapshot 完整性校验通过。

### 2.3 自动基线

Subject 也必须为 `succeeded` 才能进行效果对比。若 subject 为 `failed/cancelled`：

- `auto` 自动退化为 `no_baseline`，失败复盘仍可生成；
- `none` 正常生成单运行复盘；
- `explicit` 返回 `409 subject_not_succeeded_for_comparison`。

排序：

```text
created_at DESC,
attempt.number DESC,
attempt.id DESC
```

自动基线只考虑至少有一个可读 Best/Final Eval 指标的候选；第一条为自动基线。显式基线
可以指向指标缺失的成功运行，但 ComparisonEngine 必须输出 `inconclusive` 和
`confidence=none`，不得用健康度替代 Eval 效果。

不得按 Eval Loss、健康度或交付状态挑选自动基线，避免结果导向选择。

### 2.4 显式基线

用户选择显式基线时，后端必须重新验证 Hard Key、状态和快照完整性。前端传入的
`comparability` 不能作为可信输入。

## 3. 参数差异

### 3.1 参与 diff 的字段

```text
epochs
learning_rate
cutoff_len
batch_size
gradient_accumulation
lora_rank
lora_alpha
lora_dropout
scheduler
warmup_ratio
template
seed
```

### 3.2 变更分类

| 分类 | 字段 | 影响 |
|---|---|---|
| 优化参数 | learning_rate、lora_rank、lora_alpha、lora_dropout、scheduler、warmup_ratio | 可作为实验变量 |
| 预算参数 | epochs、batch_size、gradient_accumulation | 改变训练步数或有效 batch |
| 输入处理 | cutoff_len、template | 可能改变 token 化和监督内容 |
| 随机性 | seed | 改变随机过程，不应作为“优化”证据 |
| 运行时 | runtime lock、image profile、GPU 类型 | 混杂因素，不属于训练配置 |

### 3.3 归因规则

| 变化数量 | 允许表达 |
|---|---|
| 仅 1 个非 seed 参数 | “该参数是本次主要变化，但因果仍需重复实验确认” |
| 2 个以上参数 | “多个参数共同变化，不能归因给单个参数” |
| Seed 变化 | “包含随机性变化，不能排除波动” |
| Template/cutoff 变化 | “输入处理发生变化，比较解释力下降” |
| Runtime/镜像/GPU 变化 | “运行环境混杂，不能声称由训练参数造成” |

## 4. 主指标

### 4.1 Adapter 选择

优先顺序：

1. Best Adapter 的 `metrics.eval_loss`；
2. Final Adapter 的 `metrics.eval_loss`；
3. 指标列表中的最低 `eval_loss`；
4. 无可用 Eval Loss → `inconclusive`。

报告必须显示实际使用的 Adapter role，不能把 Final 写成 Best。

Best Eval Loss 是各自运行内选出的最低验证损失，不代表两次运行使用了相同训练预算。若
`epochs`、batch 或 gradient accumulation 改变，报告必须说明“训练预算不同”，不能把更低
损失写成“更高效”或“同等成本下更优”。

### 4.2 差值

由确定性代码计算：

```text
absolute_delta = subject_eval_loss - baseline_eval_loss
relative_delta = absolute_delta / baseline_eval_loss
```

方向：

- `absolute_delta < 0`：subject Eval Loss 更低；
- `absolute_delta > 0`：subject Eval Loss 更高；
- `absolute_delta = 0`：相同。

差值、基线和 subject 原值都必须进入 comparison facts 和 allowed numbers。

### 4.3 噪声阈值

首版策略：

```text
RELATIVE_EVAL_EPSILON = 0.02
```

规则：

- `abs(relative_delta) <= 2%` → `flat`；
- 改善超过 2% → 进入 `improved` 候选；
- 恶化超过 2% → 进入 `worsened` 候选。

2% 是策略常量，不是模型推断，必须写入 `policy_version`。若后续修改，必须升级策略版本并
增加回归夹具。

### 4.4 采样点

- subject 和 baseline 都有至少 3 个 Eval 点：最多 `high`；
- 至少 2 个：最多 `medium`；
- 只有 1 个：最多 `low`；
- 没有任何 Eval：`inconclusive`。

只有 1 个 Eval 点时可以输出“初步改善/初步恶化”，但禁止“稳定改善”。

## 5. 可比性

### 5.1 Hard Ineligibility

任一条件成立：

- 基座指纹不同；
- 数据集哈希不同；
- split 哈希不同；
- 基线不存在；
- 基线非成功；
- 快照完整性失败。

结果：

```text
comparability_status = not_comparable 或 no_baseline
training_signal = inconclusive
```

### 5.2 Confounders

记录但不一定阻止比较：

- Runtime lock ID 或 hash 不同；
- Training image profile 不同；
- GPU 型号不同；
- Template 不同；
- Seed 不同；
- Eval 点数量差异明显；
- 多个参数同时变化；
- 两次 Adapter role 不一致；
- 一侧 metrics 缺失。

### 5.3 Comparability Status

| 状态 | 条件 |
|---|---|
| `strict` | Hard Key 相同；Runtime lock、GPU、Template、Eval 覆盖一致；无 blocking confounder |
| `conditional` | Hard Key 相同，但至少一个 confounder |
| `not_comparable` | Hard Key 不满足或基线不可用 |
| `no_baseline` | 用户选择不比较或没有候选 |

## 6. 训练信号判定

### 6.1 回归检测

新增回归包括：

- subject 新增 `blocked` 健康状态；
- 新增 runtime mismatch；
- Token 溢出数量增加；
- Runtime 从 ready 变为不 ready；
- 显存采样新增错误；
- 日志新增缺口；
- 新增阻塞性证据冲突。

证据缺失增加属于 coverage 下降，不自动等于训练质量下降。

### 6.2 判定矩阵

| Eval 方向 | 新增训练回归 | training_signal |
|---|---|---|
| 改善超过 2% | 否 | `improved` |
| 改善超过 2% | 是 | `mixed` |
| 恶化超过 2% | 否 | `worsened` |
| 恶化超过 2% | 是 | `worsened` |
| 在 ±2% 内 | 否 | `flat` |
| 在 ±2% 内 | 是 | `mixed` |
| 缺失/不可用 | 任意 | `inconclusive` |

`mixed` 的含义是“训练损失信号与健康信号方向冲突”，不是模型质量冲突。

### 6.3 置信度

| 置信度 | 条件 |
|---|---|
| `high` | strict；双方 Eval 点 ≥3；单一非 seed 参数变化；无 Runtime/GPU/Template 混杂 |
| `medium` | hard match；双方 Eval 点 ≥2；变化参数 ≤2；无 blocking 回归 |
| `low` | 只有 1 个 Eval 点、Seed 变化、多个混杂、Adapter role 不一致或覆盖不完整 |

置信度由 ComparisonEngine 给出，LLM 不得升级。

## 7. 交付信号判定

交付状态优先级：

```text
ready_for_release_review
artifact_deliverable_model_unverified
not_deliverable
unknown
```

规则：

- 两个状态都已知且不同：按固定优先级给出 improved/worsened；
- 任一为 `unknown`：`inconclusive`；
- 两者相同：`same`；
- 独立推理验收从缺失到存在匹配记录，可标记 improved；
- Trial `ready` 不算验收提升；
- 仍不能把交付信号写成模型效果信号。

## 8. 模型效果

### 8.1 首版输出

```text
model_effect.status = unverified
reason = no_comparable_downstream_evaluation
```

### 8.2 未来允许 `verified_*` 的最低条件

- subject 与 baseline 的 Adapter 各有独立评测记录；
- 测试集 digest 相同；
- 指标定义相同；
- 阈值/方向相同；
- 评测规范版本相同；
- 分数可比较；
- 评测证据不可变。

当前 `training_inference_acceptance` 只有 passed/failed/inconclusive，没有测试集 digest
和可比较分数，不满足上述条件。

### 8.3 统计边界

首版不输出 p-value、置信区间、显著性结论或收益预估。连续多次运行中的一次最低 Loss
不能当作统计显著改善；人工建议仍应要求重复实验。

## 9. AI Prompt v4 规则

新增规则：

1. 只能引用 `allowed_evidence_ids`；比较陈述必须同时引用 subject 和 baseline 证据。
2. 不得修改 `comparability_status`、`training_signal`、`delivery_signal`、
   `confidence` 或 `model_effect`。
3. 数字只能使用 comparison facts 中的原值或预计算差值。
4. `model_effect=unverified` 时不得写“模型效果更好”“新模型更优”“微调成功”。
5. 多参数变化时不得单归因。
6. 低置信度时不得写“稳定改善/明确提升”。
7. 没有可比基线时不得生成历史比较结论。
8. Runtime、GPU、Template、Seed 混杂必须出现在限制或混杂因素中。
9. 只能给出单变量、可复现的下一轮实验建议。
10. 所有建议仍只产生未提交草稿，不创建 GPU、不提交训练。

## 10. Validator 规则

### 10.1 引用

- comparison claim 至少引用一个 subject Evidence ID；
- comparison claim 至少引用一个 baseline Evidence ID；
- baseline ID 前缀使用 `E-BASE-`；
- ComparisonResult 的 reference IDs 必须存在于 evidence set；
- `E-COMPARE-*` 只能引用冻结 comparison facts。

### 10.2 状态一致性

- 正文不能与 ComparisonResult 相反；
- `training_signal != improved` 时禁止“比上次更好”；
- `model_effect=unverified` 时禁止模型效果升级；
- `confidence=low` 时禁止绝对化词语；
- `not_comparable/no_baseline` 时禁止任何“上次/对比”事实断言。

### 10.3 数字

允许数字集合必须包括：

- subject facts；
- baseline facts；
- GateResult；
- ComparisonResult；
- policy 中的常量只允许用于解释阈值，不允许伪造测量值。

### 10.4 敏感信息

继续禁止：

- API Key；
- Bearer Token；
- DSN；
- 私钥；
- 签名 URL；
- 未经脱敏的日志片段。

## 11. 用户可见措辞

### 11.1 推荐

```text
训练信号：较基线改善（中等置信度）
Best Eval Loss：基线值 → 当前值，相对变化已在冻结比较中计算
模型效果：未验证。缺少同一独立评测集上的两次 Adapter 分数。
```

### 11.2 禁止

```text
新模型效果更好。
本次微调成功。
学习率提升带来了模型能力提升。
模型已经可以上线。
```

### 11.3 多参数示例

```text
观测：本次 Best Eval Loss 低于基线。
推断：学习率、LoRA Rank 和 Epoch 同时变化，均可能是相关因素。
限制：无法把差异归因给单一参数；需要单变量重复实验。
```

## 12. 黄金集 `comparison-golden-v1`

至少覆盖 18 个案例：

| 编号 | 场景 | 期望 |
|---|---|---|
| C01 | strict；仅 learning_rate 改变；Eval 改善超过 2% | improved |
| C02 | strict；仅 learning_rate 改变；Eval 恶化超过 2% | worsened |
| C03 | strict；Eval 变化小于 2% | flat |
| C04 | 只有 1 个 Eval 点，方向改善 | improved + low confidence |
| C05 | 2 个参数同时变化 | 不产生单归因 |
| C06 | Seed 改变 | 标记随机性混杂 |
| C07 | Runtime lock 改变 | conditional |
| C08 | GPU 型号改变 | conditional |
| C09 | 数据集 SHA 不同 | not_comparable |
| C10 | Split SHA 不同 | not_comparable |
| C11 | 无历史成功 Attempt | no_baseline |
| C12 | 基线 Adapter 指标缺失 | inconclusive |
| C13 | 新增 Token 溢出回归 | mixed |
| C14 | 新增 Runtime mismatch | mixed/worsened |
| C15 | 基线 failed | 不进入首版效果比较 |
| C16 | 模型声称“模型效果更好” | Validator 拒绝 |
| C17 | 比较 Claim 缺少 baseline evidence | Validator 拒绝 |
| C18 | AI 自行计算冻结事实外百分比 | Validator 拒绝 |

夹具必须同时覆盖：

- subject；
- baseline；
- 两套 GateResult；
- 参数差异；
- comparison facts；
- 预期报告字段；
- 预期 Validator issue code。

## 13. 评估指标

硬门禁：

- comparison gate consistency = 100%；
- comparison evidence coverage = 100%；
- unknown evidence ID = 0；
- unsupported number = 0；
- forbidden model-effect claim = 0；
- missing-baseline hallucination = 0；
- 多参数单归因 = 0。

质量指标：

- 人工判断“是否清楚区分训练信号和模型效果” ≥ 90%；
- 人工判断“是否能解释为什么可比/不可比” ≥ 90%；
- 人工判断“下一步实验是否单变量且可执行” ≥ 85%；
- 低置信度案例中，是否明确标注不确定性的比例 = 100%。

## 14. 不得用平均值绕过硬门禁

以下项目任一条失败，整个 ticket 不得关闭：

- 错误基线；
- 错误 split；
- 错误 Gate；
- 伪造差值；
- 模型效果升级；
- 比较证据缺失。

文本可读性评分不能补偿事实错误。
