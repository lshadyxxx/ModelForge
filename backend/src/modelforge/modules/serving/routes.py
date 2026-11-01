import asyncio
import json
import uuid
from fastapi import APIRouter,Request,Query
from fastapi.responses import StreamingResponse
from modelforge.bootstrap import remote_services
from modelforge.modules.models import Adapters
from pydantic import BaseModel,ConfigDict,Field
from .use_cases import Serving,CreateTrial,Chat

router=APIRouter(prefix='/api/v1/serving',tags=['serving'])

class Binding(BaseModel):
    model_config=ConfigDict(extra='forbid')
    instance_id:str=Field(min_length=1,max_length=120,pattern=r'^[A-Za-z0-9_-]+$')
    acknowledge_cleanup:bool

@router.get('/adapters')
def adapters(request:Request,attempt_id:uuid.UUID|None=None,offset:int=Query(0,ge=0),limit:int=Query(200,ge=1,le=200)):
    return Adapters(request.app.state.resources).list(attempt_id=attempt_id,offset=offset,limit=limit)

@router.post('/trials',status_code=201)
def create(body:CreateTrial,request:Request):return Serving(request.app.state.resources).create(body)

@router.get('/trials')
def listing(request:Request):return Serving(request.app.state.resources).list()

@router.get('/trials/{identifier}')
def detail(identifier:uuid.UUID,request:Request):return Serving(request.app.state.resources).get(identifier)

@router.post('/trials/{identifier}/stop')
def stop(identifier:uuid.UUID,request:Request):return Serving(request.app.state.resources).stop(identifier)

@router.post('/trials/{identifier}/instance')
def bind(identifier:uuid.UUID,body:Binding,request:Request):
    resources=request.app.state.resources
    lifecycle=remote_services(resources).lifecycle
    return Serving(resources).bind(identifier,body.instance_id,body.acknowledge_cleanup,lifecycle)

@router.post('/trials/{identifier}/cancel-request')
def cancel_request(identifier:uuid.UUID,request:Request):return Serving(request.app.state.resources).request_cancel(identifier)

@router.post('/trials/{identifier}/chat')
def chat(identifier:uuid.UUID,body:Chat,request:Request):
    resources=request.app.state.resources;serving=Serving(resources)
    request_id=serving.start_request(identifier,body);row=serving.get(identifier)
    channel=remote_services(resources).channel
    def rpc(route,payload):return channel.call(row['instance_id'],identifier,'http',route=route,body=payload)
    async def stream():
        finished=False;offset=0
        try:
            yield 'event: request\ndata: '+json.dumps({'request_id':request_id})+'\n\n'
            await asyncio.to_thread(rpc,'/chat/start',{'request_id':request_id,**body.model_dump()})
            while True:
                if not await asyncio.to_thread(serving.stream_alive,identifier,request_id):return
                current=await asyncio.to_thread(serving.get,identifier)
                if current['request_cancel_requested']:
                    await asyncio.to_thread(rpc,'/chat/cancel',{'request_id':request_id})
                result=await asyncio.to_thread(rpc,'/chat/poll',{'request_id':request_id,'offset':offset})
                for delta in result.get('chunks',[]):
                    yield 'event: delta\ndata: '+json.dumps({'text':delta},ensure_ascii=False)+'\n\n'
                offset=result.get('offset',offset)
                if result['state'] in ('completed','cancelled') and result.get('done'):
                    # Drain any remaining buffered chunks before the terminal event.
                    if result.get('chunks') and len(result['chunks'])==100:continue
                    await asyncio.to_thread(serving.finish_request,identifier,request_id)
                    finished=True
                    yield 'event: done\ndata: '+json.dumps({'state':result['state'],'partial':result['state']=='cancelled'})+'\n\n'
                    break
                if result['state']=='rejected' and result.get('done'):
                    await asyncio.to_thread(serving.finish_request,identifier,request_id)
                    finished=True
                    yield 'event: error'+chr(10)+'data: '+json.dumps({'code':result.get('code','chat_rejected')})+chr(10)*2
                    break
                if result['state']=='unknown':
                    yield 'event: error\ndata: '+json.dumps({'code':'request_state_unknown'})+'\n\n';break
                await asyncio.sleep(.2)
        except asyncio.CancelledError:raise
        except Exception:
            yield 'event: error\ndata: '+json.dumps({'code':'remote_request_unconfirmed'})+'\n\n'
        finally:
            if not finished:await asyncio.shield(asyncio.to_thread(serving.request_cancel,identifier,request_id))
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'X-Accel-Buffering':'no'})
