# MVP 工作流实施与验收记录（2026-11-01）

## 当前边界

训练、产物、独立推理及六入口 UI 已实现，当前部署为后端 `mvp-release-20261102-r1`、Web `mvp-release-20261101-r6`。真实 Qwen3-0.6B SFT/LoRA 已在人工创建的 RTX 4090 实例上完成：Attempt `02504b93-efb7-4258-9029-45a963b07d47` 训练 22 step，平均 `train_loss=1.7859`、`eval_loss=0.2148`、退出码 0；Best/Final Adapter 已发布到 MinIO 并完成 SHA-256 回读，训练实例 `<redacted-instance-id>` 已停止、删除并确认租约释放。另一台人工创建的推理实例 `<redacted-instance-id>` 已从 MinIO 恢复同一基座和 Best Adapter，在固定 vLLM 运行时中通过真实 Adapter 生成探针；平台 SSE 的两轮上下文、生成中取消、取消后新请求、Worker 重启、客户端断流恢复和十五分钟空闲回收均已通过。修复 FlashInfer 采样依赖后的 r1 镜像又在一台全新人工实例 `<redacted-instance-id>` 上完成真实页面生成，并通过页面手动结束：Trial `3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92` 进入 `stopped`，进程退出、精确实例查询连续为空、Lease `a5f27ee5-8cbd-43e5-8a9f-0dee4feb17d9` 全部到达释放终态。`ego-browser` 隔离验收覆盖六页桌面、390px移动布局、真实目录/历史详情及训练/推理收费确认弹窗，并发现、修复和复验了空镜像名参数导致请求验证失败的问题。单模型、单卡 RTX 4090、手动收费实例的 MVP 生命周期门禁至此闭合；容量上限、完整模型/GPU兼容矩阵和面向更多用户的生产部署仍属于后续范围。用户明确要求收费实例由本人手动创建，Worker 不调用收费创建接口；提交收费实例要求前，训练与推理页面都会先显示模态确认，列出规格并说明平台不会购买或预留资源。关联必须核对真实供应商实例、固定规格、owner/generation 和停止/删除授权。

## 实现

- 0009/0010/0011：单 GPU 持久租约、实例操作及手动绑定、不可变 Task/Attempt、日志、Best/Final、独立 trial 与请求期限。
- OpenSSH 仅从后端读取端点、私钥和已核实 known_hosts；每次执行分配 UUID 工作目录，文件校验、持久启动回执、进程组退出确认。未知状态保留租约和实例。
- 文本 SFT/LoRA 使用 LLaMA-Factory 0.9.5 候选适配器；控制参数、真实分词预检、实际 Loss、确定性 Best 与 Final。成功输出完整回传并回读校验后原子发布两个版本。
- 已失败/取消且进程组退出确认时，日志/诊断回传故障记录缺口并继续安全回收；成功输出回传失败继续保留唯一副本。
- 独立 vLLM 0.32.0 候选运行时从正式资产恢复，核对同一基座指纹，实际 Adapter 生成探针后 ready。私有 loopback HTTP，页面内会话、单请求、取消屏障、断流期限及空闲十五分钟回收。训练与推理分别使用随任务上传并冻结 SHA-256 的运行时锁；GPU 加载模型前核对 Python、CUDA 和关键 Python 包，任一漂移即拒绝启动。
- 空闲回收以条件 SQL 与请求准入共享行锁；中断回答保留显示但不进入后续完整上下文。
- 运行时实现模块公开的 TrainingExecutor/ServingExecutor，具体命令、脚本及报告格式归适配器；bootstrap 统一装配 HTTP 传输与 Worker 执行器。
- 训练/模型页展示 Best/Final 状态、来源和指标；试用页展示基座、Adapter 与回收期限；训练取消有明确确认。
- 训练与独立推理提交前显示收费资源确认弹窗，说明后续由用户在优云控制台手动创建实例；确认后才创建 Task/Trial。收费实例仍通过页面回填实例 ID、所有权确认和清理授权显式绑定。

## 验证与审查

证据目录：`<home>/AppData/Local/Temp/modelforge-mvp-20261101-6a47c3b3`。

第一轮独立 QA 复现四项故障（日志尾部、代理超时、取消竞态、部分产物提前发布）；修复后独立复验完整 HTTP/SQL/MinIO 相邻流程、5MiB 跨块 UTF-8 日志、27秒 SSE/205段、普通9秒云查询、busy409、模拟时钟下的请求过期和十五分钟回收。原报告与复验报告分别保留，不覆盖历史结果。

修复前完整后端425通过、1跳过；随后三轴host-only审查及同家族独立验证确认9条发现（跨轴包含重复问题）。后续补审又确认Top P表单边界与旧Attempt的Adapter分页两个P2；修复分别加入实际字段/RPC覆盖、分页测试和前端分页请求。r3 隔离 PostgreSQL/MinIO 完整后端回归为439通过、1跳过；r5 加入训练/推理运行时锁和真实训练兼容修复后，最终隔离回归为445通过、1跳过。唯一跳过项是需要运行中 Web/API 的可选 Web-origin 大文件上传。r6 修复实例表单在镜像名为空时仍发送 `name=` 的缺陷，前端18通过，TypeScript/Vite生产构建通过。独立QA覆盖故障退出后的安全回收、成功产物同步失败保留、请求准入/空闲回收竞态、跨块Unicode日志、205段SSE、取消屏障、测试时钟和完整HTTP/SQL/MinIO流程。

本地实际 OpenSSH 检查通过：hash传输、持久启动回执、重复启动不重跑、退出/进程组退出、取消、日志以及未知主机密钥拒绝。该检查没有 GPU，不能代替云端训练。测试服务器与临时私钥已清理。

## 本地发布与数据保全

- 发布前业务库为 `0008_external_base_models`；备份 SHA-256 为 `2ce1900843fd601e2ace6af714a1bdbed9da92b15f3a6bdac75517aaeed6e9c9`。备份副本已在隔离数据库演练升级到 `0011_execution_workflows`。
- 正式迁移成功到 `0011_execution_workflows`；原有数据集、模型、文件清单和传输记录行数保持不变。
- 当前运行后端镜像为 `modelforge-backend:mvp-release-20261102-r1`（镜像 ID `sha256:317a8cf964b28ec34b33ce039b432dbad66d6eed2fb5c576314d9fc296f0ef8e`），Web 为 `modelforge-web:mvp-release-20261101-r6`（镜像 ID `sha256:047a1872cc002129d8e03390750e00c165d9bb3f1c0018b1d80d90c19a517bd9`）。r1 在 r5 的训练/推理运行时锁、配置入口兼容和精确空查询回收逻辑上，显式禁用需要 `ninja` 临时编译的 FlashInfer 采样路径；r6 统一用 `imageDirectoryQuery` 构造镜像查询，过滤空白名称并修复实例表单镜像列表始终为空的问题。
- API、Worker 均健康；Web 首页、直连健康、同源健康、概览、数据集和模型路由均返回200。部署后的JS/CSS包含手动创建确认弹窗，服务日志未发现ERROR、Traceback或Exception。
- 部署后正式MinIO `modelforge` 桶仍为11个对象、1,519,209,873字节，逐对象SHA-256与迁移前基线完全一致。
- 本轮隔离数据库 `modelforge_test_mvp_6a47c3b3`、`modelforge_test_upgrade_6a47c3b3` 和测试桶 `modelforge-test-mvp-6a47c3b3` 已按精确名称清理。

## 真实门禁状态

- 已验证：全新人工收费实例上的真实 Adapter 页面生成、页面手动结束、进程组退出、云实例删除和 GPU Lease 释放。首次失败 Trial `a99b49c6-c3e4-44bb-a7b5-97e40cd3caf1` 与修复后成功 Trial `3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92` 均独立完成回收，不能用自动空闲回收推断手动路径。
- 容量上限最终锁定和完整模型/GPU兼容矩阵。

建议首轮候选为平台已托管Qwen3-0.6B（11文件、1,519,209,873字节），LoRA rank8、cutoff2048、batch1。2026-11-01 15:36北京时间只读目录与库存观察：上海二区cn-sh2/cn-sh2-02，单RTX4090 24GB、16核、64GiB，应用镜像cuda128_torch291_py312（compshareImage-1minbz219ceq），100GB CLOUD_SSD，Postpay。这是待实测候选，库存和价格以下单时为准，不是已锁定兼容基线。

## 2026-11-01 真实训练实例准备增量

用户手动创建实例`<redacted-instance-id>`，只读供应商查询确认其位于华北一`cn-bj2-03`、Running、单RTX 4090 24GB、14 CPU、64GiB内存，镜像为应用镜像`cuda128_python312`（`compshareImage-1fc8fjody17l`）。该镜像目录标签含PyTorch，但实例实际默认`python3`为3.10.12且没有`pip`/`torch`；镜像另带Python 3.13.5 Miniconda。`prepare-gpu-runtime.sh`已改为显式发现Python >=3.11，并支持`MODELFORGE_PYTHON`覆盖。

在实例上安装LLaMA-Factory 0.9.5后，`pip check`通过；实际环境为Python 3.13.5、torch 2.15.0+cu132、CUDA 13.2、transformers 5.6.0、peft 0.18.1。RTX 4090设备可见，实际CUDA矩阵乘法成功，Qwen3-0.6B tokenizer从优云只读目录加载并生成32 token的受控模板样本。该结果证明训练运行时前置兼容，不替代真实SFT/LoRA、产物回传和独立vLLM验收。

首轮 Attempt `1bb8f907-b129-4042-a073-7af8d6bcb9b2` 通过公开 HTTP 创建并绑定该实例。平台完成 24 条样本输入传输，runtime report 记录 RTX 4090、2,528,083,968字节显存和上述版本；token preflight 覆盖 22 train / 2 validation，全部 41–43 token，无 overflow。随后 LLaMA-Factory 0.9.5 CLI 在 `json.load(Path(...))` 处失败，GPU 未进入训练。原始日志、runtime report、preflight、execution manifest 与失败回执均已保留。

r3 将已解析配置直接传给公开 `run_exp` 入口并继续使用独立子进程。终止响应无法验证但实例随后持续从精确 ID 查询消失时，平台要求终止请求已发出且再取得一次成功的空查询后才记录删除并释放租约。旧实例 `<redacted-instance-id>` 已从优云目录和 SSH 端点消失，租约 `b5afded3-dcfb-4a7b-939a-7be0e7e2ca7a` 已为 `released/deleted/confirmed`。

## 2026-11-01 真实训练与 r5 完成增量

用户手动创建 `<redacted-instance-id>`，平台核对为华北一 `cn-bj2/cn-bj2-03`、单卡 RTX 4090 24GB、14 CPU、64GiB 内存、镜像 `cuda128_python312`（`compshareImage-1fc8fjody17l`）、100GB CLOUD_SSD、Postpay。Attempt `02504b93-efb7-4258-9029-45a963b07d47` 完成 24 条样本的确定性拆分和 token preflight（41–43 token，无 overflow），以 Qwen3-0.6B、LoRA rank 8、cutoff 512、batch 1、1 epoch 跑完 22 step；平均训练 loss 1.7859，最终验证 loss 0.2148，退出码 0。

Best `29fe9ea2-e11c-5dee-900d-73cc256d9b70` 与 Final `f48e77f1-adca-5f3f-86fc-00456dac2c0c` 两个 Adapter 均为 `available`，各含 `adapter_config.json` 和 20,236,472 字节的 `adapter_model.safetensors`，分别位于 `adapters/<id>/`。MinIO 回读 SHA-256 与上传清单一致。租约 `8cd33c1b-4f9f-4930-b4ad-02c6840b2c8c` 最终为 `released/deleted/confirmed`，实例精确 ID 连续空查询后确认不存在。

训练运行时锁 ID 为 `ucloud-cuda13.2-llamafactory-0.9.5-qwen3-20261101-r2`，SHA-256 为 `08a1c34b453406bd4a6d89ce5241827e973766d936baae6cc24378edb3cc032a`。新增推理锁 ID 为 `ucloud-cuda13.0-vllm-0.32.0-qwen3-20261101-r1`，固定 Python 3.13.5、CUDA 13.0、vLLM 0.32.0、Torch 2.13.0、Transformers 5.19.0、Tokenizers 0.23.3、Hugging Face Hub 2.4.0 及 HTTP 关键包版本，SHA-256 为 `e4e0a0ccc190393978b4e81b74d3df350a5b2913cf1fc005a123a08c69ac355b`。推理健康响应必须同时匹配该锁、真实 Adapter 指纹和生成探针，任一不符不得进入 ready。

2026-11-01 20:53 北京时间实时只读库存：华北一 `cn-bj2-03` 的 RTX 4090 当前无货；华北二 `cn-wlcb-01` 有单卡 4090 24GB、16 CPU、64GiB 内存的容量。推理实例候选仍使用镜像 `cuda128_python312`（`compshareImage-1fc8fjody17l`）、100GB CLOUD_SSD、Postpay，价格与最终库存必须在控制台下单页面再次确认。该实例必须由用户手动创建。

已创建本地 Trial `29efb08d-f4c7-4da1-9b5c-d180c18e6334`，状态为 `waiting_instance`；选择 Best Adapter `29fe9ea2-e11c-5dee-900d-73cc256d9b70`，关联 held 租约 `a135d290-d8ea-4efe-9778-9755355e724b`。该操作只固定本地快照并排队，没有调用优云创建接口、没有预留容量，也没有产生费用。实例由用户创建并通过精确 ID 与供应商字段核对后，再显式绑定和授权清理。

## 2026-11-01 真实独立推理增量

用户手动创建 `<redacted-instance-id>` 后，平台只读优云接口核对为华北一 `cn-bj2/cn-bj2-03`、单卡 RTX 4090 24GB、14 CPU、64GiB 内存、镜像 `cuda128_python312`（`compshareImage-1fc8fjody17l`）、100GB CLOUD_SSD、Postpay。为匹配实际 14 CPU 规格，旧华北二 16 CPU Trial `29efb08d-f4c7-4da1-9b5c-d180c18e6334` 在未创建云资源时本地停止；新 Trial `47917c40-ab2d-43c2-8e09-b59a6ae5466b` 与租约 `a1f8e5de-5549-4b96-9ab0-00fdf3799eef` 通过正式 API 绑定该实例并显式确认清理授权。

实例实际安装并报告 Python 3.13.5、CUDA 13.0、vLLM 0.32.0、Torch 2.13.0、Transformers 5.19.0、Tokenizers 0.23.3 和 Hugging Face Hub 2.4.0；`pip check` 无冲突。推理运行锁为 `ucloud-cuda13.0-vllm-0.32.0-qwen3-20261101-r1`，SHA-256 为 `e4e0a0ccc190393978b4e81b74d3df350a5b2913cf1fc005a123a08c69ac355b`。健康响应只在单卡 RTX 4090、零版本漂移、基座指纹 `ffeb1654eaf9f55ac1ece9d1396c006cb17ff6d18f2d21a120fd0cef28a0166a`、Best Adapter 指纹 `780954de248533a08a91f7efc61c491192bdc00ac1d15fc4a2dc76519965fb7b` 和真实 Adapter 生成探针同时成立时返回 ready。引擎加载后的空闲采样为总显存 `24564 MiB`、已用 `19634 MiB`、剩余 `4477 MiB`；这是服务加载样本，不冒充请求峰值。

正式 SSE 验收使用 Best Adapter `29fe9ea2-e11c-5dee-900d-73cc256d9b70`。第一组两轮请求分别成功，但模型只答出暗号前缀“青岚”、漏掉后缀；该不完整结果原样保留，不判通过。第二组以六位标记 `731204` 重测，第一轮输出 `OK.`，第二轮精确输出 `731204`，两个请求 ID 不同，证明页面上下文被携带且旧请求未阻塞下一轮。

生成中取消使用长文本请求，取消前已产生非空 partial 文本；SSE 终态为 `state=cancelled, partial=true`，随后新请求返回 `恢复成功。`，证明取消只结束当前生成并越过 vLLM 引擎 idle barrier。Worker 容器重启后 Trial 保持 `ready/idle`，重启后的真实请求返回 `Worker恢复成功。`。另一次测试在首个 delta 后直接断开客户端且不调用取消 API；后端在约 92 秒真实流租约到期后清理该请求，随后新请求成功，证明关闭页面不会永久占用当前生成。

原始 SSE、运行锁报告、运行基线、进程日志、健康响应、Worker 重启/断流恢复和租约快照保存在 `.runtime/evidence/inference-<redacted-instance-id>/`。该目录是本地被 Git 忽略的证据，不包含私钥、SSH 主机端口、云 AccessKey 或运行时 token。

## 2026-11-01 空闲回收、浏览器与 r6 增量

十五分钟空闲门禁按真实墙钟通过。Trial `47917c40-ab2d-43c2-8e09-b59a6ae5466b` 的最后活动时间为 `22:53:18`，`23:08:27` 自动进入 `stopping` 并记录 `stop_requested=true`，`23:08:49` 为 `stopped`。进程组以 `-15` 退出；精确实例 ID `<redacted-instance-id>` 连续两次查询均为 `total=0/state=empty`。Lease `a1f8e5de-5549-4b96-9ab0-00fdf3799eef` 最终为 `released`、`process_state=exited`、`instance_state=deleted`、`cleanup_state=confirmed`，`released_at=23:08:39.519497`。事件中保留了一次 `deletion_failed`，随后 `deletion_confirmed`，没有用数据库改写或 fixture 替代。

浏览器验收使用 `ego-browser` TaskSpace `3`。工作台、数据集、模型、计算环境、训练、推理六页均加载真实 API 数据；桌面无整页横向溢出，390px移动视图六页的 `scrollWidth` 均为 `390`。训练页确认“请手动创建训练实例”“不会调用优云创建接口”、后付费和回填实例 ID；推理页确认“请手动创建独立推理实例”“独立于训练的新实例”和后付费。两处均点击返回，没有创建任务、试用或云资源。

`ego-browser` TaskSpace `3` 的首轮语义交互发现实例表单把空的 `name=` 参数发送给后端，镜像目录接口返回 `Request validation failed` 且列表为 0。r6 复用 `imageDirectoryQuery` 对名称去除首尾空白并省略空参数；新增回归测试后前端18通过、生产构建通过，只重建 Web。随后使用临时 profile 的后台 headless Chrome 完成正式复验：六页桌面和390px移动布局无整页横向溢出，训练镜像10条、推理应用镜像62条，两处收费确认内容逐项通过，真实目录和无控制台/页面/非取消请求错误。正式报告与截图在 `.runtime/evidence/browser-isolated-20261101/formal-r6/`；Ego 调试截图保留在 `ego-r6/`。

## 2026-11-02 手动结束、真实失败与 r1 采样器修复增量

用户手动创建 `<redacted-instance-id>` 后，平台通过精确实例查询确认其为华北一 `cn-bj2/cn-bj2-03`、单卡 RTX 4090、14 CPU、64GiB 内存、镜像 `cuda128_python312`（`compshareImage-1fc8fjody17l`），状态 Running。后端仅从该精确实例响应的 SSH 登录命令取得连接坐标，连续三次主机密钥扫描得到一致的 ECDSA、ED25519、RSA 公钥；连接坐标、私钥和已知主机文件只进入本地后端配置目录，未进入日志、页面或证据 JSON。运行时安装报告 Python 3.13.5、CUDA 13.0、vLLM 0.32.0、单张 `NVIDIA GeForce RTX 4090`，`pip check` 通过。

Trial `a99b49c6-c3e4-44bb-a7b5-97e40cd3caf1` 通过正式 API 绑定该实例后进入 `ready/idle`，健康接口同时返回固定运行时锁、基座/Adapter 指纹和真实 Adapter probe。页面发送首个短请求时 vLLM 选择 FlashInfer sampled top-p JIT，优云新镜像没有 `ninja`，EngineCore 在首次采样时退出，页面得到 `request_state_unknown`。原始进程日志、失败 Trial 快照与截图保存在 `.runtime/evidence/manual-end-20261101/`，该失败没有被改写成成功。

r1 在远端 runtime 模块加载 vLLM 前强制设置 `VLLM_USE_FLASHINFER_SAMPLER=0`，改用 vLLM 自带采样路径，不新增宿主机工具或放宽运行时锁。新增回归测试后后端全量为 255 通过、192 跳过；后端镜像 `mvp-release-20261102-r1`（`sha256:317a8cf964b28ec34b33ce039b432dbad66d6eed2fb5c576314d9fc296f0ef8e`）已重建并部署，API、PostgreSQL、MinIO 与 Worker 全部健康，部署镜像内验证采样开关为 `0`。

随后通过 Ego 页面的“结束试用并回收实例”按钮手动结束上述失败 Trial。Trial 状态为 `stopping → stopped` 且 `stop_requested=true`；远端进程回执为 exited；精确实例 ID 连续两次供应商查询均为 `total=0/state=empty`；Lease `538b220c-8d09-4293-a460-d4b31dc4ee03` 最终为 `released / exited / deleted / confirmed`，`released_at=2026-11-02T00:00:53.188558+08:00`。事件中保留了一次 `deletion_failed`，下一次精确空查询后才记录 `deletion_confirmed`。

## 2026-11-02 修复版最终成功与手动回收增量

用户手动创建最终收费实例 `<redacted-instance-id>` 后，平台通过精确供应商查询确认其为华北一 `cn-bj2/cn-bj2-03`、Running、单卡 RTX 4090、14 CPU、64 GiB 内存、镜像 `cuda128_python312`（`compshareImage-1fc8fjody17l`），再通过正式 API 绑定 Trial `3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92` 与 held Lease `a5f27ee5-8cbd-43e5-8a9f-0dee4feb17d9`。冻结运行时安装在远端报告 Python 3.13.5、CUDA 13.0、vLLM 0.32.0、单张 `NVIDIA GeForce RTX 4090`，`pip check` 无冲突；安装日志为 70,645 字节、476 行。

平台完成 11 个基座文件与 Best Adapter `29fe9ea2-e11c-5dee-900d-73cc256d9b70` 的恢复、SHA-256 校验和私有运行时启动。启动期间 `/health` 在监听端口尚未建立时曾被通道短暂归类为 `remote_state_unknown`；Agent 状态同时确认进程组仍在运行，Uvicorn 开始监听后 Trial 自动进入 `ready/idle` 并清除错误码。就绪健康响应为 `ready=true`、真实 Adapter probe 为真、运行时锁 SHA-256 为 `e4e0a0ccc190393978b4e81b74d3df350a5b2913cf1fc005a123a08c69ac355b`，模型权重加载 1.14 GiB、GPU KV cache 17.38 GiB；进程日志明确记录 `VLLM_USE_FLASHINFER_SAMPLER=0`，未再触发 FlashInfer JIT。

`ego-browser` 在 TaskSpace `3` 的隔离页面中向该 Trial 发送“请只回复：手动回收验收通过”，最大生成 32 token；页面渲染出模型非空回答“手动回收验收通过”，没有 `role=alert`，请求最终回到 `idle`。随后点击“结束试用并回收实例”，Trial 经历 `stopping → stopped` 且 `stop_requested=true`。精确实例 ID 连续两次供应商查询均为 `total=0/state=empty`；Lease 最终为 `released`、`process_state=exited`、`exit_code=-15`、`instance_state=deleted`、`cleanup_state=confirmed`，`cleanup_error_code=null`，`released_at=2026-11-02T00:36:38.521267+08:00`。页面终态显示“已结束”和错误“无”。

原始证据保存在 `.runtime/evidence/manual-end-20261101/`，包括最终安装、就绪与进程日志，真实回答及终态页面截图，Trial/健康/停止轮询，两次精确空查询和数据库只读 Lease 快照；机器可读汇总为 `final-<redacted-instance-id>-acceptance-summary.json`。证据不包含私钥、SSH 主机端口、密码、运行时 token 或云 AccessKey。该轮只在最终页面点击一次请求和一次手动回收，没有改写数据库或伪造云状态。

## 2026-11-02 工作台重构与票据状态收口

首页工作台在提交 `b8987dd` 中改为真实资产与运行状态驱动的紧凑布局：服务健康条、五项关键指标、最近训练与 Loss、训练环境、下一步动作、最近活动及 Attempt 配置复用均接入真实 API。最终验证为后端定向 `6 passed`、全量 `261 passed, 192 skipped`，前端 `18 passed` 和生产构建通过；`ego-browser` 在同一 TaskSpace 内确认桌面 `1697/1697`、390px `390/390` 无页面横向溢出，可见文字最低 10px，健康详情、真实活动、推理入口及“复用 #2 配置”均通过，页面无 alert 或运行错误。

截至本次收口，当前 API 报告 API、PostgreSQL、MinIO、Worker 全部 up，已有 1 个发布数据集、1 个基础模型、2 个可用 Adapter，GPU 空闲且无运行中任务。历史失败 Attempt 仍作为待处理记录保留。实现票据 02–14 中除 06 外均按各自当前范围关闭；Hugging Face 暂缓范围另立票据 16。票据 06 继续跟踪尚未完成的容量校准和完整兼容矩阵，票据 15 因依赖 06 保持开放。
