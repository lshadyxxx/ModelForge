# ModelForge / 模锻

**从一次训练，到一份可验证、可追溯、可交付的模型。**

ModelForge 是面向模型训练与推理全生命周期的开源工程工作台。它把数据集、版本、训练预检、
运行指标、失败现场、模型产物与独立推理验收收束成一条完整证据链，让团队不再停留在
“任务跑完了”，而是持续回答真正决定交付质量的三个问题：

- **训练做对了吗？** 从 Train/Eval Loss、学习率、Token 预检、显存与运行时报告中识别健康信号。
- **产物能交付吗？** 用 Best/Final Adapter、Manifest、SHA-256 回读和独立推理验收构成交付闭环。
- **下一步怎么改？** 由 AI 诊断基于可追溯证据输出分级发现、能力边界和下一轮实验建议。

> **训练完成不是终点，模型可交付才是。**

![AI 训练诊断与历史对比](design/ai-training-report-2026-11-06/historical-comparison-2026-11-08/evidence/desktop-top-1440.png)

## 功能

- **数据集与模型管理**：维护不可变版本、校验状态、模型目录和版本关系。
- **计算环境与实例**：查询云资源目录、兼容性、费用守卫和实例生命周期状态。
- **托管训练**：面向文本 SFT/LoRA 的单次训练运行，支持预检、日志、指标、失败重试和清理。
- **产物交付**：追踪 Best/Final Adapter、Manifest、SHA-256 回读和独立推理验收状态。
- **推理试用**：将已登记模型或 Adapter 交给独立 vLLM 运行时，记录健康、流式输出和清理结果。
- **AI 训练诊断**：基于 Attempt 快照、Train/Eval Loss、学习率、Token 预检、显存、运行时报告、
  日志和产物状态生成结构化报告。
- **历史训练对比**：在同一基座、数据集和 split 的成功运行间比较参数变化、Best/Final Eval、
  健康与交付信号；真实模型效果始终要求独立评测，不能由 loss 推断。

## AI 诊断边界

AI 报告是 **advisory 诊断层**，不替代硬门禁：

- 分开判断“训练健康度”和“产物可交付性”。
- 每个关键发现都必须引用可追溯证据。
- 未上报的指标写“未上报/无法判断”，不从 loss 推断业务效果。
- 没有独立推理验收时，只能说“产物可交付，模型可用性未验证”。
- 报告中的建议只用于下一轮实验，不会自动修改训练配置或替用户执行云操作。

## 架构

| 层 | 技术 |
|---|---|
| Web | React、TypeScript、Vite |
| API / Worker | Python、FastAPI、Pydantic、SQLAlchemy、Alembic |
| 元数据 | PostgreSQL |
| 对象存储 | MinIO |
| 训练运行时 | 远程 GPU 执行器、固定 runtime contract、LLaMA-Factory |
| 推理运行时 | vLLM 独立生命周期管理 |
| AI 编排 | LangGraph、`langchain-openai`、PostgreSQL checkpoint |
| 本地编排 | Docker Compose |

API 与 Worker 共用代码、分进程运行；云凭据只从后端环境注入，不进入浏览器。
模型权重、数据集和生产凭据不属于源码仓库。

## 本地启动

前置条件：Docker Desktop（Linux containers）、Compose v2+、PowerShell 5.1+ 或 PowerShell 7。

```powershell
./scripts/start.ps1
```

- Web 工作台：<http://127.0.0.1:8092>
- API：<http://127.0.0.1:8102>

停止：

```powershell
./scripts/stop.ps1
```

首次启动会从 `.env.example` 生成被 Git 忽略的 `.env` 和本地随机凭据。
需要接入云 GPU、模型平台或 AI 诊断服务时，再配置对应的后端环境变量。

详细运行、迁移、存储校验和故障排查见
[docs/RUNNING.md](docs/RUNNING.md)。

## 开发检查

```powershell
cd frontend
npm ci
npm test
npm run build

cd ../backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -e ".[test]"
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m pip check
```

也可以使用现有 Compose 环境运行后端测试：

```powershell
docker compose exec -T api python -m pytest -q
```

## 安全模型

- `.env`、本地运行数据、浏览器配置和验收取证目录不进入 Git。
- AI 与云写入能力默认关闭，只有显式配置凭据后才会启用。
- 控制面面向单机或受控网络使用，当前没有用户登录、RBAC 或多租户隔离。
- 不要将本地 Compose 配置直接暴露到公网；公网部署前必须增加 TLS、认证、限流、
  审计和密钥管理。
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 已知限制

- 单次 Qwen3-0.6B/RTX 4090 验证不等于完整兼容矩阵。
- 供应商密码重置、计划关机、多实例首启和实际账单仍需更多验证。
- 尚未完成所有模型、GPU、区域和长时间运行场景。
- 独立推理验收记录缺失时，不能声明模型业务可用。
- AI 报告质量依赖已上报证据；缺失指标不会被推断补齐。

## 目录

```text
backend/       FastAPI API、Worker、迁移、诊断和运行时
frontend/      React 工作台
compose.yaml   本地控制面
deploy/        镜像和同源反向代理配置
docs/          架构、运行、ADR 和实现记录
design/        公开设计原型与验收截图
designs/       历史设计探索
scripts/       启动、停止、验收和迁移脚本
tests/         跨模块验收脚本
```

## 文档

- [架构与数据归属](docs/ARCHITECTURE.md)
- [项目结构与模块边界](docs/PROJECT_STRUCTURE.md)
- [技术栈](docs/TECH_STACK.md)
- [实现路线](docs/IMPLEMENTATION_ROADMAP.md)
- [运行说明](docs/RUNNING.md)
- [领域术语](GLOSSARY.md)
- [AI 训练报告设计入口](design/ai-training-report-2026-11-06/index.html)

## 贡献

提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。请勿在 issue、测试数据或提交中放入
真实云凭据、生产 DSN、私钥、个人目录路径或未脱敏的云资源标识。

## 许可证

Apache License 2.0，详见 [LICENSE](LICENSE)。
