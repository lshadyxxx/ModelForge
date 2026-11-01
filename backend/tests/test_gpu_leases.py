"""Real disposable PostgreSQL; all instance/process observations are synthetic."""
import os
import uuid

import pytest

from modelforge.errors import AppError
from modelforge.infrastructure.postgres import create_pool
from modelforge.modules.resources import GpuLeases, LeaseToken
from modelforge.settings import Settings

if os.getenv('MF_TEST_LEASE_INTEGRATION') == '1':
    if (os.getenv('MF_TEST_ISOLATED_STORES') != '1'
            or not os.getenv('MF_PG_DATABASE', '').startswith('modelforge_test_')):
        raise pytest.UsageError('GPU lease tests require an explicitly disposable database')

pytestmark = pytest.mark.skipif(os.getenv('MF_TEST_LEASE_INTEGRATION') != '1',
                                reason='Requires disposable PostgreSQL')


@pytest.fixture
def leases():
    pool = create_pool(Settings()); pool.open(wait=True)
    with pool.connection() as connection:
        connection.execute('TRUNCATE gpu_lease_events, gpu_slots, gpu_reservations RESTART IDENTITY CASCADE')
        connection.execute('INSERT INTO gpu_slots(id) VALUES (1)')
    yield GpuLeases(pool)
    pool.close()


def test_training_and_inference_share_one_gpu(leases):
    leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.reserve('trial', uuid.uuid4())
    assert caught.value.code == 'gpu_busy'


def test_repeating_reservation_for_same_attempt_is_idempotent(leases):
    owner = uuid.uuid4()
    first = leases.reserve('attempt', owner)
    assert leases.reserve('attempt', owner) == first


def test_reservation_and_event_survive_new_module_instance(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    reopened = GpuLeases(leases.pool)
    current = reopened.current()
    assert current['id'] == str(token.reservation_id)
    assert current['state'] == 'held'
    assert current['owner_id'] == str(token.owner_id)
    assert current['generation'] == token.generation
    assert current['create_state'] == 'not_requested'
    assert [event['action'] for event in reopened.get(token.reservation_id)['events']] == ['reserved']


def test_wrong_generation_cannot_renew(leases):
    from dataclasses import replace
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.renew(replace(token, generation=token.generation+1))
    assert caught.value.code == 'stale_gpu_lease'


def test_wrong_owner_cannot_renew(leases):
    from dataclasses import replace
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.renew(replace(token, owner_id=uuid.uuid4()))
    assert caught.value.code == 'stale_gpu_lease'


def test_unused_reservation_releases_and_next_owner_has_a_new_generation(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.release(token)
    assert leases.current() is None
    assert leases.get(token.reservation_id)['state'] == 'released'
    next_token = leases.reserve('trial', uuid.uuid4())
    assert next_token.generation == token.generation+1
    with pytest.raises(AppError) as caught:
        leases.renew(token)
    assert caught.value.code == 'stale_gpu_lease'


def test_a_completed_attempt_cannot_start_a_second_reservation(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.release(token)
    with pytest.raises(AppError) as caught:
        leases.reserve('attempt', token.owner_id)
    assert caught.value.code == 'gpu_owner_completed'


def test_uncertain_create_reuses_intent_and_never_dispatches_twice(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    first = leases.begin_creation(token, 'fixture-region')
    assert first['dispatch'] is True
    again = GpuLeases(leases.pool).begin_creation(token, 'fixture-region')
    assert again['dispatch'] is False
    assert again['operation_id'] == first['operation_id']
    assert leases.current()['create_state'] == 'requested'


def test_create_timeout_cannot_free_gpu(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.release(token)
    assert caught.value.code == 'gpu_release_unverified'
    with pytest.raises(AppError) as busy:
        leases.reserve('trial', uuid.uuid4())
    assert busy.value.code == 'gpu_busy'


def test_creation_cannot_silently_change_region(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.begin_creation(token, 'other-region')
    assert caught.value.code == 'gpu_creation_conflict'


def test_positive_instance_observation_resolves_create_intent(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    creation = leases.begin_creation(token, 'fixture-region')
    row = leases.bind_instance(token, creation['operation_id'], 'fixture-instance')
    assert row['provider_instance_id'] == 'fixture-instance'
    assert row['create_state'] == 'bound'
    assert row['instance_state'] == 'unknown'
    assert leases.bind_instance(token, creation['operation_id'], 'fixture-instance')['id'] == row['id']


def test_unrelated_create_operation_cannot_claim_instance(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.bind_instance(token, str(uuid.uuid4()), 'fixture-instance')
    assert caught.value.code == 'gpu_creation_conflict'
    assert leases.current()['provider_instance_id'] is None


def bound(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    creation = leases.begin_creation(token, 'fixture-region')
    leases.bind_instance(token, creation['operation_id'], 'fixture-instance')
    return token, creation


def test_existing_instance_identity_cannot_be_overwritten(leases):
    token, creation = bound(leases)
    with pytest.raises(AppError) as caught:
        leases.bind_instance(token, creation['operation_id'], 'different-instance')
    assert caught.value.code == 'gpu_creation_conflict'
    assert leases.current()['provider_instance_id'] == 'fixture-instance'


def test_dispatch_records_process_unknown_before_remote_execution(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    current = leases.current()
    assert current['process_state'] == 'unknown'
    assert current['exit_code'] is None


def test_confirmed_process_exit_is_separate_from_instance_deletion(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 0)
    current = leases.current()
    assert current['process_state'] == 'exited' and current['exit_code'] == 0
    assert current['instance_state'] == 'unknown'
    assert current['state'] == 'held'


def test_unknown_process_blocks_cleanup(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    with pytest.raises(AppError) as caught:
        leases.allow_cleanup(token, 'discard')
    assert caught.value.code == 'gpu_process_unverified'


def test_successful_but_unsynced_outputs_block_discard(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 0)
    with pytest.raises(AppError) as caught:
        leases.allow_cleanup(token, 'discard')
    assert caught.value.code == 'gpu_outputs_unverified'
    assert leases.current()['cleanup_state'] == 'not_requested'
    assert leases.allow_cleanup(token, 'outputs_persisted')['cleanup_state'] == 'pending'


def test_instance_stop_does_not_mean_process_exit_or_deleted_instance(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_instance_stopped(token, 'fixture-instance')
    row = leases.current()
    assert row['instance_state'] == 'stopped'
    assert row['process_state'] == 'unknown'
    with pytest.raises(AppError) as caught:
        leases.release(token)
    assert caught.value.code == 'gpu_release_unverified'


def test_delete_failure_retains_instance_and_occupancy(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=False)
    row = leases.current()
    assert row['cleanup_state'] == 'failed'
    assert row['cleanup_error_code'] == 'instance_delete_failed'
    assert row['provider_instance_id'] == 'fixture-instance'
    assert row['state'] == 'held'
    with pytest.raises(AppError) as caught:
        leases.reserve('trial', uuid.uuid4())
    assert caught.value.code == 'gpu_busy'


def test_confirmed_delete_can_be_retried_and_release_is_fenced_and_idempotent(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=False)
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    leases.release(token)
    assert leases.current() is None
    row = leases.get(token.reservation_id)
    assert row['cleanup_error_code'] is None and row['instance_state'] == 'deleted'
    next_token = leases.reserve('trial', uuid.uuid4())
    leases.release(token)
    assert leases.current()['id'] == str(next_token.reservation_id)


def test_unrelated_instance_cannot_supply_process_exit(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    with pytest.raises(AppError) as caught:
        leases.record_process_exit(token, 'wrong-instance', 0)
    assert caught.value.code == 'gpu_instance_conflict'
    assert leases.current()['process_state'] == 'unknown'


def test_unrelated_instance_deletion_cannot_free_gpu(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    with pytest.raises(AppError) as caught:
        leases.record_deletion(token, 'wrong-instance', confirmed=True)
    assert caught.value.code == 'gpu_instance_conflict'
    assert leases.current()['instance_state'] == 'unknown'


def test_unrelated_instance_stop_cannot_change_facts(leases):
    token, _ = bound(leases)
    with pytest.raises(AppError) as caught:
        leases.record_instance_stopped(token, 'wrong-instance')
    assert caught.value.code == 'gpu_instance_conflict'
    assert leases.current()['instance_state'] == 'unknown'


def test_deletion_requires_cleanup_authorization(leases):
    token, _ = bound(leases)
    with pytest.raises(AppError) as caught:
        leases.record_deletion(token, 'fixture-instance', confirmed=True)
    assert caught.value.code == 'gpu_cleanup_unverified'
    assert leases.current()['cleanup_state'] == 'not_requested'


def test_cleanup_authorization_blocks_new_execution(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    with pytest.raises(AppError) as caught:
        leases.execution_requested(token)
    assert caught.value.code == 'gpu_execution_conflict'
    assert leases.current()['process_state'] == 'not_started'


def test_confirmed_delete_is_not_reversed_by_a_late_failure(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    row = leases.record_deletion(token, 'fixture-instance', confirmed=False)
    assert row['cleanup_state'] == 'confirmed' and row['cleanup_error_code'] is None
    leases.release(token)
    assert leases.current() is None


def test_late_stop_or_cleanup_retry_does_not_reverse_confirmed_deletion(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    leases.record_instance_stopped(token, 'fixture-instance')
    leases.allow_cleanup(token, 'discard')
    row = leases.current()
    assert row['instance_state'] == 'deleted' and row['cleanup_state'] == 'confirmed'


def test_recorded_exit_cannot_be_overwritten_by_conflicting_result(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 0)
    with pytest.raises(AppError) as caught:
        leases.record_process_exit(token, 'fixture-instance', 1)
    assert caught.value.code == 'gpu_exit_conflict'
    assert leases.current()['exit_code'] == 0


def test_exited_execution_cannot_be_restarted_under_same_reservation(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 1)
    with pytest.raises(AppError) as caught:
        leases.execution_requested(token)
    assert caught.value.code == 'gpu_execution_conflict'


def test_string_uuid_owner_is_normalized_for_idempotency(leases):
    owner = uuid.uuid4()
    first = leases.reserve('attempt', str(owner))
    assert leases.reserve('attempt', owner) == first
    assert first.owner_id == owner


def test_invalid_owner_kind_returns_clear_validation_error(leases):
    with pytest.raises(AppError) as caught:
        leases.reserve('training', uuid.uuid4())
    assert caught.value.code == 'validation_error'
    assert leases.current() is None


def test_invalid_owner_uuid_returns_clear_validation_error(leases):
    with pytest.raises(AppError) as caught:
        leases.reserve('attempt', 'not-a-uuid')
    assert caught.value.code == 'validation_error'


def test_invalid_region_does_not_persist_creation_intent(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.begin_creation(token, ' ')
    assert caught.value.code == 'validation_error'
    assert leases.current()['create_state'] == 'not_requested'


def test_blank_instance_cannot_resolve_uncertain_creation(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    creation = leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.bind_instance(token, creation['operation_id'], '')
    assert caught.value.code == 'validation_error'
    assert leases.current()['create_state'] == 'requested'


def test_execution_requires_bound_instance(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.execution_requested(token)
    assert caught.value.code == 'gpu_execution_conflict'


def test_exit_fact_requires_prior_execution_intent(leases):
    token, _ = bound(leases)
    with pytest.raises(AppError) as caught:
        leases.record_process_exit(token, 'fixture-instance', 0)
    assert caught.value.code == 'gpu_exit_conflict'


def test_cleanup_requires_bound_instance(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    leases.begin_creation(token, 'fixture-region')
    with pytest.raises(AppError) as caught:
        leases.allow_cleanup(token, 'discard')
    assert caught.value.code == 'gpu_creation_unverified'


def test_invalid_cleanup_policy_is_rejected_without_partial_write(leases):
    token, _ = bound(leases)
    with pytest.raises(AppError) as caught:
        leases.allow_cleanup(token, 'force')
    assert caught.value.code == 'validation_error'
    assert leases.current()['cleanup_policy'] is None


def test_deletion_confirmation_must_be_a_boolean(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    with pytest.raises(AppError) as caught:
        leases.record_deletion(token, 'fixture-instance', confirmed='false')
    assert caught.value.code == 'validation_error'
    assert leases.current()['cleanup_state'] == 'pending'


def test_exit_code_must_be_an_integer_and_not_a_boolean(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    with pytest.raises(AppError) as caught:
        leases.record_process_exit(token, 'fixture-instance', False)
    assert caught.value.code == 'validation_error'
    assert leases.current()['process_state'] == 'unknown'


def test_simultaneous_training_and_trial_reservations_have_one_winner(leases):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(4)
    def reserve(index):
        barrier.wait(timeout=5)
        try:
            return leases.reserve('attempt' if index % 2 else 'trial', uuid.uuid4())
        except AppError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(reserve, range(4)))
    assert sum(isinstance(result, LeaseToken) for result in results) == 1
    assert results.count('gpu_busy') == 3
    winner = next(result for result in results if isinstance(result, LeaseToken))
    assert leases.current()['id'] == str(winner.reservation_id)


def test_same_owner_concurrent_reservations_return_the_same_token(leases):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(4); owner = uuid.uuid4()
    def reserve(index):
        barrier.wait(timeout=5)
        return leases.reserve('trial', owner)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(reserve, range(4)))
    assert len(set(results)) == 1


def test_pool_restart_and_old_heartbeat_do_not_free_uncertain_instance(leases):
    from datetime import timedelta
    token = leases.reserve('attempt', uuid.uuid4())
    creation = leases.begin_creation(token, 'fixture-region')
    # Deliberate clock fixture, not a fabricated business lifecycle.
    with leases.pool.connection() as connection:
        connection.execute("UPDATE gpu_reservations SET heartbeat_at=heartbeat_at-interval '2 days' WHERE id=%s",
                           (token.reservation_id,))
    reopened_pool = create_pool(Settings()); reopened_pool.open(wait=True)
    try:
        reopened = GpuLeases(reopened_pool)
        assert reopened.reserve('attempt', token.owner_id) == token
        assert reopened.begin_creation(token, 'fixture-region') == {
            'dispatch': False, 'operation_id': creation['operation_id']}
        with pytest.raises(AppError) as caught:
            reopened.reserve('trial', uuid.uuid4())
        assert caught.value.code == 'gpu_busy'
        assert reopened.current()['create_state'] == 'requested'
        renewed = reopened.renew(token)
        assert renewed['heartbeat_at'] > renewed['created_at']
    finally:
        reopened_pool.close()


def test_wrong_owner_kind_cannot_modify_same_uuid_reservation(leases):
    from dataclasses import replace
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.renew(replace(token, owner_kind='trial'))
    assert caught.value.code == 'stale_gpu_lease'


def test_missing_reservation_returns_not_found(leases):
    with pytest.raises(AppError) as caught:
        leases.get(uuid.uuid4())
    assert caught.value.code == 'gpu_reservation_not_found'


def test_each_lifecycle_mutation_rejects_the_previous_generation(leases):
    from dataclasses import replace
    token, creation = bound(leases)
    forged = replace(token, generation=token.generation+1)
    mutations = [
        lambda: leases.renew(forged),
        lambda: leases.begin_creation(forged, 'fixture-region'),
        lambda: leases.bind_instance(forged, creation['operation_id'], 'fixture-instance'),
        lambda: leases.execution_requested(forged),
        lambda: leases.record_process_exit(forged, 'fixture-instance', 1),
        lambda: leases.allow_cleanup(forged, 'discard'),
        lambda: leases.record_instance_stopped(forged, 'fixture-instance'),
        lambda: leases.record_deletion(forged, 'fixture-instance', confirmed=True),
        lambda: leases.release(forged),
    ]
    before = leases.current()
    for mutation in mutations:
        with pytest.raises(AppError) as caught:
            mutation()
        assert caught.value.code == 'stale_gpu_lease'
    assert leases.current() == before


def test_failed_execution_can_discard_and_release_after_confirmed_deletion(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 137)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    leases.release(token)
    assert leases.current() is None
    assert leases.get(token.reservation_id)['exit_code'] == 137


def test_successful_outputs_release_only_after_persisted_and_deleted(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    leases.record_process_exit(token, 'fixture-instance', 0)
    leases.allow_cleanup(token, 'outputs_persisted')
    with pytest.raises(AppError) as caught:
        leases.release(token)
    assert caught.value.code == 'gpu_release_unverified'
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    leases.release(token)
    assert leases.current() is None
    assert leases.get(token.reservation_id)['cleanup_policy'] == 'outputs_persisted'


def test_boolean_generation_is_not_a_valid_fencing_token(leases):
    from dataclasses import replace
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.renew(replace(token, generation=True))
    assert caught.value.code == 'validation_error'


def test_bind_requires_a_persisted_creation_operation(leases):
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        leases.bind_instance(token, None, 'fixture-instance')
    assert caught.value.code == 'gpu_creation_conflict'
    assert leases.current()['create_state'] == 'not_requested'


def test_simultaneous_creation_requests_dispatch_at_most_once(leases):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    token = leases.reserve('attempt', uuid.uuid4()); barrier = Barrier(4)
    def begin(index):
        barrier.wait(timeout=5)
        return leases.begin_creation(token, 'fixture-region')
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(begin, range(4)))
    assert sum(result['dispatch'] for result in results) == 1
    assert len({result['operation_id'] for result in results}) == 1


def test_same_process_exit_is_idempotent(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    first = leases.record_process_exit(token, 'fixture-instance', -15)
    assert leases.record_process_exit(token, 'fixture-instance', -15) == first


def test_unknown_execution_cannot_be_dispatched_a_second_time(leases):
    token, _ = bound(leases)
    leases.execution_requested(token)
    with pytest.raises(AppError) as caught:
        leases.execution_requested(token)
    assert caught.value.code == 'gpu_execution_conflict'
    assert leases.current()['process_state'] == 'unknown'


def test_confirmed_delete_does_not_allow_execution(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    leases.record_deletion(token, 'fixture-instance', confirmed=True)
    with pytest.raises(AppError) as caught:
        leases.execution_requested(token)
    assert caught.value.code == 'gpu_execution_conflict'


def test_switching_cleanup_policy_does_not_reverse_confirmed_deletion(leases):
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    before = leases.record_deletion(token, 'fixture-instance', confirmed=True)
    after = leases.allow_cleanup(token, 'outputs_persisted')
    assert after == before
    leases.release(token)
    assert leases.current() is None


def validation_code(action):
    try:
        action()
    except AppError as error:
        return error.code
    except Exception as error:
        return type(error).__name__
    return None


def test_unhashable_owner_kind_is_a_clear_validation_error(leases):
    assert validation_code(lambda: leases.reserve([], uuid.uuid4())) == 'validation_error'
    assert leases.current() is None


def test_unhashable_cleanup_policy_is_a_clear_validation_error(leases):
    token, _ = bound(leases)
    before = leases.current()
    assert validation_code(lambda: leases.allow_cleanup(token, [])) == 'validation_error'
    assert leases.current() == before


def test_malformed_reservation_identity_is_a_clear_validation_error(leases):
    assert validation_code(lambda: leases.get('not-a-uuid')) == 'validation_error'
    assert leases.current() is None


def read_during_committed_deletion(leases, mode):
    from contextlib import contextmanager
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    token, _ = bound(leases)
    leases.allow_cleanup(token, 'discard')
    selected, resume = Event(), Event()

    class ReadGate:
        def __init__(self, connection):
            self.connection = connection
            self.first_read = True

        def execute(self, sql, *args, **kwargs):
            cursor = self.connection.execute(sql, *args, **kwargs)
            if self.first_read and sql.lstrip().startswith('SELECT'):
                self.first_read = False
                selected.set()
                assert resume.wait(10)
            return cursor

    class ReaderPool:
        @contextmanager
        def connection(self):
            with leases.pool.connection() as connection:
                yield ReadGate(connection)

    reader = GpuLeases(ReaderPool())
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(reader.current if mode == 'current'
                                 else lambda: reader.get(token.reservation_id))
        try:
            assert selected.wait(10)
            leases.record_deletion(token, 'fixture-instance', confirmed=True)
        finally:
            resume.set()
        observed = future.result(timeout=10)
    assert observed['cleanup_state'] == 'pending'
    assert 'deletion_confirmed' not in [event['action'] for event in observed['events']]
    assert leases.get(token.reservation_id)['cleanup_state'] == 'confirmed'


def test_current_returns_state_and_events_from_one_snapshot(leases):
    read_during_committed_deletion(leases, 'current')


def test_get_returns_state_and_events_from_one_snapshot(leases):
    read_during_committed_deletion(leases, 'get')


def test_non_token_input_is_a_clear_validation_error_without_writes(leases):
    token, _ = bound(leases)
    before = leases.current()
    assert validation_code(lambda: leases.renew(None)) == 'validation_error'
    assert leases.current() == before
