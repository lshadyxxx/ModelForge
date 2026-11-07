# ModelForge engineering workflow

## 项目入口

本文件面向 AI 编码代理；人类贡献者请先读 `CONTRIBUTING.md`。

开始任务时先读 `README.md`、`docs/PROJECT_BRIEF.md`、
`docs/ARCHITECTURE.md`、`docs/TECH_STACK.md` 和 `docs/IMPLEMENTATION_ROADMAP.md`。
这些文档描述规划与已确定边界；实现状态以仓库内容和验证证据为准。领域术语见
`GLOSSARY.md`；产品范围见 `docs/FEATURE_INVENTORY.md`。

设计目录、调整模块或开始实现前，读取 `docs/PROJECT_STRUCTURE.md`，
按其中的职责归属、依赖方向和分阶段创建规则安排代码。

## 架构边界

- 前端：React + TypeScript + Vite。
- 后端：FastAPI；API 与 Worker 分进程运行，共用后端代码。
- PostgreSQL 保存业务元数据、任务状态和资源租约；首期通过任务表领取任务。
- MinIO 保存正式数据集、用户上传/模型平台导入的模型文件和训练产物；优云公共基础模型采用外部只读引用，不要求复制入库，见 `docs/adr/0002-external-readonly-base-models.md`。训练与独立推理必须核对同一基座内容指纹。
- 本地磁盘只用于临时工作目录和可重建缓存。
- 首版仅个人本机访问，控制面仅绑定回环地址，不做登录；云凭据仅后端环境配置注入，不开放无鉴权的云推理入口。
- 本地控制面采用 Docker Compose；首期单平台 Worker、单 GPU。产品首版接入优云智算的资源查询、远程训练、权重回传及推理试用，范围见 `docs/adr/0001-ucompshare-remote-execution.md`。
- Redis、Kubernetes、多 Worker、其他云厂商和跨实例集群调度不进入首期；优云具体执行与实例回收策略仍须按产品规格收敛。
- 架构变更须先明确提出并获得用户确认，再更新相关决策文档。

## 工作与审查

开始实现前，读取目标本地 spec 和 ticket，明确范围、依赖及验收条件。
实现与验收遵循 `docs/agents/review-policy.md`。
所有工程操作限于 ModelForge。
远程 Issues、push、PR、发布和部署均须另获维护者明确授权。

## Agent skills

### Issue tracker

公开问题和任务使用 GitHub Issues；本地临时材料放在被 Git 忽略的 `.scratch/`。
See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认的七个标签角色映射。
See `docs/agents/triage-labels.md`.

### Domain docs

single-context；`GLOSSARY.md` 与 `docs/adr/` 按需创建。
See `docs/agents/domain.md`.

### External peers

host-only；审查使用当前宿主原生能力。
See `docs/agents/cross-model.json`.

## 本机浏览器控制边界

页面验收只允许使用已验证隔离、不会激活系统窗口或抢占桌面焦点的浏览器驱动。仅有“后台”标记或页面级 API 不构成隔离证明；驱动未提供并验证此保证时，停止浏览器验收，改用代码、HTTP 与自动化测试并记录缺口。

禁止调用 `Page.bringToFront`、`Browser.setWindowBounds`、窗口置前/切换/调整、全局鼠标键盘或桌面坐标输入。禁止通过恢复旧脚本或换浏览器入口绕过本约束。遇到前台文件选择、权限提示或用户正在操作时，停止该浏览器步骤，不重试、不路由到其他 GUI 控制器。
