# ModelForge AI 训练诊断
## 安全与运维手册

状态：本地实现与受控真实模型验收完成；部署默认仍应关闭，未上线  
日期：2026-11-07（初版：2026-11-06）  
适用环境：ModelForge 本地 Compose 控制面、PostgreSQL、Worker 和 OpenAI-compatible 模型服务

> 本轮只在本地受控验收中启用真实模型；不得据此把生产默认开关改为开启。
> 验收证据见 [REAL_MODEL_ACCEPTANCE_2026-11-07.md](REAL_MODEL_ACCEPTANCE_2026-11-07.md)。

## 1. 安全目标

- 模型不能执行 SQL、Shell、浏览器、任意 HTTP、文件写入或训练提交；
- 模型不能决定训练健康度、可交付性或推理验收状态；
- API Key、DSN、日志正文、数据集样本和签名 URL 不进入 checkpoint；
- 报告发布必须经过 Validator；
- 旧 Worker 不能覆盖新 Worker 的报告；
- 失败、超时和证据不足必须 fail closed；
- AI 报告不得诱导用户把 Adapter `available` 当成“模型可用”。

## 2. 信任边界

### 2.1 不可信数据

- 训练日志；
- 数据集样本；
- manifest 中的路径；
- 用户输入和追问；
- 模型输出；
- 第三方 provider 错误正文；
- 云端返回的任意字符串。

### 2.2 受信逻辑

- GateEngine；
- Validator；
- ReportRepository；
- lease/fencing；
- 数据库约束；
- 统一迁移；
- 经过 parse/validate 的 Pydantic 数据。

### 2.3 受控外部依赖

- PostgreSQL；
- MinIO；
- 模型 provider；
- Compose 网络；
- 训练 Worker 的现有只读契约。

## 3. 密钥与配置

### 3.1 禁止

- 在浏览器暴露 API Key；
- 把 Key 写进 Prompt；
- 把 Key 写进 checkpoint State；
- 把 DSN 写进 HTTP 响应；
- 在日志中打印 Authorization 或 Secret；
- 在报告 evidence excerpt 中保留未脱敏日志；
- 用 URL query 传递凭据。

### 3.2 推荐配置

```text
MF_AI_ENABLED=false
MF_AI_MODEL=<部署决定>
MF_AI_BASE_URL=<OpenAI-compatible endpoint 或空>
MF_AI_API_KEY=<SecretStr>
MF_AI_STRUCTURED_OUTPUT_METHOD=json_schema
MF_AI_TIMEOUT_SECONDS=25
MF_AI_CHECKPOINT_DSN=<独立最小权限角色>
MF_AI_CHECKPOINT_SCHEMA=langgraph_checkpoint
MF_AI_CHECKPOINT_TTL_HOURS=24
```

`MF_AI_API_KEY` 和 `MF_AI_CHECKPOINT_DSN` 使用 SecretStr 或等价的密钥类型，不能进入 repr、异常详情或 telemetry。

### 3.2.1 受控启用真实模型

1. 由操作员通过本机 Secret 注入或受控环境变量提供 `MF_AI_MODEL`、`MF_AI_API_KEY`；
   不要把密钥粘贴到聊天、前端、Prompt、Git 或截图。
2. 如需兼容网关，再设置 `MF_AI_BASE_URL`；先用 `GET /api/v1/training/diagnosis/config`
   确认 `enabled=true`、`model_configured=true`。
3. 重建并重启 API/Worker/Web 镜像，确认 `/api/v1/status` 四项均为 `up`。
4. 使用固定成功 Attempt 执行真实模型契约测试；测试通过前，不得打开真实用户流量。
5. 只对单个终态 Attempt 手动创建诊断 job，检查报告双门禁、证据引用、数字和限制语。
6. 验证结束后把 `MF_AI_ENABLED` 恢复为 `false`；失败时停用 Worker 的 AI 入口，
   保留原始 Attempt 与硬门禁。

真实模型测试入口和人工 Rubric 见 [AI_EVALUATION_ACCEPTANCE.md](AI_EVALUATION_ACCEPTANCE.md)。

### 3.3 模型错误

向用户返回稳定错误码：

```text
ai_disabled
ai_model_timeout
ai_model_rate_limited
ai_structured_output_invalid
ai_provider_unavailable
ai_secret_rejected
```

不把 provider 原始 401/403 正文、主键或完整 URL 直接展示。

## 4. 数据最小化

### 4.1 传给模型的内容

只允许：

- 处理后的 Attempt 摘要；
- 指标统计和点系列；
- token preflight 状态；
- runtime 和 memory 摘要；
- manifest 文件摘要；
- provisioning 状态；
- 脱敏日志摘录；
- Adapter 状态和 fingerprint；
- 推理 Trial 和验收事实；
- 证据 ID 和字段路径。

不允许：

- 完整数据集；
- 完整训练日志；
- 云端密钥；
- 主机私钥；
- signed URL；
- Authorization header；
- 任意可执行代码；
- 跨 Attempt 数据。

### 4.2 日志脱敏

日志摘要需要：

- 行数和字符上限；
- 删除 access token、bearer、password、secret、private key；
- 删除 URL query；
- 删除本地绝对路径中的敏感目录；
- 不把日志原文塞进 prompt；
- 在 UI 里标记“源日志已受限/脱敏”。

### 4.3 Prompt Injection

日志或样本中的“忽略规则”“直接说模型可用”等文本只作为证据内容，不能改变系统规则。

- 系统 Prompt 明确说明证据是不可信数据；
- 模型没有工具；
- Validator 检查禁止 claim；
- 不通过“模型看到的内容”决定权限；
- 注入样例进入黄金集 G14。

## 5. Checkpointer 安全

### 5.1 独立 schema

```text
langgraph_checkpoint
```

不能把 checkpoint 表和 `training_diagnosis_*` 混在业务 schema。

### 5.2 最小权限角色

建议：

- 只可连接指定数据库；
- 只能读写 `langgraph_checkpoint`；
- 不拥有 `training_diagnosis_*`；
- 不能访问 MinIO 密钥；
- 不能执行任意 DDL；
- `setup()` 由部署/迁移身份执行，运行角色只做 checkpoint 读写。

### 5.3 setup 与 autocommit

- `PostgresSaver.setup()` 只在部署/初始化执行；
- 每请求不执行 setup；
- 若传入现有 psycopg 连接，`setup()` 前必须 `autocommit=True`；
- `setup()` 失败必须阻止 Worker 领取诊断 job；
- checkpoint 不可用时 fail closed，不能静默运行无恢复图。

### 5.4 thread 与 namespace

```text
thread_id = diagnosis:{job_id}
checkpoint_ns = graph_version
recursion_limit = 8
```

- 禁止跨 Attempt 复用 thread；
- graph_version 变化使用新 namespace；
- 不强行恢复旧图 State；
- 旧 Worker 恢复后仍要校验 lease/fencing。

### 5.5 TTL

- 默认 24 小时；
- 失败/取消任务建议 1 小时；
- 清理任务必须独立于业务报告保留；
- 不把 checkpoint 清理当作报告删除；
- 行数、磁盘和清理失败必须告警。

## 6. 业务数据库安全

### 6.1 报告不可变

- 报告发布后禁止 UPDATE；
- 重新生成创建新 job / 新 version；
- `UNIQUE(job_id)` 防止一个 job 两次发布；
- `UNIQUE(attempt_id, version)` 防止覆盖历史；
- 旧报告不因新版本删除。

### 6.2 租约与 fencing

publish 事务必须校验：

- job 仍为 running；
- lease owner 等于当前 Worker；
- lease 未过期；
- fencing token 匹配；
- report 尚未存在。

任何一项失败都拒绝发布。

### 6.3 降级

- 先停止 Worker，禁止新领取；
- 关闭 `MF_AI_ENABLED`；
- 保留已发布报告只读；
- 不删除 job/evidence/report；
- 不清空 checkpoint schema，等待 TTL 或单独清理；
- 不把 AI 失败扩大到训练详情不可用。

## 7. 网络与出口

- 模型服务地址由后端配置，不由用户输入任意 URL；
- 如果 provider 在公网，必须记录域名白名单；
- 不允许模型触发任意 HTTP；
- 训练 Worker 的云端通道不因诊断功能扩大权限；
- 报告 API 不代理 MinIO 签名 URL；
- 本地 Compose 中 API/Worker 只需访问模型 endpoint 和现有 PostgreSQL/MinIO。

## 8. 可观察性

### 8.1 指标

```text
diagnosis_jobs_queued
diagnosis_jobs_running
diagnosis_jobs_ready_total
diagnosis_jobs_failed_total
diagnosis_job_latency_ms
diagnosis_llm_latency_ms
diagnosis_llm_timeout_total
diagnosis_llm_rate_limited_total
diagnosis_validator_rejects_total
diagnosis_repair_total
diagnosis_publish_conflicts_total
diagnosis_checkpoint_rows
diagnosis_checkpoint_bytes
diagnosis_stale_reports_total
```

### 8.2 告警建议

- failure rate 5 分钟 >5%；
- queued job 超过合理等待时间；
- checkpoint schema 磁盘增长异常；
- TTL 清理连续失败；
- 同一 job 多次 lease 回收；
- Validator 拒绝率突然升高；
- 模型延迟 p95 超过 20 秒；
- 出现 `ai_secret_rejected` 或敏感信息样例；
- 出现 report publish conflict；
- 出现非预期的 `inference_trial.ready` 升级。

### 8.3 日志

只记录：

- job_id/attempt_id；
- 稳定错误码；
- 节点名；
- 延迟；
- repair 次数；
- 证据覆盖摘要；
- checkpoint 恢复次数；
- report digest。

不记录：

- Prompt 全文；
- 模型完整响应；
- API Key；
- DSN；
- 完整日志；
- 数据集正文；
- 签名 URL。

## 9. 故障 Runbook

### 9.1 AI 功能不可用

现象：

- `MF_AI_ENABLED=false`；
- 模型 endpoint 不可达；
- 503。

动作：

1. 保持训练详情、运行分析、日志和产物可用；
2. 关闭诊断入口或显示“AI 诊断暂不可用”；
3. 不创建 pending job；
4. 检查 provider 和配置；
5. 恢复后允许重新生成。

### 9.2 模型超时或 429

动作：

1. 保留 job 的可恢复状态；
2. 按 job 层重试预算延迟重试；
3. 不增加 `max_retries`；
4. 前端显示“正在重新生成”；
5. 超过上限进入 failed，不写半成品。

### 9.3 结构化输出非法

动作：

1. 记录 `ai_structured_output_invalid`；
2. 允许一次 repair；
3. 第二次失败 fail closed；
4. 不把自由文本强行解析为报告；
5. 检查 provider 的 `json_schema` 能力并按 ADR fallback。

### 9.4 Validator 拒绝

动作：

1. 记录 issue codes，不记录完整报告原文；
2. 若可修复，执行一次 repair；
3. 若引用不存在或数字不一致，不发布；
4. 保留上一个 ready 报告；
5. 将样例加入评估夹具。

### 9.5 Checkpoint 不可用

动作：

1. 停止领取新诊断 job；
2. 当前 job 失败，不静默重跑；
3. 检查 schema、角色、连接和 `setup()`；
4. 确认 TTL 清理没有误删；
5. 恢复后使用同一 graph_version 的合法 checkpoint 或从 collect 重放；
6. 不能绕过 lease/fencing。

### 9.6 Worker 重启

动作：

1. 从 `graph.get_state()` 读取最近 checkpoint；
2. 检查 job 是否仍由当前 lease owner 持有；
3. 通过则继续，否则等待新 owner；
4. 不重复 publish；
5. 记录恢复次数。

### 9.7 报告 stale

动作：

1. 比对 attempt/adapter/trial revision；
2. 标记 stale；
3. 保留历史报告；
4. 自动生成需要新 request_key；
5. 不把 stale 报告显示为 latest。

### 9.8 数据库增长

动作：

1. 先区分 checkpoint、evidence、report、log；
2. 只清 checkpoint TTL；
3. 不删除已发布报告；
4. 检查失败 job 是否重复生成；
5. 记录清理操作和行数。

## 10. 上线与回滚

### 10.1 上线前

- 数据库迁移在隔离环境验证；
- `setup()` 幂等；
- 功能开关默认 false；
- 旧页面回归通过；
- 失败/空/证据不足可展示；
- 评估门禁通过；
- 回滚步骤演练。

### 10.2 回滚

```text
1. MF_AI_ENABLED=false
2. 停止 diagnosis worker 领取
3. 保留 API / training worker / main UI
4. 验证训练详情、日志、产物仍可用
5. 不删除业务报告和证据
6. 等待 TTL 或按独立 runbook 清 checkpoint
```

### 10.3 禁止回滚

- 删除唯一训练产物；
- 回滚覆盖历史报告；
- 清除证据以修复 UI；
- 直接把 checkpoint 表当成报告备份；
- 用旧 Worker 绕过 fencing 发布。

## 11. 安全验收

- 日志和 prompt 不含密钥；
- 报告 HTML/文本转义；
- 证据 excerpt 脱敏；
- 模型无工具；
- checkpointer 权限最小；
- lease/fencing 竞争测试；
- 报告不可变；
- stale/conflict 不覆盖 latest；
- 应用建议不提交训练；
- 推理验收不能被 Trial ready 冒充；
- 关闭功能开关不影响训练主流程。
