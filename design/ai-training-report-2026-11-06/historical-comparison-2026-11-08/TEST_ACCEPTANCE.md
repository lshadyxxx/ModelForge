# ModelForge AI 训练诊断
## 历史对比测试与验收计划

日期：2026-11-08
状态：**PARTIAL PASS；本地自动化、真实页面和有限真实模型路径已执行；18 场景真实稳定性未执行。**
代码基线：`62e92dd0fbb69cce0125560fcc5c2b9cdd625390`
策略版本：`training-comparison-policy-v1`

## 1. 验收原则

1. 先测确定性比较与 Gate，再测 LLM。
2. 不以“文本看起来合理”替代证据和数据断言。
3. 硬门禁失败不能由人工可读性评分补偿。
4. Fixture 通过不等于真实模型稳定性。
5. 页面通过不等于部署或云 GPU 通过。
6. 每次修改代码后，旧证据不能标记为仍然通过。
7. 未执行的测试必须写 `NOT_RUN`，不得默认通过。

## 2. 验收层级

| 层级 | 对象 | 是否调用模型 | 通过条件 |
|---|---|---:|---|
| L0 | Pydantic contract、Hard Key、参数 diff | 否 | 全部单测通过 |
| L1 | ComparisonEngine 18 案例 | 否 | 状态、置信度、数字和证据 100% 匹配 |
| L2 | LangGraph 固定拓扑和 Validator | Fake | fail closed、比较状态不可改写 |
| L3 | PostgreSQL migration/job/report/immutability | 否 | upgrade/downgrade 与不可变通过 |
| L4 | API contract + 前端数据层 | 否 | 请求、幂等、v1/v2 兼容通过 |
| L5 | 浏览器交互与移动端 | 否 | UI/UX_SPEC 全部交互通过 |
| L6 | 真实模型 smoke | 是 | 仅作质量 smoke，不代表 18 场景稳定性 |

## 3. 后端测试矩阵

### 3.1 Hard Key

| ID | 场景 | 期望 |
|---|---|---|
| B01 | base fingerprint 相同 | 可进入候选 |
| B02 | base fingerprint 不同 | 不可比 |
| B03 | dataset sha256 相同、dataset ID 不同 | 可比 |
| B04 | dataset sha256 不同 | 不可比 |
| B05 | split sha256 相同、version 不同 | 可比 |
| B06 | split sha256 不同 | 不可比 |
| B07 | snapshot canonical hash 损坏 | 409/拒绝 |
| B08 | subject 自身出现在查询 | 排除 |

### 3.2 Baseline 选择

| ID | 场景 | 期望 |
|---|---|---|
| B09 | 多个成功候选 | 最早被当前时间约束的最近成功 |
| B10 | `created_at` 相同 | 按 number/id 稳定排序 |
| B11 | 候选 failed | 首版不进入 |
| B12 | 无候选 | `suggested_baseline_attempt_id=null` |
| B13 | explicit baseline 不在组内 | 422 |
| B14 | explicit baseline 等于 subject | 422 |
| B15 | explicit baseline 非成功 | 422 |
| B16 | 用户选择 none | 不查询 baseline |
| B17 | subject failed + auto | no_baseline，仍生成有限复盘 |
| B18 | subject cancelled + auto | no_baseline，仍生成有限复盘 |
| B19 | subject failed + explicit | 409 |

实施时允许重新编号，但不得减少场景。

### 3.3 ComparisonEngine

| ID | 场景 | 期望 |
|---|---|---|
| B20 | 仅 learning_rate 改变，Eval -3% | improved |
| B21 | 仅 learning_rate 改变，Eval +3% | worsened |
| B22 | Eval 差 1% | flat |
| B23 | 1 个 Eval 点 | confidence low |
| B24 | 2 个参数改变 | no single attribution |
| B25 | Seed 改变 | `seed_changed` confounder |
| B26 | Runtime lock 改变 | conditional |
| B27 | GPU 改变 | conditional |
| B28 | Template 改变 | conditional + confounder |
| B29 | 新增 token overflow | mixed/worsened |
| B30 | 新增 runtime mismatch | mixed/worsened |
| B31 | Adapter 指标缺失 | inconclusive |
| B32 | Best 缺失、Final 可用 | 使用 Final 并标记 role |
| B33 | subject/baseline 都缺 Eval | inconclusive |
| B34 | baseline source unreadable | inconclusive |
| B35 | model_effect | 固定 unverified |
| B36 | comparison digest | 可重复、稳定 |

### 3.4 EvidencePack v2

| ID | 场景 | 期望 |
|---|---|---|
| B37 | baseline evidence ID | 全部 `E-BASE-*` |
| B38 | subject evidence ID | 不与 baseline 冲突 |
| B39 | baseline 日志 | 只存在摘要，不进入完整 Prompt |
| B40 | baseline secret | 被现有脱敏逻辑移除 |
| B41 | subject/baseline source revision | 都可比对 stale |
| B42 | comparison evidence digest | 变更后 fail closed |
| B43 | no_baseline | 单运行报告仍可生成 |

### 3.5 Graph / Validator

| ID | 场景 | 期望 |
|---|---|---|
| B44 | mode none | collect→gate→generate |
| B45 | mode auto | 执行 baseline gate 和 compare |
| B46 | comparison result 被模型改写 | Validator 拒绝 |
| B47 | claim 缺少 baseline evidence | Validator 拒绝 |
| B48 | model_effect 升级 | Validator 拒绝 |
| B49 | 多参数单归因 | Validator 拒绝 |
| B50 | 比较差值不在 facts | unsupported_number |
| B51 | repair 一次成功 | publish |
| B52 | repair 仍失败 | diagnosis_validation_failed |
| B53 | duplicate claim ID | 拒绝 |

### 3.6 API

| ID | 场景 | 期望 |
|---|---|---|
| B54 | 无 body 创建 | auto |
| B55 | auto 有候选 | baseline_id 写入 job |
| B56 | auto 无候选 | job 可创建，无 baseline |
| B57 | explicit 合法 | baseline 写入 |
| B58 | explicit 同时无 ID | 422 |
| B59 | auto 同时带 ID | 422 |
| B60 | 重复创建 | 幂等 job |
| B61 | baseline selection 变化 | 新 job |
| B62 | AI disabled | 503 |
| B63 | subject running | 409 |
| B64 | failed subject 请求候选 | 409 `subject_not_succeeded_for_comparison` |
| B65 | running subject 请求候选 | 409 `attempt_not_terminal` |

## 4. 数据库测试

### 4.1 Migration

```text
alembic upgrade head
alembic current
```

必须显示 `0021_diagnosis_comparison (head)`。

测试：

- 现有 0020 行 upgrade 后保留；
- 旧 job `comparison_mode=none`；
- 旧 evidence/report 可读；
- downgrade 在测试库成功；
- 重新 upgrade 成功。

### 4.2 约束

- baseline = subject 被拒绝；
- comparison_mode 非枚举值被拒绝；
- model_effect 非枚举值被拒绝；
- 发布报告 update 被 trigger 拒绝；
- 相同 job 的 evidence 不能静默替换。

### 4.3 查询性能

- `training_tasks` 表达式索引被使用；
- 候选 limit 最大 20；
- 不执行全表日志加载；
- 不读取候选完整日志用于列表。

## 5. AI 黄金集

文件目标：

```text
comparison-golden-fixture-v1.json
```

至少 18 案例：

```text
C01 improved
C02 worsened
C03 flat
C04 low-confidence improved
C05 multi-parameter
C06 seed confound
C07 runtime confound
C08 GPU confound
C09 dataset mismatch
C10 split mismatch
C11 no baseline
C12 metrics unavailable
C13 token regression
C14 runtime regression
C15 failed baseline
C16 model effect forbidden claim
C17 baseline evidence missing
C18 unsupported number
```

Fixture 模式必须验证：

- ComparisonEngine 输出；
- Evidence ID 集合；
- allowed numbers；
- CandidateReport；
- Validator issues；
- 最终 publish/fail。

真实模型 smoke 只覆盖：

- improved；
- flat/inconclusive；
- multi-parameter；
- model-effect 禁止表达。

真实 smoke 结果只能写成“4 场景通过”，不得写成“18 场景真实稳定通过”。

## 6. 前端单元/集成测试

目标文件：

```text
frontend/tests/training-diagnosis.test.mjs
```

至少覆盖：

- v1 report 无 comparison 时正常显示；
- v2 report 有 strict comparison；
- no_baseline；
- not_comparable；
- conditional + confounders；
- low confidence 文案；
- model_effect unverified 始终中性；
- 候选 loading/error/empty；
- baseline 选择；
- generate body auto/explicit/none；
- 已有报告时切换基线提示；
- stale/integrity conflict；
- evidence chips 左右跳转；
- 复制摘要包含双 Attempt；
- 应用草稿不写回 Attempt。

## 7. 浏览器验收

### 7.1 环境

- Web：`http://127.0.0.1:8092/`
- API：`http://127.0.0.1:8102/`
- 桌面：1440×1000
- 移动：390×844

若服务未启动：

- 使用现有本地 Compose 启动；
- 不修改 compose 配置；
- 若无法启动，记录 `BLOCKED`，不得用静态 HTML 冒充真实页面。

### 7.2 必测路径

1. 成功 Attempt 打开 AI 诊断；
2. 候选加载并显示自动基线；
3. 生成含对比的报告；
4. 切换显式基线并重新生成；
5. 选择“不对比历史”；
6. 无候选；
7. 不可比；
8. 低置信度；
9. 多参数混杂；
10. 展开 subject evidence；
11. 展开 baseline evidence；
12. 复制摘要；
13. 应用建议草稿；
14. Attempt 从成功切失败；
15. 旧报告不串到新 Attempt；
16. 移动端 390；
17. console error = 0；
18. window error = 0；
19. unhandled rejection = 0；
20. 无横向溢出。

### 7.3 截图最低要求

- 对比报告桌面；
- 基线选择桌面；
- 参数差异桌面；
- 双证据展开桌面；
- 低置信度或不可比状态；
- 移动端主报告；
- 移动端筛选/证据；
- 旧报告兼容状态。

每张截图必须有：

- 页面 URL；
- viewport；
- commit；
- 测试时间；
- 是否为 fixture 或真实数据。

## 8. 控制台检查

记录：

```json
{
  "console_errors": 0,
  "window_errors": 0,
  "unhandled_rejections": 0,
  "failed_requests": 0,
  "viewport": "1440x1000",
  "url": "..."
}
```

如果出现 4xx fixture 预期错误，必须区分预期和意外。

## 9. 真实模型 smoke（可选）

只有用户明确允许时才运行。

必须保留：

- provider 模型名；
- 调用次数；
- total tokens；
- latency；
- cost_estimate；
- subject/baseline Attempt；
- report ID；
- job ID；
- evidence digest；
- 失败原因。

禁止：

- 输出 API Key；
- 把 provider 完整错误正文写入报告；
- 用单次 smoke 宣称稳定。

## 10. 验收硬门禁

| 门禁 | 通过条件 |
|---|---|
| Hard Key | 100% |
| baseline selection | 100% |
| Comparison status | 18/18 fixture |
| Validator | 0 unsupported comparison |
| 数值忠实 | 0 unsupported number |
| 模型效果升级 | 0 |
| 多参数单归因 | 0 |
| v1 兼容 | 通过 |
| report immutability | 通过 |
| 前端状态 | UI_UX_SPEC 全通过 |
| 1440/390 | 无横向溢出 |
| console | 0/0/0 |
| build | 通过 |

## 11. 证据归档

目标目录：

```text
design/ai-training-report-2026-11-06/historical-comparison-2026-11-08/evidence/
```

至少：

```text
desktop-top-1440.png
desktop-comparison-1440.png
desktop-baseline-pending-1440.png
desktop-evidence-expanded-1440.png
desktop-empty-state-1440.png
desktop-generating-1440.png
desktop-failure-review-1440.png
desktop-no-baseline-1440.png
mobile-report-390.png
mobile-comparison-390.png
backend-test-output.txt
frontend-test-output.txt
frontend-build-output.txt
browser-interaction-report.json
real-report-summary.json
no-baseline-report-summary.json
suggestion-draft-example.json
IMPLEMENTATION_STATUS_2026-11-08.md
```

本轮未生成独立的 `comparison-golden-fixture-v1.json` 或 `comparison-golden-result.json`；
18 场景真实稳定性仍未执行，不能把现有单测与真实页面 smoke 当作黄金集全通过。

如果某文件不存在，最终报告必须显式写缺失，不得引用设计截图充数。

## 12. 最终验收输出格式

```text
1. 已实现范围
2. 未实现范围
3. 数据库迁移状态
4. 后端测试结果
5. 前端测试结果
6. 构建结果
7. 真实页面截图
8. 桌面/移动验收
9. 控制台结果
10. 真实模型结果（若执行）
11. Known limitations
12. 未部署、未推送、未创建云资源声明
```

## 13. 当前状态

| 项目 | 状态 |
|---|---|
| 设计文档 | DONE |
| 业务代码 | DONE（本地工作区，未提交） |
| 迁移 0021 | DONE，实际 head `0021_diagnosis_comparison` |
| ComparisonEngine | DONE |
| 前端 UI | DONE |
| 自动化测试 | PASS：后端 65 passed / 1 skipped；前端 100 passed |
| 真实页面 | PASS：1440 / 390、交互、证据展开、控制台 0 错误 |
| 真实模型 smoke | PARTIAL：成功对比报告 + 失败/无基线报告已生成；18 场景未执行 |
| 部署/推送 | NOT_AUTHORIZED |
