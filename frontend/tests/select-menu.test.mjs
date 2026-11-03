import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  filterSelectOptions,
  firstEnabledIndex,
  nextEnabledIndex,
} from '../src/shared/select-menu-model.ts';

const options = [
  {value: 'system', label: '系统镜像', description: '预装 CUDA'},
  {value: 'app', label: '应用镜像', description: 'ComfyUI 纯净版', disabled: true},
  {value: 'vllm', label: 'vLLM', description: '推理运行时'},
];

test('select options filter across label and description without case sensitivity', () => {
  assert.deepEqual(
    filterSelectOptions(options, '  comfyui ').map((option) => option.value),
    ['app'],
  );
  assert.deepEqual(
    filterSelectOptions(options, 'CUDA').map((option) => option.value),
    ['system'],
  );
  assert.equal(filterSelectOptions(options, ''), options);
});

test('select navigation skips disabled options and wraps in both directions', () => {
  assert.equal(firstEnabledIndex(options), 0);
  assert.equal(nextEnabledIndex(options, -1, 1), 0);
  assert.equal(nextEnabledIndex(options, 0, 1), 2);
  assert.equal(nextEnabledIndex(options, 2, 1), 0);
  assert.equal(nextEnabledIndex(options, -1, -1), 2);
  assert.equal(nextEnabledIndex(options, 0, -1), 2);
});

test('select navigation reports no target when every option is disabled', () => {
  const disabledOptions = options.map((option) => ({...option, disabled: true}));
  assert.equal(firstEnabledIndex(disabledOptions), -1);
  assert.equal(nextEnabledIndex(disabledOptions, -1, 1), -1);
});
