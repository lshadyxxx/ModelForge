# 缓存镜像真实存储复验

日期：2026-10-29。此前将全部真实存储验收归为镜像拉取阻塞，结论不完整。本机已有可用存储镜像，已完成以下真实复验。

## 镜像及环境

| 服务 | 本机缓存镜像 | RepoDigest |
|---|---|---|
| PostgreSQL | postgres:17.9 | sha256:2a0d0fe14825b0939f78a8cad5cd4e6aa68bf94d0e5dd96e24b6d23af4315545 |
| MinIO | minio/minio:RELEASE.2024-12-18T13-15-44Z | sha256:1dce27c494a16bae114774f1cec295493f3613142713130c2d22dd5696be6ad3 |

两个镜像均为linux/amd64，实际版本命令核对通过。采用pull_policy: never；未复用其他项目的容器、数据目录或凭据。旧版MinIO仅用于本次缓存兼容性验收，默认Compose目标版本未替换。

临时配置为 `.runtime/cached-storage-20261029/compose.yaml`，project为modelforge。实际绑定挂载为 `docker-db/postgres` 和 `docker-db/minio`，见mounts.txt。本次宿主API/Worker/Vite连接Compose存储依赖；验收端口仅绑定127.0.0.1:15433/19092，默认Compose不发布依赖宿主端口的约定未修改。

## 实际通过项

- 两个存储容器健康启动。宿主venv真实运行Alembic迁移和bucket初始化两次成功，最终revision为0001_files。
- 文件生命周期：经API上传8600字节，直接核对PostgreSQL元数据，经API/MinIO双路回读，比对内容、大小和SHA-256，删除并确认对象和记录不存在。
- 重建持久化：另建探针，执行临时Compose的down/up重新创建两个存储容器，用同一run_id/file_id回读元数据及文件，摘要一致后清理。
- 逐项停止PostgreSQL、MinIO：只有对应组件down，API liveness200，readiness503；恢复后状态正常。
- 停止独立Worker：仅Worker down，API liveness和存储readiness仍为200；恢复后状态正常。
- 工作台真实浏览器观察三种对应故障，最终恢复显示四项正常；Vite同源代理返回真实status200和ready=true。
- 最后直接查询files表0行、MinIO对象0个，探针回执已移除。临时宿主服务和两个依赖容器均停止，数据目录保留，原型4311未停止。

## 原始证据

位于 `.runtime/cached-storage-20261029/`，被Git忽略：

- startup.txt、migration-1.txt、migration-2.txt、healthy-status.json。
- lifecycle.txt、prepare.txt、recreate-down.txt、recreate-up.txt、restart-verify.txt。
- postgres-fault.json、postgres-recovery.json、minio-fault.json、worker-fault.json。
- ui-postgres-fault.txt、ui-minio-fault.txt、ui-worker-fault.txt、ui-recovered.txt、ui-status-recovered.json。
- final-storage.json、mounts.txt、cleanup.json。

生命周期run_id：e867900134404059a5f0064bda0720ec。持久化run_id：0a9b9f69fb60482687e5bf447ae0ddc2，file_id：97255056-f163-4741-a850-3a0e06bf827a。以上是实际服务证据；既有19项单元测试单独记录。本次未修改应用源码。

## 未通过项

- 默认全应用Compose构建与启动：Python/Go/Debian等基础镜像拉取网络问题仍未解决。
- Compose单次migrate容器成功、重复运行及受控失败阻止API/Worker启动；宿主迁移不能覆盖此门槛。
- Python3.13 Linux应用镜像、默认目标源码构建MinIO版本和nginx容器代理运行。

本次通过真实存储生命周期、依赖容器重建持久化和宿主应用真实故障反馈；ticket01仍保持开放。

## 后续完整复验（2026-10-29）

完整根 Compose 已完成源码构建、Linux Python 3.13 运行、nginx 同源访问、单次迁移成功/重复/受控失败门槛与长时依赖故障恢复。实际镜像 digest 和依赖解析均已记录；ticket 01 的当前状态及证据以[完整验收记录](full-compose-2026-10-29.md)为准，上文保留为历史结果。
