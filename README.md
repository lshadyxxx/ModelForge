# ModelForge

ModelForge（模锻）是一个独立规划中的模型训练与推理平台，目标是把数据集、微调任务、模型产物和推理服务放进一条可追踪的生命周期中。

当前状态（2026-11-05）：核心 MVP 已在一个受支持组合上完成平台托管训练的真实闭环，同时保留原有手动实例路径。A′ 路线使用基础镜像、安全首启和冷安装 runtime，真实完成了 Qwen3-0.6B、单卡 RTX 4090 的 SFT/LoRA：Attempt `6b330374-7fff-4ac2-9104-4f3909045e0b` 运行 22 step，最终 `eval_loss=0.214783`；12 个执行证据文件经 MinIO 读回 SHA-256 全部一致，Best/Final Adapter 均为 `available` 并通过下载包级校验；实例 `<redacted-instance-id>` 已停止、删除并二次精确查询为空，租约 `092392a1-6626-4561-95b4-0fed21476b0f` 在删除确认后释放。A′ 训练主页、详情页和产物页已在 1440/390 宽度完成真实 API 截图核对，无横向溢出或浏览器运行时错误。B「预构建 Training Base」镜像 `compshareImage-1xc89j1np56m`（`Custom` / `Available`）随后通过第二次正式 managed Attempt `fbc8a03d-27e3-4ef2-8253-c23ac8a599ac` 完成 22 step SFT/LoRA、Best/Final Adapter、12/12 MinIO 读回、实例删除和租约释放；第一次 Attempt 的瞬态公钥首启失败已单列并完成有限重试修复。整体结论仍为 `PASS_WITH_LIMITATIONS`：scheduler 到期实际自动关机未单独等待验证，供应商 `ResetCompShareInstancePassword` 在当前基础镜像路径返回 `cloud_api_error`，实际安全结果由“锁定系统密码并验证旧密码认证失败”实现，不能表述为供应商 reset 成功；B 根密码快照硬化、多实例首启矩阵和实际账单仍未验证。验收后 `MF_UCLOUD_WRITE_ENABLED` 已恢复为 `false`，当前计算环境写入为 `read_only`。基线 `qwen3-0.6b-rtx4090-cn-bj2-partial-20261102-r1` 的容量边界和更广模型/GPU/镜像兼容矩阵仍未完成，因此基线继续保持 `partial`。详见[托管训练真实验收记录](docs/implementation/training-oneclick-p1-20261105.md)、[B 完整验收记录](<internal-evidence>)、[数据集审阅工作室记录](docs/implementation/datasets-review-studio-2026-11-03.md)、[模型验证工作室记录](docs/implementation/model-validation-studio-2026-11-03.md)、[Adapter 导出记录](docs/implementation/adapter-export-2026-11-03.md)、[运行时兼容记录](docs/implementation/runtime-compatibility-2026-11-02.md)及[运行说明](docs/RUNNING.md)。

## 产品目标

- 管理训练数据集及其校验、版本和发布状态。
- 创建、排队、监控和取消模型微调任务。
- 追踪基础模型、训练配置、数据集版本和 Adapter 等模型产物之间的关系。
- 将已完成的模型产物部署为推理服务，并提供调用与健康状态检查。
- 记录资源使用和任务失败原因，避免把“任务完成”“产物可用”和“服务就绪”混为一谈。

## 初期边界

- 产品首版终点是在平台内加载真实训练产物并完成推理试用；本地控制面和任务底座是前置里程碑，底座或模拟流程不代表产品 MVP 完成。
- MVP 训练范围已确定为文本 SFT＋LoRA，并接入优云智算的远程训练、权重回传和平台内推理试用；QLoRA、DPO、全参数训练、视觉/多模态和其他云厂商后续按需求加入。
- 训练和推理运行时通过明确的执行器接口接入，平台 API 不直接承担重量级模型进程。
- 项目按自身需求定义模块、数据模型、接口和实现。

## 拟议技术栈

- Web：React、TypeScript、Vite 单页应用；由静态 Web 服务器托管，通过同源代理访问 FastAPI。
- API：Python、FastAPI、Pydantic。
- 元数据与任务状态：统一使用 PostgreSQL；本地和部署环境不维护第二套数据库后端。
- 文件存储：从第一阶段直接使用 MinIO，保存数据集、用户上传/模型平台导入的模型、Adapter 和需持久保留的训练产物；优云公共基础模型按已核对内容指纹直接读取外部目录，不要求复制入库。本地磁盘仅用于临时工作目录和可重建缓存。
- 训练：文本 SFT＋LoRA；训练后端在实现阶段通过兼容验证确定，训练页从真实优云目录选择模型/GPU/镜像，不在产品规格中固定单一型号。
- 推理：以 vLLM 作为首选服务运行时，通过独立生命周期管理器启动和监控。
- 开发和本地控制面运行：Docker Compose；首期单平台 Worker、单 GPU，云端执行接入优云智算，暂不引入 Redis 和 Kubernetes。

React + Vite、FastAPI、PostgreSQL 与 MinIO 是已确定的架构选型，本地开发通过 Docker Compose 提供 PostgreSQL 与 MinIO。第一批版本、Alembic迁移、对象存储配置已记录在运行文档；备份恢复后续收敛，启动配置已生成；真实存储服务验收状态以实施记录为准。

## 文档

- [项目简述](docs/PROJECT_BRIEF.md)
- [功能清单与 UI 调研入口](docs/FEATURE_INVENTORY.md)
- [产品 MVP 规格（范围已确认）](<internal-evidence>)
- [产品 MVP 连续流程原型](designs/modelforge-mvp/index.html)
- [原型预览说明与检查记录](designs/modelforge-mvp/README.md)
- [产品 MVP 本地实现任务](<internal-evidence>)
- [优云远程执行范围决策](docs/adr/0001-ucompshare-remote-execution.md)
- [公共基座外部只读引用决策](docs/adr/0002-external-readonly-base-models.md)
- [托管训练一键化真实验收记录（2026-11-05）](docs/implementation/training-oneclick-p1-20261105.md)
- [领域术语](GLOSSARY.md)
- [运行架构与数据归属](docs/ARCHITECTURE.md)
- [项目结构与模块设计](docs/PROJECT_STRUCTURE.md)
- [技术栈决策](docs/TECH_STACK.md)
- [阶段路线](docs/IMPLEMENTATION_ROADMAP.md)
- [第一阶段可运行基础骨架规格](<internal-evidence>)
- [工程流程入口](AGENTS.md)
- [本地问题与任务跟踪](docs/agents/issue-tracker.md)
- [审查与验收策略](docs/agents/review-policy.md)

## 目录

以下为规划结构，按实施阶段逐步创建；详细代码布局及依赖规则见 [项目结构设计](docs/PROJECT_STRUCTURE.md)。第一批应用代码与启动配置已生成，真实服务验收状态见实施记录。

```text
ModelForge/
├── frontend/   # 按业务 feature 组织的 React + TypeScript + Vite 工程
├── backend/    # 模块化后端；API 与 Worker 共用代码、独立启动
├── compose.yaml  # 开发与单机运行的统一入口
├── docker-db/    # PostgreSQL 与 MinIO 的 Compose 本地持久化目录
├── deploy/     # 镜像与同源反向代理的配套配置
├── scripts/    # 环境、迁移和存储校验脚本
├── tests/e2e/  # 跨前后端的浏览器闭环
├── docs/       # 产品、架构、结构、路线与工程流程
├── .scratch/   # 本地规格及任务，按需创建
└── .runtime/   # 临时工作目录和可重建缓存，排除出 Git
```
