# ModelForge 历史训练对比 · 实施状态

日期：2026-11-08
代码基线：`62e92dd` + 当前未提交工作区
状态：**本地实现与真实页面验收完成；未提交、未推送、未部署、未创建云资源。**

## 1. 已落地范围

- 新增确定性 `ComparisonEngine`，比较同基座、同数据集、同 split 的成功 Attempt。
- 新增自动基线、指定基线、不对比历史三种模式。
- 新增候选 API、比较结果契约、EvidencePack v2、AdvisoryReport v2。
- LangGraph v2 只解释冻结事实，比较状态、置信度和 `model_effect` 不接受模型改写。
- 前端新增基线选择、历史对比面板、参数差异、指标差、混杂因素和比较证据台账。
- 失败 Attempt 不显示历史基线选择，只生成有限复盘。
- v1 报告继续兼容读取。

关键代码：

- `backend/src/modelforge/modules/diagnosis/comparison.py`
- `backend/src/modelforge/modules/diagnosis/comparison_repository.py`
- `backend/src/modelforge/modules/diagnosis/contracts.py`
- `backend/src/modelforge/modules/diagnosis/evidence.py`
- `backend/src/modelforge/modules/diagnosis/graph.py`
- `backend/src/modelforge/modules/diagnosis/validator.py`
- `frontend/src/features/training/diagnosis/BaselineSelector.tsx`
- `frontend/src/features/training/diagnosis/ComparisonPanel.tsx`
- `frontend/src/features/training/diagnosis/AiDiagnosisTab.tsx`

## 2. 数据库

实际 revision：

```text
0021_diagnosis_comparison
```

迁移文件：

```text
backend/migrations/versions/0021_training_diagnosis_comparison.py
```

文件名可以保持可读长名，但 `alembic_version.version_num` 为 `varchar(32)`，因此 revision
标识不能写成文档初稿中的 `0021_training_diagnosis_comparison`。

## 3. 真实成功运行

### 3.1 当前运行与基线

```text
subject Attempt:  fbc8a03d-27e3-4ef2-8253-c23ac8a599ac
baseline Attempt: 6b330374-7fff-4ac2-9104-4f3909045e0b
job:              0f6b2943-7486-4a10-81ab-c6f73b6cbf71
report:           f24452d8-d364-4c1c-9dee-cc4ec87721c2
report version:   4
report schema:    advisory-report-v2
evidence schema:  evidence-pack-v2
graph:            training-diagnosis-graph-v2
```

### 3.2 冻结结论

```text
health:             partial
delivery:           artifact_deliverable_model_unverified
comparability:      conditional
confidence:         low
training_signal:    flat
delivery_signal:    same
model_effect:       unverified
parameter_changes:  0
confounders:        eval_coverage_low
```

该结果只说明：

- 双方冻结训练信号基本持平；
- 只有 1 个 Eval 观测点，不能当作稳定趋势；
- Best/Final Adapter 可用，但没有匹配的独立推理验收；
- 真实模型效果仍未验证。

### 3.3 真实调用量

```text
model calls:  2
tokens:       69,524
latency:      63.18s
cost:         null（未配置供应商价格）
```

候选接口返回 4 个同组成功运行，最终比较仍由后端冻结证据重新计算。

## 4. 真实失败运行与无基线复盘

已对无历史报告的失败 Attempt 发起真实生成：

```text
Attempt:  208ea415-3f2d-4725-bb1e-02c4a82da41f
Job:      7a423474-5a74-46aa-bb6d-40c7e0d73103
Report:   3fd8c4de-8495-4752-8b42-fbed82e0108f
mode:     limited
health:   unknown
delivery: not_deliverable
compare:  no_baseline
usage:    2 calls, 34,000 tokens, 67.98s
```

页面同时显示：

- `失败复盘不做训练效果对比`；
- 训练健康度无法判断；
- 当前不可交付；
- 无可用 Adapter、无独立推理验收；
- 缺少 logs/runtime/manifest 时明确写“无法判断根因”。

## 5. 测试与构建

```text
后端：65 passed, 1 skipped
前端：100 passed, 0 failed
生产构建：通过，110 modules
构建警告：主 JS chunk 726.51 kB（不是失败）
Alembic head：0021_diagnosis_comparison
git diff --check：无空白错误，仅有 CRLF 提示
```

后端命令：

```powershell
docker compose run --rm --no-deps api python -m pytest `
  tests/test_training_diagnosis.py `
  tests/test_inference_acceptance.py `
  tests/test_training_comparison.py `
  tests/test_http_contract.py -q
```

## 6. 浏览器验收

页面：

```text
http://127.0.0.1:8092/
```

本地验收条件：

```text
Web:  http://127.0.0.1:8092/
API:  http://127.0.0.1:8102
Web 构建：/assets/index-DeMTnAVF.js
```

已通过：

- 1440×1000 成功报告顶部、历史对比、基线待应用、证据展开；
- 390×844 主报告与历史对比，文档宽度 = 视口宽度 = 390，无水平溢出；
- 指定基线后显示“基线选择尚未应用”，切回自动后按钮恢复“重新生成”；
- 严重度筛选 `全部 7 → 需关注 3 → 全部 7`；
- 证据 chip 展开目标详情，URL 保持 `#training`；
- 复制摘要显示“已复制摘要”；
- 空状态、生成中、失败复盘、无基线复盘均使用真实服务状态；
- console error / runtime exception / window error / unhandled rejection 均为 0。

证据文件位于 `evidence/`，包括：

- `desktop-top-1440.png`
- `desktop-comparison-1440.png`
- `desktop-baseline-pending-1440.png`
- `desktop-evidence-expanded-1440.png`
- `desktop-empty-state-1440.png`
- `desktop-generating-1440.png`
- `desktop-failure-review-1440.png`
- `desktop-no-baseline-1440.png`
- `mobile-report-390.png`
- `mobile-comparison-390.png`

## 7. 应用建议边界

最新 v4 报告没有 `config_patch`，因此页面不会显示“应用建议配置”按钮；这是数据驱动结果，
不是 UI 缺失。

已用真实历史 v2 报告 `5652d20e-ad8c-4f29-8646-862af83c3552` 验证草稿接口：

```text
experiment: EXP-002
patch:      epochs=2
status:     unsubmitted_draft
```

草稿只生成预览，不提交训练、不创建 GPU、不回写历史 Attempt。
原始响应摘要见 `evidence/suggestion-draft-example.json`。

## 8. 已知限制

- 当前没有 task metric、throughput、gradient norm、逐样本 loss、重复率、语言分布。
- 当前没有同一独立评测集的两次可比较分数，`model_effect` 不能升级。
- 独立推理验收真实记录仍为 0，不能宣称模型可用。
- 真实模型只完成了本组成功运行与失败/无基线复盘的页面 smoke，不等于黄金集稳定性。
- 最新 v4 报告无自动配置补丁，因此 UI 中未出现“应用建议配置”按钮。
- 移动端顶部主导航自身允许横向滚动；页面文档级无横向溢出。
- 已在现有真实数据库确认 `0021_diagnosis_comparison`，但未对真实数据库执行 downgrade。
- 未部署、未提交、未推送、未创建云实例。
