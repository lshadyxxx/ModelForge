import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestMessages} from '../src/features/serving/conversation.ts';

test('continuing after stop retains completed turns and excludes partial or empty output',()=>{
  const visible=[{role:'user',content:'你好'},{role:'assistant',content:'完整回答'},
    {role:'user',content:'first stopped'},{role:'assistant',content:'partial 😀',partial:true},
    {role:'user',content:'second stopped'},{role:'assistant',content:'',partial:true},
    {role:'user',content:'继续'}];
  assert.deepEqual(requestMessages(visible),[
    {role:'user',content:'你好'},{role:'assistant',content:'完整回答'},
    {role:'user',content:'first stopped'},{role:'user',content:'second stopped'},
    {role:'user',content:'继续'}]);
  assert.equal(visible[3].content,'partial 😀');
  assert.equal(visible[3].partial,true);
});
