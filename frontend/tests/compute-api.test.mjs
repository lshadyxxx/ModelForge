import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ComputeApi,
  computePaths,
  normalizeOperationAccepted,
} from '../src/features/resources/compute/compute-api.ts';
import { ApiError } from '../src/shared/http.ts';

const requestId = '018f6f7c-9a2b-7c3d-8e4f-123456789abc';

test('configuration and environment reads use the frozen routes and normalizers', async () => {
  const calls = [];
  const client = new ComputeApi(async (path, options) => {
    calls.push({path, options});
    if (path === computePaths.configuration) {
      return {configured: true, default_region: 'cn-wlcb', mode: 'read_write'};
    }
    if (path === computePaths.environments) {
      return {items: [{id: 'env-1', name: '环境一'}], total: 1, fetched_at: '2026-11-03T00:00:00Z', source: 'aggregate', warnings: []};
    }
    return {id: 'env-1', name: '环境一'};
  }, () => requestId);

  const configuration = await client.getConfiguration();
  const collection = await client.listEnvironments();
  const detail = await client.getEnvironment('env/with space');

  assert.equal(configuration.writeEnabled, false, 'write permission is not inferred from mode');
  assert.equal(collection.items.length, 1);
  assert.equal(detail.name, '环境一');
  assert.deepEqual(calls.map((call) => call.path), [
    computePaths.configuration,
    computePaths.environments,
    '/resources/compute/environments/env%2Fwith%20space',
  ]);
});

test('write commands POST a fresh uuid and never mutate state optimistically', async () => {
  const calls = [];
  const requestIds = [
    '018f6f7c-9a2b-7c3d-8e4f-123456789abc',
    '018f6f7c-9a2b-7c3d-8e4f-123456789abd',
    '018f6f7c-9a2b-7c3d-8e4f-123456789abe',
    '018f6f7c-9a2b-7c3d-8e4f-123456789abf',
  ];
  let requestIdIndex = 0;
  const client = new ComputeApi(async (path, options) => {
    calls.push({path, options});
    return {
      accepted: true,
      operation_id: `operation-${calls.length}`,
      environment_id: 'env-1',
      accepted_at: '2026-11-03T00:00:00Z',
      message: '已受理',
    };
  }, () => requestIds[requestIdIndex++]);

  const input = {
    name: '训练环境',
    spec: {
      region: 'cn-wlcb',
      zone: 'cn-wlcb-01',
      gpu_type: '4090',
      cpu: 16,
      memory_mb: 65536,
      image_id: 'image-1',
      cpu_platform: 'Auto',
      charge_type: 'Day',
      boot_disk_gb: 100,
      boot_disk_type: 'SSD',
    },
  };
  const created = await client.createEnvironment(input);
  const started = await client.startEnvironment('env-1');
  const stopped = await client.stopEnvironment('env-1');
  const deleted = await client.deleteEnvironment('env-1', '训练环境');

  assert.equal(created.accepted, true);
  assert.equal(started.operationId, 'operation-2');
  assert.equal(stopped.operationId, 'operation-3');
  assert.equal(deleted.operationId, 'operation-4');
  assert.deepEqual(calls.map((call) => call.path), [
    computePaths.create,
    computePaths.start('env-1'),
    computePaths.stop('env-1'),
    computePaths.delete('env-1'),
  ]);
  for (const [index, call] of calls.entries()) {
    assert.equal(
      call.options.method,
      index === calls.length - 1 ? 'DELETE' : 'POST',
    );
    assert.equal(call.options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(call.options.body);
    assert.equal(call.options.headers['Idempotency-Key'], requestIds[index]);
  }
  assert.equal(JSON.parse(calls[0].options.body).name, '训练环境');
  assert.equal(JSON.parse(calls[3].options.body).confirm_name, '训练环境');
});

test('delete requires an explicit exact name before any request is sent', async () => {
  let called = false;
  const client = new ComputeApi(async () => {
    called = true;
    return {};
  }, () => requestId);

  await assert.rejects(
    () => client.deleteEnvironment('env-1', '   '),
    (error) => error instanceof ApiError && error.code === 'confirmation_required',
  );
  assert.equal(called, false);
});

test('operation responses must be accepted and contain an operation id', () => {
  assert.deepEqual(normalizeOperationAccepted({
    accepted: true,
    operation_id: 'op-1',
    environment_id: 'env-1',
    accepted_at: '2026-11-03T00:00:00Z',
    message: '已受理',
  }), {
    accepted: true,
    state: 'accepted',
    operationId: 'op-1',
    environmentId: 'env-1',
    acceptedAt: '2026-11-03T00:00:00Z',
    message: '已受理',
  });

  assert.throws(
    () => normalizeOperationAccepted({accepted: true}),
    (error) => error instanceof ApiError && error.code === 'invalid_response',
  );
});

test('the adapter also accepts the backend command envelope without inventing success', () => {
  const accepted = normalizeOperationAccepted({
    environment: {id: 'environment-1'},
    command: {
      id: 'command-1',
      state: 'accepted',
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T00:01:00Z',
    },
  });
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.operationId, 'command-1');
  assert.equal(accepted.environmentId, 'environment-1');

  assert.throws(
    () => normalizeOperationAccepted({
      command: {id: 'command-2', state: 'failed', error_code: 'cloud_timeout'},
    }),
    (error) => error instanceof ApiError && error.code === 'cloud_timeout',
  );
});

test('delete passes explicit data-loss acknowledgement only when the caller provides it', async () => {
  const bodies = [];
  const client = new ComputeApi(async (_path, options) => {
    bodies.push(JSON.parse(options.body));
    return {accepted: true, operation_id: 'op-1'};
  }, () => requestId);

  await client.deleteEnvironment('env-1', '环境一', {
    acknowledgeDataLoss: true,
    cleanupPolicy: 'outputs_persisted',
  });

  assert.equal(bodies[0].confirm_name, '环境一');
  assert.equal(bodies[0].acknowledge_data_loss, true);
  assert.equal(bodies[0].cleanup_policy, 'outputs_persisted');
});

test('invalid injected request ids fail closed before an operation is sent', async () => {
  let called = false;
  const client = new ComputeApi(async () => {
    called = true;
    return {accepted: true, operation_id: 'op-1'};
  }, () => 'not-a-uuid');

  await assert.rejects(
    () => client.stopEnvironment('env-1'),
    (error) => error instanceof ApiError && error.code === 'secure_random_unavailable',
  );
  assert.equal(called, false);
});
