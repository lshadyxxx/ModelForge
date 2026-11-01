import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeVersionRow } from '../src/features/models/api.ts';

const versionDetail = {id: 'version-1', model_id: 'model-1', version_number: 1,
  source_kind: 'directory', state: 'uploading', created_at: '2026-10-31T00:00:00Z',
  compatibility_state: 'unverified'};

test('detail refresh preserves the model name already shown in the list', () => {
  const rows = [{...versionDetail, name: 'Customer model'}];
  const updated = mergeVersionRow(rows, {...versionDetail, state: 'available'});

  assert.equal(updated[0].state, 'available');
  assert.equal(updated[0].name, 'Customer model');
});

test('new directory upload uses its submitted name until list reload', () => {
  const rows = mergeVersionRow([], versionDetail, 'Uploaded model');

  assert.equal(rows[0].name, 'Uploaded model');
  assert.equal(rows[0].state, 'uploading');
});
