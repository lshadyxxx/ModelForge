"""Single Worker driver. Network failures preserve process uncertainty and GPU ownership."""
import base64
import hashlib
import io
import json
import tempfile
from modelforge.errors import AppError
from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import Adapters, ModelExecution
from modelforge.modules.resources import GpuLeases
from modelforge.runtimes.runtime_lock import training_runtime_lock
from .use_cases import Training, token_from
from .contracts import TrainingExecutor
from .provisioning import RemoteJobs, TrainingProvisioning

class TrainingWorker:
    def __init__(self, resources, channel, lifecycle, executor: TrainingExecutor, *,
                 provisioning=None, remote_jobs=None):
        self.resources, self.channel, self.lifecycle = resources, channel, lifecycle
        self.executor = executor
        self.training = Training(resources); self.leases = GpuLeases(resources.pool)
        self.provisioning = provisioning or TrainingProvisioning(resources, lifecycle)
        self.remote_jobs = remote_jobs or RemoteJobs(resources.pool)

    def run_once(self):
        # A session advisory lock prevents two resident Workers from executing this loop.
        with self.resources.pool.connection() as guard:
            if not guard.execute('SELECT pg_try_advisory_lock(731801) AS acquired').fetchone()['acquired']: return False
            try:
                with self.resources.pool.connection() as c:
                    item = c.execute("SELECT id FROM training_attempts WHERE state NOT IN ('succeeded','failed','cancelled') ORDER BY created_at LIMIT 1").fetchone()
                if not item: return False
                try: self.advance(item['id'])
                except Exception as error:
                    current = self.training.get(item['id'])
                    # Cleanup failures are recorded on the lease. Once the
                    # training outcome is fixed, a transient provider
                    # acknowledgement error must not replace it on the attempt.
                    if current['state'] != 'cleanup':
                        code = error.code if isinstance(error, AppError) else 'execution_dependency_failed'
                        self.training.update(item['id'], error_code=code)
                return True
            finally: guard.execute('SELECT pg_advisory_unlock(731801)')

    def _upload(self, row, name, data):
        digest = hashlib.sha256(data).hexdigest()
        self.channel.upload(row['instance_id'],row['id'],name,io.BytesIO(data),len(data),digest)
        return {'path':name,'size':len(data),'sha256':digest}

    def _read_json(self, row, path):
        result = self.channel.call(row['instance_id'],row['id'],'read',path=path)
        if result.get('missing'): raise AppError(503, 'runtime_result_missing', 'Required runtime result is not available')
        if result.get('size',0) > 1024**2: raise AppError(503, 'runtime_result_invalid', 'Runtime result exceeds its limit')
        return json.loads(base64.b64decode(result['data']))

    def _logs(self, row):
        response = self.channel.call(row['instance_id'],row['id'],'read',path='process.log',offset=row['log_offset'])
        if response.get('missing'): return True
        if response['next_offset'] == row['log_offset'] and not response.get('gap'): return True
        data = base64.b64decode(response['data'],validate=True)
        next_offset = response['next_offset']
        # Re-read a split UTF-8 suffix with the next chunk instead of corrupting it.
        if next_offset < response.get('size',next_offset):
            try:data.decode('utf-8')
            except UnicodeDecodeError as error:
                if error.reason=='unexpected end of data':
                    next_offset-=len(data)-error.start;data=data[:error.start]
        text = data.decode('utf-8',errors='replace')
        with self.resources.pool.connection() as c:
            c.execute('''INSERT INTO training_log_chunks(attempt_id,offset_bytes,next_offset,content,gap)
                VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                (row['id'],row['log_offset'],next_offset,text,bool(response.get('gap'))))
            c.execute('UPDATE training_attempts SET log_offset=%s WHERE id=%s', (next_offset,row['id']))
        return next_offset >= response.get('size',next_offset)

    def _runtime_reports(self, row):
        report=self.executor.reports(lambda path:self._read_json(row,path))
        if report:self.training.update(row['id'],**report)

    def _archive(self,row,required):
        manifest=[]
        bucket=self.resources.settings.minio_bucket
        for name in self.executor.evidence_files:
            head=self.channel.call(row['instance_id'],row['id'],'read',path=name,limit=1)
            if head.get('missing'):
                if name in required:raise AppError(503,'execution_evidence_missing','Retain instance until required execution evidence can be archived')
                continue
            size=head['size']
            if size>self.resources.settings.model_file_limit_bytes:raise AppError(503,'execution_evidence_limit','Execution evidence exceeds the supported file limit')
            with tempfile.SpooledTemporaryFile(max_size=8*1024**2) as target:
                offset=0;digest=hashlib.sha256()
                while offset<size:
                    block=self.channel.call(row['instance_id'],row['id'],'read',path=name,offset=offset)
                    data=base64.b64decode(block['data'],validate=True)
                    if not data or block.get('gap') or block.get('missing') or block['next_offset']!=offset+len(data):
                        raise AppError(503,'execution_evidence_changed','Execution evidence changed while archiving')
                    target.write(data);digest.update(data);offset+=len(data)
                item={'path':name,'size':size,'sha256':digest.hexdigest()}
                key='training/'+str(row['id'])+'/'+name
                target.seek(0);self.resources.store.put_object(bucket,key,target,size)
                source=self.resources.store.get_object(bucket,key)
                try:
                    check=hashlib.sha256();count=0
                    while data:=source.read(1024**2):check.update(data);count+=len(data)
                    if count!=size or check.hexdigest()!=item['sha256']:raise AppError(503,'execution_sync_failed','Execution evidence read-back verification failed')
                finally:source.close();source.release_conn()
                manifest.append({**item,'object_key':key})
        self.training.update(row['id'],execution_manifest={'bucket':bucket,'files':manifest})

    def advance(self, identifier):
        row = self.training.get(identifier)
        if row['lease_id'] is None:
            if row['cancel_requested']:
                self.training.update(identifier,state='cancelled',outcome='cancelled',stage='finished'); return
            token = self.leases.reserve('attempt', identifier)
            if row['execution_mode'] == 'managed':
                self.provisioning.ensure_intent(identifier, token)
                self.training.update(identifier, lease_id=token.reservation_id, state='preparing', stage='provisioning')
            else:
                self.training.update(identifier, lease_id=token.reservation_id, state='waiting_instance', stage='manual_instance')
            row = self.training.get(identifier)
        lease = self.leases.get(row['lease_id']); token = token_from(lease)
        if lease['state'] == 'released':
            if row['outcome']:
                if row['outcome'] == 'succeeded':
                    facts = self.provisioning.row(identifier)
                    if not facts or facts['artifact_state'] != 'verified':
                        raise AppError(409, 'artifact_unverified', 'A released successful Attempt has no verified artifact fact')
                self.provisioning.remove_endpoint(identifier, token)
                fields = {'state': row['outcome'], 'stage': 'finished'}
                if row['outcome'] in ('succeeded', 'cancelled'):
                    fields['error_code'] = None
                self.training.update(identifier, **fields)
            else: raise AppError(409,'execution_reconciliation_required','Released lease has no persisted outcome')
            return
        self.leases.renew(token)
        if (row['cancel_requested'] and lease['create_state'] == 'not_requested'
                and lease['provider_instance_id'] is None):
            # Cancellation before the side-effecting create call must never
            # spend money just to discover that the user already cancelled.
            self.leases.release(token)
            self.training.update(
                identifier, state='cancelled', stage='finished',
                outcome='cancelled', error_code=None,
            )
            return
        if (row['cancel_requested'] and lease['create_state'] == 'bound'
                and lease['process_state'] == 'not_started'
                and row['state'] not in {'cleanup', 'succeeded', 'failed', 'cancelled'}):
            if row['instance_id'] is None and lease['provider_instance_id']:
                self.training.update(
                    identifier, instance_id=lease['provider_instance_id'],
                    state='cleanup', stage='cleanup', outcome='cancelled',
                )
            else:
                self.training.update(
                    identifier, state='cleanup', stage='cleanup',
                    outcome='cancelled',
                )
            row = self.training.get(identifier)
        if row['execution_mode'] == 'managed' and row['stage'] in {
                'provisioning', 'cost_guard', 'bootstrap', 'runtime'}:
            try:
                if row['cancel_requested']:
                    if row['instance_id'] is None:
                        provisioned = self.provisioning.ensure_instance(identifier, token)
                        row = self.training.get(identifier)
                        if not row['instance_id']:
                            return
                    self.training.update(
                        identifier, state='cleanup', stage='cleanup',
                        outcome='cancelled',
                    )
                    return
                if row['instance_id'] is None:
                    provisioned = self.provisioning.ensure_instance(identifier, token)
                    row = self.training.get(identifier)
                    if not row['instance_id']:
                        return
                facts = self.provisioning.row(identifier)
                if not facts:
                    raise AppError(409, 'provisioning_missing', 'Managed provisioning facts are missing')
                if facts['cost_guard_state'] != 'set':
                    self.training.update(identifier, state='preparing', stage='cost_guard')
                    self.provisioning.guard_cost(identifier, token)
                    facts = self.provisioning.row(identifier)
                if facts['credential_state'] not in {'rotated', 'password_disabled'}:
                    self.training.update(identifier, state='preparing', stage='bootstrap')
                    boot = self.provisioning.bootstrap(identifier, token)
                    if boot.get('state') == 'pending':
                        return
                    facts = self.provisioning.row(identifier)
                if facts['runtime_state'] != 'preflight_ready':
                    self.training.update(identifier, state='preparing', stage='runtime')
                    self.provisioning.ensure_runtime(identifier, token, self.channel)
                self.training.update(identifier, state='preparing', stage='inputs', error_code=None)
                row = self.training.get(identifier)
            except AppError as error:
                current_lease = self.leases.get(row['lease_id'])
                if current_lease['provider_instance_id'] is None and current_lease['create_state'] == 'not_requested':
                    self.leases.release(token)
                    self.training.update(
                        identifier,
                        state='failed' if not row['cancel_requested'] else 'cancelled',
                        stage='finished',
                        outcome='failed' if not row['cancel_requested'] else 'cancelled',
                        error_code=error.code,
                    )
                else:
                    self.training.update(
                        identifier, state='cleanup', stage='cleanup',
                        outcome='failed' if not row['cancel_requested'] else 'cancelled',
                        error_code=error.code,
                    )
                return
        if not row['instance_id'] and lease['provider_instance_id']:
            self.training.update(identifier,instance_id=lease['provider_instance_id'],state='preparing',stage='inputs')
            row = self.training.get(identifier)
        if row['instance_id'] is None:
            if row['cancel_requested']:
                self.leases.release(token)
                self.training.update(identifier,state='cancelled',outcome='cancelled',stage='finished')
            return
        if row['stage'] == 'cleanup':
            current_lease = self.leases.get(row['lease_id'])
            if row['execution_mode'] == 'managed' and current_lease['create_state'] not in {
                    'not_requested', 'bound'}:
                # A create request may have been sent before cancellation or
                # failure. Resolve that uncertain request before cleanup; never
                # release the lease while the provider may still hold a child.
                try:
                    self.provisioning.ensure_instance(identifier, token)
                except AppError:
                    return
                current_lease = self.leases.get(row['lease_id'])
                if current_lease['create_state'] != 'bound':
                    return
                row = self.training.get(identifier)
                if row['instance_id'] is None and current_lease['provider_instance_id']:
                    self.training.update(
                        identifier, instance_id=current_lease['provider_instance_id'],
                    )
                    row = self.training.get(identifier)
            if row['execution_mode'] == 'managed':
                self.provisioning.clear_cost_guard(identifier, token)
            self.lifecycle.cleanup(token, 'outputs_persisted' if row['outcome']=='succeeded' else 'discard')
            self.lifecycle.reconcile(token)
            if self.leases.get(row['lease_id'])['state']=='released':
                self.provisioning.remove_endpoint(identifier, token)
                fields = {'state': row['outcome'], 'stage': 'finished'}
                if row['outcome'] in ('succeeded', 'cancelled'):
                    fields['error_code'] = None
                self.training.update(identifier, **fields)
            return
        if lease['process_state'] == 'not_started' and row['cancel_requested']:
            self.training.update(identifier,state='cleanup',stage='cleanup',outcome='cancelled')
            return
        if lease['process_state'] == 'not_started':
            runtime_report = self.channel.runtime_check(
                row['instance_id'], identifier, training_runtime_lock()
            )
            self.training.update(
                identifier,
                runtime_report={'phase': 'preflight', **runtime_report},
            )
            if not runtime_report['ready']:
                raise AppError(
                    409,
                    'gpu_runtime_incompatible',
                    'The instance runtime does not match the verified training lock',
                    {
                        'lock_id': runtime_report.get('lock_id'),
                        'mismatches': runtime_report.get('mismatches', []),
                    },
                )
            if row['error_code']:
                self.training.update(identifier, error_code=None)
        status = self.channel.call(row['instance_id'],identifier,'status')
        if status['state'] == 'not_started':
            if lease['process_state'] != 'not_started':
                raise AppError(503,'remote_launch_unconfirmed','A launch was requested but its receipt is missing; retain the instance for reconciliation')
            if row['cancel_requested']:
                self.training.update(identifier,state='cleanup',stage='cleanup',outcome='cancelled'); return
            self.training.update(identifier,state='preparing',stage='inputs')
            dataset = DatasetRegistry(self.resources).execution_data(row['snapshot']['dataset'])
            model_path = ModelExecution(self.resources).prepare(row['snapshot']['base'],self.channel,row['instance_id'],identifier)
            plan=self.executor.prepare(dataset,row['snapshot']['config'],model_path)
            inputs=[self._upload(row,name,data) for name,data in plan.files.items()]
            # Re-read cancellation after all potentially slow input transfers.
            if self.training.get(identifier)['cancel_requested']:
                self.training.update(identifier,state='cleanup',stage='cleanup',outcome='cancelled'); return
            if lease['process_state']=='not_started':
                self.leases.execution_requested(token)
                self.remote_jobs.ensure(identifier, row['instance_id'], plan.argv, inputs)
                self.remote_jobs.launch_requested(identifier)
            status = self.channel.call(row['instance_id'],identifier,'start',argv=list(plan.argv),inputs=inputs)
            self.remote_jobs.observed(identifier, status)
        if status['state'] in ('launching','running'):
            self.remote_jobs.observed(identifier, status)
            self.training.update(identifier,state='running',stage='training',error_code=None)
            if self.training.get(identifier)['cancel_requested']:
                status = self.channel.call(row['instance_id'],identifier,'cancel')
            self._logs(self.training.get(identifier)); self._runtime_reports(row); return
        if status['state'] != 'exited' or status.get('group_exited') is not True:
            self.remote_jobs.observed(identifier, status)
            raise AppError(503,'remote_process_unknown','Remote process exit is unverified; retain GPU instance')
        self.remote_jobs.observed(identifier, status)
        self.leases.record_process_exit(token,row['instance_id'],status['exit_code'],cancelled=bool(status.get('cancelled')))
        cancelled = bool(status.get('cancelled'))
        unsuccessful=cancelled or status['exit_code']!=0
        if not unsuccessful:
            # Artifact persistence is a distinct user-visible phase. Record it
            # before touching object storage so a failed upload cannot leave
            # the Attempt looking like training is still running.
            self.training.update(identifier,state='syncing',stage='artifacts',exit_code=0)
        try:
            # Bound each tick; resume large tails next tick while the instance exists.
            for _ in range(4):
                if self._logs(self.training.get(identifier)):break
            else:
                self.training.update(identifier,stage='logs');return
            self._runtime_reports(row)
            if row['execution_mode'] == 'managed':
                self.provisioning.mark_artifact(identifier, 'uploading')
            self._archive(row,set() if unsuccessful else self.executor.required_evidence)
        except Exception:
            if not unsuccessful:raise
            # Diagnostics are best effort after a confirmed unsuccessful exit.
            # Keep the gap explicit while allowing safe resource reclamation.
            self.training.update(identifier,execution_manifest={'diagnostic_gap':True,'code':'diagnostic_collection_failed'})
        if cancelled or status['exit_code'] != 0:
            if row['execution_mode'] == 'managed':
                self.provisioning.mark_artifact(identifier, 'failed')
            code = 'cancelled' if cancelled else 'training_failed'
            if not cancelled:code=self.executor.failure_code(lambda path:self._read_json(row,path))
            self.training.update(identifier,state='cleanup',stage='cleanup',
                outcome='cancelled' if cancelled else 'failed',exit_code=status['exit_code'],error_code=code)
            return
        result = self.executor.result(lambda path:self._read_json(row,path))
        Adapters(self.resources).publish(identifier,row['snapshot'],self.channel,row['instance_id'],result)
        if row['execution_mode'] == 'managed':
            self.provisioning.mark_artifact(identifier, 'verified', verified=True)
        self.training.update(identifier,state='cleanup',stage='cleanup',outcome='succeeded',error_code=None)
