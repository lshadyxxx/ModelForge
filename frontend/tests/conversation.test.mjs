import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSseFrames, requestMessages} from '../src/features/serving/conversation.ts';

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

test('SSE parsing handles split chunks, multiple frames and multiline data',()=>{
  const first=parseSseFrames('event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\nevent: do');
  assert.deepEqual(first.frames,[
    {event:'delta',data:'{"text":"a"}'},
    {event:'delta',data:'{"text":"b"}'},
  ]);
  const second=parseSseFrames(first.rest+'ne\ndata: {"partial":true}\n\n');
  assert.deepEqual(second.frames,[{event:'done',data:'{"partial":true}'}]);
  assert.equal(second.rest,'');
  assert.deepEqual(parseSseFrames('event: error\r\ndata: first\r\ndata: second\r\n\r\n').frames,[
    {event:'error',data:'first\nsecond'},
  ]);
});
