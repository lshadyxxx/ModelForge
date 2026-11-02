# Runtime compatibility baseline（2026-11-02）

## 本轮结果

票据 06 已从“页面可自由选任意模型、模板、GPU 和镜像，后端只检查库存”推进到版本化兼容基线与提交前硬门禁。当前基线 ID 为 `qwen3-0.6b-rtx4090-cn-bj2-partial-20261102-r1`，SHA-256 为 `e88471f9ddee563edab1bb11413193422c6450873fe402e10c549bdc275f7b4b`，状态为 `partial`：一个组合的完整训练、独立推理和训练峰值已经真实验证；容量边界和更广兼容矩阵仍未完成，因此票据保持开放。

基线文件是 `backend/src/modelforge/runtimes/compatibility-baseline.json`。加载时严格校验字段，并与当前训练、推理 runtime lock 的 ID、SHA-256 以及数据集/模型运行时容量设置逐项交叉核对。任何配置版本、lock、数值上限或锁定标志漂移都会 fail closed。`GET /api/v1/runtime/baseline` 以 `Cache-Control: no-store` 返回基线 SHA-256、规范化容量、已支持组合和仍需收口的门禁。

## 已支持组合

- 基座：`qwen3`，完整清单指纹 `ffeb1654eaf9f55ac1ece9d1396c006cb17ff6d18f2d21a120fd0cef28a0166a`。
- 训练参数：1 epoch、学习率 `0.0002`、cutoff 512、batch 1、梯度累积 1、LoRA rank 8 / alpha 16 / dropout 0、cosine、warmup 0、模板 `qwen3_nothink`。随机种子可调整。
- 硬件与镜像：华北一 `cn-bj2/cn-bj2-03`、14 CPU、65,536 MiB、单卡 RTX 4090 24GB 级设备、镜像 `compshareImage-1fc8fjody17l`、100 GB `CLOUD_SSD`、Postpay。训练实测 CPU 平台为 `Amd/Auto`，推理实测为 `Auto`；两者都是硬门禁。
- 训练 runtime lock：`ucloud-cuda13.2-llamafactory-0.9.5-qwen3-20261101-r2`，SHA-256 `08a1c34b453406bd4a6d89ce5241827e973766d936baae6cc24378edb3cc032a`。
- 推理 runtime lock：`ucloud-cuda13.0-vllm-0.32.0-qwen3-20261101-r1`，SHA-256 `e4e0a0ccc190393978b4e81b74d3df350a5b2913cf1fc005a123a08c69ac355b`。
- 推理 Adapter 参数：rank 8、模型长度 512、模板 `qwen3_nothink`；服务加载后的空闲设备占用样本为 `20,587,741,184` bytes。该值不是请求峰值。

训练+推理组合的真实证据仍为 Attempt `02504b93-efb7-4258-9029-45a963b07d47`：22 step、平均训练 loss `1.7858700981490652`、验证 loss `0.2147834300994873`、退出码 0。Best Adapter `29fe9ea2-e11c-5dee-900d-73cc256d9b70` 与 Final Adapter `f48e77f1-adca-5f3f-86fc-00456dac2c0c` 已通过 MinIO 回读校验。独立推理 Trial `3e73bdb1-f05b-4390-a0b9-a8ca09dc9e92` 使用同一基座内容指纹和 Best Adapter 完成真实生成。训练峰值由独立 Attempt `fbbe9980-1b83-44b9-9880-422efb4a1f4d` 在同一精确规格上测得；该 Attempt 产出的 Adapter 未做推理验收，因此不进入可推理 Adapter 允许列表。

## 提交前门禁

训练提交会依次检查模型架构、完整内容指纹、实测参数预设和实例地域/可用区/GPU/CPU/内存/CPU 平台/镜像/磁盘/计费方式。推理提交会检查 Adapter 绑定的同一基座、训练参数、旧基线身份和完整推理实例硬件。失败返回 `runtime_model_unsupported`、`runtime_model_version_unsupported`、`runtime_parameters_unsupported`、`runtime_hardware_unsupported` 或 `runtime_baseline_changed`，并在 `details.mismatches` 中给出 expected/actual。

前端从同一基线读取模型允许列表、训练默认/锁定字段、Adapter 可选项和对话上限。当前 11 个训练预设控件锁定，只有随机种子可调；对话默认 128 generated tokens、上限 256，消息数最多 20，单条和总输入字符上限均为 12,000。后端仍以模型 tokenizer 的 512 token 长度作为最终拒绝门禁。旧 Adapter 只允许基线中记录的两个真实 Best/Final 产物及其精确指纹；无兼容 pin 的未知 Adapter 会被拒绝。

## GPU 峰值采集

训练库在独立子进程运行，父进程的 `torch.cuda` 峰值原本无法覆盖它。本轮新增两类证据：

- 训练子进程结束后写入 `gpu/torch-peaks.json`，记录 `max_memory_allocated` 和 `max_memory_reserved`。
- 父进程每 250 ms 执行 `nvidia-smi --query-gpu=memory.used`，将设备采样、设备峰值、Torch 峰值和退出码汇总到 `gpu-memory.json`，同时写入运行报告。

两项证据随 Successful Attempt 归档，`gpu-memory.json` 已成为成功训练的必需证据文件。用户授权的精确规格实例 `<redacted-instance-id>` 完成 22 step 后退出码为 0；MinIO 回读的 `gpu-memory.json` SHA-256 为 `d97f3a0534f85a12f6258cf8ea8dc429b38c88d0ad3a1c3a4fed0d09bddfeb57`，记录了 92 个 250 ms 样本：

- 设备峰值 `2,580,545,536` bytes（`2.403 GiB`）。
- Torch allocated 峰值 `1,659,389,440` bytes（`1.545 GiB`）。
- Torch reserved 峰值 `1,686,110,208` bytes（`1.570 GiB`）。
- `sampler_error=null`、`process_exit_code=0`，设备峰值低于基线记录的 `25,280,839,680` bytes。

基线证据同时保留旧训练/推理组合和独立的 peak Attempt，并校验 measured 状态、样本数、采样间隔及 Torch/设备峰值大小顺序。训练完成后，`<redacted-instance-id>` 自动回收；先前规格不匹配的 `<redacted-instance-id>` 和另一台临时实例 `<redacted-instance-id>` 也已停止并终止。三个实例均以连续精确 ID 查询 `TotalCount=0` 作为删除完成证据。

## 运行时准备门禁

精确镜像默认没有 `/opt/modelforge-venv`。首次真实成功依赖人工先安装运行时再绑定；如果绑定后立即传输输入，缺失或漂移的运行时会表现为通用远程失败。本轮在产品流程中增加了只读预检：

- 训练和推理 Worker 在传输数据集、模型或 Adapter 前调用远端 `runtime_check`。
- 预检使用后端配置的 venv Python，核对 Python、运行时锁中的每个包版本、`pip check`、CUDA 版本、CUDA 可用性和单 GPU 数量。
- 解释器或 SSH 配置缺失返回 `gpu_runtime_not_ready`；版本或依赖漂移返回 `gpu_runtime_incompatible`，并保留 `mismatches` 事实、实例和 Lease。
- 预检失败不会创建运行目录、传输输入或启动训练/推理。用户修复运行时后，Worker 可在同一实例上重试；取消请求也无需在运行时缺失时先建立远程会话。
- 训练脚本仍会再次校验完整 runtime lock，预检不是训练执行的替代证据。

2026-11-02 已在用户授权的付费实例 `<redacted-instance-id>` 上完成真实双向验收。该实例与基线精确匹配 `cn-bj2/cn-bj2-03`、14 CPU、65,536 MiB、单卡 RTX 4090、镜像 `compshareImage-1fc8fjody17l`、100 GB CLOUD_SSD 和 Postpay：

- 临时移走 `/opt/modelforge-venv` 后，生产 `RemoteChannel.runtime_check` 返回 `gpu_runtime_not_ready`；随后通过 SSH 核对对应 UUID 工作目录不存在。
- `prepare-gpu-runtime.sh train` 安装固定运行时成功，远端 `pip check` 通过并报告 `NVIDIA GeForce RTX 4090`。
- 恢复运行时后，同一预检返回 Python `3.13.5`、CUDA `13.2`、14 个锁定包全部一致、单 GPU、`25,280,839,680` bytes、`mismatches=[]`；成功路径同样没有创建工作目录。
- 预检捕获时 `remote_agent.py` SHA-256 为 `58d361c3cede7a3bb8965aa9c572b80eb08da53bc76b823a5df72d9135206ce7`；负向与正向原始 JSON 位于 `.runtime/evidence/gpu-runtime-preflight-20261102/`。
- 验收后实例执行 Running → Stopping → Stopped → Terminate，连续精确查询均为 `TotalCount=0`。未绑定密钥的临时实例 `<redacted-instance-id>` 和自动化密钥交接失败的 `<redacted-instance-id>` 也均已停止、删除并核对不存在。

优云当前 CompShare 容器实例的终止成功响应实际只返回 `UHostId`，没有旧文档记录的 `InRecycle`；本地适配器已允许该字段缺失，但仍拒绝错误的实例 ID 或非法非空值，并继续以终止后的连续精确空查询作为最终释放证据。

## 容量状态

数据集仍为单文件 100 MiB、100,000 样本、单行 1 MiB、100 个校验错误、20 个预览样本；模型仍为单文件 20 GiB、目录 100 GiB、10,000 文件。配置版本为 `conservative-2026-11-02`，全部数值已写入兼容基线，并与 `MF_DATASET_*` / `MF_MODEL_*` 运行时设置严格比较。已有真实观测仅为 dataset 4,836 bytes / 24 samples，model 11 files / 1,519,209,873 bytes；加载时会拒绝观测值超过声明上限的基线。

`locked` 继续保持 `false`。数值完整性和“容量边界已经实测”是两件事：本轮只证明配置不可静默漂移，没有把未测试上限冒充为已校准容量。

## 验证

- 后端宿主：`290 passed, 194 skipped`；跳过项仍需隔离 PostgreSQL/MinIO 或真实服务条件。
- 根级全量：`329 passed, 194 skipped`，包含后端与根级验收脚本测试。
- 前端：`21 passed`。
- TypeScript/Vite production build：通过。
- 当前镜像隔离 PostgreSQL/MinIO 全量：`483 passed, 1 skipped, 1 warning`，耗时 178.50 秒。测试使用一次性数据库 `modelforge_test_141042e7e56e454b8115e2e3582af7fb` 和 bucket `modelforge-test-141042e7e56e454b8115e2e3582af7fb`；删除 234 个对象后 bucket 无剩余对象，数据库与 bucket 均二次确认不存在。
- 实时契约验收：`python scripts/acceptance-runtime-baseline.py` 通过，确认 `Cache-Control: no-store` 和所有容量数值与基线一致；`--require-complete` 仍会因容量边界未实测和兼容矩阵仅覆盖单一组合而失败，这是预期的票据开放状态。
- 当前部署：Web `http://127.0.0.1:8092`、API `http://127.0.0.1:8102`；后端镜像 `sha256:0ae29db62fe3877f03fc78da155028371ee2571cd00989b12762ed190eaf272c`，Web 镜像 `sha256:aa940175c1343d7b89c3cc5508c679531494c2bfd3419f0990de7de623243b89`。
- 真实 HTTP 反向探针：训练 `cutoff_len=1024` 返回 `422 runtime_parameters_unsupported`，推理 `gpu_type=A100` 返回 `422 runtime_hardware_unsupported`；请求前后 dataset/model/Attempt/Trial/Adapter 计数均为 `1/2/2/4/2`。
- 隔离浏览器：`ego-browser` TaskSpace 22 验证桌面 1695px 与 390px 均无横向溢出，工作台呈现关键指标、最近训练、下一步动作和最近活动；训练锁定字段与两个 legacy Adapter 兼容性仍通过。训练和推理页面的收费资源确认弹窗均展示精确 `cn-bj2 / cn-bj2-03`、RTX 4090、14 CPU、65,536 MiB、`compshareImage-1fc8fjody17l`、100 GB CLOUD_SSD 与后付费，并明确平台不会采购或预留资源；取消弹窗未创建 Attempt 或确认 Trial。窗口保持最小化，因此证据为语义 DOM 与 viewport emulation，没有截图。

## 仍然开放

- 针对上传大小、文件数、transfer、模型总量和对话 token 边界做有预算的边界测试；通过后才设置 `locked=true`。
- 扩展并逐个实测更多模型、GPU、镜像和参数组合。当前仅开放一个组合。
