import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScopeOptions,
  findScopeOption,
} from '../src/features/resources/compute/compute-scope.ts';

const zones = [
  {
    Region: 'cn-bj2',
    Zone: 'cn-bj2-03',
    Describe: '华北一C',
    IsPod: true,
  },
  {
    Region: 'cn-sh2',
    Zone: 'cn-sh2-01',
    Describe: '上海二A',
    IsPod: true,
  },
  {
    Region: 'cn-sh2',
    Zone: 'cn-sh2-03',
    Describe: '上海二C',
    IsPod: true,
  },
  {
    Region: 'cn-wlcb',
    Zone: 'cn-wlcb-01',
    Describe: '华北二A',
    IsPod: false,
  },
  {
    Region: 'cn-sh2',
    Zone: 'cn-sh2-02',
    Describe: '上海二B',
    IsPod: false,
  },
];

test('scope options retain every sellable zone without collapsing by region', () => {
  const options = buildScopeOptions(zones);

  assert.equal(options.length, 5);
  assert.deepEqual(
    options.map((option) => option.label),
    ['华北一C', '上海二A', '上海二C', '华北二A', '上海二B'],
  );
  assert.equal(
    options.filter((option) => option.region === 'cn-sh2').length,
    3,
  );
  assert.ok(
    options.every(
      (option) => option.value === option.zone,
    ),
  );
});

test('scope options ignore duplicate or incomplete zone rows', () => {
  const options = buildScopeOptions([
    ...zones,
    zones[0],
    { Region: '', Zone: 'cn-sh2-09', Describe: '', IsPod: false },
    { Region: 'cn-sh2', Zone: '', Describe: '', IsPod: false },
  ]);

  assert.equal(options.length, 5);
});

test('findScopeOption requires the exact region and zone pair', () => {
  const options = buildScopeOptions(zones);

  assert.equal(
    findScopeOption(options, 'cn-sh2', 'cn-sh2-03')?.label,
    '上海二C',
  );
  assert.equal(findScopeOption(options, 'cn-sh2', 'cn-bj2-03'), null);
  assert.equal(findScopeOption(options, 'cn-bj2', ''), null);
});
