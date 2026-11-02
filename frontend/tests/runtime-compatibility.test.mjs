import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adapterCompatibilityReason,
  modelCompatibilityReason,
  trainingPresetFromBaseline,
} from '../src/features/runtime/compatibility.ts';

const baseline = {
  id: 'baseline-r1',
  sha256: 'a'.repeat(64),
  model: {
    architecture: 'qwen3',
    allowed_fingerprints: ['b'.repeat(64)],
  },
  training: {
    verified_preset: {
      epochs: 1,
      learning_rate: 0.0002,
      cutoff_len: 512,
      batch_size: 1,
      gradient_accumulation: 1,
      lora_rank: 8,
      lora_alpha: 16,
      lora_dropout: 0,
      scheduler: 'cosine',
      warmup_ratio: 0,
      template: 'qwen3_nothink',
      seed: 42,
    },
  },
  inference: {
    config: {template: 'qwen3_nothink', max_model_len: 512, lora_rank: 8},
  },
  evidence: {
    adapter_best_id: 'best-r1',
    adapter_best_fingerprint: 'd'.repeat(64),
    adapter_final_id: 'final-r1',
    adapter_final_fingerprint: 'e'.repeat(64),
  },
};

test('model compatibility requires architecture and complete content fingerprint', () => {
  assert.equal(modelCompatibilityReason({
    manifest_sha256: 'b'.repeat(64),
    format_summary: {model_type: 'qwen3'},
  }, baseline), null);
  assert.match(modelCompatibilityReason({
    manifest_sha256: 'b'.repeat(64),
    format_summary: {model_type: 'llama'},
  }, baseline), /qwen3/);
  assert.match(modelCompatibilityReason({
    manifest_sha256: 'c'.repeat(64),
    format_summary: {model_type: 'qwen3'},
  }, baseline), /指纹/);
});

test('adapter compatibility checks base, preset and pinned baseline identity', () => {
  const adapter = {
    id: 'best-r1',
    fingerprint: 'd'.repeat(64),
    snapshot: {
      base: {fingerprint: 'b'.repeat(64)},
      config: {template: 'qwen3_nothink', cutoff_len: 512, lora_rank: 8},
    },
  };
  assert.equal(adapterCompatibilityReason(adapter, baseline), null);
  assert.match(adapterCompatibilityReason({
    ...adapter,
    id: 'unknown-r1',
  }, baseline), /没有绑定/);
  assert.match(adapterCompatibilityReason({
    ...adapter,
    snapshot: {...adapter.snapshot, config: {...adapter.snapshot.config, lora_rank: 16}},
  }, baseline), /训练参数/);
  assert.match(adapterCompatibilityReason({
    ...adapter,
    snapshot: {
      ...adapter.snapshot,
      compatibility: {
        baseline_id: 'old',
        baseline_sha256: '0'.repeat(64),
        model_fingerprint: 'b'.repeat(64),
      },
    },
  }, baseline), /旧版/);
  assert.match(adapterCompatibilityReason({
    ...adapter,
    snapshot: {
      ...adapter.snapshot,
      compatibility: {
        baseline_id: baseline.id,
        baseline_sha256: baseline.sha256,
        model_fingerprint: 'c'.repeat(64),
      },
    },
  }, baseline), /旧版/);
});

test('baseline preset replaces mutable training defaults', () => {
  const current = {...baseline.training.verified_preset, epochs: 3, cutoff_len: 2048, seed: 7};
  const result = trainingPresetFromBaseline(current, baseline);
  assert.equal(result.epochs, 1);
  assert.equal(result.cutoff_len, 512);
  assert.equal(result.seed, 42);
});
