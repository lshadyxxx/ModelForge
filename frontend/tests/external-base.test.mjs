import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerExternalBase } from '../src/features/models/external-base.ts';

const path = '/model/ModelScope/example/base';
const directory = {items: [{Name:'base', Path:path, Size:'fixture', Tag:'LLM'}], total:1, state:'ready',
  fetched_at:'2026-10-31T00:00:00Z', source:'ucloud', compatibility:'unverified', filters:{Region:'region-a'}};

test('registration uses the selected current public directory without supplying verification proof', async () => {
  const original=globalThis.fetch; const calls=[];
  globalThis.fetch=async (url, options) => {calls.push({url,options});return new Response(JSON.stringify({id:'registered',state:'awaiting_verification'}),{status:201});};
  try {
    const result=await registerExternalBase(' My base ', 'region-a', path, directory);
    assert.equal(result.state, 'awaiting_verification');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/v1/models/external-bases');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), {name:'My base',region:'region-a',path});
  } finally {globalThis.fetch=original;}
});

test('missing, stale, absent and ambiguous selections are rejected before sending a request', async () => {
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async () => {calls++;throw new Error('must not send');};
  try {
    for (const value of [null, {...directory,filters:{Region:'region-b'}}, {...directory,items:[]}, {...directory,items:[...directory.items,...directory.items]}]) {
      await assert.rejects(registerExternalBase('base','region-a',path,value), /重新读取/);
    }
    assert.equal(calls,0);
  } finally {globalThis.fetch=original;}
});
