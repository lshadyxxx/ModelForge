# 托管训练一键化真实验收记录（A′ 与 B，2026-11-05）

## 本轮结果

本轮在 ModelForge 内完成了一次真实的平台托管训练闭环。用户提交训练后，平台自行完成 GPU 实例创建、费用截止时间设置、安全首启、固定 runtime 冷安装、输入传输、LLaMA-Factory SFT/LoRA、指标收集、产物回传、实例删除和租约释放。

结论为 `PASS_WITH_LIMITATIONS`：

| 能力 | 状态 | 结论 |
|---|---|---|
| A′ 托管训练主闭环 | `PASS` | 真实完成 22 step，退出码 0，结果成功 |
| Best / Final Adapter | `PASS` | 两个角色均为 `available`，下载包和包内文件校验通过 |
| 执行证据持久化 | `PASS` | 12 个文件经 MinIO 读回，大小和 SHA-256 全部一致 |
| 实例删除与租约释放 | `PASS` | 实例两次精确查询为空；租约已 released |
| UI 成功终态 | `PASS` | 1440/390 真实 API 页面无横向溢出和运行错误 |
| B 预构建 Training Base | `PASS`（后续补充） | 镜像 `compshareImage-1xc89j1np56m` 完成第二次正式 managed Attempt：22 step、Adapter、MinIO 读回、清理和租约释放均通过；详见文末 |
| scheduler 到期自动关机 | `NOT_RUN` | 只验证设置和清理事实，未等待真实到期 |
| 供应商密码 reset | `FAILED` / 已安全回退 | 接口返回 `cloud_api_error`；实例密码由平台锁定并验证旧密码失效 |
| 实际云账单 | `NOT_RUN` | 仅有目录报价，未查询账单 |

因此 A′ 与 B 都可以说明“受支持单组合的一键训练已经真实跑通”，但仍不能说明完整生产就绪、多实例/多区域稳定或固定 SLA 成立。

## 范围与路线

本文件先记录 A′ 回退路线；B 的后续执行与结果见文末：

```text
已验证基础镜像
→ 安全首启
→ 固定 runtime 冷安装
→ runtime preflight
→ 固定训练输入
→ LLaMA-Factory SFT/LoRA
→ MinIO 产物校验
→ 停止并删除实例
→ 确认删除后释放租约
```

训练镜像 profile 为 `base-image-a-prime`，`runtime_source=cold_install`。在本轮 A′ 验收时，B 的 `training-base-b` profile 状态为 `not_published`，没有可用的 `image_id` / `image_group_id`，因此不得把 A′ 的结果填写成 B 的结果。后续已单独制作 B 镜像，见文末更新。

本轮没有修改 `compatibility-baseline.json`，训练镜像继续由独立的、版本化 profile 清单约束。兼容基线仍为 `partial`，只开放当前一个已验证组合。

## 关键身份

| 项 | 值 |
|---|---|
| 基线 HEAD | `d987b568e78ba7f524fed26d6a290c57dfc50d0a` |
| Attempt | `6b330374-7fff-4ac2-9104-4f3909045e0b` |
| Task | `e0c999c0-5fee-4ae3-b4ca-88c53b10210f` |
| 实例 | `<redacted-instance-id>` |
| Lease | `092392a1-6626-4561-95b4-0fed21476b0f` |
| ProjectId | `<redacted-project-id>` |
| 基础镜像 | `compshareImage-1fc8fjody17l` |
| 训练镜像 profile | `base-image-a-prime` |
| Runtime lock | `ucloud-cuda13.2-llamafactory-0.9.5-qwen3-20261101-r2` |
| Runtime lock SHA-256 | `08a1c34b453406bd4a6d89ce5241827e973766d936baae6cc24378edb3cc032a` |
| 基座版本 | `51f7b869-9894-424b-bc5d-dba013723ddb` |
| 数据集版本 | `dc344d8b-41ca-459a-9eb6-3c276eeb93a2` |
| Snapshot SHA-256 | `76fc2ec382f370eb4f7e030ed132797fdab5dc0c1ac343664805c641172621ad` |

硬件为 `cn-bj2/cn-bj2-03`、单卡 RTX 4090、14 CPU、65,536 MiB、100 GB `CLOUD_SSD`、Postpay。目录报价为 CNY 2.15/小时；这不是实际账单。

## 实际时间线

以下时间取自 `timeline-r3.ndjson`：

| UTC | 阶段 | 事实 |
|---|---|---|
| 08:27:38 | 创建 | Attempt 和 provisioning intent 建立 |
| 08:27:52 | bootstrap | 实例已绑定，进入安全首启 |
| 08:28:02–08:35:02 | runtime | runtime 冷安装，约 7 分钟 |
| 08:35:12–08:38:43 | inputs | preflight 后传输数据、模型和 runtime 输入 |
| 08:38:53–08:39:33 | training | 22 step 训练运行 |
| 08:39:43–08:41:43 | artifacts | MinIO 回传、清单校验和 Adapter 发布 |
| 08:41:53–08:42:03 | cleanup | 停止、删除、确认清理 |
| 08:42:13 | finished | 本地 Attempt 进入终态 |

从创建到本地终态约 14 分 27 秒。该值是单次样本，不是 SLA；冷安装时间也不能外推到其他镜像、区域或依赖源。

## 训练结果

远程 job 的实际结果为：

- `state=succeeded`
- `exit_code=0`
- `error_code=null`
- 22 个训练 step
- Train Loss：`11.681931 → 0.1998093426`
- 平均 Train Loss：`1.7858700981`
- Eval Loss：`0.2147834301`
- 模型：Qwen3-0.6B，`qwen3_nothink`
- 设备显存峰值：`2,580,545,536 bytes`，约 `2.40 GiB`

Token preflight 检查了 24 个样本，token 长度为 41–43，`overflow=[]`。训练进程退出 0 只是成功条件之一；本轮同时要求产物 verified、清理 confirmed 和租约 released。

## Adapter 与证据

两个 Adapter 均已发布并处于 `available`：

| 角色 | Adapter ID | Fingerprint | ZIP SHA-256 |
|---|---|---|---|
| Best | `af2bcf26-1df1-5fb1-b53f-d078f8295595` | `4b0892be62af2fe92fd4848732538d51dbf9f2b63c3163e24fc1be92edc9f6f9` | `1f3f25065616d573801baf0ebf954db5ef2eb67e94d7c769eb45ae362b24b7e5` |
| Final | `8a32918d-5ab6-53a1-97ca-0131e2bc83f3` | `6008acbc6f0b9d7bbf164a91bd3a24f19bb83d342da3eff6d0ef49df689c0464` | `686e398c3ffa39e86949937c3935fadbef661dce677fe4131e68a08453e67309` |

下载验证确认：

- ZIP 响应头摘要与实际字节摘要一致。
- ZIP 内 `manifest.json`、`adapter_config.json`、`adapter_model.safetensors` 均存在。
- 两个 Adapter 的 manifest ID、角色、Attempt、fingerprint 与 API 响应一致。
- `adapter_config.json` 为 1,090 bytes，SHA-256 为 `3c8548994ae4c62856f826c801ee0db31d870529d7ac47c7f5bd299d4ae7bec4`。
- `adapter_model.safetensors` 为 20,236,472 bytes，SHA-256 为 `be46405d76279b78c5010c1e56a947718fceb858d38877f1516f898a47681135`。
- Best/Final 本轮都绑定最后一个 checkpoint，因此底层权重文件相同；二者仍保留不同的角色、Adapter ID、fingerprint 和 manifest。

执行证据共 12 个文件，经 MinIO 独立读回后大小与 SHA-256 全部一致，`artifact-readback-verification.json` 的 `all_ok=true`。包含 `execution.json`、`data/dataset_info.json`、`runtime-lock.json`、`runtime-lock-report.json`、`runtime-baseline.json`、`token-preflight.json`、`gpu-memory.json`、`gpu/torch-peaks.json`、`train.json`、`output/trainer_state.json`、`process.log` 和 `result.json`。

整个本地验收证据目录在收尾后重新扫描了 27 个文件、1,089,708 字节；已知云私钥、数据库密码、MinIO secret、PEM 私钥块、`sshpass`、内联私钥命令和 Bearer 模式均未命中，结果为 `PASS`。扫描只记录文件与规则类型，不输出秘密值。

本轮没有使用新生成的 Best/Final Adapter 做独立推理 Trial；这只证明训练产物包可用和对象校验通过，不等于独立推理部署已验收。

## 安全首启回退

本轮真实首次运行时，供应商 `ResetCompShareInstancePassword` 在当前基础镜像路径返回 `cloud_api_error`。

平台没有把 reset 响应成功当作公钥安全完成，也没有在 reset 失败后直接进入训练。实际顺序为：

1. 尝试一次供应商密码 reset。
2. reset 失败后，先证明每实例 Ed25519 公钥登录可用。
3. 在实例内执行 `passwd -l` 锁定系统密码。
4. 使用旧密码再次尝试登录，确认认证失败。
5. 记录 `credential_state=password_disabled` 和 `credential_recovery=password_disabled_after_reset_error`。
6. 如果旧密码仍可登录，抛出 `credential_disable_unverified` 并停止训练。

因此本轮可以说明“旧密码在实例内已不可用”，不能说明“供应商 reset 接口成功”。这是 A′ 路线的已知限制，也是后续 B 镜像需要消除的冷安装和首启复杂度。

## 清理与释放

清理链路如下：

- `lease.state=released`
- `process_state=exited`
- `exit_code=0`
- `cleanup_policy=outputs_persisted`
- `instance_state=deleted`
- `cleanup_state=confirmed`
- `released_at=2026-11-05T08:42:05.602714+00:00`
- 非 released 租约数量为 0

实例 `<redacted-instance-id>` 在 `cn-bj2` 下两次精确查询结果均为空。恢复只读后再次全量查询实例为空，精确 ID 查询也仍然为空。API 和 Worker 均 healthy。

验收后已将 `MF_UCLOUD_WRITE_ENABLED` 恢复为 `false`；当前 `/api/v1/resources/ucloud/configuration` 返回 `mode=read_only`、`write_enabled=false`。

## UI 验收

真实 API 页面在 1440 和 390 两个宽度完成检查：

| 页面 | 1440 | 390 |
|---|---|---|
| 训练工作台总览 | 无横向溢出，单一 `h1` | 无横向溢出，单一 `h1` |
| Attempt 详情 | 六个托管生命周期阶段、run facts、证据和下一步动作可见 | 以纵向堆叠呈现，无文档级横向溢出 |
| 训练产物 | Best/Final `2/2`，下载和配对入口可见 | 卡片纵向堆叠，产物信息完整 |

`ui-final-verification.json` 记录：

- `all_widths_ok=true`
- `console_errors=[]`
- `page_errors=[]`
- 1440 和 390 页面均没有文档级横向溢出
- 每个页面恰好一个 `h1`

桌面端截图：

- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-overview-1440.png`
- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-detail-1440.png`
- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-artifacts-1440.png`

移动端截图：

- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-overview-390.png`
- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-detail-390.png`
- `<home>\ego\modelforge-training-acceptance-20261105\ui-training-success-artifacts-390.png`

## 自动化验证

本轮收尾实际运行：

```text
backend: 327 passed, 216 skipped, 1 existing Starlette/FastAPI warning
frontend: 87 passed
frontend production build: passed
```

Vite 只报告一个既有的 JS chunk 超过 500 kB 的体积警告，不是构建失败。跳过项仍需要隔离 PostgreSQL/MinIO 或真实服务条件；测试通过不等于完整云兼容矩阵通过。

## A′ 与 B 的区别

| 项 | A′ | B |
|---|---|---|
| 镜像 | 已验证基础镜像 | 平台自制 Training Base |
| runtime | 启动后冷安装固定 lock | 镜像内预装 |
| 首启复杂度 | 高，需要安全首启/密码处理 | 目标为更低，但必须先发布并验证镜像 |
| 本轮状态 | 真实 `PASS` | 真实 `PASS` |
| 现在能否作为默认路线 | 可以用于受支持单组合的回退验证 | 仍建议先补多实例首启稳定性与根密码快照硬化证据 |

不能因为 A′ 通过就删除 B 计划；也不能把 B 的预期收益写成已经实现。

## 仍开放

1. 扩展 B `training-base-b` 的多实例、多区域和长时间首启稳定性矩阵；单次全量闭环已经通过。
2. 单独验证 scheduler 到 deadline 后实例实际进入 Stopped。
3. 解决供应商 `ResetCompShareInstancePassword` 失败，或把当前“密码锁定 + 旧密码失效”作为明确的受支持边界。
4. 查询真实账单并与目录报价分开记录。
5. 用新的 Best/Final Adapter 做一次独立推理试用。
6. 扩展模型、GPU、区域、镜像和容量边界矩阵；当前基线仍为 `partial`。
7. 单次 14 分 27 秒和约 7 分钟冷安装不是 SLA，需要更多窗口统计。
8. `training-image-profiles.json` 中 A′ profile 的 `evidence` 文案仍冻结为验收前的“P1 pending”，因为该文件 SHA 已被本轮 Attempt 快照引用；下一次更新应发布新的 profile 版本，不能直接改写本轮身份。

## 证据位置

```text
<project-root>\.runtime\evidence\training-oneclick-p1-20261105\
```

关键文件：

- `attempt-r3-final.json`
- `timeline-r3.ndjson`
- `artifact-readback-verification.json`
- `adapter-download-verification.json`
- `cleanup-exact-query-1.json`
- `cleanup-exact-query-2.json`
- `post-readonly-instance-list.json`
- `post-readonly-exact-instance-query.json`
- `lease-final-query.json`
- `active-lease-query.txt`
- `ui-final-verification.json`
- `redaction-check.json`
- `redaction-check.txt`

本轮未提交 Git、未 push、未部署外部服务。工作区包含实现改动和本地设计/验收资料，提交前必须按白名单审查，不能使用 `git add -A`。

## 2026-11-05 B 镜像后续事实

本文件前面的 A′ 验收记录保留为当时的历史快照。后续已单独制作并验证 B
`Training Base` 自定义镜像：

| 项 | 结果 |
|---|---|
| 镜像 | `compshareImage-1xc89j1np56m` |
| 名称 | `modelforge-training-base-qwen3-20261105-r1` |
| 类型 / 状态 | `Custom` / `Available` |
| 区域 / 可用区 | `cn-bj2` / `cn-bj2-03` |
| GroupId | `null`，Provider 未返回 |
| Runtime lock | `ucloud-cuda13.2-llamafactory-0.9.5-qwen3-20261101-r2` |
| 预构建 preflight | `PASS`，无冷安装、`mismatches=[]` |
| B 全量托管训练 | `PASS`，Attempt `fbc8a03d-27e3-4ef2-8253-c23ac8a599ac` |

正式 profile 已升级为 `training-image-profiles-20261105-r2`，并把
`training-base-b` 标记为 `available`。`provisioning.py` 也已适配：
Custom 镜像使用 `DescribeCompShareCustomImages`，系统镜像继续使用
`DescribeCompShareImages`。不能用 A′ 的冷安装训练结果代替 B 的全量托管
训练结论。

后续已完成服务重建和 B 全量 managed 训练。第一次 Attempt
`f3801f77-48e1-4b30-b6f3-5448f4a7bb4f` 在公钥首启阶段失败
`bootstrap_key_install_failed`，实例已删除且租约已释放；同一镜像的诊断
实例证明密码登录、原公钥脚本和仅公钥登录均可成功。公钥安装随后增加最多
3 次、间隔 4 秒的有限重试，第二次 Attempt 完成 22 step、Best/Final
Adapter、12/12 MinIO 读回、实例删除和租约释放。

B 全量证据和复现步骤见：

```text
<project-root>\.scratch\training-base-b-20261105\B_IMAGE_REPORT.md
<project-root>\.scratch\training-base-b-full-20261105\B_FULL_ACCEPTANCE.md
<project-root>\.runtime\evidence\training-base-b-full-20261105T110831Z\
```
