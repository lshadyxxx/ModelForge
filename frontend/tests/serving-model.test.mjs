import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  classifyReceipt,
  deriveTrialView,
  formatRemaining,
  parseServingRoute,
  queuePresentation,
  servingErrorMessage,
  servingRouteQuery,
  summarizeTrials,
} from '../src/features/serving/serving-model.ts';

const base = {
  id: '11111111-1111-1111-1111-111111111111',
  state: 'ready',
  adapter_id: 'adapter-1',
  instance_id: 'instance-1',
  lease_id: 'lease-1',
  stop_requested: false,
  request_state: 'idle',
  request_cancel_requested: false,
  last_activity_at: '2026-11-04T08:00:00Z',
  snapshot: {
    base: {id: 'base-1', fingerprint: 'base-fingerprint'},
    instance: {},
    adapter_fingerprint: 'adapter-fingerprint',
  },
};

const tracked = {
  status: 'tracked',
  creation: {state: 'bound'},
  process: {state: 'exited', exit_code: 0, cancelled: true, exited_at: '2026-11-04T08:01:00Z'},
  instance: {state: 'deleted', stopped_at: '2026-11-04T08:02:00Z', deleted_at: '2026-11-04T08:03:00Z'},
  cleanup: {policy: 'discard', state: 'confirmed', error_code: null},
  lease: {state: 'released', created_at: '2026-11-04T07:59:00Z', released_at: '2026-11-04T08:03:01Z'},
  events: [{action: 'released', recorded_at: '2026-11-04T08:03:01Z'}],
};

test('serving routes preserve the active trial when the create overlay opens', () => {
  assert.deepEqual(parseServingRoute(''), {trialId: '', create: false});
  assert.deepEqual(parseServingRoute('?trial=abc'), {trialId: 'abc', create: false});
  assert.deepEqual(parseServingRoute('?view=create'), {trialId: '', create: true});
  const route = {trialId: 'abc', create: true};
  assert.equal(servingRouteQuery(route), '?trial=abc&view=create');
  assert.deepEqual(parseServingRoute(servingRouteQuery(route)), route);
  assert.equal(servingRouteQuery({trialId: 'abc', create: false}), '?trial=abc');
  assert.equal(servingRouteQuery({trialId: '', create: false}), '');
});

test('state priority never turns stopping or unknown work into ready', () => {
  assert.deepEqual(deriveTrialView(base), {kind: 'ready'});
  assert.deepEqual(deriveTrialView({...base, request_state: 'running'}), {kind: 'generating'});
  assert.deepEqual(deriveTrialView({...base, request_state: 'cancelling'}), {kind: 'cancelling'});
  assert.deepEqual(deriveTrialView({...base, request_state: 'unknown'}), {kind: 'request_unknown'});
  assert.deepEqual(deriveTrialView({...base, stop_requested: true}), {kind: 'ending', phase: 'stop_requested'});
  assert.deepEqual(deriveTrialView({...base, state: 'blocked', stop_requested: true}), {kind: 'blocked'});
  assert.deepEqual(deriveTrialView({...base, state: 'stopped', request_state: 'unknown'}), {kind: 'ended', receipt: 'incomplete'});
  assert.deepEqual(deriveTrialView({...base, state: 'future'}), {kind: 'unknown', rawState: 'future', rawRequestState: 'idle'});
  assert.deepEqual(deriveTrialView({...base, request_state: ''}), {kind: 'request_unknown'});
});

test('receipt facts require process, instance, cleanup and lease closure together', () => {
  assert.equal(classifyReceipt({status: 'not_reserved'}), 'no_instance');
  assert.equal(classifyReceipt({...tracked, lease: {state: 'held', created_at: 'x', released_at: null}}), 'incomplete');
  assert.equal(classifyReceipt({...tracked, cleanup: {...tracked.cleanup, state: 'failed', error_code: 'instance_delete_failed'}}), 'incomplete');
  assert.equal(classifyReceipt({...tracked, process: {...tracked.process, state: 'unknown', exit_code: null}}), 'incomplete');
  assert.equal(classifyReceipt(tracked), 'reclaimed');
  assert.equal(classifyReceipt(undefined), 'incomplete');
  assert.deepEqual(
    deriveTrialView({...base, state: 'stopped', lifecycle: tracked}),
    {kind: 'ended', receipt: 'complete'},
  );
});

test('ending phase reports residual instance and lease work without inventing success', () => {
  assert.deepEqual(
    deriveTrialView({...base, stop_requested: true, lifecycle: {...tracked, process: {...tracked.process, state: 'unknown'}}}),
    {kind: 'ending', phase: 'cleanup_pending'},
  );
  assert.deepEqual(
    deriveTrialView({...base, stop_requested: true, lifecycle: {
      ...tracked,
      process: {...tracked.process, state: 'exited'},
      cleanup: {...tracked.cleanup, policy: null, state: 'not_requested'},
      instance: {state: 'stopped', stopped_at: '2026-11-04T08:02:00Z', deleted_at: null},
      lease: {state: 'held', created_at: 'x', released_at: null},
    }}),
    {kind: 'ending', phase: 'process_exited'},
  );
  assert.deepEqual(
    deriveTrialView({...base, stop_requested: true, lifecycle: tracked}),
    {kind: 'ending', phase: 'cleanup_pending'},
  );
  assert.deepEqual(
    deriveTrialView({...base, stop_requested: true, lifecycle: {
      ...tracked,
      process: {...tracked.process, state: 'exited'},
      cleanup: {...tracked.cleanup, state: 'pending'},
      lease: {state: 'held', created_at: 'x', released_at: null},
    }}),
    {kind: 'ending', phase: 'lease_pending'},
  );
  assert.deepEqual(
    deriveTrialView({...base, state: 'stopping', lifecycle: {
      ...tracked,
      lease: {state: 'held', created_at: 'x', released_at: null},
    }}),
    {kind: 'ending', phase: 'lease_pending'},
  );
});

test('countdown, queue summary and user errors remain deterministic', () => {
  assert.equal(formatRemaining('2026-11-04T08:00:00Z', Date.parse('2026-11-04T08:10:00Z')), '5 分钟');
  assert.equal(formatRemaining('2026-11-04T08:00:00Z', Date.parse('2026-11-04T08:15:01Z')), '即将请求回收');
  assert.deepEqual(summarizeTrials([
    {...base, id: 'ready'},
    {...base, id: 'waiting', state: 'waiting_instance'},
    {...base, id: 'blocked', state: 'blocked'},
    {...base, id: 'generating', request_state: 'running'},
  ]), {active: 1, waiting: 1, ready: 1, attention: 1});
  assert.match(servingErrorMessage('gpu_busy'), /占用 GPU/);
  assert.equal(servingErrorMessage('future_code', '原始错误'), '原始错误');
});

test('queue does not call an unloaded lifecycle incomplete', () => {
  const stopped = {...base, state: 'stopped'};
  assert.deepEqual(deriveTrialView(stopped), {kind: 'ended', receipt: 'incomplete'});
  assert.equal(queuePresentation(stopped).shortLabel, '已结束');
  assert.equal(queuePresentation(stopped).tone, 'neutral');
  assert.equal(queuePresentation({...stopped, lifecycle: tracked}).shortLabel, '已回收');
  assert.deepEqual(summarizeTrials([
    stopped,
    {...stopped, id: 'complete', lifecycle: tracked},
    {...base, id: 'blocked', state: 'blocked'},
  ]), {active: 0, waiting: 0, ready: 0, attention: 1});
});
