import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filterModelGroups,groupModelRows,modelImportProgress,summarizeModelGroup} from '../src/features/models/api.ts';

const row=(id,model_id,version_number,state,compatibility_state='unverified',source_kind='modelscope')=>({
  id,model_id,name:'Qwen test',version_number,state,compatibility_state,source_kind,
  created_at:`2026-11-0${version_number}T00:00:00Z`,
});

test('model rows are grouped by immutable model id and ordered by version',()=>{
  const groups=groupModelRows([
    row('v1','family-1',1,'available'),
    row('v3','family-1',3,'uploading'),
    row('v2','family-1',2,'delete_failed'),
    row('other','family-2',1,'available'),
  ]);

  assert.equal(groups.length,2);
  assert.deepEqual(groups.find(group=>group.id==='family-1').versions.map(version=>version.version_number),[3,2,1]);
});

test('family status aggregates every version and prioritizes errors',()=>{
  const group=groupModelRows([
    row('v1','family-1',1,'available'),
    row('v2','family-1',2,'uploading'),
    row('v3','family-1',3,'delete_failed'),
  ]).find(item=>item.id==='family-1');
  const summary=summarizeModelGroup(group);

  assert.equal(summary.label,'1 异常 · 1 传输中 · 1 可用');
  assert.equal(summary.tone,'bad');
  assert.equal(summary.errors,1);
});

test('filters inspect every version in a model family',()=>{
  const groups=groupModelRows([
    row('v1','family-1',1,'available','verified'),
    row('v2','family-1',2,'uploading'),
    row('v1','family-2',1,'delete_failed'),
  ]);

  assert.equal(filterModelGroups(groups,'','errors')[0].id,'family-2');
  assert.equal(filterModelGroups(groups,'','pending')[0].id,'family-1');
  assert.equal(filterModelGroups(groups,'','verified')[0].id,'family-1');
});

test('model import progress combines verified bytes and the active file without double counting',()=>{
  const files=[
    {path:'config.json',size_bytes:100,sha256:'a',state:'verified'},
    {path:'model-00001.safetensors',size_bytes:300,sha256:'b',state:'pending'},
  ];
  const progress=modelImportProgress({
    files,
    total_bytes:400,
    verified_bytes:100,
    import:{state:'running',current_path:'model-00001.safetensors',current_bytes:150},
  });

  assert.equal(progress.transferredBytes,250);
  assert.equal(progress.percent,62.5);
  assert.equal(progress.verifiedFiles,1);
  assert.equal(progress.currentBytes,150);
  assert.equal(progress.currentPercent,50);

  const settled=modelImportProgress({
    files:[files[0],{...files[1],state:'verified'}],
    total_bytes:400,
    verified_bytes:400,
    import:{state:'running',current_path:'model-00001.safetensors',current_bytes:300},
  });
  assert.equal(settled.transferredBytes,400);
  assert.equal(settled.percent,100);
});
