# ModelForge AI 训练诊断 · 真实模型验收记录

日期：2026-11-07  
代码基线：`685a7ee3e0a3fc088122aa66bb613c28d35d24c3`  
环境：本地 Docker Compose；API、Worker、Web、PostgreSQL、MinIO 均健康  
状态：真实模型 smoke、成功/失败报告发布和页面交互已通过；黄金集真实稳定性、
独立推理验收、生产可用或部署仍未完成

> 本文保留单例契约和早期 v1/v2 发布证据。最新黄金集、模型用量、v3 报告、独立验收
> schema/API 和页面截图见
> [GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md](GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md)。

## 1. 模型与启用边界

- Provider：DeepSeek OpenAI-compatible 接口。
- 模型名：`deepseek-flash`。
- 结构化适配：`langchain-openai` 的 `ChatOpenAI`。
- 编排：固定 LangGraph StateGraph。
- checkpoint：`PostgresSaver`，独立 `langgraph_checkpoint` schema。
- 密钥只通过本地 `.env` 注入；本文、截图、日志和 Git 均不记录密钥。
- `MF_AI_ENABLED` 是本轮为受控验收启用的本地开关；生产默认与发布策略仍需单独确认。

## 2. 真实模型契约测试

执行入口：

```text
backend/tests/test_training_diagnosis.py::test_live_model_output_is_contract_valid_and_evidence_bound
```

在显式设置 `MF_AI_LIVE_EVAL=1` 后，真实请求到达 DeepSeek，结果为：

```text
1 passed in 62.60s
```

通过内容：

- 模型返回可解析的 JSON 对象；
- `CandidateReport` Pydantic 契约通过；
- Evidence ID 与冻结 EvidencePack 可解析；
- Validator 的数字忠实、门禁一致性和禁止表达检查通过；
- 没有把 Adapter available 升级为模型可用。

该结果只证明一次受控真实调用满足契约与证据约束。它不是黄金集通过率、稳定性、
人评 Rubric 或训练模型业务效果验收。

## 3. 定向回归与构建

| 验证 | 命令 | 结果 |
|---|---|---|
| 诊断 + HTTP 契约 | `docker compose run --rm --no-deps api python -m pytest tests/test_training_diagnosis.py tests/test_http_contract.py -q` | `26 passed, 1 skipped` |
| 前端单元测试 | `cd frontend; npm test` | `96 passed, 0 failed` |
| 前端生产构建 | `cd frontend; npm run build` | 通过，108 modules |
| 构建体积提示 | Vite 报告 | 主 JS 约 706 kB，存在非阻断 chunk-size warning |
| API 存活 | `GET /api/v1/health/live` | `status=alive` |
| Web | `GET http://127.0.0.1:8092/` | HTTP 200 |

跳过项是默认关闭的真实模型评估测试；上述单例测试已另行显式执行并通过。

## 4. 成功 Attempt 的真实发布

Attempt：

```text
fbc8a03d-27e3-4ef2-8253-c23ac8a599ac
```

### 4.1 Job 与报告

| 项目 | v1 | v2 | v3/latest |
|---|---|---|---|
| Job | `7e61cff4-8012-4262-94a9-fe366136d8d9` | `82d6e219-3a46-4bf8-8abf-568c39a1086b` | `377b3f5a-2040-46d8-9972-0dc6247d442f` |
| 报告 | `104ea3a9-8c7e-45f0-be2d-003fec5db0e6` | `5652d20e-ad8c-4f29-8646-862af83c3552` | `15b7a89d-12fb-444c-b75b-47e9461deb27` |
| 状态 | `ready` | `ready` | `ready` |
| mode | `full` | `full` | `full` |
| health | `partial` | `partial` | `partial` |
| delivery | `artifact_deliverable_model_unverified` | `artifact_deliverable_model_unverified` | `artifact_deliverable_model_unverified` |
| findings / limitations | 8 / 7 | 7 / 7 | 8 / 5 |

v2 使用的冻结版本：

```text
prompt_version=training-diagnosis-prompt-v2
generator_version=langchain-openai-structured-v1
model_name=deepseek-flash
```

v2 摘要明确写入：22 个 Train Loss 点、1 个 Eval Loss 点、Best/Final Adapter
均为 available，但当前 Adapter 没有独立推理验收，因此不能判断模型可用性或业务效果。

v3 使用 `training-diagnosis-prompt-v3`，job 用量为 1 次调用、19,616 tokens、
43.1 秒；`cost_estimate=null`，没有估算费用。旧 v1/v2 完整保留且不可变。

### 4.2 Fail-closed 证据

首次 v1 尝试的 job：

```text
1837c4cf-18da-4c57-8e4e-5d631f9c47e6
state=failed
error_code=diagnosis_validation_failed
```

它没有发布报告；只有后续通过 Validator 的 job 才能写入不可变报告。这一行为通过真实
运行验证，不是前端假状态。

## 5. 失败 Attempt 的真实发布

Attempt：

```text
f3801f77-48e1-4b30-b6f3-5448f4a7bb4f
```

| 项目 | 值 |
|---|---|
| Job | `1da14b71-4e3b-48ef-80b7-cec46054ec9b` |
| 报告 | `0b569dbe-7706-4e8d-bc8a-b351eafc4727` |
| version | 1 |
| state | `ready` |
| report_mode | `limited` |
| health | `unknown` |
| delivery | `not_deliverable` |
| findings / limitations | 5 / 5 |

报告只确认：

- Attempt 状态为 failed；
- `error_code=bootstrap_key_install_failed`；
- metrics、token preflight、runtime、manifest、logs 未上报；
- Best/Final Adapter 未发布；
- 当前无法判断根因、训练健康度、模型能力或业务效果。

将 provisioning 错误码写成“已确认根因”会违反 Validator；本次报告没有这样做。

## 6. 不可变与恢复证据

- 报告发布后，业务表更新被 PostgreSQL trigger 拒绝：

```text
ERROR: Published diagnosis reports are immutable
CONTEXT: PL/pgSQL function mf_diagnosis_report_immutable() line 3 at RAISE
```

- 重新生成产生新 job、新 version 和新 report ID，不覆盖旧报告。
- 三个 job 均为 `attempt_count=1`、`repair_count=0`；首次失败的 job 保留失败记录。
- LangGraph checkpoint 表存在并可读取，但 checkpoint 不是业务真相；job/evidence/report
  仍以 PostgreSQL 业务表为准。
- 长模型调用期间 heartbeat 续租；失租路径 fail closed，旧 fencing token 不能发布。

## 7. 页面与交互验收

截图目录：`screenshots/`

| 截图 | 覆盖 |
|---|---|
| `implementation-ai-report-entry-desktop-20261107.png` | 训练概览 AI 入口 |
| `implementation-ai-report-success-desktop-20261107.png` | 成功报告主页面、双门禁 |
| `implementation-ai-report-findings-desktop-20261107.png` | 严重度筛选、按组展示关键发现 |
| `implementation-ai-report-evidence-desktop-20261107.png` | 证据索引、E-MEMORY 展开 |
| `implementation-ai-report-apply-draft-desktop-20261107.png` | 应用建议生成未提交配置草稿 |
| `implementation-ai-report-failure-desktop-20261107.png` | 失败 Attempt 的 limited 复盘 |
| `implementation-ai-report-empty-desktop-20261107.png` | 取消 Attempt 的无报告空状态 |
| `implementation-ai-report-success-mobile-20261107.png` | 390px 移动报告内容 |

最新 v3 真实页面截图：

- `qa/v3-report-desktop-1440.png`
- `qa/v3-report-findings-1440.png`
- `qa/v3-report-evidence-1440.png`
- `qa/v3-report-mobile-390.png`
- `qa/v3-report-mobile-filter-390.png`

验证结果：

- 桌面：`innerWidth=1440`，文档级横向溢出 `false`。
- 移动：`innerWidth=390`，文档级横向溢出 `false`。
- 截图：桌面 `1440×1028`，移动 `390×840`；DPR 已校正为约 `1.0`。
- 严重度筛选“需关注”显示 3 条。
- 证据 `E-MEMORY` 可展开，显示字段路径、观测时间与来源摘要。
- 复制摘要返回“已复制摘要”；复制配置草稿返回“已复制”。
- 应用建议只生成 `{"epochs": 2}` 草稿，并明确不会自动提交、创建 GPU 或修改历史
  Attempt。
- 成功 Attempt 与失败 Attempt 可切换，失败页展示 limited 复盘。
- 取消 Attempt 显示无报告空状态和“生成 AI 诊断”入口，不自动调用模型。
- 页面 instrumentation 记录 console error、window error、unhandled rejection：
  `0 / 0 / 0`。

## 8. 证据边界

### 可用于报告

- Attempt snapshot；
- Train/Eval Loss；
- learning_rate；
- token_preflight；
- runtime_report；
- GPU 显存快照/峰值；
- execution_manifest；
- provisioning 错误码；
- 日志；
- Best/Final Adapter；
- 推理 Trials 与独立推理验收的关联状态。

### 当前不可用

- task metric 和业务质量指标；
- throughput；
- gradient norm；
- 逐样本 loss；
- 重复率；
- 语言分布；
- 当前 Adapter 的独立推理验收结论；
- 训练模型的实际业务效果。

### 因此禁止

- 用 Train/Eval Loss 推断准确率、业务收益或用户满意度；
- 用 Adapter available 推断模型可用；
- 用 provisioning 错误码代替已确认根因；
- 将缺失字段写成 0、正常或“无异常”；
- 将 AI 报告替代确定性的 Gate、训练校验或发布门禁。

## 9. 已知限制

- 黄金集 fixture 为 18/18，但真实模型 smoke 只覆盖 4 个场景，不是 18 场景真实稳定性
  结论，也不是人工 Rubric 验收。
- 真实模型网络调用只覆盖一个成功 Attempt 的契约测试；失败报告另有真实发布，但未做
  多次重复生成的一致性统计。
- 独立推理验收 schema/API 已实现，但真实验收记录仍为 0；没有真实 Trial 时不能执行
  人工验收。
- Provider 延迟、429、token 成本和 p95 尚未压测。
- 当前 Adapter 没有独立推理验收，页面只能显示
  `artifact_deliverable_model_unverified`。
- 未启动云 GPU、未创建云实例、未执行正式训练。
- 未部署、未提交 Git、未推送；所有修改仍在工作区。
- 屏幕阅读器、200% zoom、forced-colors、真实移动设备和真实用户可用性测试仍未完成。
- 本轮截图使用本地浏览器模拟尺寸；硬件设备验收不能由截图替代。

## 10. 结论

本轮可以确认：

1. 真实 DeepSeek 结构化输出已通过一次契约与证据绑定测试；
2. 成功与失败 Attempt 都已通过 Worker 发布真实、不可变的 AI 报告；
3. GateEngine、Validator、租约/fencing 和 fail-closed 路径有运行证据；
4. v3 页面在 1440/390 下可操作，用量、严重度筛选、证据和草稿交互通过；
5. AI 仍然只是 advisory 诊断层，真实独立推理验收为 0，不能宣称模型可用。

