# Serving / 推理试用 F1.1 生产化文档包

Status: implemented-local / browser-verified / real-gpu-verified  
Date: 2026-11-04  
Target: ModelForge「推理试用 / Serving」

## 当前结论

- 生产主路径：F1.1「队列 + 会话 + 运行事实」工作台。
- P0 已落实正式前端与只读后端投影；F2/F3 仍延后为独立增强。
- 回收回执读取现有 GPU 租约事实，不新增数据库迁移。
- 前端 69/69 单测、生产构建、Serving 后端 14 项测试通过。
- 1440 / 1024 / 768 / 390 真实浏览器验收通过。
- 创建弹层下拉的 dialog top-layer 遮挡已修复，并完成共享控件同类问题审计。
- 精确 4090 库存恢复后，真实 GPU 新闭环已通过：正式 Trial、SSE、停止、删除和租约释放均有证据。

## 当前状态

本目录同时保留执行计划、规格、验收标准和实施记录。

- 已修改 Serving 正式前后端代码。
- 未新增数据库迁移。
- 未修改 Worker 状态机。
- 本轮创建并已删除付费实例 `<redacted-instance-id>`；Provider 精确 ID 查询为 0。
- 本轮 Trial `da4dfd18-bff6-4064-9998-2ff882610405` 已完成真实 SSE 与四项回收事实。
- 未提交 Git、未推送、未部署。

本计划的视觉和交互依据是：

- `../index.html` 及三套 Serving 原型。
- 真实 Serving 源文件：`frontend/src/features/serving/Serving.tsx`。
- 真实接口和生命周期：`backend/src/modelforge/modules/serving/routes.py`、`use_cases.py`。
- 真实 GPU 租约事实：`backend/migrations/versions/0009_gpu_leases.py`。
- 当前项目约束：`../../../../AGENTS.md`、`docs/PROJECT_STRUCTURE.md`、`docs/agents/review-policy.md`。

## 已确定决策

1. **F1 合并版是唯一生产主方案**，不继续并行三套视觉实现。
2. 主结构采用 F1 的“队列 + 会话 + 运行事实”工作台。
3. 吸收 F2 的固定业务问题和验收意识，但不在 P0 实现人工评级持久化。
4. 吸收 F3 的进程退出、实例删除、租约释放事实，但不采用整站深色主题。
5. 创建 Trial 改为弹层，实例配置采用基础项与高级项分层。
6. Trial 使用 URL query 深链，路由形式沿用训练页的 `location.search + #serving` 模式。
7. 生命周期、请求状态和停止标记统一派生为用户可执行状态，不在界面上分别暴露原始枚举。
8. 回收回执优先使用只读接口投影；P0 不新增数据库迁移，不修改 Worker 状态机。
9. 会话继续只保存在当前页面；刷新或离开后清空。
10. 不新增 UI 框架、状态管理库或 Playwright 产品依赖。

## 文档索引

| 文档 | 作用 |
|---|---|
| `01-execution-plan.md` | 阶段、依赖、里程碑、验收门和停止条件 |
| `02-product-ux-spec.md` | 目标用户、信息架构、页面流程、状态和交互规格 |
| `03-technical-design.md` | 前端结构、路由、状态模型、API 与后端只读回执设计 |
| `04-visual-system.md` | 布局、颜色、字体、组件、响应式和无障碍规范 |
| `05-acceptance-plan.md` | 测试矩阵、证据等级、验收命令和关闭规则 |
| `06-ticket-backlog.md` | P0/P1/P2 票据、文件白名单、依赖和完成条件 |
| `07-agent-handoff.md` | 可直接交给其他开发代理的提示词和执行顺序 |
| `08-risks-decisions.md` | 风险、假设、未决项和回滚策略 |
| `09-implementation-record.md` | 实际代码、测试、浏览器证据、GPU 阻塞与后续门 |
| `10-select-control-audit.md` | 下拉遮挡根因、修复、同类控件审计与剩余统一边界 |
| `11-live-serving-gpu-acceptance.md` | 真实 GPU、SSE、停止、Provider 与数据库回收验收 |

## 事实边界

本计划中的“成功回收”“回执”“移动端适配”“可访问性通过”等词，只有在对应证据实际取得后才能用于验收结论。

| 层级 | 本文允许的表达 | 不允许的表达 |
|---|---|---|
| 设计原型 | 可交互原型、模拟状态 | 已实现生产功能 |
| 前端自动化 | 单元/构建验证通过 | 已完成真实业务闭环 |
| 浏览器检查 | 指定视口和流程通过 | 全平台兼容 |
| 后端 API | 合同测试/隔离服务通过 | 真实 GPU 已验证 |
| 真实 GPU | 单独记录模型、实例、时间和回收证据 | 用前端模拟推断 |

## 验收门

当前已完成：

1. 正式 React 工作台与响应式实现。
2. 前端单测、构建与 Serving 后端测试。
3. 真实浏览器状态、失败恢复、焦点和控制台检查。
4. 证据归档与票据关闭。
5. 精确 4090 实例、真实 SSE、停止与回收硬门。

仍未完成：

1. 修复回收回执将受控终止误写为“进程自然退出”的文案。
2. 生产目标环境部署 smoke test 与跨浏览器回归；当前仍为本地闭环。

真实 GPU 门已完成，详见 `11-live-serving-gpu-acceptance.md`。
