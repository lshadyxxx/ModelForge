"""Private loopback runtime. Conversation payloads exist only in memory."""
import asyncio
import contextlib
from contextlib import asynccontextmanager
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import secrets
import uuid


def configure_runtime_environment():
    # Fresh CompShare images do not ship ninja. FlashInfer's sampled top-p path
    # compiles on first generation and otherwise kills EngineCore mid-request.
    os.environ["VLLM_USE_FLASHINFER_SAMPLER"] = "0"


configure_runtime_environment()


def runtime_mismatches(lock, python_version, cuda_version, versions):
    mismatches = []
    if python_version != lock['python']:
        mismatches.append({'field': 'python', 'expected': lock['python'], 'actual': python_version})
    if cuda_version != lock['cuda']:
        mismatches.append({'field': 'cuda', 'expected': lock['cuda'], 'actual': cuda_version})
    for name, expected in sorted(lock['packages'].items()):
        actual = versions.get(name)
        if actual != expected:
            mismatches.append({'field': name, 'expected': expected, 'actual': actual})
    return mismatches


def verify_runtime():
    frozen = json.loads(Path('execution.json').read_text())
    lock_bytes = Path('runtime-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    lock_sha256 = hashlib.sha256(lock_bytes).hexdigest()
    if lock.get('schema') != 1 or lock_sha256 != frozen.get('runtime_lock_sha256'):
        raise RuntimeError('runtime_lock_invalid')
    versions = {}
    for name in lock.get('packages', {}):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    import torch
    identity = {
        'python': platform.python_version(),
        'cuda': torch.version.cuda,
        'versions': versions,
    }
    mismatches = runtime_mismatches(
        lock, identity['python'], identity['cuda'], versions)
    report = {
        'lock_id': lock.get('id'),
        'lock_sha256': lock_sha256,
        **identity,
        'mismatches': mismatches,
    }
    Path('runtime-lock-report.json').write_text(
        json.dumps(report, allow_nan=False))
    if mismatches:
        raise RuntimeError('runtime_lock_mismatch')
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('single_gpu_required')
    report.update(
        gpu=torch.cuda.get_device_name(0),
        memory_bytes=torch.cuda.get_device_properties(0).total_memory,
    )
    Path('runtime-baseline.json').write_text(
        json.dumps(report, allow_nan=False))
    return report


async def build_engine():
    runtime = verify_runtime()
    from vllm.engine.arg_utils import AsyncEngineArgs
    from vllm.v1.engine.async_llm import AsyncLLM
    config=json.loads(Path('execution.json').read_text())
    args=AsyncEngineArgs(model=config['model_path'],tensor_parallel_size=1,
        enable_lora=True,max_loras=1,max_lora_rank=config['rank'],
        max_model_len=config['max_model_len'],trust_remote_code=False,
        gpu_memory_utilization=.8,enforce_eager=True)
    engine=AsyncLLM.from_engine_args(args)
    return engine,{**config,'runtime':runtime}

def create_app():
    from fastapi import FastAPI, Request, HTTPException
    from vllm import SamplingParams
    from vllm.lora.request import LoRARequest
    state={'ready':False,'request':None,'engine':None,'cancelled_ids':set()}
    @asynccontextmanager
    async def lifespan(app):
        engine,config=await build_engine(); state['engine']=engine
        tokenizer=engine.get_tokenizer()
        lora=LoRARequest('modelforge-adapter',1,str(Path('adapter').resolve()))
        # This probe actually generates with the selected Adapter.
        probe_id='probe-'+uuid.uuid4().hex
        count=0
        async for result in engine.generate('Hello',SamplingParams(max_tokens=1),probe_id,lora_request=lora):
            count+=sum(len(output.token_ids) for output in result.outputs)
        if count<1:raise RuntimeError('adapter_probe_failed')
        state.update(ready=True,tokenizer=tokenizer,lora=lora,config=config)
        try:yield
        finally:
            state['ready']=False
            if state['request'] and state['request']['state']=='running':
                await engine.abort(state['request']['id'])
            shutdown=getattr(engine,'shutdown',None)
            if shutdown:shutdown()
    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None)
    token=Path('runtime.token').read_text().strip()
    @app.middleware('http')
    async def authorize(request,call_next):
        if not secrets.compare_digest(request.headers.get('authorization',''),'Bearer '+token):
            from fastapi.responses import JSONResponse
            return JSONResponse({'code':'unauthorized'},status_code=401)
        return await call_next(request)
    @app.get('/health')
    async def health():
        return {'ready':state['ready'],'adapter_probe':state['ready'],
                'adapter_fingerprint':state.get('config',{}).get('adapter_fingerprint'),
                'vllm_version':importlib.metadata.version('vllm'),
                'runtime_lock_id':state.get('config',{}).get('runtime',{}).get('lock_id'),
                'runtime_lock_sha256':state.get('config',{}).get('runtime',{}).get('lock_sha256'),
                'gpu':state.get('config',{}).get('runtime',{}).get('gpu')}
    def result(record,offset=0):
        terminal=record['state'] in ('completed','cancelled','rejected')
        chunks=record['chunks'][offset:offset+100]
        return {'state':record['state'],'chunks':chunks,'offset':offset+len(chunks),
                'done':terminal and record['task_done'] and not record.get('cancellation_in_progress',False),
                'code':record.get('code')}

    async def generate(record,prompt,params):
        last=''
        try:
            async for response in state['engine'].generate(prompt,params,record['id'],lora_request=state['lora']):
                text=response.outputs[0].text
                delta=text[len(last):];last=text
                if delta:record['chunks'].append(delta)
            if not record['cancel_requested']:record['state']='completed'
        except Exception:
            record['state']='unknown'
        finally:record['task_done']=True

    def empty_record(identifier,phase):
        return {'id':identifier,'state':phase,'chunks':[],'cancel_requested':False,
                'task_done':phase in ('cancelled','rejected'),'cancellation_in_progress':False}

    @app.post('/chat/start')
    async def start(request:Request):
        body=await request.json(); identifier=str(uuid.UUID(body['request_id']))
        old=state['request']
        if old and old['id']==identifier:return result(old)
        if identifier in state['cancelled_ids']:return result(empty_record(identifier,'cancelled'))
        if old and (old['state'] not in ('completed','cancelled','rejected') or old.get('cancellation_in_progress')):
            raise HTTPException(409)
        if not state['ready']:raise HTTPException(503)
        record=empty_record(identifier,'running')
        state['request']=record
        try:
            messages=body['messages']
            if not isinstance(messages,list) or not 1<=len(messages)<=100:raise ValueError()
            prompt=state['tokenizer'].apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
            tokens=state['tokenizer'].encode(prompt,add_special_tokens=False)
            if len(tokens)+body['max_tokens']>state['config']['max_model_len']:
                record.update(state='rejected',task_done=True,code='token_overflow');return result(record)
            params=SamplingParams(max_tokens=body['max_tokens'],temperature=body['temperature'],top_p=body.get('top_p',.9))
        except Exception:
            record.update(state='rejected',task_done=True,code='chat_template_invalid');return result(record)
        record['task']=asyncio.create_task(generate(record,prompt,params))
        return result(record)

    @app.post('/chat/poll')
    async def poll(request:Request):
        body=await request.json();record=state['request']
        if not record or record['id']!=body['request_id']:
            if body['request_id'] in state['cancelled_ids']:return result(empty_record(body['request_id'],'cancelled'))
            return {'state':'unknown','chunks':[],'offset':body['offset'],'done':False}
        offset=body['offset']
        if type(offset)!=int or offset<0 or offset>len(record['chunks']):raise HTTPException(422)
        return result(record,offset)

    async def confirm_cancel(record):
        try:
            # Engine-core pause waits for idle; generator termination alone does not.
            await asyncio.wait_for(state['engine'].pause_generation(mode='abort',clear_cache=False),timeout=20)
            await asyncio.wait_for(asyncio.shield(record['task']),timeout=5)
            if not await state['engine'].is_paused():raise RuntimeError('engine_not_paused')
            await state['engine'].resume_generation()
            record.update(state='cancelled',cancellation_in_progress=False)
        except Exception:
            record['state']='unknown'

    @app.post('/chat/cancel')
    async def cancel(request:Request):
        identifier=str(uuid.UUID((await request.json())['request_id']));record=state['request']
        # Keep cancellation independent of the last response buffer. Never evict
        # an acknowledged cancellation: reject on capacity until runtime restart.
        if identifier not in state['cancelled_ids']:
            if len(state['cancelled_ids'])>=4096:raise HTTPException(503)
            state['cancelled_ids'].add(identifier)
        if not record or record['id']!=identifier:
            return result(empty_record(identifier,'cancelled'))
        if record['state'] in ('completed','cancelled','rejected') and not record.get('cancellation_in_progress'):
            return result(record)
        if not record.get('cancel_task'):
            record.update(cancel_requested=True,cancellation_in_progress=True,state='cancelling')
            record['cancel_task']=asyncio.create_task(confirm_cancel(record))
        await asyncio.shield(record['cancel_task'])
        return result(record)
    return app

if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_app(),host='127.0.0.1',port=18180,access_log=False)
