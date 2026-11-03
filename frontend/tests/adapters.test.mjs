import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adapterDownloadUrl,latestAdapterPair,listAdapters} from '../src/features/models/adapters.ts';

test('artifact lists fetch later pages and filter the exact attempt at the server',async()=>{
  const original=globalThis.fetch,calls=[];
  try{
    globalThis.fetch=async(url)=>{
      calls.push(url);const query=new URL(url,'http://localhost').searchParams;
      assert.equal(query.get('attempt_id'),'old-attempt');
      const offset=Number(query.get('offset'));
      const rows=Array.from({length:offset===0?200:2},(_,i)=>({id:String(offset+i)}));
      return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const rows=await listAdapters(undefined,'old-attempt');
    assert.equal(rows.length,202);assert.equal(rows.at(-1).id,'201');
    assert.equal(calls.length,2);assert.match(calls[1],/offset=200/);
  }finally{globalThis.fetch=original;}
});

test('artifact download uses the encoded serving endpoint',()=>{
  assert.equal(
    adapterDownloadUrl('adapter/id with spaces'),
    '/api/v1/serving/adapters/adapter%2Fid%20with%20spaces/download',
  );
});

test('artifact cards use only the latest best/final pair for a base version',()=>{
  const adapter=(id,role,baseId,attempt,created_at)=>({
    id,role,source_attempt_id:attempt,created_at,state:'available',fingerprint:id,
    snapshot:{base:{id:baseId,fingerprint:'base'},dataset:{id:'data',sha256:'sha'}},
    metrics:{},manifest:[],
  });
  const rows=[
    adapter('old-best','best','base-1','old','2026-11-01T00:00:00Z'),
    adapter('old-final','final','base-1','old','2026-11-01T00:00:00Z'),
    adapter('new-best','best','base-1','new','2026-11-02T00:00:00Z'),
    adapter('new-final','final','base-1','new','2026-11-02T00:00:00Z'),
    adapter('other-base','best','base-2','other','2026-11-03T00:00:00Z'),
  ];
  assert.deepEqual(latestAdapterPair(rows,'base-1').map(row=>row.id),['new-best','new-final']);
});
