# ModelForge AI 训练诊断 · 历史训练对比设计包

日期：2026-11-08
代码基线：`62e92dd0fbb69cce0125560fcc5c2b9cdd625390`
状态：**本地实现与真实页面验收完成；未提交、未推送、未部署、未创建云资源。**
适用范围：在同一基座、同一数据集内容和同一训练/验证切分下，将当前 Attempt 与一次历史
成功 Attempt 做训练信号对比，并生成 advisory AI 解释。

## 1. 产品结论

本功能不是让 LLM 自由判断“新模型更好”，而是增加一个确定性的
`ComparisonEngine`，先回答：

- 两次运行是否可比；
- 哪些训练参数发生变化；
- Best/Final Adapter 的 Eval Loss 是改善、恶化、基本持平还是无法判断；
- 健康度、Token 溢出、Runtime、显存、产物和交付状态是否出现回归；
- 结论的置信度与混杂因素是什么。

LangGraph 中的 LLM 只负责把冻结比较事实解释成用户可读报告，不能修改比较结果，也不能
把训练损失改善表述成业务效果提升。

最终结论必须分成三层：

| 层级 | 首版能力 |
|---|---|
| 训练信号 | 可以判断改善、恶化、混合或无法判断 |
| 交付信号 | 可以比较 Adapter 完整性与独立推理验收状态 |
| 真实模型效果 | 首版固定保留为 `unverified`，除非未来接入同一评测集的可比较分数 |

## 2. 已冻结的产品决策

| 决策 | 结论 |
|---|---|
| 首版范围 | 当前成功 Attempt vs 一次历史成功 Attempt |
| 自动基线 | 同一比较组中、当前运行之前最近一次具备可读 Eval 指标的成功 Attempt |
| 手动基线 | 用户可从可比候选列表中选择 |
| 硬匹配 | 基座内容指纹、数据集 SHA-256、训练/验证切分 SHA-256 相同 |
| 主比较指标 | Best Adapter 的 Eval Loss；Final Adapter Eval Loss 为辅助 |
| 比较执行者 | 确定性 `ComparisonEngine`，不是 LLM |
| AI 定位 | advisory 解释器，不决定好差、置信度或门禁 |
| 模型效果 | 没有同评测集分数时固定 `unverified` |
| 报告存储 | 继续使用不可变报告版本；新增 baseline 引用与 comparison JSON |
| UI 基线 | 方案 A v2 专业诊断信号台，在结论区增加“历史对比”模块 |
| 编排 | 继续使用现有 LangGraph 固定 StateGraph，不引入自主 Agent |
| 依赖 | 不新增框架；继续使用 `langchain-openai` 与 `langgraph-checkpoint-postgres` |

## 3. 首版明确不做

- 不比较不同基座、不同数据集或不同 split。
- 不比较非成功 Attempt 的效果；失败复盘仍是单运行诊断。
- 不做多基线排名、批量 cohort 分析或自动选“历史最佳”。
- 不自动提交训练、不自动创建 GPU、不自动修改训练配置。
- 不用 Train/Eval Loss 推断业务准确率、用户满意度或生产能力。
- 不把独立推理验收的 `passed` 当作效果分数。
- 不在本阶段新增 benchmark runner 或任务指标采集。

## 4. 文档包

建议按以下顺序阅读：

1. [ARCHITECTURE.md](ARCHITECTURE.md)
   总体架构、数据流、LangGraph 拓扑、边界和失败模式。
2. [DATA_CONTRACT.md](DATA_CONTRACT.md)
   Pydantic 契约、SQL 迁移、API 请求响应、状态与错误码。
3. [COMPARISON_POLICY_AND_AI_EVAL.md](COMPARISON_POLICY_AND_AI_EVAL.md)
   基线选择、可比性、判定矩阵、置信度、Prompt 和 Validator 规则。
4. [UI_UX_SPEC.md](UI_UX_SPEC.md)
   入口、对比面板、状态、交互、移动端和可访问性。
5. [EXECUTION_PLAN.md](EXECUTION_PLAN.md)
   分阶段任务、依赖、文件白名单、并行规则和可复制交接提示词。
6. [TEST_ACCEPTANCE.md](TEST_ACCEPTANCE.md)
   测试矩阵、黄金案例、浏览器验收、证据格式和关闭条件。

## 5. 现有代码事实

本方案只使用当前系统已经存在的数据：

- `training_tasks.snapshot` 是不可变训练输入，包含 `base`、`dataset`、`config` 和 `instance`。
- 基座内容指纹位于 `snapshot.base.fingerprint`。
- 数据集内容哈希位于 `snapshot.dataset.sha256`。
- Train/Validation 切分哈希位于 `snapshot.dataset.split_sha256`。
- TrainingConfig 已包含 epochs、learning_rate、cutoff_len、batch_size、
  gradient_accumulation、LoRA 参数、scheduler、warmup、template 和 seed。
- 训练结果已产出 `best_metrics` 与 `final_metrics`，并随 Adapter 持久化。
- 当前诊断模块已具备 EvidencePack、确定性 Gate、LangGraph、Validator、不可变报告和
  前端 AI 诊断页签。

关键代码：

- `backend/src/modelforge/modules/training/use_cases.py`
- `backend/src/modelforge/runtimes/train_remote.py`
- `backend/src/modelforge/modules/diagnosis/`
- `frontend/src/features/training/diagnosis/`

## 6. 当前不能证明的事

现有系统没有：

- task metric、业务准确率或用户评分；
- throughput、gradient norm、逐样本 loss；
- 同一独立评测集上的两次 Adapter 分数；
- 统计显著性检验；
- 自动单变量实验管理。

因此首版只能可靠输出“训练信号与交付信号对比”，不能输出“微调后的模型实际效果更好”。

## 7. 实施状态

本轮已在用户明确授权后完成本地实现：

1. 新增迁移 `0021_diagnosis_comparison`；
2. 实现 ComparisonEngine、候选 API、EvidencePack v2 和 Report v2；
3. 接入自动基线、指定基线和“不对比历史”；
4. 完成前端对比面板、参数差异、指标差、混杂因素和证据台账；
5. 通过后端、前端、构建和真实页面验收。

仍未执行 Git 提交、推送、部署或云 GPU/实例操作。

准确证据见：

- [IMPLEMENTATION_STATUS_2026-11-08.md](IMPLEMENTATION_STATUS_2026-11-08.md)
- [TEST_ACCEPTANCE.md](TEST_ACCEPTANCE.md)
- `evidence/`
