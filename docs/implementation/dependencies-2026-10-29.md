# 第一批依赖来源核验

日期 2026-10-29。新增依赖按 dependency-vetting 从上游到安装路径核对，注册表信息只用于版本检查。

| 依赖 | 上游文档或仓库 | 版本 |
|---|---|---|
| FastAPI | https://fastapi.tiangolo.com/tutorial/ | 0.162.0 |
| Uvicorn | https://uvicorn.dev/installation/ | 0.54.0 |
| Pydantic Settings | https://docs.pydantic.dev/latest/concepts/pydantic_settings/ | 2.16.2 |
| Psycopg / pool | https://www.psycopg.org/psycopg3/docs/basic/install.html | 3.3.6 / 3.3.3 |
| MinIO Python | https://github.com/minio/minio-py | 7.2.20 |
| Alembic | https://alembic.sqlalchemy.org/en/latest/front.html | 1.20.1 |
| SQLAlchemy | https://docs.sqlalchemy.org/en/20/intro.html | 2.1.6 |
| HTTPX | https://www.python-httpx.org/ | 0.28.1 |
| pytest | https://docs.pytest.org/en/stable/getting-started.html | 9.2.0 |
| React / React DOM | https://react.dev/learn/build-a-react-app-from-scratch | 19.3.1 |
| Vite / plugin-react | https://vite.dev/guide/ | 8.3.5 / 6.1.2 |
| TypeScript / React types | Vite React TypeScript template / React docs | 7.0.2 / 19.3.0 |

前端 package-lock.json 固化解析结果；npm audit signatures 实际核验 24 个包签名、13 个 attestations，这不等于安全漏洞扫描。后端安装在私有 .venv，沿用现有 pip 的清华镜像配置；包名与导入路径从上游核对，未改变全局配置。

MinIO 服务端使用官方 RELEASE.2025-10-15T17-29-55Z 源码。GitHub latest release 本次返回此 tag，发布说明要求源码构建并声明安全修复；Dockerfile 用 go install github.com/minio/minio@该tag。go.mod 声明 Go 1.24.0 / toolchain 1.24.8。默认Compose仍采用该目标版本；后续使用本机旧MinIO进行临时兼容性验收，未替换默认版本。

基础镜像选择 PostgreSQL 支持线17、Python3.13、Node22、Debian bookworm、nginx stable，以及 Go1 构建器。本次 Docker Hub 拉取超时，尚未锁定已拉取的镜像 digest，容器构建/兼容性未验证。首次成功构建应记录 digest 与 Linux 依赖解析，不能用宿主 venv freeze 冒充跨平台锁。原始上游抓取在 .runtime/upstream-*。

## 本机缓存复验

已核对postgres:17.9与minio/minio:RELEASE.2024-12-18T13-15-44Z的RepoDigest、平台和版本输出，使用pull_policy: never运行独立容器完成真实存储验收。旧版本仅用于本次本地兼容性复验，不作为新推荐或默认版本降级。完整结果见[缓存镜像复验](cached-storage-2026-10-29.md)。镜像下载超时主要阻塞应用构建及默认目标镜像，不能概括为本机没有可运行的PostgreSQL/MinIO。

## 后续完整复验（2026-10-29）

完整根 Compose 已完成源码构建、Linux Python 3.13 运行、nginx 同源访问、单次迁移成功/重复/受控失败门槛与长时依赖故障恢复。实际镜像 digest 和依赖解析均已记录；ticket 01 的当前状态及证据以[完整验收记录](full-compose-2026-10-29.md)为准，上文保留为历史结果。
