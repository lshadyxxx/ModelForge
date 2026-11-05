"""Server-only provider lifecycle coordinated by the persistent GPU lease."""
from typing import Literal
from datetime import datetime
from psycopg.types.json import Jsonb
from modelforge.errors import AppError
from .catalog import Instance
from pydantic import BaseModel, ConfigDict, ValidationError, Field

class InstanceSpec(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    region: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    zone: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    gpu_type: str = Field(min_length=1, max_length=120, pattern=r'^[A-Za-z0-9_.-]+$')
    cpu: int = Field(gt=0, le=1024)
    memory_mb: int = Field(gt=0, le=10485760, multiple_of=1024)
    image_id: str = Field(min_length=1, max_length=120, pattern=r'^[A-Za-z0-9_-]+$')
    cpu_platform: Literal['Auto', 'Intel/Auto', 'Amd/Auto']
    charge_type: Literal['Month', 'Day', 'Postpay']
    boot_disk_gb: int = Field(gt=0, le=1000000)
    boot_disk_type: Literal['CLOUD_SSD', 'CLOUD_RSSD']

class ObservedInstance(Instance):
    UHostId: str = Field(min_length=1, max_length=120, pattern=r'^[A-Za-z0-9_-]+$')
    State: str = Field(min_length=1, max_length=64)
    CreateTime: int = Field(ge=0)


class InstanceLifecycle:
    def __init__(self, leases, provider):
        self.leases, self.provider = leases, provider

    def _state(self, token):
        with self.leases.pool.connection() as c:
            row = self.leases._locked(c, token, allow_released=True)
            intent = c.execute('SELECT * FROM ucloud_instance_intents WHERE reservation_id=%s',
                               (token.reservation_id,)).fetchone()
            return {'lease': self.leases._snapshot(c, row),
                    'intent': {k: v for k,v in intent.items() if k != 'reservation_id'} if intent else None}

    def create(self, token, spec, *, login_password: str | None = None,
               project_id: str | None = None):
        if not isinstance(spec, InstanceSpec):
            raise AppError(422, 'validation_error', 'Use a validated InstanceSpec')
        try:
            spec = InstanceSpec.model_validate(spec.model_dump(warnings=False))
        except (ValidationError, TypeError, ValueError):
            raise AppError(422, 'validation_error', 'Use a validated InstanceSpec') from None
        with self.leases.pool.connection() as c:
            lease = self.leases._locked(c, token)
            existing = c.execute('SELECT 1 FROM ucloud_instance_intents WHERE reservation_id=%s',
                                 (token.reservation_id,)).fetchone()
            if not existing and lease['create_state'] != 'not_requested':
                raise AppError(409, 'gpu_instance_intent_missing', 'This reservation has no adapter creation snapshot')
            c.execute("""INSERT INTO ucloud_instance_intents(reservation_id,label,spec)
                VALUES (%s,%s,%s) ON CONFLICT (reservation_id) DO NOTHING""",
                (token.reservation_id, 'mf-'+token.reservation_id.hex, Jsonb(spec.model_dump())))
            intent = c.execute('SELECT * FROM ucloud_instance_intents WHERE reservation_id=%s',
                               (token.reservation_id,)).fetchone()
            if intent['spec'] != spec.model_dump():
                raise AppError(409, 'gpu_creation_conflict', 'Creation parameters are already fixed')
        row = self._state(token)
        if row['lease']['create_state'] != 'not_requested':
            return row
        params = {'Region': spec.region, 'Zone': spec.zone, 'GpuType': spec.gpu_type,
            'MinimalCpuPlatform': spec.cpu_platform, 'CompShareImageId': spec.image_id,
            'MachineType': 'G', 'ChargeType': spec.charge_type,
            'Disks': [{'IsBoot': True, 'Type': spec.boot_disk_type, 'Size': spec.boot_disk_gb}]}
        if project_id:
            params['ProjectId'] = project_id
        capacity = self.provider.query('CheckCompShareResourceCapacity', params)
        rows = capacity.get('Specs')
        if (not isinstance(rows, list) or any(not isinstance(row, dict)
                or any(type(row.get(k)) is not int or row[k] <= 0 for k in ('Gpu','Cpu','Mem'))
                or type(row.get('ResourceEnough')) is not bool for row in rows)):
            raise AppError(502, 'cloud_invalid_response', 'Capacity response is invalid')
        if not any(row['Gpu'] == 1 and row['Cpu'] == spec.cpu
                   and row['Mem'] * 1024 == spec.memory_mb and row['ResourceEnough'] is True
                   for row in capacity['Specs']):
            raise AppError(409, 'cloud_out_of_stock', 'Selected exact specification is out of stock')
        creation = self.leases.begin_creation(token, spec.region)
        if creation['dispatch']:
            login = {}
            if login_password is not None:
                if (not isinstance(login_password, str) or not 8 <= len(login_password) <= 128
                        or any(character.isspace() for character in login_password)):
                    raise AppError(422, 'validation_error', 'Bootstrap password does not meet the transport contract')
                import base64
                login = {
                    'LoginMode': 'Password',
                    'Password': base64.b64encode(login_password.encode('ascii')).decode('ascii'),
                }
            response = self.provider.create({**params, 'CPU': spec.cpu, 'GPU': 1,
                'Memory': spec.memory_mb, 'MaxCount': 1, 'Quantity': 1,
                'Name': intent['label'], **login})
            self.leases.bind_instance(token, creation['operation_id'], response['UHostIds'][0])
        return self._state(token)

    def bootstrap_observation(self, token):
        """Return transient connection facts for the exact bound instance.

        The password and login command are intentionally absent from every
        persistent projection. Callers must keep them in memory only and must
        not include this result in API responses or evidence files.
        """
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released' or lease['create_state'] != 'bound' or not intent:
            raise AppError(409, 'cloud_instance_not_bound', 'A bound instance is required for secure bootstrap')
        spec = InstanceSpec(**intent['spec'])
        response = self.provider.query('DescribeCompShareInstance', {
            'Region': spec.region,
            'Zone': spec.zone,
            'UHostIds': [lease['provider_instance_id']],
            'Limit': 100,
            'Offset': 0,
        })
        rows = response.get('UHostSet')
        if (not isinstance(rows, list) or type(response.get('TotalCount')) is not int
                or response['TotalCount'] != len(rows) or len(rows) != 1):
            raise AppError(502, 'cloud_invalid_response', 'Exact bootstrap observation is incomplete')
        raw = rows[0]
        if not isinstance(raw, dict) or raw.get('UHostId') != lease['provider_instance_id']:
            raise AppError(409, 'cloud_instance_conflict', 'Query did not identify the bound instance')
        self._match(self._validated_rows([raw])[0], spec)
        password = raw.get('Password')
        ssh_login_command = raw.get('SshLoginCommand')
        if password is not None and (not isinstance(password, str) or len(password) > 4096):
            raise AppError(502, 'cloud_invalid_response', 'Provider credential observation is invalid')
        if ssh_login_command is not None and (
                not isinstance(ssh_login_command, str) or len(ssh_login_command) > 4096):
            raise AppError(502, 'cloud_invalid_response', 'Provider SSH observation is invalid')
        return {
            'instance_id': lease['provider_instance_id'],
            'state': raw.get('State'),
            'password_base64': password,
            'ssh_login_command': ssh_login_command,
            'image_type': raw.get('CompShareImageType'),
            'instance_type': raw.get('InstanceType'),
            'observed_at': datetime.now().isoformat(),
        }

    def reconcile(self, token):
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if not intent or lease['state'] == 'released' or lease['create_state'] == 'not_requested':
            return result
        spec = InstanceSpec(**intent['spec'])
        if lease['create_state'] == 'bound':
            rows = self._observe(lease, spec)
            if (not rows
                    and lease.get('cleanup_policy') is not None
                    and lease.get('cleanup_state') == 'pending'):
                # Explicit delete authorization already exists. A second exact-ID
                # absence is enough to confirm provider deletion without relying
                # on a terminate acknowledgement from an idempotent mutation.
                confirmed_absent = self._observe(lease, spec)
                if not confirmed_absent:
                    self.leases.record_deletion(token, lease['provider_instance_id'], confirmed=True)
                    self.leases.release(token)
            elif not rows and intent['terminate_acknowledged']:
                self.leases.record_deletion(token, lease['provider_instance_id'], confirmed=True)
                self.leases.release(token)
            elif not rows and intent['terminate_requested']:
                # A provider mutation can succeed while its acknowledgement is
                # unverifiable. Only confirm absence after a second exact-ID
                # query, and only after stop and termination were requested.
                confirmed_absent = self._observe(lease, spec)
                if not confirmed_absent:
                    self.leases.record_deletion(token, lease['provider_instance_id'], confirmed=True)
                    self.leases.release(token)
            elif rows and rows[0]['State'] == 'Stopped':
                self.leases.record_instance_stopped(token, lease['provider_instance_id'])
            return self._state(token)
        all_rows = []
        total = None
        while True:
            response = self.provider.query('DescribeCompShareInstance',
                {'Region': spec.region, 'Zone': spec.zone, 'Limit': 100, 'Offset': len(all_rows)})
            count, page = response.get('TotalCount'), response.get('UHostSet')
            if (type(count) is not int or not 0 <= count <= 10000 or not isinstance(page, list)
                    or (total is not None and total != count)
                    or len(page) != min(100, count-len(all_rows))):
                raise AppError(502, 'cloud_invalid_response', 'Incomplete or unstable instance listing')
            total = count
            all_rows.extend(self._validated_rows(page))
            if len(all_rows) == total:
                break
        rows = [row for row in all_rows if row['Name'] == intent['label']]
        if len(rows) > 1:
            raise AppError(409, 'cloud_instance_conflict', 'Creation label is not unique')
        if lease['create_state'] == 'requested' and len(rows) == 1:
            self._match(rows[0], spec)
            if (type(rows[0].get('CreateTime')) is not int
                    or rows[0]['CreateTime'] < int(datetime.fromisoformat(lease['created_at']).timestamp())):
                raise AppError(409, 'cloud_instance_conflict', 'Creation predates this reservation or is unverified')
            self.leases.bind_instance(token, lease['create_operation_id'], rows[0]['UHostId'])
        return self._state(token)

    def observe(self, token):
        """Read one exact provider instance and retain only verified state facts."""
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released' or lease['create_state'] != 'bound' or not intent:
            return {**result, 'observation': None, 'absent': None}
        rows = self._observe(lease, InstanceSpec(**intent['spec']))
        observation = rows[0] if rows else None
        if observation and observation['State'] == 'Stopped':
            self.leases.record_instance_stopped(token, lease['provider_instance_id'])
        return {**self._state(token), 'observation': observation, 'absent': not rows}

    def start(self, token):
        """Request start for a verified bound environment; never infer success."""
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released':
            raise AppError(409, 'gpu_lease_released', 'The GPU lease is already released')
        if lease['create_state'] != 'bound' or not intent:
            raise AppError(409, 'cloud_instance_not_bound', 'Bind a verified instance before starting it')
        if intent['terminate_requested'] or lease['cleanup_policy'] is not None:
            raise AppError(409, 'cloud_instance_cleanup_started', 'An instance awaiting cleanup cannot be started')
        rows = self._observe(lease, InstanceSpec(**intent['spec']))
        if not rows:
            raise AppError(409, 'cloud_instance_not_found', 'The bound instance is not present at the provider')
        observation = rows[0]
        if observation['State'] == 'Running':
            return {**result, 'observation': observation}
        if observation['State'] != 'Stopped':
            raise AppError(409, 'cloud_instance_transition_conflict',
                           'Only a stopped provider instance can be started')
        self._fact(token, 'start_requested')
        self.provider.start({
            'Region': intent['spec']['region'],
            'Zone': intent['spec']['zone'],
            'UHostId': lease['provider_instance_id'],
        })
        return {**self._state(token), 'observation': observation, 'requested_state': 'Running'}

    def stop(self, token):
        """Stop a verified environment while retaining its instance and lease."""
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released':
            raise AppError(409, 'gpu_lease_released', 'The GPU lease is already released')
        if lease['create_state'] != 'bound' or not intent:
            raise AppError(409, 'cloud_instance_not_bound', 'Bind a verified instance before stopping it')
        if intent['terminate_requested'] or lease['cleanup_policy'] is not None:
            raise AppError(409, 'cloud_instance_cleanup_started', 'Termination already owns this instance')
        rows = self._observe(lease, InstanceSpec(**intent['spec']))
        if not rows:
            raise AppError(409, 'cloud_instance_not_found', 'The bound instance is not present at the provider')
        observation = rows[0]
        if observation['State'] == 'Stopped':
            self.leases.record_instance_stopped(token, lease['provider_instance_id'])
            return {**self._state(token), 'observation': observation}
        if observation['State'] != 'Running':
            raise AppError(409, 'cloud_instance_transition_conflict',
                           'Only a running provider instance can be stopped')
        self._fact(token, 'stop_requested')
        self.provider.stop({
            'Region': intent['spec']['region'],
            'Zone': intent['spec']['zone'],
            'UHostId': lease['provider_instance_id'],
        })
        return {**self._state(token), 'observation': observation, 'requested_state': 'Stopped'}

    def reset_password(self, token, new_password):
        """Rotate the provider password without persisting either password."""
        if (not isinstance(new_password, str) or not 8 <= len(new_password) <= 128
                or any(character.isspace() for character in new_password)):
            raise AppError(422, 'validation_error', 'Reset password does not meet the transport contract')
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released' or lease['create_state'] != 'bound' or not intent:
            raise AppError(409, 'cloud_instance_not_bound', 'A bound instance is required for password reset')
        if lease['cleanup_policy'] is not None or intent['terminate_requested']:
            raise AppError(409, 'cloud_instance_cleanup_started', 'An instance awaiting cleanup cannot reset credentials')
        import base64
        self.provider.reset_password({
            'Region': intent['spec']['region'],
            'Zone': intent['spec']['zone'],
            'UHostId': lease['provider_instance_id'],
            'Password': base64.b64encode(new_password.encode('ascii')).decode('ascii'),
        })
        return {'state': 'requested', 'instance_id': lease['provider_instance_id']}

    @staticmethod
    def _match(row, spec):
        expected = {'Region': spec.region, 'Zone': spec.zone, 'GpuType': spec.gpu_type,
            'GPU': 1, 'CPU': spec.cpu, 'Memory': spec.memory_mb, 'CompShareImageId': spec.image_id}
        if any(row.get(key) != value for key, value in expected.items()):
            raise AppError(409, 'cloud_instance_conflict', 'Provider instance does not match the creation snapshot')

    def _observe(self, lease, spec):
        response = self.provider.query('DescribeCompShareInstance',
            {'Region': spec.region, 'Zone': spec.zone, 'UHostIds': [lease['provider_instance_id']],
             'Limit': 100, 'Offset': 0})
        rows = response.get('UHostSet')
        if (not isinstance(rows, list) or type(response.get('TotalCount')) is not int
                or response['TotalCount'] != len(rows) or len(rows) > 1):
            raise AppError(502, 'cloud_invalid_response', 'Incomplete exact instance query')
        if rows:
            rows = self._validated_rows(rows)
            self._match(rows[0], spec)
            if len(rows) != 1 or rows[0]['UHostId'] != lease['provider_instance_id']:
                raise AppError(409, 'cloud_instance_conflict', 'Query did not identify the bound instance')
        return rows

    def _fact(self, token, column):
        # Column names are fixed by this module. Commit before provider dispatch.
        with self.leases.pool.connection() as c:
            self.leases._locked(c, token)
            c.execute('UPDATE ucloud_instance_intents SET '+column+'=true WHERE reservation_id=%s',
                      (token.reservation_id,))

    def cleanup(self, token, policy):
        if policy not in ('discard', 'outputs_persisted'):
            raise AppError(422, 'validation_error', 'Use an explicit cleanup policy')
        result = self._state(token)
        lease, intent = result['lease'], result['intent']
        if lease['state'] == 'released':
            return result
        if not intent:
            raise AppError(409, 'gpu_instance_intent_missing', 'This reservation has no adapter creation snapshot')
        self.leases.allow_cleanup(token, policy)
        spec = InstanceSpec(**intent['spec'])
        rows = self._observe(lease, spec)
        if not rows:
            return self.reconcile(token)
        params = {'Region': spec.region, 'Zone': spec.zone, 'UHostId': lease['provider_instance_id']}
        if rows[0]['State'] == 'Running':
            self._fact(token, 'stop_requested')
            self.provider.stop(params)
        elif rows[0]['State'] == 'Stopped':
            self.leases.record_instance_stopped(token, lease['provider_instance_id'])
            self._fact(token, 'terminate_requested')
            try:
                self.provider.terminate({**params, 'ReleaseUDisk': False})
            except AppError:
                self.leases.record_deletion(token, lease['provider_instance_id'], confirmed=False)
                raise
            self._fact(token, 'terminate_acknowledged')
        return self._state(token)

    @staticmethod
    def _validated_rows(rows):
        try:
            return [ObservedInstance.model_validate(row).model_dump() for row in rows]
        except (ValidationError, TypeError, ValueError):
            raise AppError(502, 'cloud_invalid_response', 'Invalid provider instance fields') from None

    def bind_manual(self, token, spec, instance_id, *, acknowledge_cleanup):
        """Explicit human association; no creation dispatch or silent adoption."""
        if acknowledge_cleanup is not True:
            raise AppError(422, 'manual_binding_ack_required', 'Confirm ownership and platform stop/delete management')
        try:
            spec = InstanceSpec.model_validate(spec.model_dump(warnings=False))
        except Exception:
            raise AppError(422, 'validation_error', 'Use a validated InstanceSpec') from None
        self.leases._identifier(instance_id)
        with self.leases.pool.connection() as c:
            self.leases._locked(c, token)
        rows = self._observe({'provider_instance_id': instance_id}, spec)
        if len(rows) != 1 or rows[0]['State'] != 'Running':
            raise AppError(409, 'manual_instance_not_running', 'Select an exact Running instance matching the requested specification')
        import uuid
        with self.leases.pool.connection() as c:
            lease = self.leases._locked(c, token)
            existing = c.execute('SELECT * FROM ucloud_instance_intents WHERE reservation_id=%s', (token.reservation_id,)).fetchone()
            if existing:
                if (existing['binding_mode'] == 'manual' and lease['provider_instance_id'] == instance_id
                        and existing['spec'] == spec.model_dump()): return self.leases._snapshot(c, lease)
                raise AppError(409, 'manual_binding_conflict', 'Reservation already has an instance operation')
            if lease['create_state'] != 'not_requested':
                raise AppError(409, 'manual_binding_conflict', 'Reservation already has an instance operation')
            if c.execute('SELECT id FROM gpu_reservations WHERE provider_instance_id=%s', (instance_id,)).fetchone():
                raise AppError(409, 'manual_binding_conflict', 'Instance was already associated with a platform execution')
            c.execute('''INSERT INTO ucloud_instance_intents(reservation_id,label,spec,binding_mode,manually_bound_at)
                VALUES (%s,%s,%s,'manual',now())''',
                (token.reservation_id, 'mf-manual-'+token.reservation_id.hex, Jsonb(spec.model_dump())))
            return self.leases._update(c, lease, 'instance_bound', create_operation_id=uuid.uuid4(),
                create_state='bound', provider_instance_id=instance_id, region=spec.region, instance_state='unknown')
