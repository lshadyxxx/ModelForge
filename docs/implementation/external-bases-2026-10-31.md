# 优云公共基座外部只读身份（2026-10-31）

## 范围与结果

沿用 ADR-0002，实现 ticket03 的一个增量：从优云实时公共目录登记外部引用；保存来源快照；提供服务器内部的完整文件核对与首次不可变身份固化；模型页展示来源、指纹及最近核对状态。已在本地常驻服务应用迁移 `0008_external_base_models` 并更新镜像 `modelforge-backend:external-base-fixed-20261031`，同源 Web 资产为 `index-BlJAD2P_.js`。

真实优云目录条目通过同源 API 登记为 `awaiting_verification`；API/Worker 重启后逐字段回读一致。独立查询 PostgreSQL 确认 bucket 和 manifest_sha256 均为空、托管文件行数为零，并核实对应 MinIO 前缀无对象。验收登记已用 API 删除，公共文件未被操作。API 和 Worker 各 32 个 Python 源文件 hash 与工作区一致，Web 资产字节与最终构建一致。

实际实例上的公共挂载、SSH/SFTP/执行通道及 GPU 兼容性仍未接通。完整文件核对仅在明确的本地模型字节 fixture 上执行；fixture 不是可运行模型。没有创建收费实例，没有浏览器或桌面操作。ticket03 保持开放，Hugging Face 继续暂缓。

## HTTP 与存储契约

`POST /api/v1/models/external-bases` 仅接受 `name`、`region`、`path`。服务端再次查询实时公共模型目录，仅登记其中唯一、规范的 `/model/` 绝对路径；目录失败、路径不在目录或重复时明确失败。浏览器不能上传指纹或核对报告。登记创建一个模型及 v1 版本，不创建 MinIO 索引。

`GET /api/v1/models` 和 `/model-versions/{id}` 区分 `source_kind=ucloud_public`；详情返回 source_snapshot、pinned_manifest、pinned_configuration、pinned_at、last_check_state、check_generation、last_checked_at、last_instance_id 和 last_error_code。尚未核对时清单/指纹为空，不能推断为空模型或可训练。已观察文件标记 `external_observed`，verified_bytes 始终为 0；total_bytes 是首次固定的外部文件总量，失败复核时仍保留原值，不代表当前完整目录。

删除外部版本只删除未被引用的平台元数据，沿用行锁及引用保护，不访问对象删除接口，不删除云端文件。上传、完成、恢复和取消托管传输的操作拒绝外部版本。

## 服务器核对契约

`ExternalModels.check(version_id, instance_id, read_directory, expected_fingerprint=...)` 仅供未来服务器拥有的远程执行通道调用，没有公共 HTTP 核对入口。reader 必须在传入的实际实例执行随服务发布的标准库探针，按保存的公共路径返回完整报告，不能把浏览器提供的 JSON 当作证据。`instance_id` 目前只记录调用方身份，尚无租约或实例所属权校验；未来通道负责绑定平台 Attempt/实例/租约、截止时间、取消、报告体积与通道身份。当前内部能力不得直接视为生产执行授权。

探针不加载模型或执行仓库代码，不写源文件、不联网。逐文件读取全部字节并计算 SHA-256，拒绝链接/Windows reparse、特殊文件、缺失/空目录、超限及观察到的目录或文件变化。Linux 从文件系统根逐级用 O_NOFOLLOW 打开并核对全部路径分量，清单和内容读取锚定同一目录描述符，结束前重查路径链；Windows 使用身份/大小/mtime 前后检查，未将不稳定的 Windows ctime 纳入比较。扫描是一次有界观察，不是不可变文件系统快照；文件可在扫描后变化，未来执行通道仍须在同一实例核对后立即绑定实际输入，不能承诺消除所有检查与使用之间的竞争。

扫描安全上限：10000 文件、10 TiB 总字节、40000 目录条目、单个配置/index JSON 8 MiB。这些是拒绝截断报告的保护，独立于尚未锁定的托管上传容量，不是性能实测承诺。

报告 schema_version=1，文件为相对路径/字节数/完整 SHA-256，metadata 保存原始 UTF-8 config/index JSON。要求 config.model_type、tokenizer 文件和完整权重/分片索引；索引目标须存在并匹配 .safetensors 或 .bin 权重格式，配置/tokenizer/索引自身不能充当分片；原始元数据字节必须与清单 hash 一致。JSON 拒绝重复字段、非有限值、NUL 和非法 Unicode。结构校验不证明 tokenizer 可加载、权重张量有效或训练兼容，compatibility_state 继续 unverified。

首次成功按相对路径排序，把路径、大小和 SHA-256 的规范 JSON 计算 SHA-256 固定为版本指纹，并固化配置和首次时间。重新核对先进入 awaiting_verification/pending；新增、删除或改变任意文件均阻止使用，保留原始指纹/清单/配置。失败记录错误码，恢复同一内容后可再次核对通过。每次检查递增 generation，旧检查不能覆盖新检查，迟到结果不能复活已删除/不再接受核对的版本。长时间远程读取不持有数据库锁。

训练首次启动、独立推理和重试都须再次核对；有固定输入的调用必须传 expected_fingerprint。available/历史 verified 只表示最近文件观察结果，不能直接授权执行或替代实际实例核对。当前没有训练/推理调用方，尚未证明全链路强制执行此规则。

## 检查和证据

- 初始 Linux 定向 33 passed；修复后模型/外部基座定向 58 passed，覆盖全路径/嵌套目录替换、扫描限额、内容变化、两种分片格式、严格 JSON、固定身份、漂移、generation、引用删除和无托管对象。
- 修复后最终镜像隔离 PostgreSQL/MinIO 全套 265 passed / 1 skipped；宿主 228 passed / 38 skipped（集成门禁、Windows 链接权限及 Linux 描述符专属场景）。此前 252/1、218/35 是修复前结果。
- 前端 15/15，TypeScript/Vite build 通过；覆盖同源登记 payload、旧地域/不存在/重复条目拒绝以及既有上传/筛选回归。
- 新唯一空库升级、重复升级、存在外部记录时拒绝回退、删除记录后的回退和重新升级通过。迁移验收脚本曾因先删 models 外键父行失败，修正脚本顺序后通过；未放宽产品约束。
- 独立 QA 初次16项通过，结论 Passes with gaps；修复后定向独立复验9组通过、0失败，覆盖6种坏索引、两种合法嵌套分片、祖先/嵌套替换、并发/引用/漂移、真实MinIO相邻流程和Windows探针；沿用未变HTTP证据。页面视觉/交互因隔离驱动未验证继续 blocked。
- 初次三轴 host-only 审查：Standards 确认包入口规则 P2 和结构规则重复 P3，Spec 零发现，Adversarial 确认无权重索引与祖先链接竞争两个 P2。独立同家族验证确认四项；精确隔离触发与修复后拒绝结果均保留，不声称跨家族覆盖。
- 修复采用公开资源包入口、共享纯结构规则和 Linux 完整路径/目录描述符锚定。新增7项回归先在旧代码失败；修复后通过并扩展两种分片、嵌套替换及失败不固化状态。原7项变异均检出；修复新增2项变异分别回退索引守卫和探针，均产生实际测试失败。

命令：`backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider`；`npm --prefix frontend test`；`npm --prefix frontend run build`。隔离镜像通过 Compose run 设置唯一 MF_PG_DATABASE/MF_MINIO_BUCKET 和 MF_TEST_INTEGRATION=1/MF_TEST_ISOLATED_STORES=1，再运行 `python -m pytest -q -p no:cacheprovider tests`；正式 Worker 未指向测试库。

原始证据在 OS 临时目录 `modelforge-external-base-20261031-ye2v74gw`，本机 `.runtime/external-base-evidence-path.txt` 指向该目录。本次两套唯一测试库/桶和独立验收容器已核对身份并清理，二次回读确认不存在；正式验收登记及空父记录、独立QA自建记录/对象也已清零。复现fixture和报告保留在OS临时证据目录；先前scratch递归清理被策略拒绝的状态如实保留，未换路径重试。三轴定向补审均为零遗留发现；全部四项已修复。初审、验证及修复补审前后可信快照均一致。最后精确密钥值扫描覆盖源码、构建、服务资产和日志/证据，未命中；.env仍忽略。Git diff --check 通过（已有CRLF提示保留）。Git 未提交或推送。

## 下一步

先实现 GPU 单实例租约、平台实例与 Attempt 绑定及可恢复远程通道；取得明确的收费资源授权后，才能在所选实际 GPU/镜像上核实公共路径挂载并跑完整指纹。随后接真实文本 SFT/LoRA、Best/Final 回传和独立 vLLM 推理。
