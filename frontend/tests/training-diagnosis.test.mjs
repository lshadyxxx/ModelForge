import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseTrainingRoute} from '../src/features/training/training-model.ts';
import {
  baselineSelectionChanged,
  comparisonEntryLine,
  reportSummaryForClipboard,
} from '../src/features/training/diagnosis/diagnosis-model.ts';

test('diagnosis is an addressable training tab without replacing analysis', () => {
  assert.equal(
    parseTrainingRoute('?attempt=attempt-1&tab=diagnosis').tab,
    'diagnosis',
  );
  assert.equal(
    parseTrainingRoute('?attempt=attempt-1&tab=analysis').tab,
    'analysis',
  );
});

test('clipboard summary keeps dual gates and report digest explicit', () => {
  const summary = reportSummaryForClipboard({
    attempt_id: 'fbc8a03d-27e3-4ef2-8253-c23ac8a599ac',
    health: {label: '部分可判断'},
    delivery: {label: '产物可下发，模型可用性未验证'},
    summary: '仅有一个 Eval 点，无法判断泛化趋势。',
    version: 1,
    report_digest: 'a'.repeat(64),
  });
  assert.match(summary, /训练健康度：部分可判断/);
  assert.match(summary, /可交付性：产物可下发，模型可用性未验证/);
  assert.match(summary, /报告版本 v1/);
  assert.doesNotMatch(summary, /模型可用$/m);
});

test('baseline selection is applied only when it differs from the frozen report', () => {
  const report = {
    attempt_id: 'attempt-2',
    baseline_attempt_id: 'baseline-old',
  };
  const candidates = {
    suggested_baseline_attempt_id: 'baseline-new',
    candidates: [],
  };
  assert.equal(
    baselineSelectionChanged({mode: 'auto'}, report, candidates),
    true,
  );
  assert.equal(
    baselineSelectionChanged(
      {mode: 'explicit', attemptId: 'baseline-old'},
      report,
      candidates,
    ),
    false,
  );
  assert.equal(
    baselineSelectionChanged({mode: 'none'}, report, candidates),
    true,
  );
});

test('baseline choice stays neutral until comparison candidates are loaded', () => {
  const report = {
    attempt_id: 'attempt-2',
    baseline_attempt_id: 'baseline-old',
  };
  assert.equal(
    baselineSelectionChanged({mode: 'auto'}, report, null),
    false,
  );
});

test('comparison entry and clipboard never turn unverified model effect into success', () => {
  const comparison = {
    training_signal: 'improved',
    confidence: 'medium',
    comparability_status: 'conditional',
    model_effect: {status: 'unverified'},
    parameter_changes: [{field: 'learning_rate'}],
  };
  assert.equal(
    comparisonEntryLine(comparison),
    '较基线：训练信号较基线改善 · 中等置信度',
  );
  const summary = reportSummaryForClipboard({
    attempt_id: 'attempt-2',
    baseline_attempt_id: 'baseline-1',
    health: {label: '部分可判断'},
    delivery: {label: '产物可下发，模型可用性未验证'},
    summary: '训练信号改善；模型效果仍需独立推理验收。',
    version: 2,
    report_digest: 'b'.repeat(64),
    comparison,
  });
  assert.match(summary, /比较基线：baseline-1/);
  assert.match(summary, /训练信号：训练信号较基线改善 · 中等置信度/);
  assert.match(summary, /模型效果：未验证/);
  assert.match(summary, /参数变化：learning_rate/);
  assert.doesNotMatch(summary, /模型效果：可用/);
});

test('no-baseline entry is explicit and does not imply a winner', () => {
  assert.equal(
    comparisonEntryLine({
      comparability_status: 'no_baseline',
      training_signal: 'inconclusive',
      confidence: 'none',
    }),
    '未找到同一基座与数据集的成功历史运行',
  );
});
