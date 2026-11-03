"""Server-only GPU lease contract. No provider operations are dispatched here."""
from dataclasses import dataclass
import uuid

from modelforge.errors import AppError


@dataclass(frozen=True)
class LeaseToken:
    reservation_id: uuid.UUID
    owner_kind: str
    owner_id: uuid.UUID
    generation: int

    def __post_init__(self):
        if (not isinstance(self.reservation_id, uuid.UUID)
                or not isinstance(self.owner_id, uuid.UUID)
                or self.owner_kind not in ('attempt', 'trial', 'environment')
                or type(self.generation) is not int or not 1 <= self.generation < 2**63):
            raise AppError(422, 'validation_error', 'Use a valid UUID owner and positive integer lease generation')


class GpuLeases:
    def __init__(self, pool):
        self.pool = pool

    def reserve(self, owner_kind, owner_id):
        if owner_kind not in ('attempt', 'trial', 'environment'):
            raise AppError(422, 'validation_error', 'Owner kind must be attempt, trial or environment')
        try:
            owner_id = uuid.UUID(str(owner_id))
        except (ValueError, TypeError, AttributeError) as error:
            raise AppError(422, 'validation_error', 'Owner identity must be a UUID') from error
        with self.pool.connection() as connection:
            slot = connection.execute('SELECT * FROM gpu_slots WHERE id=1 FOR UPDATE').fetchone()
            if slot['reservation_id'] is not None:
                row = connection.execute('SELECT * FROM gpu_reservations WHERE id=%s',
                                         (slot['reservation_id'],)).fetchone()
                if row['owner_kind'] == owner_kind and row['owner_id'] == owner_id:
                    return LeaseToken(row['id'], owner_kind, owner_id, row['generation'])
                raise AppError(409, 'gpu_busy', 'GPU is reserved or awaiting reconciliation')
            previous = connection.execute(
                'SELECT id FROM gpu_reservations WHERE owner_kind=%s AND owner_id=%s',
                (owner_kind, owner_id)).fetchone()
            if previous is not None:
                raise AppError(409, 'gpu_owner_completed', 'Use a new Attempt or trial identity')
            identifier = uuid.uuid4()
            generation = slot['generation'] + 1
            connection.execute("""INSERT INTO gpu_reservations(id,owner_kind,owner_id,generation)
                VALUES (%s,%s,%s,%s)""", (identifier, owner_kind, owner_id, generation))
            connection.execute('UPDATE gpu_slots SET generation=%s,reservation_id=%s WHERE id=1',
                               (generation, identifier))
            connection.execute("INSERT INTO gpu_lease_events(reservation_id,action) VALUES (%s,'reserved')",
                               (identifier,))
            return LeaseToken(identifier, owner_kind, owner_id, generation)

    @staticmethod
    def _snapshot(connection, row):
        result = {key: str(value) if isinstance(value, uuid.UUID) else
                  value.isoformat() if hasattr(value, 'isoformat') else value
                  for key, value in row.items()}
        events = connection.execute("""SELECT action,recorded_at FROM gpu_lease_events
            WHERE reservation_id=%s ORDER BY id""", (row['id'],)).fetchall()
        result['events'] = [{'action': event['action'], 'recorded_at': event['recorded_at'].isoformat()}
                            for event in events]
        return result

    def current(self):
        with self.pool.connection() as connection:
            connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            row = connection.execute("""SELECT r.* FROM gpu_slots s
                JOIN gpu_reservations r ON r.id=s.reservation_id WHERE s.id=1""").fetchone()
            return self._snapshot(connection, row) if row else None

    def get(self, reservation_id):
        try:
            reservation_id = uuid.UUID(str(reservation_id))
        except (ValueError, TypeError, AttributeError) as error:
            raise AppError(422, 'validation_error', 'Reservation identity must be a UUID') from error
        with self.pool.connection() as connection:
            connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            row = connection.execute('SELECT * FROM gpu_reservations WHERE id=%s',
                                     (reservation_id,)).fetchone()
            if row is None:
                raise AppError(404, 'gpu_reservation_not_found', 'GPU reservation not found')
            return self._snapshot(connection, row)

    @staticmethod
    def _locked(connection, token, *, allow_released=False):
        if not isinstance(token, LeaseToken):
            raise AppError(422, 'validation_error', 'Use a LeaseToken for GPU lifecycle changes')
        slot = connection.execute('SELECT * FROM gpu_slots WHERE id=1 FOR UPDATE').fetchone()
        row = connection.execute('SELECT * FROM gpu_reservations WHERE id=%s FOR UPDATE',
                                 (token.reservation_id,)).fetchone()
        if (row is None or row['generation'] != token.generation
                or row['owner_kind'] != token.owner_kind or row['owner_id'] != token.owner_id):
            raise AppError(409, 'stale_gpu_lease', 'GPU lease token no longer matches')
        if row['state'] == 'released' and allow_released:
            return row
        if (row['state'] != 'held' or slot['reservation_id'] != row['id']
                or slot['generation'] != row['generation']):
            raise AppError(409, 'stale_gpu_lease', 'GPU lease token no longer matches')
        return row

    def _update(self, connection, row, action, **fields):
        # Column names originate only in this module, never in caller data.
        names = ','.join(name+'=%s' for name in fields)
        row = connection.execute('UPDATE gpu_reservations SET '+names+' WHERE id=%s RETURNING *',
                                 (*fields.values(), row['id'])).fetchone()
        connection.execute('INSERT INTO gpu_lease_events(reservation_id,action) VALUES (%s,%s)',
                           (row['id'], action))
        return self._snapshot(connection, row)

    def renew(self, token):
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            now = connection.execute('SELECT clock_timestamp() AS now').fetchone()['now']
            return self._update(connection, row, 'renewed', heartbeat_at=now)

    def release(self, token):
        with self.pool.connection() as connection:
            row = self._locked(connection, token, allow_released=True)
            if row['state'] == 'released':
                return self._snapshot(connection, row)
            if (row['create_state'] != 'not_requested' and not (
                    row['create_state'] == 'bound' and row['instance_state'] == 'deleted'
                    and row['cleanup_state'] == 'confirmed' and row['cleanup_policy'] is not None
                    and row['process_state'] != 'unknown')):
                raise AppError(409, 'gpu_release_unverified', 'Instance release is not verified')
            now = connection.execute('SELECT clock_timestamp() AS now').fetchone()['now']
            result = self._update(connection, row, 'released', state='released', released_at=now)
            connection.execute('UPDATE gpu_slots SET reservation_id=NULL WHERE id=1')
            return result

    @staticmethod
    def _identifier(value):
        if (not isinstance(value, str) or not 1 <= len(value) <= 255
                or any(c.isspace() or not c.isprintable() for c in value)):
            raise AppError(422, 'validation_error', 'Use a nonempty printable identifier of at most 255 characters')
        return value

    def begin_creation(self, token, region):
        self._identifier(region)
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            if row['create_operation_id'] is not None:
                if row['region'] != region:
                    raise AppError(409, 'gpu_creation_conflict', 'Creation region is already fixed')
                return {'dispatch': False, 'operation_id': str(row['create_operation_id'])}
            operation = uuid.uuid4()
            self._update(connection, row, 'creation_requested', create_operation_id=operation,
                         create_state='requested', region=region, instance_state='unknown')
            return {'dispatch': True, 'operation_id': str(operation)}

    def bind_instance(self, token, operation_id, instance_id):
        self._identifier(instance_id)
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            if row['create_operation_id'] is None or str(row['create_operation_id']) != str(operation_id):
                raise AppError(409, 'gpu_creation_conflict', 'Creation operation does not match')
            if row['provider_instance_id'] == instance_id:
                return self._snapshot(connection, row)
            if row['provider_instance_id'] is not None:
                raise AppError(409, 'gpu_creation_conflict', 'Instance identity is already fixed')
            return self._update(connection, row, 'instance_bound', provider_instance_id=instance_id,
                                create_state='bound')

    def execution_requested(self, token):
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            if (row['cleanup_policy'] is not None or row['process_state'] != 'not_started'
                    or row['create_state'] != 'bound' or row['instance_state'] != 'unknown'):
                raise AppError(409, 'gpu_execution_conflict', 'Execution is already requested or unavailable')
            return self._update(connection, row, 'execution_requested', process_state='unknown')

    @staticmethod
    def _instance(row, instance_id):
        if row['create_state'] != 'bound' or row['provider_instance_id'] != instance_id:
            raise AppError(409, 'gpu_instance_conflict', 'Observation does not match the bound instance')

    def record_process_exit(self, token, instance_id, exit_code, *, cancelled=False):
        if type(cancelled) is not bool: raise AppError(422, 'validation_error', 'Cancellation must be a confirmed boolean fact')
        if type(exit_code) is not int or not -(2**31) <= exit_code < 2**31:
            raise AppError(422, 'validation_error', 'Exit code must be a signed 32-bit integer')
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            self._instance(row, instance_id)
            if row['process_state'] == 'not_started':
                raise AppError(409, 'gpu_exit_conflict', 'Execution was never requested')
            if row['process_state'] == 'exited':
                if row['exit_code'] != exit_code or row.get('process_cancelled',False) != cancelled:
                    raise AppError(409, 'gpu_exit_conflict', 'A different process exit was already recorded')
                return self._snapshot(connection, row)
            return self._update(connection, row, 'process_exited', process_state='exited', exit_code=exit_code, process_cancelled=cancelled)

    def allow_cleanup(self, token, policy):
        if policy not in ('discard', 'outputs_persisted'):
            raise AppError(422, 'validation_error', 'Cleanup requires discard or outputs_persisted')
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            if row['create_state'] != 'bound':
                raise AppError(409, 'gpu_creation_unverified', 'Resolve the creation intent first')
            if row['process_state'] == 'unknown':
                raise AppError(409, 'gpu_process_unverified', 'Remote process exit is not verified')
            if row['exit_code'] == 0 and not row.get('process_cancelled',False) and policy != 'outputs_persisted':
                raise AppError(409, 'gpu_outputs_unverified', 'Persist successful outputs before cleanup')
            if row['cleanup_state'] == 'confirmed' or row['cleanup_policy'] == policy:
                return self._snapshot(connection, row)
            return self._update(connection, row, 'cleanup_allowed', cleanup_policy=policy, cleanup_state='pending')

    def record_instance_stopped(self, token, instance_id):
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            self._instance(row, instance_id)
            if row['instance_state'] == 'deleted':
                return self._snapshot(connection, row)
            return self._update(connection, row, 'instance_stopped', instance_state='stopped')

    def record_deletion(self, token, instance_id, *, confirmed):
        if type(confirmed) is not bool:
            raise AppError(422, 'validation_error', 'Deletion confirmation must be a boolean')
        with self.pool.connection() as connection:
            row = self._locked(connection, token)
            self._instance(row, instance_id)
            if row['cleanup_state'] == 'confirmed':
                return self._snapshot(connection, row)
            if row['cleanup_policy'] is None:
                raise AppError(409, 'gpu_cleanup_unverified', 'Authorize cleanup before deletion')
            if confirmed:
                return self._update(connection, row, 'deletion_confirmed', cleanup_state='confirmed',
                                    instance_state='deleted', cleanup_error_code=None)
            return self._update(connection, row, 'deletion_failed', cleanup_state='failed',
                                cleanup_error_code='instance_delete_failed')
