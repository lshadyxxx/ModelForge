import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  availableTrainingProfiles,
  buildTrainingPayload,
  chooseCurrentAttempt,
  defaultTrainingImageProfile,
  executionModeDescriptor,
  filterAttempts,
  filterLogLines,
  formatBytes,
  isActiveAttempt,
  isManagedAttempt,
  imageProfileStatus,
  lifecycleConclusion,
  normalizeExecutionMode,
  needsAttention,
  normalizeMetrics,
  parseLogLines,
  parseTrainingRoute,
  provisioningStateLabel,
  summarizeAttempts,
  trainingLifecycle,
  trainingStage,
  trainingRouteQuery,
  trainingState,
} from '../src/features/training/training-model.ts';

function attempt(overrides = {}) {
  return {
    id: 'attempt-1',
    task_id: 'task-1',
    number: 1,
    name: '客服意图分类 LoRA',
    state: 'running',
    stage: 'training',
    cancel_requested: false,
    created_at: '2026-11-03T01:00:00Z',
    updated_at: '2026-11-03T01:10:00Z',
    metrics: [],
    snapshot: {},
    ...overrides,
  };
}

test('unknown states stay explicit and attention never becomes optimistic', () => {
  assert.equal(trainingState('future_state').label, 'future_state');
  assert.match(trainingState('future_state').description, /尚未识别/);
  assert.equal(trainingState('future_state').tone, 'warning');
  assert.equal(needsAttention(attempt({state: 'failed'})), true);
  assert.equal(needsAttention(attempt({error_code: 'oom'})), true);
  assert.equal(needsAttention(attempt({cancel_requested: true, state: 'cleanup'})), true);
  assert.equal(needsAttention(attempt({state: 'succeeded'})), false);
});

test('summary and current attempt follow active-state priority, not array order', () => {
  const rows = [
    attempt({id: 'old-success', state: 'succeeded', updated_at: '2026-11-03T03:00:00Z'}),
    attempt({id: 'active', state: 'running', updated_at: '2026-11-03T02:00:00Z'}),
    attempt({id: 'failed', state: 'failed', updated_at: '2026-11-03T04:00:00Z', error_code: 'oom'}),
    attempt({id: 'waiting', state: 'waiting_instance', updated_at: '2026-11-03T01:00:00Z'}),
  ];
  assert.deepEqual(summarizeAttempts(rows), {active: 2, waiting: 1, succeeded: 1, attention: 1});
  assert.equal(chooseCurrentAttempt(rows).id, 'active');
  assert.equal(chooseCurrentAttempt(rows, 'old-success').id, 'old-success');
  assert.equal(chooseCurrentAttempt([
    attempt({id: 'older-failed', state: 'failed', updated_at: '2026-11-03T01:00:00Z'}),
    attempt({id: 'newer-success', state: 'succeeded', updated_at: '2026-11-03T02:00:00Z'}),
  ]).id, 'newer-success');
  assert.equal(chooseCurrentAttempt([]), null);
});

test('metrics are finite, deduplicated by step and sorted without invented points', () => {
  const value = normalizeMetrics([
    {step: 20, epoch: 1, loss: 2.2, learning_rate: 0.00018},
    {step: 10, epoch: 1, loss: 2.8, learning_rate: 0.0002},
    {step: 20, epoch: 1, loss: 2.1},
    {step: 30, loss: Number.NaN},
    {step: 40, eval_loss: 4.4},
    {step: 40, eval_loss: 4.1},
    {epoch: 1.2},
  ]);
  assert.deepEqual(value.train, [{step: 10, value: 2.8}, {step: 20, value: 2.1}]);
  assert.deepEqual(value.evaluation, [{step: 40, value: 4.1}]);
  assert.deepEqual(value.learningRate, [
    {step: 10, value: 0.0002},
    {step: 20, value: 0.00018},
  ]);
  assert.equal(value.latestStep, 40);
  assert.equal(value.latestEpoch, 1.2);
  assert.equal(value.latestTrainLoss, 2.1);
  assert.equal(value.bestEval.value, 4.1);
});

test('lifecycle marks reached stages and never paints unreached work as complete', () => {
  assert.deepEqual(
    trainingLifecycle(attempt({state: 'waiting_instance'})).map((node) => node.status),
    ['done', 'active', 'pending', 'pending', 'pending'],
  );
  assert.deepEqual(
    trainingLifecycle(attempt({
      state: 'failed',
      error_code: 'oom',
      metrics: [{step: 10, loss: 2.5}],
    })).map((node) => node.status),
    ['done', 'done', 'failed', 'pending', 'pending'],
  );
  assert.deepEqual(
    trainingLifecycle(attempt({state: 'succeeded'})).map((node) => node.status),
    ['done', 'done', 'done', 'done', 'done'],
  );
  assert.equal(lifecycleConclusion(attempt({state: 'succeeded'})), '全部阶段已完成');
});

test('ledger filters compose state predicates with name, id and error code search', () => {
  const rows = [
    attempt({id: 'attempt-a', name: '客服分类', state: 'running'}),
    attempt({id: 'attempt-b', name: '摘要生成', state: 'failed', error_code: 'oom'}),
    attempt({id: 'attempt-c', name: '客服重试', state: 'succeeded'}),
  ];
  assert.deepEqual(filterAttempts(rows, 'active', '').map((row) => row.id), ['attempt-a']);
  assert.deepEqual(filterAttempts(rows, 'attention', 'OOM').map((row) => row.id), ['attempt-b']);
  assert.deepEqual(filterAttempts(rows, 'all', '客服').map((row) => row.id), ['attempt-a', 'attempt-c']);
});

test('log parsing removes transport trailing newline and filters only recognized levels', () => {
  const lines = parseLogLines([
    {offset_bytes: 0, next_offset: 20, gap: false, content: 'INFO start\nWARN slow\n'},
    {offset_bytes: 20, next_offset: 50, gap: false, content: 'plain line\nERROR CUDA OOM\n'},
  ]);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((line) => line.level), ['info', 'warn', 'other', 'error']);
  assert.deepEqual(filterLogLines(lines, 'error', 'cuda').map((line) => line.index), [4]);
  assert.deepEqual(filterLogLines(lines, 'all', 'slow').map((line) => line.index), [2]);
  assert.deepEqual(parseLogLines([]), []);
});

test('training routes preserve the legacy switch and encode only valid tabs', () => {
  assert.deepEqual(parseTrainingRoute('?training=legacy'), {
    legacy: true,
    create: false,
    attemptId: '',
    tab: 'overview',
  });
  assert.deepEqual(parseTrainingRoute('?attempt=attempt-1&tab=analysis'), {
    legacy: false,
    create: false,
    attemptId: 'attempt-1',
    tab: 'analysis',
  });
  assert.equal(parseTrainingRoute('?attempt=attempt-1&tab=unknown').tab, 'overview');
  assert.equal(
    trainingRouteQuery({attemptId: 'attempt-1', tab: 'logs'}),
    '?attempt=attempt-1&tab=logs',
  );
  assert.equal(
    trainingRouteQuery({legacy: true, create: false, attemptId: '', tab: 'overview'}),
    '?training=legacy',
  );
});

test('byte formatting is stable at binary unit boundaries', () => {
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.00 KiB');
  assert.equal(formatBytes(1024 ** 3), '1.00 GiB');
  assert.equal(formatBytes(24 * 1024 ** 3), '24.0 GiB');
});

test('managed execution states and stages stay explicit', () => {
  assert.equal(normalizeExecutionMode('managed'), 'managed');
  assert.equal(normalizeExecutionMode(undefined), 'manual');
  assert.equal(executionModeDescriptor('managed').label, '平台托管');
  assert.equal(trainingState('provisioning_unknown').label, '云实例待核对');
  assert.match(trainingState('provisioning_unknown').description, /不会自动重复创建/);
  assert.equal(trainingState('blocked').label, '等待处理');
  assert.equal(trainingState('cost_guard').label, '费用守卫');
  assert.equal(trainingState('bootstrap').label, '安全首启');
  assert.equal(trainingState('runtime').label, '运行环境预检');
  assert.equal(trainingState('artifact_sync_failed').tone, 'danger');
  assert.equal(trainingStage('cost_guard'), '费用守卫');
  assert.equal(trainingStage('bootstrap'), '安全首启');
  assert.equal(trainingStage('runtime'), '运行环境预检');
  assert.equal(trainingStage('preflight'), '运行环境预检');
  assert.equal(trainingStage('syncing'), '同步产物');
  assert.equal(trainingStage('artifact_sync_failed'), '产物同步失败');
  assert.equal(trainingStage('cleanup_pending'), '等待回收确认');
  assert.equal(provisioningStateLabel('cost_guard_state', 'set'), '已设置');
  assert.equal(provisioningStateLabel('credential_state', 'password_disabled'), '密码已禁用');
  assert.equal(provisioningStateLabel('runtime_state', 'preflight_ready'), '预检通过');
  assert.equal(provisioningStateLabel('artifact_state', 'failed'), '同步失败');
  assert.equal(needsAttention(attempt({state: 'provisioning_unknown'})), true);
  assert.equal(needsAttention(attempt({state: 'artifact_sync_failed'})), true);
  assert.equal(isActiveAttempt(attempt({state: 'provisioning_unknown'})), true);
  assert.equal(isActiveAttempt(attempt({state: 'cleanup_pending'})), true);
  assert.equal(isManagedAttempt(attempt({execution_mode: 'managed'})), true);
  assert.equal(isManagedAttempt(attempt({execution_mode: 'manual', provisioning: {attempt_id: 'a'}})), true);
  assert.equal(isManagedAttempt(attempt({execution_mode: 'manual'})), false);
});

test('managed lifecycle exposes provisioning, guard, security and cleanup gates', () => {
  const running = attempt({
    state: 'running',
    stage: 'training',
    execution_mode: 'managed',
  });
  const nodes = trainingLifecycle(running);
  assert.deepEqual(nodes.map((node) => node.label), [
    '创建实例',
    '费用守卫',
    '首启与运行时',
    '训练',
    '产物同步',
    '回收',
  ]);
  assert.deepEqual(nodes.map((node) => node.status), [
    'done',
    'done',
    'done',
    'active',
    'pending',
    'pending',
  ]);
  assert.equal(lifecycleConclusion(running), '当前在训练阶段');
  assert.deepEqual(
    trainingLifecycle(attempt({state: 'succeeded', stage: 'finished', execution_mode: 'managed'}))
      .map((node) => node.status),
    ['done', 'done', 'done', 'done', 'done', 'done'],
  );
  assert.deepEqual(
    trainingLifecycle(attempt({state: 'failed', stage: 'bootstrap', execution_mode: 'managed'}))
      .map((node) => node.status),
    ['done', 'done', 'failed', 'pending', 'pending', 'pending'],
  );
  const unsafe = trainingLifecycle(attempt({
    state: 'provisioning_unknown',
    stage: 'provisioning',
    execution_mode: 'managed',
  }));
  assert.equal(unsafe[0].status, 'active');
});

test('training image availability never falls back to an unpublished route', () => {
  const catalog = {
    schema: 1,
    id: 'catalog',
    sha256: 'x',
    baseline_id: 'b',
    baseline_sha256: 'y',
    profiles: [
      {
        id: 'base-image-a-prime',
        provider_profile: 'base-image-a-prime',
        label: 'A prime',
        description: 'Available',
        image_id: 'img-1',
        image_group_id: null,
        image_type: 'System',
        runtime_source: 'cold_install',
        status: 'available',
        evidence: 'test',
      },
      {
        id: 'training-base-b',
        provider_profile: 'training-base-b',
        label: 'B',
        description: 'Not published',
        image_id: null,
        image_group_id: null,
        image_type: 'Custom',
        runtime_source: 'prebuilt',
        status: 'not_published',
        evidence: 'test',
      },
    ],
  };
  assert.deepEqual(availableTrainingProfiles(catalog).map((profile) => profile.id), ['base-image-a-prime']);
  assert.equal(defaultTrainingImageProfile(catalog).id, 'base-image-a-prime');
  assert.equal(availableTrainingProfiles({...catalog, profiles: [catalog.profiles[1]]}).length, 0);
  assert.equal(imageProfileStatus(catalog.profiles[0]).label, '可使用');
  assert.equal(imageProfileStatus(catalog.profiles[1]).label, '未发布');
  assert.equal(imageProfileStatus({...catalog.profiles[0], status: 'blocked'}).label, '已阻止');
  assert.equal(imageProfileStatus({...catalog.profiles[0], status: 'blocked'}).selectable, false);
});

test('available prebuilt training image is preferred for one-click training', () => {
  const profile = (overrides) => ({
    provider_profile: overrides.id,
    label: overrides.id,
    description: '',
    image_group_id: null,
    image_type: 'Custom',
    status: 'available',
    evidence: 'test',
    ...overrides,
  });
  const catalog = {
    schema: 1,
    id: 'catalog',
    sha256: 'x',
    baseline_id: 'b',
    baseline_sha256: 'y',
    profiles: [
      profile({
        id: 'base-image-a-prime',
        image_id: 'img-system',
        runtime_source: 'cold_install',
      }),
      profile({
        id: 'training-base-b',
        image_id: 'img-custom',
        runtime_source: 'prebuilt',
      }),
    ],
  };

  assert.equal(defaultTrainingImageProfile(catalog).id, 'training-base-b');
});

test('managed payload sends a profile while manual payload remains profile-free', () => {
  const base = {
    name: 'Qwen3 小样本训练',
    datasetVersionId: 'dataset-1',
    baseModelVersionId: 'model-1',
    config: {epochs: 1},
    instance: {gpu_type: '4090'},
  };
  assert.deepEqual(
    buildTrainingPayload({
      ...base,
      executionMode: 'managed',
      trainingImageProfileId: 'base-image-a-prime',
    }),
    {
      name: 'Qwen3 小样本训练',
      dataset_version_id: 'dataset-1',
      base_model_version_id: 'model-1',
      config: base.config,
      instance: base.instance,
      execution_mode: 'managed',
      training_image_profile_id: 'base-image-a-prime',
    },
  );
  assert.deepEqual(
    buildTrainingPayload({
      ...base,
      executionMode: 'manual',
      trainingImageProfileId: 'base-image-a-prime',
    }),
    {
      name: 'Qwen3 小样本训练',
      dataset_version_id: 'dataset-1',
      base_model_version_id: 'model-1',
      config: base.config,
      instance: base.instance,
      execution_mode: 'manual',
    },
  );
});
