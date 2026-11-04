# 推理试用真实 GPU 闭环验收

Status: PASS  
Date: 2026-11-04  
Trial: `da4dfd18-bff6-4064-9998-2ff882610405`  
Instance: `<redacted-instance-id>`  
Scope: ModelForge「推理试用 / Serving」，不包含「训练 / Training」

## 1. 结论

本轮使用真实付费单卡实例完成了新的 Serving 闭环：

1. 精确规格实例创建并进入 `Running`。
2. 安装并校验 CUDA 13.0 / vLLM 0.32.0 / torch 2.13.0 运行时。
3. 通过正式 API 创建 Trial、生成租约并绑定手动实例。
4. Worker 上传真实基座模型与 Adapter，启动 vLLM，并通过 Adapter generation probe。
5. 通过正式 API 和正式页面分别发送真实消息，均收到 SSE 增量与 `done`。
6. 提交停止请求，确认进程退出、实例停止与删除、清理确认、租约释放。
7. Provider 精确 ID 查询连续两次为 0，数据库当前持有租约为 0。

因此，本轮可以声明“真实 GPU 推理与回收闭环通过”；不能据此声明生产部署、
全后端回归、跨版本浏览器兼容或计费金额已结算。

## 2. 实例与运行时

| 字段 | 实测值 |
|---|---|
| Region / Zone | `cn-bj2` / `cn-bj2-03` |
| GPU | `1 × 4090` |
| CPU / Memory | 14 核 / 65,536 MiB |
| Image | `compshareImage-1fc8fjody17l` |
| CPU Platform | `Auto` |
| Charge | `Postpay` |
| Boot Disk | 100 GB `CLOUD_SSD` |
| 官方报价 | ¥2.15/小时（报价，不是账单） |
| Instance ID | `<redacted-instance-id>` |
| 创建完成 | `2026-11-04T17:05:55+08:00` |

远端运行时实测：

```json
{
  "python": "3.13.5",
  "torch": "2.13.0+cu130",
  "cuda": "13.0",
  "vllm": "0.32.0",
  "transformers": "5.19.0",
  "gpu": "NVIDIA GeForce RTX 4090",
  "devices": 1
}
```

`pip check` 输出 `No broken requirements found.`，运行时退出码为 0。

证据：

- `.runtime/serving-live-20261104/order-capacity-watch.json`
- `.runtime/serving-live-20261104/order-created.json`
- `.runtime/serving-live-20261104/order-ready.json`
- `.runtime/serving-live-20261104/remote-runtime-baseline.json`
- `.runtime/serving-live-20261104/remote-process.log`

## 3. Trial 与模型

| 字段 | 实测值 |
|---|---|
| Trial ID | `da4dfd18-bff6-4064-9998-2ff882610405` |
| Lease ID | `e5edc433-606b-4cb3-b488-75487f9f91f3` |
| Adapter | `29fe9ea2-e11c-5dee-900d-73cc256d9b70` |
| Adapter 来源 | `02504b93-efb7-4258-9029-45a963b07d47` / Best |
| Adapter fingerprint | `780954de248533a08a91f7efc61c491192bdc00ac1d15fc4a2dc76519965fb7b` |
| Runtime lock | `ucloud-cuda13.0-vllm-0.32.0-qwen3-20261101-r1` |
| Trial 创建 | `2026-11-04T17:42:40+08:00` |
| 进入 waiting_instance | `2026-11-04T17:42:41+08:00` |
| 绑定 Running 实例 | `2026-11-04T17:43:01+08:00` |
| 进入 ready | `2026-11-04T18:09:36+08:00` |

健康检查返回：

```json
{
  "ready": true,
  "adapter_probe": true,
  "adapter_fingerprint": "780954de248533a08a91f7efc61c491192bdc00ac1d15fc4a2dc76519965fb7b",
  "vllm_version": "0.32.0",
  "runtime_lock_id": "ucloud-cuda13.0-vllm-0.32.0-qwen3-20261101-r1",
  "gpu": "NVIDIA GeForce RTX 4090"
}
```

## 4. SSE 推理

### 正式 API

请求 ID：`8e115e5f-a8b4-455b-8828-643759254272`

事件序列：

- 1 个 `request`
- 12 个 `delta`
- 1 个 `done`，`state=completed`，`partial=false`

模型输出：

> 是的，这次推理试用已经成功连通。

原始事件流：`.runtime/serving-live-20261104/chat-sse.txt`

### 正式页面

页面：

```text
http://127.0.0.1:8092/?trial=da4dfd18-bff6-4064-9998-2ff882610405#serving
```

页面请求 ID：`265e29b2-bd31-4643-af05-2c3ea3005251`

页面实测：

- 状态为“可以试用”。
- 用户问题与 Adapter 回答出现在同一会话。
- 回答完成后流式指示消失。
- 页面级横向溢出为 `false`。
- 截图：`.runtime/serving-live-20261104/serving-chat-1440.png`

## 5. 停止与回收

| 事实 | 实测 |
|---|---|
| 停止请求 | `2026-11-04T18:11:34+08:00` |
| 进程退出 | `2026-11-04T18:11:41+08:00`，exit code `-15` |
| 实例停止 | `2026-11-04T18:11:51+08:00` |
| 实例删除 | `2026-11-04T18:11:53+08:00` |
| 清理状态 | `confirmed`，策略 `discard` |
| 租约释放 | `2026-11-04T18:11:53+08:00` |
| Trial 最终状态 | `stopped` |

## 6. 硬回收证明

Provider 精确 ID 查询执行两次：

| 次数 | 时间 | TotalCount | UHostSet |
|---|---|---:|---|
| 1 | `2026-11-04T18:12:10+08:00` | 0 | `[]` |
| 2 | `2026-11-04T18:12:13+08:00` | 0 | `[]` |

数据库租约行：

```text
e5edc433-606b-4cb3-b488-75487f9f91f3|released|bound|<redacted-instance-id>|deleted|confirmed|2026-11-04 10:11:53.008895+00
held|0
```

证据：

- `.runtime/serving-live-20261104/provider-empty-twice.json`
- `.runtime/serving-live-20261104/db-release-proof.txt`
- `.runtime/serving-live-20261104/trial-final-api.json`
- `.runtime/serving-live-20261104/serving-closed-1440.png`

## 7. 观察到但不阻塞闭环的问题

1. vLLM 预热期间有一次短暂的 `remote_state_unknown`，随后在服务健康后自动恢复为
   `ready`。本轮未因此修改 Worker 状态机。
2. 正式回收回执把 exit code `-15` 显示为“进程自然退出”，但本轮实际是用户提交
   停止后的受控终止。该文案不能准确区分“主动停止”和“自然退出”，建议下一轮
   单独修复并补状态文案测试。

## 8. 边界

- 本轮只新增证据、验收记录和临时执行脚本。
- 未修改正式业务逻辑，未提交 Git，未推送，未部署。
- 没有依据本轮结果修改训练模块。
- 不把官方小时报价推导为已结算账单。
