import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendDatasetSamplePage,
  deriveDatasetVersion,
  datasetShortId,
  datasetStateLabel,
  groupDatasetRows,
} from '../src/features/datasets/api.ts';

function row(datasetId, versionId, versionNumber, createdAt) {
  return {
    dataset_id: datasetId,
    name: '客服123',
    version_id: versionId,
    version_number: versionNumber,
    state: 'published',
    size_bytes: 100,
    sha256: 'a'.repeat(64),
    sample_count: 10,
    line_count: 10,
    version_created_at: createdAt,
    published_at: createdAt,
  };
}

test('same-name datasets remain separate and versions sort newest first', () => {
  const groups = groupDatasetRows([
    row('4323e5cf-d95a-4db5-8ab5-40e081220f74', 'v1', 1, '2026-11-01T00:00:00Z'),
    row('4323e5cf-d95a-4db5-8ab5-40e081220f74', 'v2', 2, '2026-11-02T00:00:00Z'),
    row('d3e1c4dc-c10d-48f1-89a8-5bdfa2ee54b2', 'other-v1', 1, '2026-10-31T00:00:00Z'),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].versions.map((version) => version.version_id), ['v2', 'v1']);
  assert.equal(groups[0].latest.version_id, 'v2');
  assert.notEqual(groups[0].id, groups[1].id);
});

test('dataset identity and state labels remain stable at the API boundary', () => {
  assert.equal(datasetShortId('d3e1c4dc-c10d-48f1-89a8-5bdfa2ee54b2'), 'DT-D3E1C4DC');
  assert.equal(datasetStateLabel('upload_failed'), '上传失败');
  assert.equal(datasetStateLabel('future-state'), 'future-state');
});

function samplePage(versionId, offset, lines) {
  return {
    version_id: versionId,
    sha256: 'a'.repeat(64),
    line_count: 4,
    sample_count: 4,
    offset,
    limit: 2,
    next_offset: offset + lines.length < 4 ? offset + lines.length : null,
    samples: lines.map((line) => ({
      line,
      messages: [{role: 'user', content: `q${line}`}],
      raw: `{"line":${line}}`,
      split: null,
    })),
  };
}

test('sample pagination appends only pages from the selected immutable version', () => {
  const current = samplePage('version-a', 0, [1, 2]);
  const appended = appendDatasetSamplePage(
    current,
    samplePage('version-a', 2, [3, 4]),
    'version-a',
  );

  assert.deepEqual(appended.samples.map((sample) => sample.line), [1, 2, 3, 4]);
  assert.equal(appended.offset, 0);
  assert.equal(appended.next_offset, null);
  assert.equal(
    appendDatasetSamplePage(current, samplePage('version-b', 2, [3, 4]), 'version-a'),
    current,
  );
});

test('derivation requests carry a stable idempotency identifier', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = {url, options};
    return new Response(JSON.stringify({id: 'derived'}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  };
  try {
    await deriveDatasetVersion(
      'version-a',
      '00000000-0000-0000-0000-000000000002',
      'a'.repeat(64),
      2,
      [{role: 'assistant', content: 'edited'}],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, '/api/v1/dataset-versions/version-a/derived');
  assert.equal(body.request_id, '00000000-0000-0000-0000-000000000002');
  assert.equal(body.line, 2);
});
