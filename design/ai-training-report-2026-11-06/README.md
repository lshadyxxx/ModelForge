# ModelForge AI 智能报告分析 · UI/UX 探索

日期：2026-11-07（初版：2026-11-06）  
范围：设计探索 + 本地 AI 诊断纵向切片；未提交、未推送、未部署、未调用云 GPU。

实施状态：纵向切片已落地。黄金集 fixture 18/18，真实 DeepSeek smoke 覆盖 4 个场景，
成功 Attempt 已发布 v3 报告并显示真实 usage；成功/失败报告的不可变发布、A 方向诊断
页签、LangGraph/PostgresSaver、1440/390 页面与关键交互通过。18 场景真实稳定性、
人工 Rubric、真实独立推理验收、部署和提交仍未完成。详见
`GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md`、
`REAL_MODEL_ACCEPTANCE_2026-11-07.md` 与 `IMPLEMENTATION_STATUS_2026-11-06.md`。

真实页面取证使用 `evidence/*-1440-v2.png` 四个终稿版本；旧的无 `-v2` 图片保留为
历史记录，不作为最终 1440×1000 证据引用。

## 本轮规划包

- 规划总索引：`PLANNING_INDEX.md`
- 实施执行计划：`DELIVERY_EXECUTION_PLAN.md`
- 系统架构设计：`SYSTEM_ARCHITECTURE_DESIGN.md`
- 数据契约与数据库规范：`DATA_CONTRACT_AND_DB_SPEC.md`
- AI 评估与验收：`AI_EVALUATION_ACCEPTANCE.md`
- 安全与运维手册：`SECURITY_OPERATIONS_RUNBOOK.md`
- 实施任务种子：`IMPLEMENTATION_BACKLOG.md`

## 先看什么

- 对比入口：`index.html`
- 设计开发与 AI 评估方案：`DESIGN_DEV_AND_AI_EVAL_PLAN.md`
- 技术方案与代码实现结论：`TECHNICAL_IMPLEMENTATION_CONCLUSION.md`
- LangGraph 架构决策与框架比较：`LANGGRAPH_ARCHITECTURE_DECISION.md`
- 方案 A · 专业诊断信号台（已优化 v2）：`option-a.html?view=report`
- 方案 A 优化前基线：`option-a-baseline.html?view=report`
- 方案 A 空状态：`option-a.html?attempt=4caec70d-eb19-445f-8b08-97fdec64276d&view=empty`
- 方案 B · 教练式训练简报：`option-b.html?view=report`
- 方案 C · 证据审计台：`option-c.html?view=report`
- 失败复盘：将 `attempt` 换成 `f3801f77-48e1-4b30-b6f3-5448f4a7bb4f`
- 无报告状态：将 `attempt` 换成 `4caec70d-eb19-445f-8b08-97fdec64276d`

三套 HTML 均可直接以本地文件打开。相对资源只位于本目录内，不需要安装依赖或启动服务。

技术选型已按用户决策更新为 **LangGraph 1.2.20 + langchain-openai +
langgraph-checkpoint-postgres**：LangGraph 只做固定状态图编排，`ChatOpenAI` 做结构化模型
适配，`PostgresSaver` 只做短期 checkpoint 恢复；checkpoint 使用独立 schema/TTL，不能替代
PostgreSQL job/evidence/report 和租约/fencing。产品名称仍为“AI 智能诊断”，原型页面不展示
框架品牌。

## 方案 A · v2 优化

- 两张结论卡增加直达动作：健康度跳到图表或失败发现，可交付性直达 Adapter 证据。
- 摘要区增加唯一主动作，成功态指向“独立推理验收”，失败态指向“补齐失败上下文”。
- 发现改为可折叠 `details`，默认展开“需关注”项，保留观测预览与证据入口。
- 证据检查器增加完整证据索引，可逐条切换并同步更新来源、字段、样本与边界提示。
- 增加“证据截至”时间与“只读快照 · 不写回 Attempt”边界说明。
- 390px 增加吸顶章节导航；修复证据边界列表逐字换行与 4px 横向溢出。
- 补齐 `view=empty` 直达路由，并在顶栏与侧栏提高辅助文字对比度。
- 优化前版本保留在 `option-a-baseline.html`，便于对照评审。

## 推荐

以 A 的专业诊断骨架作为正式实现基线，吸收 B 的一句人话结论、C 的证据链检查器。

固定双门禁：

1. 训练健康度：部分可判断。22 个 Train/LR 点、仅 1 个 Eval 点；训练内信号可读，泛化趋势无法判断。
2. 可交付性：Best / Final 2/2 `available`；现有推理 Trials 未关联当前 Adapter ID，因此不能写“模型可用”。

## 真实证据

- 成功 Attempt：`fbc8a03d-27e3-4ef2-8253-c23ac8a599ac`
- 失败 Attempt：`f3801f77-48e1-4b30-b6f3-5448f4a7bb4f`，`bootstrap_key_install_failed`，metrics/runtime/manifest/logs 均为空
- 取消 Attempt：`4caec70d-eb19-445f-8b08-97fdec64276d`，metrics 0、runtime 存在、manifest 6 个、无 Adapter
- 运行页面：`http://127.0.0.1:8092/`
- API：`http://127.0.0.1:8102`

当前可用于报告的字段：Attempt snapshot、Train/Eval Loss、learning_rate、token_preflight、runtime_report、GPU 显存峰值、execution_manifest、provisioning 错误码、日志、Best/Final Adapter。

当前不可用：task metric、throughput、gradient norm、逐样本 loss、重复率、语言分布。
独立推理验收 schema/API 已实现，但当前真实验收记录为 0，仍不能得出模型可用结论。

不允许：用 Train/Eval Loss 推断业务效果；把 Adapter `available` 写成推理 ready 或模型可用；用缺失字段替代 0；把失败错误码写成根因。

## 文件

- `shared/prototype-data.js`：三套原型共用的原型示例数据与真实证据边界
- `shared/prototype-core.js`：对话框、复制、提示和图表辅助
- `shared/base.css`：ModelForge 共用底色、字号、状态与组件语言
- `LANGGRAPH_ARCHITECTURE_DECISION.md`：LangGraph ADR、框架比较、租约、测试与未来 Agent 分层
- `GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md`：18 场景夹具、4 场景真实
  smoke、usage、独立推理验收与 v3 页面证据
- `evidence/`：5 张真实训练页面截图
- `screenshots/`：三套原型、对比首页、失败/空/加载/有限复盘状态、移动端与交互截图
- `qa/v3-report-*.png`：最新真实 v3 报告、发现、证据、移动端与筛选截图
- `screenshots/implementation-ai-report-*-20261107.png`：正式实现页的真实 AI 报告入口、
  成功报告、筛选、证据、草稿、失败复盘、空状态与移动端截图
- `qa/round-01.mjs` 至 `round-10.mjs`：真实页面取证、原型截图和交互回归脚本
- `qa/ego-ai-report-02-capture.mjs`：正式实现页真实报告截图与交互回归
- `qa/interaction-report.json`：筛选、证据、草稿、重新生成、复制和 Attempt 切换结果
- `qa/round-10-result.json`：A v2、首页桌面/移动端、空/加载/有限复盘状态回归结果

## 验证记录

- 1440 与 390：三套原型、对比首页均无文档级横向溢出
- 浏览器控制台：A/B/C 与首页均无错误
- 真实训练页：概览、运行分析、产物、失败页已重拍为 1440×1000
- 正式实现页：AI 入口、成功 v3 报告、usage、严重度筛选、证据展开、建议草稿和失败
  复盘均使用真实服务证据；v3 桌面 `1440×1007`，移动 `390×844`
- A v2 首页：正确显示“已优化 · v2”与“优化前基线”入口，图片无破图
- A v2 状态：空报告可直接打开；生成中、有限复盘、失败复盘均可独立展示
- 三套方案：8 条发现可筛到 2 条“需关注”
- 应用建议：只显示草稿对话框；确认后提示未提交、未创建 GPU
- 重新生成：进入加载态并返回报告
- Attempt 切换：成功记录可切换至失败记录
- C 取消记录：可生成“有限复盘”，不会生成伪 Loss
- 实施增量：长模型调用心跳续租、独立 diagnosis 轮询、共享诊断状态、
  剪贴板失败兜底
- 黄金集 fixture：18/18；9/9 negative probe 被拒绝
- 真实模型：DeepSeek `deepseek-flash` 4 场景 smoke 最终 4/4；first-pass 3/4，
  1 次 repair 成功；5 次调用、77,209 tokens、234.9 秒
- 真实成功报告：v1 `104ea3a9-8c7e-45f0-be2d-003fec5db0e6`，
  v2 `5652d20e-ad8c-4f29-8646-862af83c3552`，latest v3
  `15b7a89d-12fb-444c-b75b-47e9461deb27`
- v3 usage：1 次调用、19,616 tokens、43.1 秒；`cost_estimate=null`
- 真实失败报告：`0b569dbe-7706-4e8d-bc8a-b351eafc4727`（limited）
- 报告不可变：更新已被 PostgreSQL trigger 拒绝
- 页面 console error / window error / rejection：`0 / 0 / 0`
- 复制摘要与复制配置草稿：均显示“已复制”
- 前端：96/96 测试通过，生产构建 108 modules 通过
- 诊断 + 独立验收测试：23 passed, 1 skipped
- Alembic：`0020_diagnosis_usage (head)`；独立推理验收表 0 行

## 未验证

- 18 场景真实模型稳定性、多样本重复、人工 Rubric、429/超时/并发和费用统计
- 生产环境权限、密钥托管、真实用户发布审计
- 当前 Adapter 的独立推理验收与业务效果
- 屏幕阅读器、200% zoom、forced colors、真实设备触摸
- 云 GPU/云实例、部署、Git 提交与推送

最新本地纵向切片与真实模型证据见
`GOLDEN_EVAL_AND_INFERENCE_ACCEPTANCE_2026-11-07.md`：迁移、诊断模块、A v3 页签、
PostgresSaver smoke、黄金集 fixture、4 场景真实 smoke、成功/失败报告发布、
`23 passed / 1 skipped` 定向后端和 `96/96` 前端测试通过；这些结果不等于 18 场景
真实稳定性、推理验收、部署或生产可用。
