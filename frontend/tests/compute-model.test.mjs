import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLatestRequestScope,
  environmentAttention,
  matchesEnvironmentFilters,
  normalizeConfiguration,
  normalizeEnvironment,
  normalizeEnvironmentCollection,
  normalizeProviderStatus,
  normalizeQuote,
  sortEnvironments,
  summarizeEnvironments,
} from '../src/features/resources/compute/compute-model.ts';

function environment(overrides = {}) {
  return {
    id: 'env-1',
    name: '训练环境 A',
    provider_instance_id: 'uhost-1',
    status: 'running',
    spec: {
      region: 'cn-wlcb',
      zone: 'cn-wlcb-01',
      gpu_type: '4090',
      cpu: 16,
      memory_mb: 64 * 1024,
      image_id: 'image-1',
      image_name: 'PyTorch 2.6',
      cpu_platform: 'Intel/Auto',
      charge_type: 'Day',
      boot_disk_gb: 100,
      boot_disk_type: 'SSD',
    },
    lease: {
      reservation_id: 'lease-1',
      state: 'held',
      owner_kind: 'attempt',
      owner_id: 'attempt-1',
      events: [{action: 'reserved', label: '已预留 GPU', recorded_at: '2026-11-03T01:00:00Z', source: 'lease'}],
    },
    relation: {kind: 'training', id: 'attempt-1', label: '模型微调'},
    cleanup: {state: 'not_requested'},
    monitor: {provider: 'unavailable', error_code: 'monitor_not_configured'},
    ownership: 'managed',
    freshness: 'fresh',
    compatibility: 'verified',
    inventory: {state: 'available_snapshot', checked_at: '2026-11-03T01:01:00Z'},
    actions: ['start', 'delete', 'restart'],
    events: [{id: 'event-1', action: 'create', label: '创建实例', recorded_at: '2026-11-03T00:58:00Z', source: 'observation'}],
    created_at: '2026-11-03T00:58:00Z',
    updated_at: '2026-11-03T01:00:00Z',
    ...overrides,
  };
}

test('a complete environment is normalized without leaking provider-specific fields', () => {
  const value = normalizeEnvironment(environment());

  assert.equal(value.id, 'env-1');
  assert.equal(value.status, 'running');
  assert.equal(value.spec.gpuType, '4090');
  assert.equal(value.spec.memoryMb, 65536);
  assert.equal(value.lease.ownerKind, 'training');
  assert.equal(value.lease.events[0].source, 'lease');
  assert.equal(value.relation.kind, 'training');
  assert.equal(value.compatibility, 'verified');
  assert.equal(value.inventory.state, 'available_snapshot');
  assert.deepEqual(value.actions, ['start', 'delete']);
  assert.equal(value.events[0].source, 'observation');
  assert.equal(value.quote.state, 'unavailable');
  assert.equal(value.quote.code, 'quote_unavailable');
  assert.equal(value.quote.label, '报价不可用');
  assert.equal(value.quote.currency, null);
  assert.equal(value.quote.hourly, null);
  assert.equal(value.quote.estimatedTotal, null);
});

test('missing or malformed fields degrade honestly instead of becoming healthy defaults', () => {
  const value = normalizeEnvironment({});

  assert.equal(value.id, '');
  assert.equal(value.name, '未命名环境 1');
  assert.equal(value.status, 'unknown');
  assert.equal(value.lease.state, 'unknown');
  assert.equal(value.relation.kind, 'unknown');
  assert.equal(value.cleanup.state, 'unknown');
  assert.equal(value.ownership, 'unknown');
  assert.equal(value.freshness, 'unconfirmed');
  assert.equal(value.compatibility, 'unverified');
  assert.equal(value.inventory.state, 'unknown');
  assert.equal(value.identityAvailable, false);
  assert.deepEqual(value.actions, []);
  assert.equal(value.quote.code, 'quote_unavailable');
  assert.equal(value.quote.currency, null);
  assert.equal(value.quote.hourly, null);
  assert.ok(value.warnings.length >= 5);
});

test('unknown provider lifecycle values never become failed, stopped or running', () => {
  assert.equal(normalizeProviderStatus('Runtime Lost'), 'unknown');
  assert.equal(normalizeProviderStatus('Terminated'), 'unknown');
  assert.equal(normalizeProviderStatus('RUNNING'), 'running');
  assert.equal(normalizeProviderStatus('Initializing'), 'creating');
  assert.equal(normalizeProviderStatus('Error'), 'failed');
  assert.equal(normalizeProviderStatus('Offline'), 'unavailable');
});

test('unmanaged environments do not expose destructive actions even if the response suggests them', () => {
  const value = normalizeEnvironment(environment({
    ownership: 'unmanaged',
    actions: ['start', 'stop', 'delete'],
  }));

  assert.equal(value.ownership, 'unmanaged');
  assert.deepEqual(value.actions, []);
  assert.ok(value.warnings.some((warning) => warning.includes('写操作已关闭')));
});

test('an explicit managed=false backend flag fails closed when management metadata conflicts', () => {
  const value = normalizeEnvironment(environment({
    ownership: undefined,
    managed: false,
    management: 'environment',
    capabilities: {start: true, stop: true, delete: true},
  }));

  assert.equal(value.ownership, 'unmanaged');
  assert.deepEqual(value.actions, []);
});

test('missing actions stay closed and are never inferred from lifecycle state', () => {
  const stopped = normalizeEnvironment(environment({status: 'stopped', actions: undefined}));
  const failed = normalizeEnvironment(environment({status: 'failed', actions: undefined}));

  assert.deepEqual(stopped.actions, []);
  assert.deepEqual(failed.actions, []);
});

test('environment collections preserve source metadata and tolerate bad rows', () => {
  const result = normalizeEnvironmentCollection({
    items: [environment(), null, environment({id: 'env-2', name: '备用环境'})],
    total: 1,
    fetched_at: '2026-11-03T02:00:00Z',
    source: 'aggregate',
    degraded: true,
    warnings: ['供应商刷新较慢'],
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.total, 2);
  assert.equal(result.fetchedAt, '2026-11-03T02:00:00Z');
  assert.equal(result.source, 'aggregate');
  assert.equal(result.degraded, true);
  assert.ok(result.warnings.includes('供应商刷新较慢'));
});

test('the adapter normalizes the backend state object, associations, capabilities and command-ready fields', () => {
  const value = normalizeEnvironment({
    id: '018f6f7c-9a2b-7c3d-8e4f-123456789abc',
    name: '后端环境',
    resource_owner: 'personal-workspace',
    managed: true,
    management: 'environment',
    state: 'starting',
    provider_state: 'Boot',
    provider_instance_id: 'uhost-1',
    spec: {
      region: 'cn-wlcb',
      zone: 'cn-wlcb-01',
      gpu_type: '4090',
      cpu: 8,
      memory_mb: 32768,
      image_id: 'image-1',
      cpu_platform: 'Auto',
      charge_type: 'Day',
      boot_disk_gb: 60,
      boot_disk_type: 'CLOUD_SSD',
    },
    lease_id: 'lease-1',
    lease: {id: 'lease-1', state: 'held', owner_kind: 'environment'},
    associations: [{kind: 'inference', id: 'trial-1', label: '推理试用', state: 'running', active: true}],
    capabilities: {start: false, stop: true, delete: true, reconcile: true, monitor: true, price: false},
    monitor: {
      state: 'ready',
      fetched_at: '2026-11-03T00:01:00Z',
      items: [{Metrics: [{MetricKey: 'gpu_util', label: 'GPU 利用率', Results: [{Values: [{Value: 73}]}]}]}],
    },
    freshness: {state: 'unknown', observed_at: null},
    pricing: {
      state: 'available',
      code: 'quote_observed',
      label: '官方报价',
      description: '官方折后报价，按小时展示。',
      source: 'ucloud',
      currency: 'CNY',
      hourly: 1.66,
      amount: 1.66,
      unit: 'hour',
      charge_type: 'Postpay',
      breakdown: {
        instance: 1.48,
        system_disks: 0.18,
        data_disks: 0,
        image: 0,
      },
      observed_at: '2026-11-03T00:02:00Z',
    },
    events: [{source: 'platform', action: 'create_requested', recorded_at: '2026-11-03T00:00:00Z'}],
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:01:00Z',
  });

  assert.equal(value.status, 'creating');
  assert.equal(value.resourceOwner, 'personal-workspace');
  assert.equal(value.providerState, 'Boot');
  assert.equal(value.management, 'environment');
  assert.equal(value.ownership, 'managed');
  assert.equal(value.lease.reservationId, 'lease-1');
  assert.equal(value.relation.kind, 'trial');
  assert.equal(value.relation.active, true);
  assert.deepEqual(value.actions, ['stop', 'delete']);
  assert.equal(value.freshness, 'unconfirmed');
  assert.equal(value.monitor.provider, 'ucloud');
  assert.equal(value.monitor.metrics[0].value, 73);
  assert.equal(value.events[0].source, 'observation');
  assert.equal(value.quote.state, 'available');
  assert.equal(value.quote.hourly, 1.66);
  assert.equal(value.quote.breakdown.systemDisks, 0.18);
  assert.equal(value.quote.chargedAt, '2026-11-03T00:02:00Z');
});

test('pricing accepts only explicit official amounts and never invents a fallback', () => {
  const value = normalizeQuote({
    state: 'available',
    code: 'quote_observed',
    currency: 'CNY',
    hourly: 2.25,
    amount: 2.25,
    unit: 'hour',
    observed_at: '2026-11-03T00:02:00Z',
    breakdown: {
      instance: 2,
      system_disks: 0.25,
      data_disks: 0,
      image: 0,
    },
  });
  assert.equal(value.state, 'available');
  assert.equal(value.hourly, 2.25);
  assert.equal(value.estimatedTotal, 2.25);

  const missing = normalizeQuote({state: 'available'});
  assert.equal(missing.state, 'unavailable');
  assert.equal(missing.hourly, null);
  assert.equal(missing.errorCode, 'quote_invalid');
});

test('the collection adapter maps summary, observed_at and degraded source metadata', () => {
  const result = normalizeEnvironmentCollection({
    items: [environment()],
    summary: {total: 4},
    source: {
      state: 'stale',
      fetched_at: '2026-11-03T00:00:00Z',
      errors: [{code: 'cloud_timeout', message: '供应商刷新超时'}],
    },
    observed_at: '2026-11-03T00:01:00Z',
  });

  assert.equal(result.total, 4);
  assert.equal(result.fetchedAt, '2026-11-03T00:01:00Z');
  assert.equal(result.sourceState, 'stale');
  assert.equal(result.degraded, true);
  assert.ok(result.warnings.includes('供应商刷新超时'));
});

test('configuration defaults to read-only when write_enabled is missing or conflicts', () => {
  assert.equal(normalizeConfiguration({configured: true, default_region: 'cn-wlcb', mode: 'read_write'}).writeEnabled, false);
  assert.equal(normalizeConfiguration({configured: true, mode: 'read_only', write_enabled: true}).writeEnabled, false);
  assert.equal(normalizeConfiguration({configured: true, mode: 'read_write', write_enabled: true}).writeEnabled, true);
  assert.equal(normalizeConfiguration(undefined).configured, false);
});

test('environment filters are intersection across groups and OR within a group', () => {
  const value = normalizeEnvironment(environment());

  assert.equal(matchesEnvironmentFilters(value), true);
  assert.equal(matchesEnvironmentFilters(value, {regions: ['cn-wlcb'], gpuTypes: ['4090', 'A100']}), true);
  assert.equal(matchesEnvironmentFilters(value, {zones: ['cn-wlcb-02']}), false);
  assert.equal(matchesEnvironmentFilters(value, {statuses: ['running'], leaseStates: ['held']}), true);
  assert.equal(matchesEnvironmentFilters(value, {minMemoryMb: 64001}), true);
  assert.equal(matchesEnvironmentFilters(value, {minMemoryMb: 70000}), false);
  assert.equal(matchesEnvironmentFilters(normalizeEnvironment({}), {minCpu: 1}), false);
});

test('attention summaries expose unsafe, stale and unknown states without relying on color', () => {
  const healthy = normalizeEnvironment(environment());
  const failed = normalizeEnvironment(environment({
    id: 'env-2',
    name: '失败环境',
    status: 'failed',
    freshness: 'stale',
    lease: {state: 'review'},
    cleanup: {state: 'failed', error_code: 'delete_failed'},
  }));
  const summary = summarizeEnvironments([healthy, failed]);
  const reasons = environmentAttention(failed);
  const sorted = sortEnvironments([healthy, failed], 'attention');

  assert.equal(summary.total, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.attention, 2);
  assert.ok(reasons.some((reason) => reason.code === 'lease:review'));
  assert.ok(reasons.some((reason) => reason.code === 'cleanup:failed'));
  assert.ok(reasons.every((reason) => reason.label && reason.description && reason.icon));
  assert.equal(sorted[0].id, 'env-2');
});

test('latest request scope aborts stale work and refuses late commits', () => {
  const scope = createLatestRequestScope();
  const first = scope.begin();
  const second = scope.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(scope.isCurrent(first), false);
  assert.equal(scope.isCurrent(second), true);

  scope.finish(first);
  assert.equal(scope.isCurrent(second), true);
  scope.finish(second);
  assert.equal(scope.isCurrent(second), false);
});
