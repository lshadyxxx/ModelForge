# ModelForge AI 训练诊断
## 实施规划索引

状态：单运行诊断与历史对比本地实现已落地；黄金集、人评与生产验收待执行
日期：2026-11-07（初版：2026-11-06）  
范围：单次训练终态 Attempt 的 AI 智能诊断报告与失败复盘  
当前状态：本地纵向切片与历史对比完成；DeepSeek 单例契约、成功/失败报告发布通过；
未提交、未推送、未部署

## 1. 本轮规划产出

本目录中的文档分为三类：

1. 已完成的设计探索与原型证据；
2. 已落到正式代码边界的本地纵向切片说明；
3. 可直接转成后续 task 和验收门禁的规划文档。

规划阶段没有安装依赖、创建数据库表、修改正式代码、启动真实模型或提交 Git。
用户随后明确启动实施：已在工作区完成依赖接线、诊断业务表、后端模块、A v2 页签、
LangGraph/PostgresSaver、定向测试、真实模型单例契约和成功/失败报告发布；仍未提交
Git、未部署、未调用云 GPU。准确证据见
[REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

## 2. 已冻结的产品与技术决策

| 决策 | 结论 |
|---|---|
| UI 基线 | A v2「专业诊断信号台」，吸收 B 的结论摘要和 C 的证据检查器 |
| 诊断范围 | 单次训练终态 Attempt + 失败/证据不足复盘 |
| AI 定位 | advisory 诊断层，不替代硬门禁 |
| 编排 | LangGraph 1.2.20 固定 StateGraph |
| 模型适配 | `langchain-openai` 1.7.4 + `ChatOpenAI.with_structured_output` |
| 工作流恢复 | `langgraph-checkpoint-postgres` 3.2.0 的 `PostgresSaver` |
| 业务真相 | PostgreSQL 的 job、冻结证据、不可变报告表 |
| 模型权限 | 不注册 SQL、Shell、浏览器、任意 HTTP、文件写入或训练提交工具 |
| 建议执行 | 只生成未提交训练草稿，必须再次经过现有创建流程和兼容性检查 |
| 推理验收 | 独立建模；`inference_trials.state='ready'` 不等于验收通过 |

## 3. 文档地图

| 文档 | 解决的问题 | 状态 |
|---|---|---|
| [LANGGRAPH_ARCHITECTURE_DECISION.md](LANGGRAPH_ARCHITECTURE_DECISION.md) | 为什么选择 LangGraph、`langchain-openai` 和 `PostgresSaver`；备选框架与长期 Agent 边界 | 决策依据 |
| [TECHNICAL_IMPLEMENTATION_CONCLUSION.md](TECHNICAL_IMPLEMENTATION_CONCLUSION.md) | 后端、数据库、API、前端和测试的代码级实现结论 | 技术依据 |
| [DESIGN_DEV_AND_AI_EVAL_PLAN.md](DESIGN_DEV_AND_AI_EVAL_PLAN.md) | 产品范围、信息架构、状态、数据契约与 AI 评估背景 | 产品依据 |
| [DELIVERY_EXECUTION_PLAN.md](DELIVERY_EXECUTION_PLAN.md) | 阶段、里程碑、依赖、退出条件、验证和回滚 | 执行主计划 |
| [SYSTEM_ARCHITECTURE_DESIGN.md](SYSTEM_ARCHITECTURE_DESIGN.md) | 目标系统、模块边界、进程拓扑、时序、状态机与未来 Agent 扩展 | 架构主文档 |
| [DATA_CONTRACT_AND_DB_SPEC.md](DATA_CONTRACT_AND_DB_SPEC.md) | EvidencePack/Report 契约、DDL、索引、租约、fencing、API 和保留策略 | 数据规范 |
| [AI_EVALUATION_ACCEPTANCE.md](AI_EVALUATION_ACCEPTANCE.md) | 黄金集、自动断言、人工 Rubric、指标阈值和发布门禁 | 验收规范 |
| [SECURITY_OPERATIONS_RUNBOOK.md](SECURITY_OPERATIONS_RUNBOOK.md) | Prompt Injection、密钥、checkpoint、监控、故障恢复和回滚 | 安全与运维 |
| [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md) | 可排序的实施 ticket、依赖、建议文件边界和完成条件 | 任务种子 |

### 3.1 历史训练对比规划包（2026-11-08）

状态：**本地实现完成，真实页面验收通过；未提交、未推送、未部署。**

| 文档 | 解决的问题 |
|---|---|
| [historical-comparison-2026-11-08/README.md](historical-comparison-2026-11-08/README.md) | 产品结论、范围、冻结决策和阅读入口 |
| [historical-comparison-2026-11-08/ARCHITECTURE.md](historical-comparison-2026-11-08/ARCHITECTURE.md) | 当前/历史双证据、ComparisonEngine、LangGraph v2 与存储边界 |
| [historical-comparison-2026-11-08/DATA_CONTRACT.md](historical-comparison-2026-11-08/DATA_CONTRACT.md) | EvidencePack v2、Report v2、迁移 0021、候选 API 与错误码 |
| [historical-comparison-2026-11-08/COMPARISON_POLICY_AND_AI_EVAL.md](historical-comparison-2026-11-08/COMPARISON_POLICY_AND_AI_EVAL.md) | Hard Key、参数 diff、训练信号、置信度、Prompt/Validator 与黄金集 |
| [historical-comparison-2026-11-08/UI_UX_SPEC.md](historical-comparison-2026-11-08/UI_UX_SPEC.md) | 基线选择、对比卡、状态、移动端与证据交互 |
| [historical-comparison-2026-11-08/EXECUTION_PLAN.md](historical-comparison-2026-11-08/EXECUTION_PLAN.md) | HC-01 至 HC-09、依赖、文件白名单和交接提示词 |
| [historical-comparison-2026-11-08/TEST_ACCEPTANCE.md](historical-comparison-2026-11-08/TEST_ACCEPTANCE.md) | 后端/前端/数据库/浏览器/AI 黄金集验收 |

该规划不改变已落地的单 Attempt 诊断架构。历史对比只比较训练信号和交付信号；没有同评测集
可比较分数时，`model_effect` 固定为 `unverified`。

准确证据入口：
[historical-comparison-2026-11-08/IMPLEMENTATION_STATUS_2026-11-08.md](historical-comparison-2026-11-08/IMPLEMENTATION_STATUS_2026-11-08.md)。

文档冲突时的优先级：

1. 用户最新明确指令；
2. 仓库 `AGENTS.md` 和已确认架构边界；
3. 本目录 ADR 与数据规范；
4. 执行计划和任务队列；
5. 历史探索记录。

## 4. 推荐阅读顺序

1. 先看 [SYSTEM_ARCHITECTURE_DESIGN.md](SYSTEM_ARCHITECTURE_DESIGN.md) 理解系统边界；
2. 再看 [DATA_CONTRACT_AND_DB_SPEC.md](DATA_CONTRACT_AND_DB_SPEC.md) 理解事实、报告和租约；
3. 用 [DELIVERY_EXECUTION_PLAN.md](DELIVERY_EXECUTION_PLAN.md) 决定执行顺序；
4. 用 [AI_EVALUATION_ACCEPTANCE.md](AI_EVALUATION_ACCEPTANCE.md) 判断何时可以发布；
5. 按 [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md) 创建实际 ticket；
6. 实施与上线前阅读 [SECURITY_OPERATIONS_RUNBOOK.md](SECURITY_OPERATIONS_RUNBOOK.md)。

## 5. 实施授权记录

以下边界已在用户明确启动实施后解除；本文保留原始顺序，作为后续环境或阶段复用的
授权清单：

1. 允许修改 `backend/`、`frontend/`、`backend/migrations/` 和对应测试；
2. 允许在项目容器中安装和锁定指定依赖；
3. 允许在本地 Compose PostgreSQL 创建诊断业务表和 checkpoint schema；
4. 允许调用真实或受控 OpenAI-compatible 模型服务；
5. 允许启动本地 API/Worker 做端到端验证；
6. 是否允许 Git commit、push、部署，必须另行明确。

没有这些命令时，继续保持设计目录边界。

## 6. 配置与启用边界

以下配置不影响本地页面和确定性 Gate；本机受控验收已临时启用真实模型并发布报告，
默认启用策略、黄金集和生产配置仍需单独评审：

| 配置 | 建议默认 | 用途 |
|---|---|---|
| `MF_AI_ENABLED` | `false` | 正式功能总开关 |
| `MF_AI_MODEL` | 由部署环境决定 | `ChatOpenAI` 模型名 |
| `MF_AI_BASE_URL` | 空，使用供应商默认 | OpenAI-compatible 服务地址 |
| `MF_AI_API_KEY` | 只注入环境 | 模型密钥，禁止写入 State 或日志 |
| `MF_AI_STRUCTURED_OUTPUT_METHOD` | `json_schema` | 结构化输出方法 |
| `MF_AI_TIMEOUT_SECONDS` | `25` | 单次模型请求超时 |
| `MF_AI_CHECKPOINT_DSN` | 独立最小权限角色 | `PostgresSaver` 专用连接 |
| `MF_AI_CHECKPOINT_SCHEMA` | `langgraph_checkpoint` | checkpoint 独立 schema |
| `MF_AI_CHECKPOINT_TTL_HOURS` | `24` | 过期 checkpoint 清理 |
| `MF_AI_WORKER_POLL_SECONDS` | `2` | 诊断 worker 轮询间隔 |

不提供真实模型配置时，允许实施到“fake generator + 契约测试”，但不能宣称 AI 生成验收完成。

## 7. 四个不可混淆的完成层级

| 层级 | 说明 | 不能替代 |
|---|---|---|
| 静态设计完成 | 文档、原型、契约和门禁已定义 | 代码实现、真实模型 |
| 软件流程完成 | Fake Generator 驱动 job 全生命周期 | 真实模型质量、真实训练 |
| 真实模型完成 | 单例已通过：`ChatOpenAI` 返回并发布结构化报告；黄金集/人评待完成 | 训练模型业务效果 |
| 训练/推理验收完成 | 当前 Adapter 有独立推理验收证据 | AI 报告质量本身 |

AI 报告只能帮助解释事实，不能证明训练模型有业务价值。

## 8. 已执行的第一组动作

1. 重读仓库 `AGENTS.md`、`docs/IMPLEMENTATION_ROADMAP.md`、`docs/PROJECT_STRUCTURE.md`；
2. 固定本地基准 SHA 和工作区既有修改清单；
3. 创建本地 feature spec 与 issue 文件；
4. 执行 M0 依赖与 Python 3.13 容器 smoke test；
5. 在任何正式代码修改前记录回滚点；
6. 按 [DELIVERY_EXECUTION_PLAN.md](DELIVERY_EXECUTION_PLAN.md) 逐阶段推进。

## 9. 当前结论

系统处于 **Local slice, historical comparison, and real-model single-case
acceptance complete; production evidence pending**：

- 已在本地工作区安装/接线 LangGraph、`langchain-openai` 和 `PostgresSaver`；
- 已创建三张诊断业务表和独立 checkpoint schema；
- 已修改正式前后端代码，但仅限本轮诊断纵向切片；
- A v2 页签、入口卡、状态、证据展开、建议草稿和失败复盘已实现；
- 真实模型单例契约、成功/失败报告发布和不可变 trigger 已通过；
- 当前 Adapter 独立推理验收、黄金集、人评、生产配置和生产部署未执行；
- 历史对比已完成本地实现、1440/390 页面验收和成功/失败真实报告生成；
- 当前 Alembic head 为 `0021_diagnosis_comparison`；
- 未提交 Git、未推送、未部署、未调用云 GPU。

准确状态与测试证据见 [IMPLEMENTATION_STATUS_2026-11-06.md](IMPLEMENTATION_STATUS_2026-11-06.md)。
