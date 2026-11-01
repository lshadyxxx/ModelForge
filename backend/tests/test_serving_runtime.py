"""Actual runtime HTTP handlers with an explicitly fake inference engine, no GPU."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
from types import ModuleType,SimpleNamespace
import sys
import threading
import time
import uuid
import pytest
from fastapi.testclient import TestClient
from modelforge.runtimes.executors import VllmExecutor
from modelforge.runtimes import serve_remote
from modelforge.runtimes.runtime_lock import (
    inference_runtime_lock,
    inference_runtime_lock_bytes,
    inference_runtime_lock_sha256,
)

class Engine:
    def __init__(self):
        self.started=threading.Event();self.pause_entered=threading.Event();self.idle=threading.Event()
        self.aborted=False;self.paused=False;self.resumed=False
        self.generated_params=None
    def get_tokenizer(self):
        return SimpleNamespace(apply_chat_template=lambda *a,**k:'prompt',encode=lambda *a,**k:[1]*8)
    async def generate(self,prompt,params,identifier,**kwargs):
        if identifier.startswith('probe-'):
            yield SimpleNamespace(outputs=[SimpleNamespace(token_ids=[1],text='p')]);return
        self.generated_params=params;self.started.set()
        for i in range(125):
            yield SimpleNamespace(outputs=[SimpleNamespace(token_ids=[1],text='x'*(i+1))])
        while not self.aborted:await asyncio.sleep(.01)
    async def pause_generation(self,**kwargs):
        self.aborted=True;self.pause_entered.set()
        while not self.idle.is_set():await asyncio.sleep(.01)
        self.paused=True
    async def is_paused(self):return self.paused
    async def resume_generation(self):self.resumed=True;self.paused=False
    async def abort(self,*a):self.aborted=True
    def shutdown(self):self.aborted=True;self.idle.set()

@pytest.fixture
def runtime(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path);(tmp_path/'runtime.token').write_text('fixture-private-token')
    fake=ModuleType('vllm');fake.SamplingParams=lambda **k:SimpleNamespace(**k)
    lora=ModuleType('vllm.lora.request');lora.LoRARequest=lambda *a:a
    monkeypatch.setitem(sys.modules,'vllm',fake);monkeypatch.setitem(sys.modules,'vllm.lora.request',lora)
    engine=Engine()
    async def build():return engine,{'adapter_fingerprint':'fixture','max_model_len':128}
    monkeypatch.setattr(serve_remote,'build_engine',build)
    monkeypatch.setattr(serve_remote.importlib.metadata,'version',lambda name:'fixture')
    with TestClient(serve_remote.create_app(),headers={'Authorization':'Bearer fixture-private-token'}) as client:
        yield client,engine

def start(client,identifier,max_tokens=64):
    return client.post('/chat/start',json={'request_id':identifier,'messages':[{'role':'user','content':'hi'}],
                                         'max_tokens':max_tokens,'temperature':.7})

def test_cancel_waits_for_engine_idle_and_keeps_buffer(runtime):
    client,engine=runtime;identifier=str(uuid.uuid4());assert start(client,identifier).status_code==200
    assert engine.started.wait(2)
    with ThreadPoolExecutor() as executor:
        cancellation=executor.submit(client.post,'/chat/cancel',json={'request_id':identifier})
        try:
            assert engine.pause_entered.wait(2)
            pending=client.post('/chat/poll',json={'request_id':identifier,'offset':0}).json()
            assert pending['state']=='cancelling' and not pending['done']
            assert start(client,str(uuid.uuid4())).status_code==409
            assert not cancellation.done()
        finally:engine.idle.set()
        assert cancellation.result(timeout=3).json()['state']=='cancelled'
    assert engine.resumed
    first=client.post('/chat/poll',json={'request_id':identifier,'offset':0}).json()
    last=client.post('/chat/poll',json={'request_id':identifier,'offset':first['offset']}).json()
    assert first['done'] and len(first['chunks'])==100 and len(last['chunks'])==25
    assert ''.join(first['chunks']+last['chunks'])=='x'*125

def test_cancel_before_delayed_start_prevents_generation(runtime):
    client,engine=runtime;identifier=str(uuid.uuid4())
    assert client.post('/chat/cancel',json={'request_id':identifier}).json()['done']
    assert start(client,identifier).json()['state']=='cancelled'
    assert not engine.started.is_set()


def test_cancel_delayed_start_after_previous_request(runtime):
    client,engine=runtime
    assert start(client,str(uuid.uuid4()),max_tokens=128).json()['state']=='rejected'
    identifier=str(uuid.uuid4())
    assert client.post('/chat/cancel',json={'request_id':identifier}).json()['done']
    # A newer completed request must not displace an earlier cancellation.
    assert start(client,str(uuid.uuid4()),max_tokens=128).json()['state']=='rejected'
    assert start(client,identifier).json()['state']=='cancelled'
    assert not engine.started.is_set()

def test_overflow_is_confirmed_rejection_without_generation(runtime):
    client,engine=runtime;identifier=str(uuid.uuid4())
    result=start(client,identifier,max_tokens=128).json()
    assert result['state']=='rejected' and result['done'] and result['code']=='token_overflow'
    assert not engine.started.is_set()
    assert client.post('/chat/cancel',json={'request_id':identifier}).json()['state']=='rejected'

def test_runtime_requires_private_token(runtime):
    client,_=runtime
    assert client.get('/health',headers={'Authorization':'Bearer wrong'}).status_code==401
    assert client.get('/health').json()['adapter_probe']


def test_runtime_passes_top_p_to_engine(runtime):
    client,engine=runtime
    response=client.post('/chat/start',json={'request_id':str(uuid.uuid4()),
        'messages':[{'role':'user','content':'hi'}],'max_tokens':32,'temperature':.7,'top_p':.37})
    assert response.status_code==200 and engine.started.wait(2)
    assert engine.generated_params.top_p==.37


def test_inference_runtime_lock_is_embedded_in_execution_plan():
    plan=VllmExecutor().prepare(
        '/remote/base',{'lora_rank':8,'cutoff_len':2048},'a'*64)
    execution=json.loads(plan.files['execution.json'])
    lock=json.loads(plan.files['runtime-lock.json'])
    assert plan.files['runtime-lock.json']==inference_runtime_lock_bytes()
    assert execution['runtime_lock_sha256']==inference_runtime_lock_sha256()
    assert lock==inference_runtime_lock()
    assert lock['packages']['vllm']=='0.32.0'


def test_runtime_disables_flashinfer_sampler_jit(monkeypatch):
    monkeypatch.setenv('VLLM_USE_FLASHINFER_SAMPLER','1')
    serve_remote.configure_runtime_environment()
    assert os.environ['VLLM_USE_FLASHINFER_SAMPLER']=='0'


def test_inference_runtime_lock_rejects_any_drift():
    lock=inference_runtime_lock()
    versions=dict(lock['packages'])
    assert serve_remote.runtime_mismatches(
        lock,lock['python'],lock['cuda'],versions)==[]
    versions['transformers']='future'
    assert serve_remote.runtime_mismatches(
        lock,lock['python'],lock['cuda'],versions)==[
            {'field':'transformers','expected':'5.19.0','actual':'future'}]
    assert serve_remote.runtime_mismatches(
        lock,'3.14.0',lock['cuda'],dict(lock['packages']))[0]['field']=='python'


def test_vllm_executor_requires_matching_lock_in_health():
    executor=VllmExecutor()
    health={'ready':True,'adapter_probe':True,'adapter_fingerprint':'a'*64,
            'runtime_lock_sha256':inference_runtime_lock_sha256()}
    assert executor.ready(health,'a'*64)
    health['runtime_lock_sha256']='0'*64
    assert not executor.ready(health,'a'*64)
