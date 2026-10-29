# 完整 Compose 基础骨架验收

日期：2026-10-29。范围：ticket 01，本地控制面基础骨架。基准提交：`de75e88e19215a093c30240b9ce8cf3e1e605339`。真实命令与页面语义验收已通过；新增截图逐图视觉读回仍是覆盖限制。最终三轴 host-only 审查为零发现、Ready；ticket 01 已于本日关闭。

## 构建与镜像来源

本次 Docker Hub 与 Google 镜像缓存不可达；实际从 AWS ECR Public 的 Docker Official Images 命名空间取得 Python、Node、Go、Debian、nginx、PostgreSQL，并本地重标记为已有 Dockerfile 使用的名称，没有更改全局 Docker 网络配置。基础镜像实际 digest 见 `.runtime/full-compose-20261029/base-images.json`，重新拉取移动标签后应重新记录。

MinIO 保留已选 `RELEASE.2025-10-15T17-29-55Z` 源码构建。新增可选 `MF_GOPROXY` 构建参数，本次使用 `https://goproxy.cn,direct`；默认仍为官方 proxy，Go checksum database 保持启用。`go install` 二进制版本字符串为 `DEVELOPMENT.GOGET`，源码身份实际由 Go module build information 核对：`github.com/minio/minio v0.0.0-20251015172955-9e49d5e7a648`，摘要 `h1:6TdolSCLSs2nwm8i0PpWDqf9iX2Ty9WQK8wmr7dCnUM=`。

修复后 backend image：`sha256:d43b5412e6ed76de51d859a554842845bc679d38c8fdc97eaaa79471eef175ed`。容器内与工作树的 `postgres.py` SHA-256 相同：`5050304ea189b3d514d56801f6f741df3b016f254b5e21ae61b9513246c7ccf6`。Web、MinIO 镜像身份及基础镜像分别记录，不把旧后端 image 作为修复后的运行身份。

## 自动化与实际服务结果

- `scripts/start.ps1` 成功构建并启动根 Compose；`migrate` exit 0 后才启动 API/Worker。Web 8092、API 8102 仅绑定 127.0.0.1，PostgreSQL、MinIO、Worker 不发布宿主端口。
- 宿主 Python 3.14 与最终 Linux Python 3.13.18 均为 19 项 pytest 通过；容器 `pip check` 通过。测试替身不计真实服务证据；保留既有 Starlette/httpx 弃用警告。最终测试使用 `-p no:cacheprovider` 避免只读 `/app` 缓存警告。
- 前端 TypeScript/Vite 生产构建、Compose 默认与自定义 GOPROXY 结构校验、四个 PowerShell 脚本语法通过。实际工具：Node 22.23.4、Go 1.27.3、nginx 1.30.6、PostgreSQL 17.11。
- 增强后 `scripts/acceptance.py`：32 条容器操作、51 次 HTTP 读取，run_id `20261029T083457Z`，最终 pass。包含真实 API 上传、直接 PostgreSQL 元数据核对、API/MinIO 双路回读、字节/大小/SHA-256 比对、删除与零残留核对；故障恢复后再次运行完整文件生命周期。
- 独立持久化探针 `8614d474-f9f9-4aa9-a75e-ab62f3c129e0`：容器 down/up 重建后同一元数据及对象内容可读，SHA-256 `734575c1fbb8335175c7278c11585dca1e2c85bc987ea9d1d91cec2dad11b611` 匹配后清理。
- 重复 migrate 成功；受控 migrate exit 37 使 Compose 启动非零且 API/Worker 运行列表为空，移除受控失败后恢复。初轮独立 QA 另建空数据库/bucket 验证首次迁移与重复初始化，核对 `0001_files` 后删除隔离资源；正式数据未替换。
- 逐项停止 PostgreSQL、MinIO、Worker，状态准确；存储故障 readiness 503，Worker 故障不改变存储 readiness 200；API 停止时 Worker 独立存活。

## 发现并修复的恢复缺陷

初轮独立 QA 为 **Fails QA**：PostgreSQL 停约 36 秒后恢复，直接新连接 `SELECT 1` 成功，但原 API 连续超过 6 分钟报告数据库 down，重启 API 才恢复。原报告保留，不将短暂断库通过替代长时恢复。

最小复现观察到：8 个已超时等待项仍在池中，连接数降为 0；之后借连接被 `TooManyRequests` 拒绝，无法触发新一轮建连。调用公开 `pool.check()` 后同一连接池立即可查询。`create_pool` 增加 `reconnect_failed=ConnectionPool.check`，使后台恢复独立于新请求继续触发，保留原连接数、等待数和超时限制，不修改第三方私有状态、不增加依赖。

先增强现有 HTTP/Compose 验收并在旧代码确认失败，原始结果为 `recovery-red.jsonl`；修复后同一场景通过，记录为 `recovery-green.jsonl`。回归持续断库至少 40 秒并轮询，恢复后 API 容器 ID 和 StartedAt 不变，再核实实际文件读写；不接受重启 API 绕过。

## 独立 QA、审查与清理

修复后独立 QA：PostgreSQL 断开超过 48 秒、四路并发共 728 次同源轮询后，约 3.24 秒恢复，API 容器 ID 与 StartedAt 均未改变。恢复后经该 API 完成 5000 字节真实上传、元数据/MinIO 双路核对与删除。Worker 单项停止的页面、刷新、重载及恢复准确，readiness 保持 200；API 停止后四卡标记过期/未知，刷新/重载不显示假健康，同源代理 503，Worker 独立探针仍 200，API 恢复后页面恢复。

375px 视口实际无水平溢出；原健康桌面图已视觉读取。本次故障及窄屏 PNG 已保存，但未逐图完成视觉读回；独立 QA 的总体结论保留 **Passes with gaps**（视觉覆盖限制），不能称所有截图视觉验收通过。真实状态语义、恢复与持久化硬门槛均已观察。

最终 files=0、bucket objects=0、隔离 QA 数据库/bucket 均已清理。全部本项目 Compose 服务已停止，`docker-db`、其他项目容器和原型 4311 保留；浏览器 TaskSpace 12 已结束。QA 源码前后 snapshot 逐字节一致，SHA-256 均为 `42018f05270685f80ffcded39adfd64d578677d198a85b16a94e4cc01ec17fa9`。

最终审查固定基准 `de75e88e19215a093c30240b9ce8cf3e1e605339`，完整读取 370 行 tracked/untracked diff。Standards、Spec、Adversarial 由三个独立 OpenAI 宿主 reader 审查，各轴 P0/P1/P2/P3 均为 0，结论 **Ready**；无待验证发现，不需要 validator。`external peer disabled by docs/agents/cross-model.json`，外部 CLI、model、effort、isolation 均不适用，没有跨模型家族审查。

审查者使用源码与上述原始证据，未新增运行触发器；Adversarial reader 因本机无 rsync 未执行 scratch 复现，没有留下具体未决故障。审查前后 trusted snapshot 逐字节一致，SHA-256 均为 `58825fe3ca0cd94f8c3dd750ffafaaf7a22e828c1792c1efa4050cd7bedac0d1`。原始报告摘要与 snapshot/diff 保存在 `.runtime/full-compose-20261029/final-review.*`；临时审查目录已删除。此后仅补入本审查结果、票据关闭和文档状态文字，运行时代码/配置/验收脚本未再修改。

票据按本地跟踪契约添加 `Closed: 2026-10-29`；保留既有历史评论，不将早期失败覆盖成通过。

## 证据与后续边界

构建、版本、回归与整栈原始输出：`.runtime/full-compose-20261029/`（Git 忽略）。包括 `*-build*.txt`、`base-images.json`、`minio-module-version.txt`、`backend-final-identity.json`、`backend-final-linux-freeze.txt`、`host-final-pytest.txt`、`linux-recovery-final-pytest.txt`、`frontend-final-build.txt`、`compose-final-check.json`、`recovery-red.jsonl`、`recovery-green.jsonl`。

初轮独立 QA：本机临时目录 `modelforge-full-compose-20261029-ck9etfym/`，保留 F01 失败、初次迁移及清理证据。修复后独立 QA：`modelforge-recovery-qa-20261029-0ba7c197/`。QA 原始文件保持在仓库外。

本批完成边界仅为基础骨架。数据集业务、模型导入、优云资源、训练/推理、真实 GPU 和 DeepSeek 报告仍未接入。下一批先读 ticket 02 与产品规格，待用户确认后开始；本轮未执行 Git 远程操作。
