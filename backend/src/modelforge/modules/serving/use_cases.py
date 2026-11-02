"""Independent trial lifecycle. Chat content never enters PostgreSQL."""
from datetime import datetime,timezone,timedelta
import hashlib
import io
import uuid
from pydantic import BaseModel,ConfigDict,Field
from typing import Literal
from psycopg.types.json import Jsonb
from modelforge.errors import AppError
from .contracts import ServingExecutor
from modelforge.modules.models import Adapters,ModelExecution
from modelforge.modules.resources import GpuLeases,InstanceSpec,LeaseToken,Catalog
from modelforge.runtimes.compatibility import compatibility_baseline, inference_compatibility

_CONVERSATION = compatibility_baseline().inference.conversation

class CreateTrial(BaseModel):
    model_config=ConfigDict(extra='forbid')
    adapter_id:uuid.UUID
    instance:InstanceSpec

class Message(BaseModel):
    model_config=ConfigDict(extra='forbid')
    role:Literal['system','user','assistant']
    content:str=Field(min_length=1,max_length=_CONVERSATION.max_content_chars_per_message)

class Chat(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    messages:list[Message]=Field(min_length=1,max_length=_CONVERSATION.max_messages)
    max_tokens:int=Field(_CONVERSATION.max_tokens_default,ge=1,le=_CONVERSATION.max_tokens_limit)
    temperature:float=Field(.7,ge=0,le=2)
    top_p:float=Field(.9,gt=0,le=1)

def token(lease):
    return LeaseToken(uuid.UUID(str(lease['id'])),lease['owner_kind'],uuid.UUID(str(lease['owner_id'])),lease['generation'])

class Serving:
    def __init__(self,resources):self.resources=resources;self.pool=resources.pool

    def create(self,body):
        body=CreateTrial.model_validate(body.model_dump())
        adapter=Adapters(self.resources).get(body.adapter_id)
        compatibility=inference_compatibility(adapter,body.instance)
        if GpuLeases(self.pool).current():
            raise AppError(409,'gpu_busy','Complete existing training/trial instance cleanup before starting a new trial')
        base=adapter['snapshot']['base']
        if base['source_kind']=='ucloud_public' and base['external']['region']!=body.instance.region:
            raise AppError(422,'base_region_mismatch','Trial must use the pinned public model region')
        Catalog(self.resources).validate_selection(body.instance)
        identifier=uuid.uuid4();snapshot={'base':base,'instance':body.instance.model_dump(),
            'config':adapter['snapshot']['config'],'adapter_fingerprint':adapter['fingerprint'],
            'compatibility':compatibility}
        with self.pool.connection() as c:
            c.execute('INSERT INTO inference_trials(id,adapter_id,snapshot) VALUES (%s,%s,%s)',(identifier,body.adapter_id,Jsonb(snapshot)))
        return self.get(identifier)

    def list(self):
        with self.pool.connection() as c:return c.execute('SELECT * FROM inference_trials ORDER BY created_at DESC LIMIT 200').fetchall()

    def get(self,identifier):
        with self.pool.connection() as c:row=c.execute('SELECT * FROM inference_trials WHERE id=%s',(identifier,)).fetchone()
        if not row:raise AppError(404,'not_found','Inference trial not found')
        return row

    def update(self,identifier,**fields):
        allowed={'state','lease_id','instance_id','stop_requested','error_code','last_activity_at',
                 'request_id','request_state','request_cancel_requested'}
        if not fields or not fields.keys()<=allowed:raise ValueError('Invalid trial update')
        with self.pool.connection() as c:
            c.execute('UPDATE inference_trials SET '+','.join(key+'=%s' for key in fields)+',updated_at=now() WHERE id=%s',(*fields.values(),identifier))

    def stop(self,identifier):
        self.get(identifier);self.update(identifier,stop_requested=True)
        return self.get(identifier)

    def bind(self,identifier,instance_id,acknowledge_cleanup,lifecycle):
        row=self.get(identifier)
        if row['state']!='waiting_instance' or row['stop_requested']:
            raise AppError(409,'trial_not_waiting','Trial is not waiting for a manually created instance')
        lease=GpuLeases(self.pool).get(row['lease_id'])
        lifecycle.bind_manual(token(lease),InstanceSpec(**row['snapshot']['instance']),instance_id,
                              acknowledge_cleanup=acknowledge_cleanup)
        self.update(identifier,instance_id=instance_id,state='preparing',error_code=None)
        return self.get(identifier)

    def start_request(self,identifier,body):
        if (sum(len(m.content) for m in body.messages)>_CONVERSATION.max_total_content_chars
                or body.messages[-1].role!='user'):
            raise AppError(422,'chat_invalid','End with a user message and keep context within the supported limit')
        with self.pool.connection() as c:
            row=c.execute('SELECT * FROM inference_trials WHERE id=%s FOR UPDATE',(identifier,)).fetchone()
            if not row:raise AppError(404,'not_found','Inference trial not found')
            if row['state']!='ready' or row['stop_requested'] or row['request_state']!='idle':
                raise AppError(409,'trial_busy','Trial must be ready with no active or uncertain request')
            request_id=uuid.uuid4()
            c.execute("UPDATE inference_trials SET request_id=%s,request_state='running',request_cancel_requested=false,last_activity_at=now(),stream_alive_until=now()+interval '90 seconds' WHERE id=%s",(request_id,identifier))
        return str(request_id)

    def stream_alive(self,identifier,request_id):
        with self.pool.connection() as c:
            return c.execute("UPDATE inference_trials SET stream_alive_until=now()+interval '90 seconds' WHERE id=%s AND request_id=%s AND request_state!='idle' RETURNING id",
                             (identifier,request_id)).fetchone() is not None

    def request_cancel(self,identifier,request_id=None):
        with self.pool.connection() as c:
            row=c.execute('SELECT * FROM inference_trials WHERE id=%s FOR UPDATE',(identifier,)).fetchone()
            if not row:raise AppError(404,'not_found','Inference trial not found')
            if row['request_state']!='idle' and (request_id is None or str(row['request_id'])==str(request_id)):
                c.execute("UPDATE inference_trials SET request_cancel_requested=true,request_state='cancelling' WHERE id=%s",(identifier,))
        return self.get(identifier)

    def finish_request(self,identifier,request_id):
        with self.pool.connection() as c:
            c.execute("UPDATE inference_trials SET request_state='idle',request_cancel_requested=false,stream_alive_until=NULL,last_activity_at=now() WHERE id=%s AND request_id=%s",(identifier,request_id))

    def stop_if_idle(self,identifier,deadline):
        # Conditional UPDATE shares the row lock with request admission. A stale
        # Worker snapshot cannot stop a request that has just refreshed activity.
        with self.pool.connection() as c:
            return c.execute("""UPDATE inference_trials SET stop_requested=true,updated_at=now()
                WHERE id=%s AND state='ready' AND request_state='idle'
                AND NOT stop_requested AND last_activity_at<=%s RETURNING id""",
                (identifier,deadline)).fetchone() is not None

class ServingWorker:
    def __init__(self,resources,channel,lifecycle,executor: ServingExecutor):
        self.resources=resources;self.channel=channel;self.lifecycle=lifecycle
        self.executor=executor
        self.serving=Serving(resources);self.leases=GpuLeases(resources.pool)

    def run_once(self):
        with self.resources.pool.connection() as guard:
            if not guard.execute('SELECT pg_try_advisory_lock(731801) AS acquired').fetchone()['acquired']:return False
            try:
                with self.resources.pool.connection() as c:
                    rows=c.execute("SELECT id FROM inference_trials WHERE state!='stopped' ORDER BY created_at LIMIT 200").fetchall()
                for item in rows:
                    try:self.advance(item['id'])
                    except AppError as error:self.serving.update(item['id'],error_code=error.code)
                    except Exception:self.serving.update(item['id'],error_code='serving_dependency_failed')
                return bool(rows)
            finally:guard.execute('SELECT pg_advisory_unlock(731801)')

    def http(self,row,route,body=None):
        return self.channel.call(row['instance_id'],row['id'],'http',route=route,body=body or {})

    def advance(self,identifier):
        row=self.serving.get(identifier)
        if row['lease_id'] is None:
            if row['stop_requested']:self.serving.update(identifier,state='stopped');return
            lease_token=self.leases.reserve('trial',identifier)
            self.serving.update(identifier,lease_id=lease_token.reservation_id,state='waiting_instance')
            row=self.serving.get(identifier)
        lease=self.leases.get(row['lease_id']);lease_token=token(lease)
        if lease['state']=='released':self.serving.update(identifier,state='stopped',error_code=None);return
        self.leases.renew(lease_token)
        if lease['cleanup_policy'] is not None:
            self.lifecycle.cleanup(lease_token,lease['cleanup_policy'])
            self.lifecycle.reconcile(lease_token)
            return
        if row['instance_id'] is None and lease['provider_instance_id']:
            self.serving.update(identifier,instance_id=lease['provider_instance_id'],state='preparing')
            row=self.serving.get(identifier)
        if row['instance_id'] is None:
            if row['stop_requested']:
                self.leases.release(lease_token);self.serving.update(identifier,state='stopped')
            return
        # DB time and persistent last_activity survive API/page/Worker restarts.
        idle=row['state']=='ready' and row['request_state']=='idle' and row['last_activity_at']<=datetime.now(timezone.utc)-timedelta(minutes=15)
        if idle:
            self.serving.stop_if_idle(identifier,datetime.now(timezone.utc)-timedelta(minutes=15))
            row=self.serving.get(identifier)
        status=self.channel.call(row['instance_id'],identifier,'status')
        if row['stop_requested']:
            self.serving.update(identifier,state='stopping')
            if status['state']=='not_started':
                if lease['process_state']!='not_started':raise AppError(503,'remote_launch_unconfirmed','Runtime launch receipt is missing')
                self.lifecycle.cleanup(lease_token,'discard');self.lifecycle.reconcile(lease_token);return
            if status['state']!='exited':self.channel.call(row['instance_id'],identifier,'cancel');return
            if not status.get('group_exited'):raise AppError(503,'remote_process_unknown','Runtime group exit is not confirmed')
            self.leases.record_process_exit(lease_token,row['instance_id'],status['exit_code'])
            # A serving process has no only-copy training output.
            self.lifecycle.cleanup(lease_token,'outputs_persisted' if status['exit_code']==0 else 'discard')
            self.lifecycle.reconcile(lease_token);return
        if status['state']=='not_started':
            if lease['process_state']!='not_started':
                raise AppError(503,'remote_launch_unconfirmed','Runtime launch receipt is missing; retain the instance')
            model_path=ModelExecution(self.resources).prepare(row['snapshot']['base'],self.channel,row['instance_id'],identifier)
            Adapters(self.resources).restore(row['adapter_id'],self.channel,row['instance_id'],identifier)
            plan=self.executor.prepare(model_path,row['snapshot']['config'],row['snapshot']['adapter_fingerprint'])
            # Generate a private, ephemeral runtime token on the GPU; never store it in SQL.
            self.channel.call(row['instance_id'],identifier,'ensure_token')
            inputs=[]
            for path,data in plan.files.items():
                digest=hashlib.sha256(data).hexdigest()
                self.channel.upload(row['instance_id'],identifier,path,io.BytesIO(data),len(data),digest)
                inputs.append({'path':path,'size':len(data),'sha256':digest})
            if self.serving.get(identifier)['stop_requested']:return
            if lease['process_state']=='not_started':self.leases.execution_requested(lease_token)
            status=self.channel.call(row['instance_id'],identifier,'start',argv=list(plan.argv),inputs=inputs)
        if status['state'] in ('launching','running'):
            health=self.http(row,'/health')
            if not self.executor.ready(health,row['snapshot']['adapter_fingerprint']):
                raise AppError(503,'adapter_probe_pending','Waiting for an actual Adapter generation probe')
            if row['state']!='ready':self.serving.update(identifier,state='ready',last_activity_at=datetime.now(timezone.utc),error_code=None)
            if row['request_state']!='idle':
                alive=row['stream_alive_until'] and row['stream_alive_until']>datetime.now(timezone.utc)
                # A healthy stream drains its output. API death expires this lease;
                # the Worker cancels the exact request and awaits the idle barrier.
                if row['request_cancel_requested'] or not alive:
                    result=self.http(row,'/chat/cancel',{'request_id':str(row['request_id'])})
                    if result.get('done') and result['state'] in ('completed','cancelled','rejected'):
                        if not alive:self.serving.finish_request(identifier,row['request_id'])
                    elif result['state']=='unknown':
                        self.serving.update(identifier,request_state='unknown',error_code='request_state_unknown')
            return
        if status['state']=='exited' and status.get('group_exited'):
            self.leases.record_process_exit(lease_token,row['instance_id'],status['exit_code'])
            self.serving.update(identifier,state='blocked',error_code='runtime_exited',stop_requested=True);return
        raise AppError(503,'remote_process_unknown','Runtime state is unknown; instance and lease are retained')
