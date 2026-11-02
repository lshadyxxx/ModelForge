"""Controlled text SFT/LoRA commands and immutable input snapshots."""
import hashlib
import json
import uuid
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from modelforge.errors import AppError
from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import ModelRegistry
from modelforge.modules.resources import GpuLeases, InstanceSpec, LeaseToken, Catalog
from modelforge.runtimes.compatibility import training_compatibility

class TrainingConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False, strict=True)
    epochs: int = Field(1, ge=1, le=100)
    learning_rate: float = Field(2e-4, ge=1e-7, le=.01)
    cutoff_len: int = Field(512, ge=128, le=32768)
    batch_size: int = Field(1, ge=1, le=8)
    gradient_accumulation: int = Field(1, ge=1, le=128)
    lora_rank: Literal[4,8,16,32,64] = 8
    lora_alpha: int = Field(16, ge=1, le=256)
    lora_dropout: float = Field(0, ge=0, le=.5)
    scheduler: Literal['cosine','linear'] = 'cosine'
    warmup_ratio: float = Field(0, ge=0, le=.3)
    template: Literal['qwen3_nothink','qwen','llama3','mistral']
    seed: int = Field(42, ge=0, le=2147483647)

class CreateTask(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=160, pattern=r'\S')
    dataset_version_id: uuid.UUID
    base_model_version_id: uuid.UUID
    instance: InstanceSpec
    config: TrainingConfig

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def token_from(row):
    return LeaseToken(uuid.UUID(str(row['id'])), row['owner_kind'], uuid.UUID(str(row['owner_id'])), row['generation'])

class Training:
    def __init__(self, resources):
        self.resources = resources
        self.pool = resources.pool

    def create(self, body):
        body = CreateTask.model_validate(body.model_dump())
        registry = ModelRegistry(self.resources)
        model_selection = registry.get(body.base_model_version_id)
        if (model_selection['source_kind'] == 'ucloud_public'
                and model_selection['external']['region'] != body.instance.region):
            raise AppError(422, 'base_region_mismatch', 'External base and execution instance must use the same region')
        compatibility = training_compatibility(model_selection, body.config, body.instance)
        Catalog(self.resources).validate_selection(body.instance)
        task_id, attempt_id = uuid.uuid4(), uuid.uuid4()
        with self.pool.connection() as connection:
            dataset = DatasetRegistry(self.resources).pin(body.dataset_version_id, 'training_task', str(task_id), connection=connection)
            model = registry.pin(body.base_model_version_id, 'training_task', str(task_id), connection=connection)
            snapshot = {'schema': 1, 'runtime': 'llamafactory-sft-lora-v1', 'dataset': dataset, 'base': model,
                        'config': body.config.model_dump(), 'instance': body.instance.model_dump(),
                        'compatibility': compatibility}
            connection.execute('INSERT INTO training_tasks(id,name,snapshot,snapshot_sha256) VALUES (%s,%s,%s,%s)',
                (task_id, body.name.strip(), Jsonb(snapshot), hashlib.sha256(canonical(snapshot)).hexdigest()))
            connection.execute('INSERT INTO training_attempts(id,task_id,number) VALUES (%s,%s,1)', (attempt_id,task_id))
        return self.get(attempt_id)

    def list(self):
        with self.pool.connection() as c:
            return c.execute('''SELECT a.*,t.name,t.snapshot_sha256 FROM training_attempts a
                JOIN training_tasks t ON t.id=a.task_id ORDER BY a.created_at DESC LIMIT 200''').fetchall()

    def get(self, identifier):
        with self.pool.connection() as c:
            row = c.execute('''SELECT a.*,t.name,t.snapshot,t.snapshot_sha256 FROM training_attempts a
                JOIN training_tasks t ON t.id=a.task_id WHERE a.id=%s''', (identifier,)).fetchone()
        if not row: raise AppError(404, 'not_found', 'Training Attempt not found')
        if hashlib.sha256(canonical(row['snapshot'])).hexdigest() != row['snapshot_sha256']:
            raise AppError(409, 'snapshot_integrity_failed', 'Immutable task snapshot integrity check failed')
        return row

    def cancel(self, identifier):
        with self.pool.connection() as c:
            row = c.execute('SELECT * FROM training_attempts WHERE id=%s FOR UPDATE', (identifier,)).fetchone()
            if not row: raise AppError(404, 'not_found', 'Training Attempt not found')
            if row['state'] not in ('succeeded','failed','cancelled'):
                c.execute('UPDATE training_attempts SET cancel_requested=true,updated_at=now() WHERE id=%s', (identifier,))
        return self.get(identifier)

    def retry(self, identifier):
        with self.pool.connection() as c:
            row = c.execute('SELECT * FROM training_attempts WHERE id=%s', (identifier,)).fetchone()
            if not row: raise AppError(404, 'not_found', 'Training Attempt not found')
            c.execute('SELECT id FROM training_tasks WHERE id=%s FOR UPDATE', (row['task_id'],))
            if c.execute("SELECT id FROM training_attempts WHERE task_id=%s AND state NOT IN ('succeeded','failed','cancelled')", (row['task_id'],)).fetchone():
                raise AppError(409, 'attempt_active', 'Complete cleanup before retrying with a new Attempt')
            identifier = uuid.uuid4()
            number = c.execute('SELECT max(number)+1 AS n FROM training_attempts WHERE task_id=%s', (row['task_id'],)).fetchone()['n']
            c.execute('INSERT INTO training_attempts(id,task_id,number) VALUES (%s,%s,%s)', (identifier,row['task_id'],number))
        return self.get(identifier)

    def logs(self, identifier, offset=0):
        self.get(identifier)
        with self.pool.connection() as c:
            return c.execute('''SELECT offset_bytes,next_offset,content,gap FROM training_log_chunks
                WHERE attempt_id=%s AND next_offset>%s ORDER BY offset_bytes LIMIT 100''', (identifier,offset)).fetchall()

    def update(self, identifier, **fields):
        allowed = {'state','stage','lease_id','instance_id','outcome','exit_code','error_code','log_offset','metrics','runtime_report','token_preflight','execution_manifest'}
        if not fields or not fields.keys() <= allowed: raise ValueError('Invalid Attempt update')
        fields = {key: Jsonb(value) if key in {'metrics','runtime_report','token_preflight','execution_manifest'} else value for key,value in fields.items()}
        with self.pool.connection() as c:
            c.execute('UPDATE training_attempts SET '+','.join(k+'=%s' for k in fields)+',updated_at=now() WHERE id=%s', (*fields.values(),identifier))

    def bind(self, identifier, instance_id, acknowledge_cleanup, lifecycle):
        row = self.get(identifier)
        if row['state'] != 'waiting_instance' or row['cancel_requested']:
            raise AppError(409, 'attempt_not_waiting', 'Attempt is not waiting for a manually created instance')
        leases = GpuLeases(self.pool); lease = leases.get(row['lease_id'])
        token = token_from(lease)
        lifecycle.bind_manual(token, InstanceSpec(**row['snapshot']['instance']), instance_id, acknowledge_cleanup=acknowledge_cleanup)
        # Recovery discovers a committed resource binding even if this update is interrupted.
        self.update(identifier, instance_id=instance_id, state='preparing', stage='inputs', error_code=None)
        return self.get(identifier)
