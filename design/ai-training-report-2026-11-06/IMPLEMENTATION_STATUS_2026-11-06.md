# ModelForge AI 训练诊断 · 实施状态

日期：2026-11-07（初版：2026-11-06）  
代码基线：`685a7ee3e0a3fc088122aa66bb613c28d35d24c3`（保留工作区既有未提交修改）  
本轮状态：黄金集夹具 18/18、4 场景真实模型 smoke 4/4、v3 报告与用量页面验收通过；
独立推理验收 schema/API 已实现但真实记录仍为 0；未提交、未推送、未部署

> 完整命令、报告 ID、数据库查询和边界见
> [REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)
> 与
> [GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md](GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md)。

## 1. 已完成范围

### 后端

- `modules/diagnosis`：EvidencePack、GateEngine、Repository、Validator、
  LangGraph 固定图、ChatOpenAI Generator、PostgresSaver、Worker、Draft、Routes。
- `training_diagnosis_jobs/evidence/reports` 三张业务表。
- 报告发布后不可变；重新生成产生新 job 和新 version。
- lease owner、过期时间、fencing token；旧 Worker 不能发布新报告。
- 长模型调用期间由独立心跳线程续租；失租后在下一次写入门禁前 fail closed。
- diagnosis worker 使用独立轮询线程，实际读取 `MF_AI_WORKER_POLL_SECONDS`，
  不再阻塞训练/推理执行循环。
- `langgraph_checkpoint` 独立 schema，迁移阶段执行 `PostgresSaver.setup()`。
- `/api/v1/training/diagnosis/config` 为无数据库 I/O 的能力探针。

### 前端

- 训练详情新增“AI 诊断”页签。
- 运行总览新增 AI 入口卡。
- 覆盖未启用、空状态、生成中、失败、证据不足、limited、stale、conflict、
  成功但模型未验证等状态。
- 展示健康度与可交付性双门禁。
- Claim 区分观测、推断、建议、限制。
- 支持严重度筛选、证据展开、复制摘要、重新生成、应用建议草稿、切换 Attempt。
- “应用建议配置”只显示未提交草稿，不提交训练、不创建 GPU。
- 总览入口卡与 AI 诊断页签由同一个 `DiagnosisProvider` 提供状态，避免重复请求
  和两套进度状态。
- 剪贴板权限失败时显示可读错误，不再产生未处理的 Promise rejection。

### 评估与文档

- 确定性 Gate 夹具、Validator 夹具、固定 LangGraph 拓扑测试。
- 黄金集 fixture `18/18` 通过；Gate 保真度 `1.0`、Validator clean `1.0`；
  9 条独立 negative probe 全部被拒绝。
- 真实 PostgreSQL 证据采集与 PostgresSaver smoke。
- 真实 DeepSeek smoke 覆盖 `G01/G04/G08/G09`：最终 `4/4` 通过，首轮洁净
  `3/4`，`G08` 一次 repair 成功；使用 5 次模型调用、77,209 tokens、
  234.9 秒。它不代表 18 场景真实稳定性。
- 新增模型用量/延迟捕获；provider 未上报 token 时保持缺失，不估算；
  未配置价格时 `cost_estimate=null`。
- 成功 Attempt 已发布 v1/v2 不可变报告；失败 Attempt 已发布 limited 复盘；首次
  Validator 失败的 job 保持 fail-closed，未发布报告。
- 成功 Attempt 当前最新真实报告为 v3；job 用量为 1 次调用、19,616 tokens、
  43.1 秒。旧 v1/v2 保留，未回填旧 job 的 usage。
- 设计、架构、数据契约、AI 评估、安全运维和任务拆分文档已存在。

## 2. AI 分析在什么时候触发

### 不会触发

- 打开训练列表、训练总览或 AI 诊断页签时不会自动调用模型。
- 训练处于 `queued/waiting_instance/preparing/running/syncing/cleanup/blocked`
  等非终态时不能生成终态报告。
- `MF_AI_ENABLED=false` 时创建接口返回 `503 ai_diagnosis_disabled`，不会创建 job。
- 报告 stale 时只提示，不自动重新生成。
- 打开已有报告只读取不可变快照，不重新采集后覆盖原文。

### 手动触发链路

1. 用户打开终态 Attempt 的“AI 诊断”页签。
2. 前端只请求 `diagnosis/config` 与 `latest`，用于读取开关和已有报告。
3. 用户点击“生成 AI 诊断”。
4. API 校验 AI 已启用且 Attempt 为 `succeeded/failed/cancelled`。
5. API 幂等创建 `queued` job，立即返回 job ID。
6. 独立 Worker 用 `FOR UPDATE SKIP LOCKED` 领取 job，并取得 lease/fencing。
7. 固定图依次执行：

```text
collect → gate → generate → validate → publish
                         ├─ invalid 且未修复 → repair → validate
                         └─ 第二次失败 → fail
```

8. 前端轮询 job；只有 Validator 通过且报告成功发布后，才显示完整报告。
9. 点击“重新生成”会创建新 job 和新不可变 version，不覆盖旧报告。

### 触发边界

- AI 是 advisory 诊断层，不决定硬门禁。
- GateEngine 先于模型计算训练健康度和可交付性。
- 模型没有 SQL、Shell、HTTP、浏览器、文件或训练提交工具。
- 没有当前 Adapter 的独立推理验收时，可交付性固定为
  `artifact_deliverable_model_unverified`。

## 3. 技术结论

选择：

- `LangGraph 1.2.20`：固定 StateGraph、条件边、checkpoint 恢复。
- `langchain-openai 1.7.4`：`ChatOpenAI.with_structured_output(CandidateReport)`。
- `langgraph-checkpoint-postgres 3.2.0`：仅保存短期工作流 checkpoint。

不选择通用 Agent 框架的原因：

- 业务链路是固定 DAG，不需要模型自主规划、调用工具或动态循环。
- 报告内容必须受 GateEngine、Validator、lease/fencing 和不可变报告约束。
- 允许模型选工具会扩大权限、审计面和失败面。
- checkpoint 不是业务真相；job/evidence/report 仍由 PostgreSQL 业务表保存。
- 通用 Agent 编排不能证明 Gate 正确、数字忠实或证据引用有效。

可理解的替代：

- 普通 Python 顺序函数足以执行单机固定流程，但恢复、节点状态和条件边需要自建。
- Temporal 适合更重的持久化编排，但当前本地单 Worker 引入成本过高。
- CrewAI/AutoGen/通用 ReAct Agent 面向开放协作任务，与本功能边界不匹配。
- LangGraph 只承担受控编排，不把它包装成“自主 Agent”。

## 4. AI 评估方案

### 分层门禁

| 层级 | 评估对象 | 是否调用模型 | 通过条件 |
|---|---|---:|---|
| L0 | Pydantic 契约、数字正则、草稿字段白名单 | 否 | 单测全部通过 |
| L1 | EvidenceCollector + GateEngine 真实/夹具 | 否 | 固定双结论；不伪造缺失值 |
| L2 | LangGraph 固定拓扑、Validator、repair/fail | Fake | 只能 publish 一次；Gate 不可改写 |
| L3 | PostgreSQL job/lease/report + PostgresSaver | 否 | 迁移、不可变、checkpoint 读写通过 |
| L4 | 真实 ChatOpenAI 结构化生成 | 是 | 黄金集与自动断言通过 |
| L5 | 人工 Rubric、可读性与行动建议 | 是 | 双人复核，不允许阻断级错误 |

### 自动断言

- Gate 一致性：报告 health/delivery 与 GateResult 完全一致。
- 证据引用：每个 Evidence ID 存在且支持对应 claim。
- 数字忠实：正文数字必须能在冻结证据中找到。
- 缺失表达：缺失、不可读、未到达不能写成 0 或“正常”。
- 禁止表达：不得声称“模型可用”“生产可用”“推理验收通过”无匹配证据。
- 可交付性：Trial ready 不能升级；Adapter available 不能升级为模型可用。
- 失败复盘：失败/取消不能生成伪 Loss 或已确认根因。
- 发布安全：敏感信息、DSN、API Key、日志秘密不得进入报告。
- 恢复安全：旧 fencing token、过期 lease、重复 publish 必须拒绝。

### 黄金集

至少覆盖：

1. 成功但只有 1 个 Eval 点。
2. 成功且 Best/Final 完整、无当前 Adapter 推理验收。
3. 成功且存在匹配的独立验收。
4. Adapter 只完成 1/2。
5. 失败且只有 provisioning 错误码。
6. 取消但仍有 runtime 和 manifest。
7. metrics 读取失败与 metrics 真的为 0 的区分。
8. 日志缺口与日志不可读的区分。
9. GPU 显存采样错误。
10. runtime mismatch。
11. stale 来源变化。
12. Prompt injection 日志。
13. 结构化输出非法与一次修复成功。
14. 第二次修复失败，必须 fail closed。

### 指标

- `gate_consistency = 100%`。
- `unknown_evidence_id = 0`。
- `unsupported_number = 0`。
- `forbidden_claim = 0`。
- 缺失证据 case 的诚实表达率 = 100%。
- Validator 拒绝可解释率、repair 成功率、publish 幂等率。
- 模型延迟 p95、超时率、429 率、单报告 token/费用。
- 人工 Rubric：事实性、证据可追溯性、建议可执行性、边界表达、可读性。

## 5. 真实证据结果

### 成功 Attempt

`fbc8a03d-27e3-4ef2-8253-c23ac8a599ac`

- 22 Train / 1 Eval / 22 learning_rate。
- 最新 Eval Loss：`0.2147834300994873 @ step 22`。
- Best/Final Adapter：`2/2 available`。
- Token 预检、runtime、显存、manifest、日志均可读。
- 当前 Adapter 推理 Trial：0；独立推理验收：0。
- Gate：`health=partial`、`delivery=artifact_deliverable_model_unverified`。
- 真实报告 v1：`104ea3a9-8c7e-45f0-be2d-003fec5db0e6`
  （job `7e61cff4-8012-4262-94a9-fe366136d8d9`）。
- 真实报告 v2：`5652d20e-ad8c-4f29-8646-862af83c3552`
  （job `82d6e219-3a46-4bf8-8abf-568c39a1086b`）。
- 真实报告 v3/latest：`15b7a89d-12fb-444c-b75b-47e9461deb27`
  （job `377b3f5a-2040-46d8-9972-0dc6247d442f`，prompt v3，
  health=`partial`，delivery=`artifact_deliverable_model_unverified`，
  8 条 findings / 5 条 limitations）。
- v3 job usage：1 次调用，prompt 10,716、completion 8,900、total 19,616
  tokens，latency 43,073 ms；`cost_estimate=null`。
- 首次校验失败 job：`1837c4cf-18da-4c57-8e4e-5d631f9c47e6`，
  `error_code=diagnosis_validation_failed`，无报告发布。

### 失败 Attempt

`f3801f77-48e1-4b30-b6f3-5448f4a7bb4f`

- `error_code=bootstrap_key_install_failed`。
- metrics、token preflight、runtime、manifest、logs 缺失。
- Gate：`health=unknown`、`delivery=not_deliverable`。
- 只能做有限复盘，不能把错误码写成已确认根因。
- 真实报告：`0b569dbe-7706-4e8d-bc8a-b351eafc4727`
  （job `1da14b71-4e3b-48ef-80b7-cec46054ec9b`，version 1，limited）。

### 取消 Attempt

`4caec70d-eb19-445f-8b08-97fdec64276d`

- metrics 缺失；runtime 与 manifest 可读；无 Adapter。
- Gate：`health=unknown`、`delivery=not_deliverable`。
- 不能把取消表述为训练失败或低质量。

## 6. 当前验证

| 项目 | 结果 |
|---|---|
| 服务启动与诊断模块导入 | 通过（API/Worker healthy，定向测试可导入） |
| Alembic | `0020_diagnosis_usage (head)` |
| 业务表 | 3 张已创建 |
| 独立推理验收表 | `training_inference_acceptance` 已创建，当前 0 行 |
| 独立推理验收 API | GET/POST 已进入 OpenAPI；只允许人工显式记录 |
| LangGraph checkpoint 表 | 4 张已创建 |
| 报告不可变 trigger | 已创建 |
| 诊断 + 独立验收测试 | 23 passed, 1 skipped |
| 黄金集 fixture | 18/18 通过；negative probe 9/9 |
| 真实 DeepSeek smoke | 4/4 final；3/4 first-pass；1 次 repair 成功 |
| 前端测试 | 96/96 通过 |
| 前端生产构建 | 通过，108 modules |
| 真实成功报告发布 | v1/v2/v3 已发布，当前 latest v3；usage 可读 |
| 真实失败报告发布 | limited v1 已发布 |
| 报告不可变 trigger | 更新被拒绝：`Published diagnosis reports are immutable` |
| 真实三 Attempt 证据采集 | 通过 |
| PostgresSaver 写读清理 smoke | 通过 |
| AI 关闭态创建接口 | `503 ai_diagnosis_disabled`，job 数保持 0 |
| 实施页 1440 / 390 | 无文档级横向溢出；v3 页面截图已更新到 `qa/` |
| 页面控制台 | console error / window error / rejection = 0 / 0 / 0 |
| 严重度筛选 | “需关注”从 8 条变为 3 条，移动端可操作 |
| 复制交互 | 摘要“已复制摘要”；配置草稿“已复制” |
| 完整后端回归 | 368 passed / 207 skipped / 1 failed；失败为既有 UCloud 配置测试隔离问题 |
| 独立推理验收 | 未执行 |
| 云 GPU / 云实例 | 未调用 |

## 7. 已知限制

- Validator 的数字忠实度采用保守白名单，可能误拒绝合理派生数字，需要用黄金集校准。
- stale 判定覆盖 Attempt 快照、metrics/runtime/manifest、Adapter、Trial 与验收来源；
  尚未注入真实来源变化进行端到端报告版本测试。
- checkpoint 与业务表当前共用 PostgreSQL；生产化时应评估独立最小权限角色。
- 真实模型只完成 4 个黄金场景 smoke；尚未完成 18 场景真实稳定性、多样本重复、
  人评 Rubric、429/超时/并发稳定性和费用统计。
- 独立推理验收 schema/API 已实现，但没有真实 Trial 和人工验收记录，不能据此宣称
  模型可用或推理验收通过。
- 当前 Adapter 没有独立推理验收，不能把 Adapter available 或 AI 报告写成模型可用。
- 还没完成屏幕阅读器、200% zoom、forced-colors 和真实移动设备验收。
- 本页所有结果均来自本地实现与测试，不代表生产可用或模型质量验收通过。
