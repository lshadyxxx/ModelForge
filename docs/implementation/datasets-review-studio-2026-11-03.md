# 数据集审阅工作室与不可变派生实施记录

日期：2026-11-03。范围：用户确认采用 C · 审阅工作室后，将数据集页面与真实逐行编辑派生能力接入生产代码。本记录不改变数据集容量校准、模型/GPU/镜像兼容矩阵或核心 MVP 口径。

## 已落地

### 生产页面

- 数据集按不可变 `dataset_id` 分组，版本按 `version_number` 归入同一数据集；同名数据集保持独立，并持续显示 `DT-` 加 8 位十六进制的身份。上传选择器同时保留完整 `dataset_id` 的悬停标题，移动端仍显示身份片段。
- 页面提供真实整体统计、搜索、版本状态筛选、数据集树、样本列表、对话/JSONL/校验视图、训练/验证归属和版本质量栏。
- 样本分页通过服务端读取完整物理行，JSONL 视图直接展示该原始行，不再依赖元数据中的 20 条预览或经页面重新格式化的 JSON；上一行/下一行和 `ArrowUp`/`ArrowDown` 均按物理行切换。
- 翻页请求会中止旧请求，并核对响应的 `version_id` 与当前版本一致，旧版本的分页结果不能混入新版本。
- 上传抽屉区分新建数据集和追加已有数据集。追加目标使用自绘选择器，显示名称、ID、版本数、样本数和状态，避免同名数据集混淆。
- 切换版本或数据集时会清空旧详情与旧样本，避免在新选择加载期间显示前一版本内容。
- 编辑样本不会覆盖原版本。提交时保存为新的草稿版本，原版本的 SHA-256、原始对象和内容保持不变。
- 来源版本仍有派生后代时，页面和 API 均阻止删除来源版本；先删除派生版本后，来源版本仍可按正常不可变版本规则清理。

### API 与持久化

新增：

```text
GET  /api/v1/dataset-versions/{id}/samples?offset=0&limit=50
POST /api/v1/dataset-versions/{id}/derived
```

派生请求要求：

```json
{
  "request_id": "调用方为每次用户提交生成并在重试时复用的 UUID",
  "expected_sha256": "64 位小写 SHA-256",
  "line": 1,
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

服务端规则：

1. 在 PostgreSQL 中锁定基准版本和数据集身份，核验 `expected_sha256`。
2. 从 MinIO 读取基准对象，并同时核验大小与 SHA-256。
3. 只替换指定物理行；其他物理行保持原始字节和换行符不变，包括裸 `CR` 终止符。
4. 对整个派生 JSONL 重新执行格式、角色、样本数和行长度校验。
5. 写新 MinIO 对象并回读逐字节核验，再登记新的不可变版本、摘要、预览和 `derived_from_version_id`。
6. 版本号分配与同数据集的其他追加/派生操作共用数据集行锁。
7. 同一数据集的相同 `request_id` 重试返回同一派生版本；若请求标识被不同内容复用则返回 `409 derivation_request_conflict`。
8. 派生内容无效时保留可诊断的 `invalid` 版本；存储失败时保留失败身份与清理要求。
9. 派生来源版本存在后代时拒绝删除，避免血缘字段被置空。
10. 删除某个数据集的最后一个版本时，在同一事务中删除已无版本的 `datasets` 父记录，避免形成页面不可见但数据库残留的孤儿数据。

迁移 `0012_dataset_derivation` 新增 `derived_from_version_id`、外键和索引；迁移 `0013_dataset_derivation_request` 新增 `derivation_request_id` 及 `(dataset_id, derivation_request_id)` 唯一约束；迁移 `0014_dataset_orphan_cleanup` 删除历史遗留的无版本数据集父记录。

## 真实闭环验收

通过生产页面和同源 API 创建唯一临时数据集 `E2E 派生闭环 2026-11-03 A`：

| 项目 | v1 | v2 |
|---|---|---|
| dataset ID | `c273d5dd-6fa8-43a8-9707-7de8a73f32a2` | 同左 |
| version ID | `b4264b91-dfb6-4cb3-98eb-896c98e5e461` | `f4a26a1f-070b-4d8a-a870-8a3ae937974e` |
| 基准 SHA-256 | `99817575173036d560194aa86a8eb1ffac8c445a012c03b49be33a895d903d50` | `4059061ebe13b5707c7e833dfc7b34bf66db081c551620225a282363982b4eeb` |
| 状态 | `draft` | 派生后为 `draft`，随后由页面发布 |
| 来源 | 首版 | `b4264b91-dfb6-4cb3-98eb-896c98e5e461` |

验收结果：

- 页面上传后显示 4 条有效样本，并收到“文件已写入 MinIO 并完成服务端校验”回执。
- 编辑物理第 1 行后成功从 v1 派生 v2；v2 来源指向 v1，二者 SHA-256 不同。
- 与 v1 逐字节比较后，v2 只有第 1 行变化，第 2–4 行完全相同；v1 的原始问题与回答保持不变。
- v2 从页面发布成功，持久化拆分清单摘要为 `1e1b14c853bcc4aa4e3470ff0915dfbbb75194b0f3334e38d61e90c8c8c27034`；4 条样本实际拆为训练 3、验证 1，请求比例 10%、实际比例 25%、seed 42。
- 页面下载文件名与 v2 身份一致；下载内容 SHA-256 为 `4059061e…982b4eeb`，与 API、MinIO 回读和 PostgreSQL 元数据一致。
- 按“先 v2、后 v1”的顺序在页面确认删除，两个版本及对象随后均返回 404，临时数据集没有留下业务记录。
- 桌面 1440×900、平板 768×1024、手机 390×844 的 DOM 检查均无页面级横向溢出。

### 幂等与最终 UI 回归

在既有 `DT-D3E1C4DC` 数据集的已发布 v1 `386f6665-2e98-4f37-a7f5-32cf36ff77f1` 上完成了一次生产页面回归：

| 项目 | 结果 |
|---|---|
| v1 SHA-256 | `4b80450534c6ade2fc7efa98b96b02f6815d777f0aac1f0140dc300777b9d5eb` |
| 页面派生 v2 | `a22119f4-1fed-444d-af4c-40ce1df29cce` |
| v2 SHA-256 | `af71d77861db9cd4d936227638a553bc1a5da43c0b8d03ce8bb8d46db1f8853a` |
| 拆分摘要 | `30d5041f7bfeaaec7cb82d23dad5068fcae5dcd390c0129a9717d77a1293a1ca` |
| 拆分结果 | 训练 22 / 验证 2，物理行共 24 |

- 页面只修改第 1 行后派生 v2；其余 23 个物理行与 v1 逐字节一致，v1 内容、SHA-256 和状态保持不变。
- v2 从页面发布成功；样本分页返回完整的训练/验证归属，并与固定拆分清单一致。
- 浏览器下载文件为 `客服123-v2.jsonl`，大小 7339 字节，SHA-256 与 API 下载、PostgreSQL 元数据和 MinIO 对象一致。
- 来源 v1 仍有 v2 后代时，真实 API 删除请求返回 `409 conflict` 并列出 v2；从页面删除 v2 后，v1 仍为 published，内容摘要不变。
- 删除确认框现在明确显示 `DT-D3E1C4DC · v2 · 客服123`，避免在信息不足时执行不可恢复操作。
- 验收脚本对相同 `request_id` 的重复提交返回同一 v2；复用该标识但改内容返回 `409 derivation_request_conflict`；两个不同标识并发派生生成两个不同版本。
- ego-browser 加载的生产 bundle 为 `index-Cyugi5bz.js` 与 `index-gZ_EjwBS.css`。JSONL 视图与 API 原始物理行完全相同且保持单行；390px 上传选择器显示 8 位身份和完整 ID 标题，1440/768/390 均无页面级横向溢出。

## 自动化与实际运行检查

- 前端：`25 passed`；TypeScript 与 Vite 生产构建通过。
- 后端数据集专项：`46 passed, 1 skipped`，唯一跳过项仍是已有环境条件测试；唯一警告为既有 Starlette `httpx` 弃用提示。
- 仓库全量：`342 passed, 194 skipped`。
- Python `compileall` 通过。
- `impeccable detect --json` 返回 `[]`。
- 实际 Compose：Web、API、Worker、PostgreSQL、MinIO 均运行；`/api/v1/health/ready` 为 `ready=true`。
- Alembic：`0014_dataset_orphan_cleanup (head)`。
- 数据清理：历史遗留的 26 个无版本父记录已由迁移移除；随后完整验收脚本再次执行，`orphan_datasets=0`、`acceptance_rows=0`、`acceptance_versions=0`。

## 证据边界

- ego-browser 的截图接口仍因窗口最小化返回 `Cannot capture a screenshot while the window is minimized`；本轮没有抢占窗口、置前或退回系统级键鼠，页面证据来自 ego 的同页 DOM、实际 API、下载回读和响应式视口检查。原型验收截图仍保存在设计目录。
- 数据集限额继续为 `locked=false`；本记录不证明大文件/容量边界，也不关闭票据 06。
- 每次读取样本仍会下载并校验完整源文件；大文件分页索引和无效物理行原地修复仍留给后续性能/编辑票据，不冒充本增量能力。
- 本记录证明当前受支持的数据集页面、PostgreSQL/MinIO 派生与发布路径，不扩大模型、GPU、镜像或生产部署范围。
- 本地代码审查按固定基准 `b78791f` 执行；远程 Git、push、PR 与部署不在本次范围。
