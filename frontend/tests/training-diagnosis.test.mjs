import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseTrainingRoute} from '../src/features/training/training-model.ts';
import {reportSummaryForClipboard} from '../src/features/training/diagnosis/diagnosis-model.ts';

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
