# ModelForge 训练模块 UI 重设计

> 状态：**设计探索与静态高保真原型**
> 日期：2026-11-03
> 范围：仅训练模块，不修改生产业务代码
> 推荐方向：**B2 · 训练工作台（在 B 的信息架构上统一 ModelForge 视觉语言）**

## 先看什么

1. [B2 可交互原型](./b2-forge.html)：直接评审训练工作台、新建训练与运行详情。
2. [B2 工作台效果图](./review/b2/overview-1440.png)：1440px 实际渲染截图。
3. [预览门户](./index.html)：推荐方案、B2 / A / C 入口和交付文件。
4. [设计报告](./DESIGN_REPORT.md)：现状诊断、B2 优化依据、token、组件拆分和前端落地步骤。
5. [三方向同屏对比](./compare.html)：保留 A / B / C 的原始方向对照。

## 可交互原型

| 方向 | 原型 | 核心重心 |
|---|---|---|
| **B2 · 训练工作台（推荐）** | [b2-forge.html](./b2-forge.html) | 保留 B 的运行主舞台、生命周期、账本和产物门禁；接回 ModelForge 左侧导航、白底工作区、系统无衬线与蓝色主操作 |
| A · 运行控制墙 | [a-console.html](./a-console.html) | 异常、门禁、日志和实例成本优先 |
| B · 铸程台（改造前对照） | [b-forge.html](./b-forge.html) | 原始生命周期、真实曲线和 Best / Final 出品门；保留用于比较 B2 的统一化改动 |
| C · 证据画布 | [c-lab.html](./c-lab.html) | 曲线、运行索引和配置证据 |

本地打开原型时，可直接使用文件路径；也可在仓库根目录启动静态服务：

```powershell
python -m http.server 4312 --bind 127.0.0.1 --directory design/model-forge-training-redesign
```

然后访问 `http://127.0.0.1:4312/index.html`。

## 原型交互

- 训练总览：任务筛选、搜索、选择 Attempt、查看当日运行与待处理事项。
- 新建训练：四步流程、输入选择、兼容边界、锁定参数、确认提交。
- 提交确认：显示冻结输入、手动实例边界与“平台不代买”说明。
- 运行详情：总览、运行分析、实时日志、Checkpoint / 产物、冻结输入五个页签。
- 运行分析：学习率调度、梯度范数、显存占用、数据吞吐四张诊断图，以及按 step 排序的关键事件。
- 日志工具：级别筛选、文本搜索、跟随最新提示、空/缺口说明。
- 安全取消：确认弹窗、进程退出 / 实例回收 / 租约释放的状态边界。
- 产物门禁：训练中未发布、成功后 Best + Final 2/2 可用两种状态。
- 失败 / 排队 / 取消 / 空结果 / 成功状态在总览账本中并列可识别。

所有交互均为静态演示；不会请求训练 API，不会触发 GPU，也不会读写数据库或 MinIO。

## 截图索引

### 当前真实页面

- [训练总览与长页面](./review/current/training-overview-1440.png)
- [选中 Attempt 后的详情堆叠](./review/current/training-detail-1440.png)

当前截图使用**真实 `Training.tsx` 页面 + mock `/api/v1` 响应**渲染，不连接后端。

### A · 运行控制墙

- [总览](./review/a/overview-1440.png)
- [运行详情](./review/a/detail-overview-1440.png)
- [创建页](./review/a/create-input-1440.png)
- [日志页](./review/a/detail-logs-1440.png)
- [成功产物页](./review/a/detail-succeeded-artifacts-1440.png)

### B2 · 训练工作台（推荐）

- [总览 1440](./review/b2/overview-1440.png)
- [新建训练](./review/b2/create-input-1440.png)
- [表单校验错误](./review/b2/create-validation-error-1440.png)
- [提交确认模态框](./review/b2/submit-modal-1440.png)
- [运行详情](./review/b2/detail-overview-1440.png)
- [运行分析](./review/b2/detail-analysis-1440.png)
- [运行分析 390](./review/b2/detail-analysis-390.png)
- [Loss 图表特写](./review/b2/loss-chart-final-1440.png)
- [实时日志](./review/b2/detail-logs-1440.png)
- [成功产物页](./review/b2/detail-succeeded-artifacts-1440.png)
- [总览 1280](./review/b2/overview-1280.png)
- [窄屏 390](./review/b2/overview-390.png)
- [Ego 实际打开验收](./review/b2/ego-b2-final-live.png)

### B · 铸程台（原始对照）

- [总览 1440](./review/b/overview-1440.png)
- [总览 1280](./review/b/overview-1280.png)
- [运行详情](./review/b/detail-overview-1440.png)
- [创建页](./review/b/create-input-1440.png)
- [表单校验错误](./review/b/create-validation-error-1440.png)
- [提交确认模态框](./review/b/submit-modal-1440.png)
- [日志页](./review/b/detail-logs-1440.png)
- [成功产物页](./review/b/detail-succeeded-artifacts-1440.png)
- [窄屏 390](./review/b/overview-390.png)

### C · 证据画布

- [总览](./review/c/overview-1440.png)
- [运行详情](./review/c/detail-overview-1440.png)
- [创建页](./review/c/create-input-1440.png)
- [日志页](./review/c/detail-logs-1440.png)
- [成功产物页](./review/c/detail-succeeded-artifacts-1440.png)

### 对比与验收

- [三方向同屏对比图](./review/compare/three-directions-overview.png)
- [预览门户整页](./review/portal/preview-portal-1440.png)
- [自动渲染与交互验收记录](./review/render-report.json)

## 实际验证

- 在 1440px 与 1280px 桌面宽度实际打开并截图。
- 在 390px 窄屏实际检查 B2 总览、创建页和详情页布局；B2 文档宽度始终等于视口宽度，表格没有内部横向溢出。
- 全部检查页面无整页横向溢出。
- 浏览器控制台与页面运行错误为 0。
- 实际走通四步创建、提交确认、进入等待实例、安全取消弹窗和日志筛选。
- B2 实机检查了左侧导航与白底工作区、当前 Run 主舞台、浅色表单、统一按钮、表格行高与状态色。
- B2 的成功态生命周期已经使用完成时间，不再同时出现“已成功”和“进行中 / 待完成”的矛盾文案。
- 实际打开 B / C 的运行页签，修复了曲线重复和日志组件缺样式的问题。
- 功能性文字以 11px、段落/列表以 12px 为原型下限；正式实现应直接落入 CSS token。
- 表单错误汇总会获得焦点，字段同步设置 `aria-invalid` 与 `aria-describedby`；模态框支持 `inert` 背景、Tab 焦点循环、Escape 关闭与焦点恢复。
- `audit-ui.mjs` 确认 A / B / C 没有低于 11px 的实际文字节点，所有段落/列表不低于 12px；B 的 390px 账本无内部横向溢出。
- `audit-ui.mjs` 同时确认 B2 在 390px 下文档、表格和创建布局均无横向溢出。
- `impeccable detect` 对 B2 HTML 与 CSS 最终返回 0 findings。

上述检查是原型级渲染与交互验收，不等同于生产 WCAG 认证；真实字号、对比度、200% 缩放、长日志虚拟化和屏幕阅读器仍需在前端实现阶段复验。

详细结果与限制见 [DESIGN_REPORT.md](./DESIGN_REPORT.md)。

## 边界

- 未修改 `frontend/src`、后端、数据库迁移、MinIO 或生产配置。
- 未启动真实训练任务，未消耗 GPU，未调用真实模型。
- 原型中的运行编号、指标、Loss、Checkpoint 和 Adapter 名称均为合理示例数据。
- 设计报告中的接口建议和数据字段仍需后端契约确认，不代表已实现。
