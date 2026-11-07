import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageDirectoryQuery, matchesFilters } from '../src/features/resources/api.ts';

const directory = (filters) => ({items: [], total: 0, state: 'empty', fetched_at: '2026-10-31T00:00:00Z', source: 'ucloud', compatibility: 'unverified', filters});

test('default image query path and freshness snapshot use the same provider type', () => {
  const query = imageDirectoryQuery('cn-wlcb', 'cn-wlcb-01', '', '');
  const response = directory({...query.filters, Offset: 0});

  assert.equal(query.filters.ImageType, 'System');
  assert.match(query.path, /image_type=System/);
  assert.doesNotMatch(query.path, /[?&]name=/);
  assert.equal(matchesFilters(response, query.filters, ['Offset']), true);
});

test('image name filters are trimmed and omitted when blank', () => {
  assert.doesNotMatch(imageDirectoryQuery('region-a', 'zone-a', '   ', 'App').path, /[?&]name=/);
  assert.match(imageDirectoryQuery('region-a', 'zone-a', '  torch  ', 'App').path, /(?:[?&])name=torch(?:&|$)/);
});

test('custom image queries keep the exact region and zone scope', () => {
  const query = imageDirectoryQuery(
    'cn-bj2',
    'cn-bj2-03',
    'training',
    'Custom',
    0,
    100,
  );

  assert.equal(query.filters.ImageType, 'Custom');
  assert.match(query.path, /image_type=Custom/);
  assert.match(query.path, /region=cn-bj2/);
  assert.match(query.path, /zone=cn-bj2-03/);
  assert.match(query.path, /name=training/);
});

test('an old region page cannot be used after switching regions', () => {
  const previous = directory({Region: 'region-a', Offset: 80, Limit: 20});

  assert.equal(matchesFilters(previous, {Region: 'region-b', Limit: 20}, ['Offset']), false);
});

test('pagination may advance only within the same directory filters', () => {
  const page = directory({Region: 'region-a', Name: 'torch', Offset: 80, Limit: 20});

  assert.equal(matchesFilters(page, {Region: 'region-a', Name: 'torch', Limit: 20}, ['Offset']), true);
  assert.equal(matchesFilters(page, {Region: 'region-a', Name: 'cuda', Limit: 20}, ['Offset']), false);
});

test('GPU options are invalidated when a zone or model filter changes', () => {
  const page = directory({Region: 'region-a', Zone: 'zone-1', MachineTypes: ['gpu-a'], InstanceType: 'uhost'});

  assert.equal(matchesFilters(page, {Region: 'region-a', Zone: 'zone-2', MachineTypes: ['gpu-a'], InstanceType: 'uhost'}), false);
  assert.equal(matchesFilters(page, {Region: 'region-a', Zone: 'zone-1', MachineTypes: ['gpu-b'], InstanceType: 'uhost'}), false);
});

test('nested selected capacity inputs must still match the directory snapshot', () => {
  const page = directory({Region: 'region-a', Zone: 'zone-1', Disks: [{IsBoot: true, Type: 'SSD', Size: 60}]});

  assert.equal(matchesFilters(page, {Region: 'region-a', Zone: 'zone-1', Disks: [{IsBoot: true, Type: 'SSD', Size: 60}]}), true);
  assert.equal(matchesFilters(page, {Region: 'region-a', Zone: 'zone-1', Disks: [{IsBoot: true, Type: 'SSD', Size: 80}]}), false);
});
