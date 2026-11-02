"""Real isolated PostgreSQL/MinIO; provider and GPU runtime facts are fixtures."""
import base64
import hashlib
import io
import json
import os
from types import SimpleNamespace
import uuid
import pytest
from modelforge.bootstrap import Resources
from modelforge.errors import AppError
from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import ModelRegistry,ModelFile,Adapters
from modelforge.modules.resources import GpuLeases,InstanceLifecycle,InstanceSpec
from modelforge.modules.training import Training,CreateTask,TrainingWorker
from modelforge.modules.serving import Serving,ServingWorker,CreateTrial,Chat
from modelforge.settings import Settings
from modelforge.runtimes.executors import LlamaFactoryExecutor,VllmExecutor
from modelforge.runtimes.runtime_lock import inference_runtime_lock_sha256
from psycopg.types.json import Jsonb

if os.getenv('MF_TEST_WORKFLOW_INTEGRATION')=='1' and (os.getenv('MF_TEST_ISOLATED_STORES')!='1'
        or not os.getenv('MF_PG_DATABASE','').startswith('modelforge_test_')):
    raise pytest.UsageError('Workflow tests require an explicitly disposable database')
pytestmark=pytest.mark.skipif(os.getenv('MF_TEST_WORKFLOW_INTEGRATION')!='1',reason='Requires isolated PostgreSQL/MinIO')
SPEC=dict(region='fixture-region',zone='fixture-zone',gpu_type='fixture-gpu',cpu=8,memory_mb=32768,
          image_id='fixture-image',cpu_platform='Auto',charge_type='Postpay',boot_disk_gb=100,boot_disk_type='CLOUD_SSD')

class Provider:
    def __init__(self):self.state='Running';self.writes=[];self.wrong=False;self.instance_id='fixture-instance'
    def query(self,action,parameters):
        assert action=='DescribeCompShareInstance'
        row={'UHostId':self.instance_id,'Name':'human-created','State':self.state,'CreateTime':1,
             'Region':SPEC['region'],'Zone':SPEC['zone'],'GpuType':SPEC['gpu_type'],'GPU':1,
             'CPU':SPEC['cpu']+(1 if self.wrong else 0),'Memory':SPEC['memory_mb'],'CompShareImageId':SPEC['image_id']}
        return {'UHostSet':[] if self.state=='Deleted' else [row],'TotalCount':0 if self.state=='Deleted' else 1}
    def create(self,*args):raise AssertionError('Paid create is forbidden')
    def stop(self,params):self.writes.append('stop');self.state='Stopped'
    def terminate(self,params):self.writes.append('terminate');self.state='Deleted'

class Channel:
    def __init__(self):
        self.files={};self.status={'state':'not_started'};self.starts=0;self.cancel_calls=0;self.fail_download=False
        self.runtime_ready=True;self.runtime_checks=0
        self.health={'ready':True,'adapter_probe':True,
                     'runtime_lock_sha256':inference_runtime_lock_sha256()}
        self.request_result={'state':'running','chunks':[],'offset':0,'done':False}
    def endpoint(self,instance):return SimpleNamespace(root='/fixture')
    def upload(self,instance,job,path,stream,size,sha256):
        data=stream.read();assert len(data)==size and hashlib.sha256(data).hexdigest()==sha256
        self.files[path]=data
    def download(self,instance,job,item,target):
        if self.fail_download:raise AppError(503,'fixture_sync_failure','Injected transfer failure')
        data=self.files[item['path']];assert hashlib.sha256(data).hexdigest()==item['sha256'];target.write(data)
    def runtime_check(self,instance,job,lock):
        self.runtime_checks+=1
        return {'ready':self.runtime_ready,'lock_id':lock['id'],
                'mismatches':[] if self.runtime_ready else [{
                    'field':'llamafactory','expected':'fixture','actual':None}]}
    def call(self,instance,job,operation,**values):
        if operation=='status':return self.status
        if operation=='start':self.starts+=1;self.status={'state':'running'};return self.status
        if operation=='cancel':self.cancel_calls+=1;return self.status
        if operation=='read':
            data=self.files.get(values['path']);offset=values.get('offset',0)
            block=(data or b'')[offset:offset+values.get('limit',1024**2)]
            return {'missing':data is None,'data':base64.b64encode(block).decode(),
                    'offset':offset,'next_offset':offset+len(block),'size':len(data or b'')}
        if operation=='manifest':return {'files':[{'path':path,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            for path,data in self.files.items() if path.startswith(values['path']+'/')]}
        if operation=='ensure_token':return {'configured':True}
        if operation=='http':
            if values['route']=='/health':return self.health
            if values['route']=='/chat/cancel':return self.request_result
            if values['route']=='/chat/poll':return self.request_result
        raise AssertionError((operation,values))
    def success(self):
        self.status={'state':'exited','exit_code':0,'group_exited':True,'cancelled':False}
        self.files['result.json']=json.dumps({'best_path':'output/checkpoint-1','final_path':'output',
            'best_metrics':{'eval_loss':.5},'final_metrics':{'eval_loss':.7}}).encode()
        self.files['process.log']=b'loss=1.0 eval_loss=0.5'
        self.files['gpu-memory.json']=json.dumps({
            'schema':1,'status':'measured','sample_interval_ms':250,
            'device_samples':[{'elapsed_ms':0,'used_bytes':1000}],
            'device_peak_used_bytes':1000,
            'torch_peaks':{
                'peak_memory_allocated_bytes':800,
                'peak_memory_reserved_bytes':900,
                'device_name':'fixture GPU',
            },
            'sampler_error':None,'process_exit_code':0,
        }).encode()
        for path in ('output','output/checkpoint-1'):
            self.files[path+'/adapter_config.json']=b'{"peft_type":"LORA"}'
            self.files[path+'/adapter_model.safetensors']=b'fixture-adapter-not-a-real-model'

@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr('modelforge.modules.resources.Catalog.validate_selection',lambda self,spec:spec)
    monkeypatch.setattr('modelforge.modules.training.use_cases.training_compatibility',lambda *args:{})
    monkeypatch.setattr('modelforge.modules.serving.use_cases.inference_compatibility',lambda *args:{})
    resources=Resources.open(Settings());resources.pool.wait()
    with resources.pool.connection() as c:
        c.execute('TRUNCATE training_tasks,gpu_slots,gpu_reservations,models,datasets CASCADE')
        c.execute('INSERT INTO gpu_slots(id) VALUES(1)')
    dataset=DatasetRegistry(resources)
    data=b'\n'.join(json.dumps({'messages':[{'role':'user','content':str(i)},{'role':'assistant','content':'answer'+str(i)}]}).encode() for i in range(20))
    d=dataset.create(data,'workflow fixture');dataset.publish(d['id'])
    files={'config.json':b'{"model_type":"qwen3","architectures":["Qwen3ForCausalLM"]}',
           'tokenizer_config.json':b'{}','tokenizer.json':b'{}','model.safetensors':b'fixture-weight'}
    registry=ModelRegistry(resources)
    manifest=[ModelFile(path=path,size_bytes=len(data),sha256=hashlib.sha256(data).hexdigest()) for path,data in files.items()]
    model=registry.create('fixture base',manifest)
    for path,data in files.items():registry.upload(model['id'],path,io.BytesIO(data),len(data),hashlib.sha256(data).hexdigest())
    registry.complete(model['id'])
    body=CreateTask(name='fixture task',dataset_version_id=d['id'],base_model_version_id=model['id'],
        instance=InstanceSpec(**SPEC),config={'template':'qwen3_nothink'})
    provider=Provider();channel=Channel();lifecycle=InstanceLifecycle(GpuLeases(resources.pool),provider)
    yield resources,body,provider,channel,lifecycle
    resources.close()

def bound(env):
    resources,body,provider,channel,lifecycle=env;training=Training(resources)
    row=training.create(body);worker=TrainingWorker(resources,channel,lifecycle,LlamaFactoryExecutor());worker.run_once()
    row=training.bind(row['id'],'fixture-instance',True,lifecycle)
    return row,training,worker

def test_snapshots_and_deletion_protection(env):
    resources,body,*_=env;training=Training(resources);row=training.create(body)
    data=DatasetRegistry(resources).execution_data(row['snapshot']['dataset'])
    assert len(data['train'])+len(data['validation'])==20
    assert {r['source_line'] for r in data['train']}.isdisjoint(r['source_line'] for r in data['validation'])
    with pytest.raises(AppError):DatasetRegistry(resources).delete(body.dataset_version_id)
    with pytest.raises(AppError):ModelRegistry(resources).delete(body.base_model_version_id)
    with pytest.raises(Exception):
        with resources.pool.connection() as c:c.execute("UPDATE training_tasks SET snapshot='{}' WHERE id=%s",(row['task_id'],))

def test_queued_cancel_and_retry_keeps_exact_snapshot(env):
    resources,body,provider,channel,lifecycle=env;training=Training(resources);row=training.create(body)
    training.cancel(row['id']);TrainingWorker(resources,channel,lifecycle,LlamaFactoryExecutor()).run_once()
    assert training.get(row['id'])['state']=='cancelled'
    retry=training.retry(row['id']);assert retry['id']!=row['id'] and retry['number']==2
    assert retry['snapshot']==row['snapshot'] and retry['snapshot_sha256']==row['snapshot_sha256']
    assert channel.starts==0 and provider.writes==[]

def test_manual_binding_requires_ack_and_exact_provider_match(env):
    resources,body,provider,channel,lifecycle=env;training=Training(resources);row=training.create(body)
    worker=TrainingWorker(resources,channel,lifecycle,LlamaFactoryExecutor());worker.run_once()
    assert training.get(row['id'])['state']=='waiting_instance'
    with pytest.raises(AppError):training.bind(row['id'],'fixture-instance',False,lifecycle)
    provider.wrong=True
    with pytest.raises(AppError):training.bind(row['id'],'fixture-instance',True,lifecycle)
    assert GpuLeases(resources.pool).current()['create_state']=='not_requested'
    assert provider.writes==[]


def test_training_runtime_preflight_blocks_inputs_until_versions_match(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    channel.runtime_ready=False
    worker.run_once()
    current=training.get(row['id'])
    assert current['error_code']=='gpu_runtime_incompatible'
    assert channel.runtime_checks==1 and channel.files=={} and channel.starts==0
    assert provider.writes==[]
    channel.runtime_ready=True
    worker.run_once()
    assert training.get(row['id'])['error_code'] is None
    assert channel.runtime_checks==2 and channel.starts==1
    assert channel.files['execution.json']

def test_real_storage_publication_precedes_instance_cleanup(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();assert channel.starts==1
    channel.success();channel.fail_download=True;worker.run_once()
    assert training.get(row['id'])['state']=='syncing' and provider.writes==[]
    assert all(a['state']=='syncing' for a in Adapters(resources).list())
    channel.fail_download=False;worker.run_once()
    assert len(Adapters(resources).list())==2 and all(a['state']=='available' for a in Adapters(resources).list())
    assert provider.writes==[]
    for _ in range(4):worker.run_once()
    assert training.get(row['id'])['state']=='succeeded'
    assert provider.writes==['stop','terminate'] and GpuLeases(resources.pool).current() is None


def test_transient_cleanup_ack_failure_does_not_pollute_successful_outcome(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();channel.success()
    for _ in range(2):worker.run_once()
    original=provider.terminate
    def uncertain_terminate(params):
        original(params)
        raise AppError(502,'cloud_invalid_response','Termination acknowledgement was not parseable')
    provider.terminate=uncertain_terminate
    worker.run_once()
    held=training.get(row['id'])
    assert held['state']=='cleanup' and held['outcome']=='succeeded' and held['error_code'] is None
    assert GpuLeases(resources.pool).current()['cleanup_state']=='failed'
    worker.run_once()
    final=training.get(row['id'])
    assert final['state']=='succeeded' and final['stage']=='finished' and final['error_code'] is None
    assert GpuLeases(resources.pool).current() is None


def test_terminal_logs_are_drained_before_cleanup(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();channel.success()
    expected=(b'x'*(7*1024**2-1))+('中-END-MARKER').encode()
    channel.files['process.log']=expected
    worker.run_once()
    assert provider.writes==[] and training.get(row['id'])['state']!='cleanup'
    for _ in range(6):worker.run_once()
    chunks=training.logs(row['id'])
    assert ''.join(c['content'] for c in chunks)==expected.decode()
    assert all(not c['gap'] for c in chunks)
    assert training.get(row['id'])['state']=='succeeded'
    assert training.get(row['id'])['log_offset']==len(expected)


def test_best_stays_unavailable_when_final_transfer_fails(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();channel.success();original=channel.download
    def download(instance,job,item,target):
        if item['path']=='output/adapter_model.safetensors':
            raise AppError(503,'fixture_final_failed','Final transfer interrupted')
        return original(instance,job,item,target)
    channel.download=download;worker.run_once()
    adapters=Adapters(resources).list()
    assert len(adapters)==2 and all(a['state']=='syncing' for a in adapters)
    for adapter in adapters:
        with pytest.raises(AppError):Adapters(resources).get(adapter['id'])
    assert provider.writes==[]
    channel.download=original;worker.run_once()
    assert all(a['state']=='available' for a in Adapters(resources).list())

def test_cancel_retains_instance_until_actual_process_group_exit(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();training.cancel(row['id']);worker.run_once()
    assert channel.cancel_calls==1 and provider.writes==[]
    assert GpuLeases(resources.pool).current()['process_state']=='unknown'
    channel.status={'state':'unknown'};worker.run_once();assert provider.writes==[]
    channel.status={'state':'exited','exit_code':-15,'group_exited':True,'cancelled':True}
    for _ in range(4):worker.run_once()
    assert training.get(row['id'])['state']=='cancelled' and Adapters(resources).list()==[]

def test_trial_requires_real_adapter_probe_and_single_active_request(env):
    row,training,worker=bound(env);resources,_,provider,channel,lifecycle=env
    worker.run_once();channel.success()
    for _ in range(5):worker.run_once()
    adapter=Adapters(resources).list()[0];serving=Serving(resources)
    trial=serving.create(CreateTrial(adapter_id=adapter['id'],instance=InstanceSpec(**SPEC)))
    trialworker=ServingWorker(resources,channel,lifecycle,VllmExecutor());trialworker.run_once()
    # A trial must use an independent provider instance identity.
    with pytest.raises(AppError):serving.bind(trial['id'],'fixture-instance',True,lifecycle)

def test_retry_rejected_before_cleanup(env):
    row,training,worker=bound(env)
    with pytest.raises(AppError) as caught:training.retry(row['id'])
    assert caught.value.code=='attempt_active'


def test_independent_trial_idle_stop_and_uncertain_cancel(env):
    row,training,worker=bound(env);resources,_,provider,channel,lifecycle=env
    worker.run_once();channel.success()
    for _ in range(5):worker.run_once()
    adapter=Adapters(resources).list()[0];serving=Serving(resources)
    provider.instance_id='fixture-trial-instance';provider.state='Running'
    trial=serving.create(CreateTrial(adapter_id=adapter['id'],instance=InstanceSpec(**SPEC)))
    trialworker=ServingWorker(resources,channel,lifecycle,VllmExecutor());trialworker.run_once()
    serving.bind(trial['id'],provider.instance_id,True,lifecycle)
    channel.status={'state':'not_started'}
    channel.health['adapter_fingerprint']='wrong'
    trialworker.run_once();assert serving.get(trial['id'])['state']=='preparing'
    channel.health['adapter_fingerprint']=adapter['fingerprint'];trialworker.run_once()
    assert serving.get(trial['id'])['state']=='ready'
    body=Chat(messages=[{'role':'user','content':'hello'}])
    request_id=serving.start_request(trial['id'],body)
    with pytest.raises(AppError):serving.start_request(trial['id'],body)
    serving.request_cancel(trial['id']);channel.request_result={'state':'unknown','done':False}
    trialworker.run_once();assert serving.get(trial['id'])['request_state']=='unknown'
    assert provider.writes==['stop','terminate']
    with resources.pool.connection() as c:
        c.execute("UPDATE inference_trials SET stream_alive_until=now()-interval '1 second' WHERE id=%s",(trial['id'],))
    channel.request_result={'state':'cancelled','done':True};trialworker.run_once()
    assert serving.get(trial['id'])['request_state']=='idle'
    with resources.pool.connection() as c:
        c.execute("UPDATE inference_trials SET last_activity_at=now()-interval '16 minutes' WHERE id=%s",(trial['id'],))
    trialworker.run_once();assert serving.get(trial['id'])['stop_requested']
    assert channel.cancel_calls>=1 and provider.state=='Running'
    channel.status={'state':'exited','exit_code':-15,'cancelled':True,'group_exited':True}
    for _ in range(4):trialworker.run_once()
    assert serving.get(trial['id'])['state']=='stopped'
    assert provider.writes==['stop','terminate','stop','terminate']
    assert GpuLeases(resources.pool).current() is None


def test_stream_owns_terminal_buffer_until_drained(env):
    row,training,worker=bound(env);resources,_,provider,channel,lifecycle=env
    worker.run_once();channel.success()
    for _ in range(5):worker.run_once()
    adapter=Adapters(resources).list()[0];serving=Serving(resources)
    provider.instance_id='fixture-stream-instance';provider.state='Running'
    trial=serving.create(CreateTrial(adapter_id=adapter['id'],instance=InstanceSpec(**SPEC)))
    driver=ServingWorker(resources,channel,lifecycle,VllmExecutor());driver.run_once()
    serving.bind(trial['id'],provider.instance_id,True,lifecycle)
    channel.status={'state':'not_started'};channel.health['adapter_fingerprint']=adapter['fingerprint'];driver.run_once()
    first=serving.start_request(trial['id'],Chat(messages=[{'role':'user','content':'hello'}]))
    channel.request_result={'state':'completed','done':True,'chunks':['not-yet-drained'],'offset':1}
    driver.run_once()
    assert serving.get(trial['id'])['request_state']=='running'
    with pytest.raises(AppError):serving.start_request(trial['id'],Chat(messages=[{'role':'user','content':'next'}]))
    serving.finish_request(trial['id'],first)
    second=serving.start_request(trial['id'],Chat(messages=[{'role':'user','content':'next'}]))
    serving.request_cancel(trial['id'],first)
    assert not serving.get(trial['id'])['request_cancel_requested']
    assert serving.stream_alive(trial['id'],first) is False
    assert serving.stream_alive(trial['id'],second)


def test_cancelled_zero_exit_can_cleanup_without_partial_artifacts(env):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once();training.cancel(row['id'])
    channel.status={'state':'exited','exit_code':0,'group_exited':True,'cancelled':True}
    for _ in range(5):worker.run_once()
    assert training.get(row['id'])['state']=='cancelled'
    assert provider.writes==['stop','terminate'] and Adapters(resources).list()==[]


@pytest.mark.parametrize('cancelled',[False,True])
@pytest.mark.parametrize('fault',['logs','archive'])
def test_unsuccessful_diagnostic_fault_does_not_block_cleanup(env,monkeypatch,cancelled,fault):
    row,training,worker=bound(env);resources,_,provider,channel,_=env
    worker.run_once()
    channel.status={'state':'exited','exit_code':-15 if cancelled else 1,'group_exited':True,'cancelled':cancelled}
    def failed(*args,**kwargs):raise AppError(503,'fixture_diagnostics_down','Diagnostic collection unavailable')
    if fault=='archive':monkeypatch.setattr(resources.store,'put_object',failed)
    else:
        original=channel.call
        def call(instance,job,operation,**values):
            if operation=='read' and values.get('path')=='process.log':return failed()
            return original(instance,job,operation,**values)
        monkeypatch.setattr(channel,'call',call)
    for _ in range(6):worker.run_once()
    final=training.get(row['id'])
    assert final['state']==('cancelled' if cancelled else 'failed')
    assert final['execution_manifest']['diagnostic_gap'] is True
    assert provider.writes==['stop','terminate']
    assert GpuLeases(resources.pool).current() is None and Adapters(resources).list()==[]


def test_idle_shutdown_does_not_kill_request_admitted_after_snapshot(env,monkeypatch):
    row,training,worker=bound(env);resources,_,provider,channel,lifecycle=env
    worker.run_once();channel.success()
    for _ in range(5):worker.run_once()
    adapter=Adapters(resources).list()[0];serving=Serving(resources)
    provider.instance_id='fixture-idle-race';provider.state='Running'
    trial=serving.create(CreateTrial(adapter_id=adapter['id'],instance=InstanceSpec(**SPEC)))
    driver=ServingWorker(resources,channel,lifecycle,VllmExecutor());driver.run_once()
    serving.bind(trial['id'],provider.instance_id,True,lifecycle)
    channel.status={'state':'not_started'};channel.health['adapter_fingerprint']=adapter['fingerprint'];driver.run_once()
    with resources.pool.connection() as c:
        c.execute("UPDATE inference_trials SET last_activity_at=now()-interval '16 minutes' WHERE id=%s",(trial['id'],))
    original=driver.serving.get;accepted=[]
    def get(identifier):
        snapshot=original(identifier)
        if not accepted:
            accepted.append(serving.start_request(identifier,Chat(messages=[{'role':'user','content':'new prompt'}])))
        return snapshot
    monkeypatch.setattr(driver.serving,'get',get);driver.run_once()
    final=serving.get(trial['id'])
    assert accepted and final['request_state']=='running'
    assert final['state']=='ready' and not final['stop_requested']
    assert channel.cancel_calls==0


def test_old_attempt_adapters_are_addressable_beyond_global_page(env):
    row,training,worker=bound(env);resources,_,_,channel,_=env
    worker.run_once();channel.success()
    for _ in range(5):worker.run_once()
    adapters=Adapters(resources);original=adapters.list()[0]
    # Metadata-only fixtures exercise list volume, not training or publication.
    with resources.pool.connection() as c:
        for number in range(2,102):
            attempt_id=uuid.uuid4()
            c.execute("INSERT INTO training_attempts(id,task_id,number,state) VALUES (%s,%s,%s,'succeeded')",
                      (attempt_id,row['task_id'],number))
            for role in ('best','final'):
                c.execute('''INSERT INTO adapter_versions(id,source_attempt_id,role,snapshot,manifest,fingerprint,bucket,metrics)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',(uuid.uuid4(),attempt_id,role,Jsonb(original['snapshot']),
                    Jsonb(original['manifest']),original['fingerprint'],original['bucket'],Jsonb({})))
    first=adapters.list()
    assert len(first)==200 and not any(a['source_attempt_id']==row['id'] for a in first)
    assert adapters.available_count()==2
    exact=adapters.list(attempt_id=row['id'])
    assert len(exact)==2 and {a['role'] for a in exact}=={'best','final'}
    second=adapters.list(offset=200)
    assert len(second)==2 and len({a['id'] for a in first+second})==202
