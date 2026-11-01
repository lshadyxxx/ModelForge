import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { uploadModelDirectory } from '../src/features/models/directory-upload.ts';

const limits = {file_limit_bytes: 1000, total_limit_bytes: 3000, file_count_limit: 5, locked: false};
const files = [new File(['{}'], 'config.json'), new File(['weights'], 'model.safetensors')];
const version = {id: 'version-1', model_id: 'model-1', version_number: 1,
  source_kind: 'directory', state: 'uploading', created_at: '2026-10-31T00:00:00Z',
  compatibility_state: 'unverified', files: [], references: [], total_bytes: 9, verified_bytes: 0, manifest_sha256: ''};

async function withBoundary(run, respond) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    options.signal?.throwIfAborted();
    const call = {url, method: options.method ?? 'GET', options};
    calls.push(call);
    const body = await respond(call, calls);
    return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {await run(calls);} finally {globalThis.fetch = original;}
}

test('resume uses the selected version and uploads only paths not reused by the server', async () => {
  await withBoundary(async calls => {
    const observed = [];
    const result = await uploadModelDirectory({files, name: 'unused', resumeId: 'version-1', limits,
      signal: new AbortController().signal, onProgress() {}, onVersion: value => observed.push(value.state)});
    assert.equal(result.state, 'available');
    assert.deepEqual(calls.map(({method, url}) => method + ' ' + url), [
      'POST /api/v1/model-versions/version-1/resume', 'GET /api/v1/model-versions/version-1',
      'PUT /api/v1/model-versions/version-1/files?path=model.safetensors',
      'GET /api/v1/model-versions/version-1', 'POST /api/v1/model-versions/version-1/complete',
      'GET /api/v1/model-versions/version-1',
    ]);
    const manifest = JSON.parse(calls[0].options.body).files;
    assert.equal(manifest[0].sha256, createHash('sha256').update('{}').digest('hex'));
    assert.equal(await calls[2].options.body.text(), 'weights');
    assert.equal(observed.at(-1), 'available');
  }, ({url}, calls) => url.endsWith('/resume') ? {reusable_paths: ['config.json'], upload_paths: ['model.safetensors']} :
    {...version, state: calls.some(call => call.url.endsWith('/complete')) ? 'available' : 'uploading'});
});

test('stopping after a file prevents later PUTs and completion', async () => {
  const controller = new AbortController();
  await withBoundary(async calls => {
    await assert.rejects(uploadModelDirectory({files, name: 'fixture', limits, signal: controller.signal,
      onProgress() {}, onVersion() {}}), {name: 'AbortError'});
    assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(calls.some(call => call.url.endsWith('/complete')), false);
    assert.equal(calls[0].url, '/api/v1/models/directory-imports');
    assert.equal(JSON.parse(calls[0].options.body).name, 'fixture');
  }, ({method}) => {if (method === 'PUT') controller.abort(); return version;});
});

test('stopping after the final readback prevents completing a cancelled transfer', async () => {
  const controller = new AbortController();
  let reads = 0;
  await withBoundary(async calls => {
    await assert.rejects(uploadModelDirectory({files: files.slice(0, 1), name: 'fixture', limits, signal: controller.signal,
      onProgress() {}, onVersion() {if (++reads === 2) controller.abort();}}), {name: 'AbortError'});
    assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(calls.some(call => call.url.endsWith('/complete')), false);
  }, () => version);
});
