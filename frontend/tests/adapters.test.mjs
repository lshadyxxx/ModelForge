import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listAdapters} from '../src/features/models/adapters.ts';

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
