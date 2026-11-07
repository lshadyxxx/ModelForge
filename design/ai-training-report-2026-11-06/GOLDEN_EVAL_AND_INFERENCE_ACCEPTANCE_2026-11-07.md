# ModelForge AI 训练诊断 · 黄金集、用量与独立验收归档

日期：2026-11-07  
代码基线：`685a7ee3e0a3fc088122aa66bb613c28d35d24c3`，工作区既有未提交修改保留  
状态：黄金集夹具、4 场景真实模型 smoke、v3 报告、用量可观测、独立推理验收
schema/API 和页面验收已完成；完整黄金集真实稳定性、真实人工推理验收、部署和生产可用
仍未完成

## 1. 结论先行

- 黄金集 fixture 模式：`18/18` 通过；Gate 保真度 `1.0`；Validator clean
  `1.0`；独立 negative probe `9/9` 被拒绝。
- 真实模型 smoke：只跑了 `G01/G04/G08/G09` 四例，最终 `4/4` 通过；首轮洁净
  `3/4`，`G08` 触发一次 repair 并成功。该结果不是 18 个场景的真实稳定性结论。
- 4 个 live 场景共 5 次模型调用，provider 上报 `77,209` tokens，总调用耗时
  `234,879 ms`。没有配置 provider 单价，`cost_estimate=null`，没有估算费用。
- 独立推理验收新增 append-only 表、人工 POST/GET API 和 Gate 证据关联；当前真实
  验收记录为 `0` 条。`Trial ready` 或 `Adapter available` 都不会自动升级为
  “模型可用”。
- 当前成功 Attempt 的最新真实报告为 v3，job 用量为 `1` 次调用、`19,616` tokens、
  `43.1 s`；健康度 `partial`，可交付性
  `artifact_deliverable_model_unverified`。

## 2. 黄金集与自动断言

### 2.1 覆盖

`golden-eval-fixture.json` 覆盖 18 个场景，包括：

- 成功但只有 1 个 Eval 点；
- Best/Final Adapter 完整但缺少当前 Adapter 推理验收；
- 存在与当前 Adapter 完全匹配的独立验收；
- Adapter 只有 1/2；
- 失败且只有 provisioning 错误码；
- 取消但保留 runtime 和 manifest；
- metrics 缺失与 metrics 真为 0 的区分；
- 日志缺口、日志不可读、显存采样失败、runtime mismatch；
- 来源 stale、日志 prompt injection；
- 结构化输出非法、一次 repair 成功、第二次 repair 失败 fail closed。

夹具文件：

- `golden-eval-fixture.json`
- `golden-eval-preflight.json`
- `golden-eval-live-smoke.json`

实现：

- `backend/src/modelforge/modules/diagnosis/evaluation.py`
- `backend/tests/test_training_diagnosis.py`

### 2.2 夹具结果

| 指标 | 结果 |
|---|---:|
| Cases | 18 |
| Passed / Failed | 18 / 0 |
| Gate fidelity | 1.0 |
| Validator clean | 1.0 |
| Negative probes | 9 / 9，rejection rate 1.0 |

negative probe 单独统计，不以普通正向 case 通过率替代禁止表达拒绝率。

### 2.3 真实模型 smoke

执行的是 `G01/G04/G08/G09` 四例真实 provider 调用，不是全量 18 例：

| 指标 | 结果 |
|---|---:|
| 最终通过 | 4 / 4 |
| first-pass clean | 3 / 4（0.75） |
| repair | 1 次，成功 |
| model calls | 5 |
| prompt tokens | 28,697 |
| completion tokens | 48,512 |
| total tokens | 77,209 |
| latency | 234,879 ms |
| cost | `null`，`provider_price_not_configured` |

`G08` 首轮出现 `forbidden_claim`，repair 后通过；这说明 Validator 能拦住并修复该
问题，但同时也说明真实模型首轮并非稳定 100% 洁净。

## 3. 独立推理验收

### 3.1 目的

训练成功和 Adapter 文件可下载不等于模型可用。新增的独立推理验收是人工证据层：

- 只能显式 POST 记录，不能由 Trial `ready` 自动推断；
- 必须绑定当前 Adapter 的 `adapter_id` 和 `adapter_fingerprint`；
- 必须记录 `result`、`criteria_version`、`evidence_digest`、`reviewer_ref` 和
  `accepted_at`；
- 同一 Adapter 的最新验收为 failed 时，不能升级交付结论；
- 报告中的交付陈述仍是 advisory，不替代硬门禁。

### 3.2 实现

- `backend/migrations/versions/0019_inference_acceptance.py`
- `backend/src/modelforge/modules/serving/acceptance.py`
- `backend/src/modelforge/modules/serving/routes.py`
- `backend/src/modelforge/modules/diagnosis/evidence.py`
- `backend/src/modelforge/modules/diagnosis/gates.py`
- `backend/tests/test_inference_acceptance.py`

API：

```text
GET  /api/v1/serving/trials/{identifier}/acceptance
POST /api/v1/serving/trials/{identifier}/acceptance
```

数据库表 `training_inference_acceptance` 为 append-only；UPDATE/DELETE 由触发器拒绝。

### 3.3 当前事实

- Alembic 当前 head：`0020_diagnosis_usage`。
- 当前 `training_inference_acceptance` 行数：`0`。
- 没有伪造通过记录，也没有把 Adapter available 写成模型可用。
- 由于没有真实 Trial，真实人工验收链路仍未执行；API/schema 通过测试不等于完成一次
  真实验收。

## 4. 模型调用用量与延迟

实现：

- `backend/migrations/versions/0020_diagnosis_usage.py`
- `backend/src/modelforge/modules/diagnosis/generator.py`
- `backend/src/modelforge/modules/diagnosis/repository.py`
- `backend/src/modelforge/modules/diagnosis/routes.py`
- `frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx`

行为：

- 从 LangChain/provider `usage_metadata` 或 `token_usage` 捕获真实 token 数据；
- 记录调用数、provider 上报/缺失次数、prompt/completion/total tokens 和 latency；
- 缺失 token 保持缺失，不按字符数或价格推测；
- `cost_estimate` 固定为 `null`，原因是 provider 价格未配置；
- 旧 job 的 `usage=null` 保留，没有回填伪造数据。

## 5. 当前真实 v3 报告

Attempt：

```text
fbc8a03d-27e3-4ef2-8253-c23ac8a599ac
```

| 项目 | 值 |
|---|---|
| Job | `377b3f5a-2040-46d8-9972-0dc6247d442f` |
| Report | `15b7a89d-12fb-444c-b75b-47e9461deb27` |
| Version | 3，当前 latest |
| Prompt | `training-diagnosis-prompt-v3` |
| Health | `partial` / 部分可判断 |
| Delivery | `artifact_deliverable_model_unverified` |
| Findings | 8 |
| Limitations | 5 |
| Usage | 1 call / 19,616 tokens / 43.1 s |

旧 v1/v2 报告仍保留且不可变，v3 没有覆盖旧记录。报告明确写出：独立推理验收缺失，
不能表述为推理验收通过或模型已验证可用。

## 6. 页面验收

真实页面：`http://127.0.0.1:8092/#training`  
成功 Attempt：`fbc8a03d-27e3-4ef2-8253-c23ac8a599ac`  
页签：`AI 诊断`

截图均来自真实页面，不使用原型图片替代：

| 截图 | 覆盖 |
|---|---|
| `qa/v3-report-desktop-1440.png` | v3 主报告、双门禁、用量 |
| `qa/v3-report-findings-1440.png` | 关键发现、观测/推断/建议、证据 chip |
| `qa/v3-report-evidence-1440.png` | 下一步实验与 12 条证据台账 |
| `qa/v3-report-mobile-390.png` | 390px 报告入口与用量 |
| `qa/v3-report-mobile-filter-390.png` | 移动端“需关注”筛选和展开内容 |

验证记录：

| 项目 | 结果 |
|---|---|
| 桌面视口 | `innerWidth=1440`，文档级横向溢出 `false` |
| 移动视口 | `innerWidth=390`，文档级横向溢出 `false` |
| v3 用量文本 | `模型调用 1 次 · 19,616 tokens · 43.1s` |
| 严重度筛选 | `需关注`：8 条变为 3 条，`aria-pressed` 正确 |
| 控制台 | console error / window error / unhandled rejection = `0 / 0 / 0` |
| 交互 | 报告页可读取，证据和实验可展开，筛选可操作 |

桌面截图按真实 1440 CSS 视口捕获后校正输出宽度；移动截图来自 390 CSS 视口。
截图为本地浏览器渲染证据，不等于真实设备、屏幕阅读器或生产验收。

## 7. 当前测试

| 验证 | 命令/范围 | 结果 |
|---|---|---|
| 诊断 + 独立验收测试 | `tests/test_training_diagnosis.py tests/test_inference_acceptance.py` | `23 passed, 1 skipped` |
| 前端单元测试 | `cd frontend; npm test` | `96 passed, 0 failed` |
| 黄金集 fixture | `golden-eval-fixture.json` | `18/18` |
| 真实模型 smoke | G01/G04/G08/G09 | `4/4` final，`3/4` first-pass |
| Alembic | 本地库 | `0020_diagnosis_usage` head |
| 服务 | API / Worker / Web / PostgreSQL / MinIO | healthy / running |
| OpenAPI | acceptance GET/POST | 已存在 |
| 真实独立推理验收 | 人工记录 | 0 条，未执行 |
| 完整后端回归 | 本轮未重跑 | 不能宣称全绿 |

跳过项是默认关闭的真实模型评估测试；本轮真实 smoke 另行显式执行。pytest 的缓存目录
警告不影响测试结论。

## 8. 仍然不可宣称

- 不能宣称 18 个黄金场景都经过真实模型稳定验证；live 只跑了 4 个。
- 不能宣称 first-pass 稳定性为 100%；实际是 3/4。
- 不能宣称完整后端回归全绿；本轮只复跑了定向测试。
- 不能宣称模型可用、生产可用或推理验收通过；当前真实验收记录为 0。
- 不能提供成本估算；provider 单价未配置。
- 不能把 Adapter available、Trial ready、AI 报告发布或页面通过当作业务效果。
- 本轮未部署、未提交 Git、未推送、未创建云实例。

