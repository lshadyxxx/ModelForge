"""Real disposable PostgreSQL plus synthetic provider HTTP, never live cloud."""
import os
from datetime import datetime, timezone
import uuid
from urllib.parse import parse_qs
import httpx
import pytest
from modelforge.errors import AppError
from modelforge.infrastructure.postgres import create_pool
from modelforge.infrastructure.ucloud import UCloudInstances
from modelforge.modules.resources import GpuLeases, InstanceLifecycle, InstanceSpec
from modelforge.settings import Settings

if os.getenv('MF_TEST_LEASE_INTEGRATION') == '1':
    if (os.getenv('MF_TEST_ISOLATED_STORES') != '1'
            or not os.getenv('MF_PG_DATABASE', '').startswith('modelforge_test_')):
        raise pytest.UsageError('Lifecycle tests require an explicitly disposable database')
pytestmark = pytest.mark.skipif(os.getenv('MF_TEST_LEASE_INTEGRATION') != '1', reason='Requires disposable PostgreSQL')

SPEC = dict(region='fixture-region', zone='fixture-zone', gpu_type='fixture-gpu',
    cpu=8, memory_mb=32768, image_id='fixture-image', cpu_platform='Auto',
    charge_type='Postpay', boot_disk_gb=100, boot_disk_type='CLOUD_SSD')

@pytest.fixture
def environment():
    pool = create_pool(Settings()); pool.open(wait=True)
    with pool.connection() as c:
        c.execute('SET LOCAL statement_timeout = 0')
        c.execute('TRUNCATE gpu_lease_events, gpu_slots, gpu_reservations RESTART IDENTITY CASCADE')
        c.execute('INSERT INTO gpu_slots(id) VALUES (1)')
    leases = GpuLeases(pool)
    seen, state = [], {}
    def handler(request):
        wire = {k: v[0] for k,v in parse_qs(request.content.decode()).items()}
        seen.append(wire)
        if state.get('callback'):
            state['callback'](wire)
        action = wire['Action']
        if action == 'CheckCompShareResourceCapacity':
            data = {'Specs': state.get('capacity', [{'Gpu': 1, 'Cpu': 8, 'Mem': 32, 'ResourceEnough': True}])}
        elif action == 'CreateCompShareInstance':
            state['created_label'] = wire['Name']
            if state.get('create_timeout'):
                raise httpx.ReadTimeout('provider secret must not escape', request=request)
            data = state.get('create_result', {'UHostIds': ['fixture-instance']})
        elif action == 'StartCompShareInstance':
            data = state.get('start_result', {'UHostId': 'fixture-instance'})
        elif action == 'StopCompShareInstance':
            data = state.get('stop_result', {'UHostId': 'fixture-instance'})
        elif action == 'TerminateCompShareInstance':
            if state.get('terminate_timeout'):
                raise httpx.ReadTimeout('provider secret must not escape', request=request)
            data = state.get('terminate_result', {'UHostId': 'fixture-instance', 'InRecycle': 'No'})
        else:
            rows = state.get('instances', [])
            offset = int(wire.get('Offset', '0'))
            limit = int(wire.get('Limit', '100'))
            sequence = state.get('describe_sequence', [])
            data = (sequence.pop(0) if sequence else
                state.get('describe_result', {'TotalCount': len(rows), 'UHostSet': rows[offset:offset+limit]}))
        return httpx.Response(200, json={'Action': action+'Response', 'RetCode':0, **data})
    with httpx.Client(transport=httpx.MockTransport(handler), trust_env=False) as client:
        provider = UCloudInstances(Settings(ucloud_public_key='public-test-only', ucloud_private_key='private-test-only'), client)
        yield leases, InstanceLifecycle(leases, provider), seen, state
    pool.close()

def test_capacity_gates_creation_and_persists_one_immutable_intent(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    result = lifecycle.create(token, InstanceSpec(**SPEC))
    assert result is not None, 'Creation must bind a provider identity through the durable lease'
    assert result['lease']['provider_instance_id'] == 'fixture-instance'
    assert [r['Action'] for r in seen] == ['CheckCompShareResourceCapacity', 'CreateCompShareInstance']
    wire = seen[-1]
    assert wire['GPU'] == '1' and wire['MaxCount'] == '1'
    assert wire['Memory'] == '32768'
    assert wire['Disks.0.IsBoot'] == 'true'
    assert wire['Name'].startswith('mf-') and len(wire['Name']) <= 63
    assert result['intent']['spec'] == SPEC
    assert result['lease']['create_operation_id'] is not None
    assert lifecycle.create(token, InstanceSpec(**SPEC))['lease']['provider_instance_id'] == 'fixture-instance'
    assert len(seen) == 2, 'Repeated creation must never dispatch again'


def test_no_exact_capacity_never_dispatches_create(environment):
    leases, lifecycle, seen, state = environment
    state['capacity'] = [{'Gpu': 1, 'Cpu': 8, 'Mem': 32, 'ResourceEnough': False},
                         {'Gpu': 2, 'Cpu': 8, 'Mem': 32, 'ResourceEnough': True}]
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert caught.value.code == 'cloud_out_of_stock'
    assert [r['Action'] for r in seen] == ['CheckCompShareResourceCapacity']
    assert leases.current()['create_state'] == 'not_requested'
    assert leases.release(token)['state'] == 'released'


def instance(label, **overrides):
    row = dict(UHostId='fixture-instance', Name=label, State='Running', Region='fixture-region',
        Zone='fixture-zone', GPU=1, CPU=8, Memory=32768, GpuType='fixture-gpu',
        CompShareImageId='fixture-image', CreateTime=int(datetime.now(timezone.utc).timestamp()))
    return {**row, **overrides}

def test_lost_create_response_recovers_by_positive_observation_after_restart(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert caught.value.code == 'cloud_timeout'
    assert leases.current()['create_state'] == 'requested'
    recovered = InstanceLifecycle(GpuLeases(leases.pool), lifecycle.provider)
    assert recovered.create(token, InstanceSpec(**SPEC))['lease']['create_state'] == 'requested'
    assert len([r for r in seen if r['Action']=='CreateCompShareInstance']) == 1
    state['instances'] = [instance(state['created_label'])]
    result = recovered.reconcile(token)
    assert result['lease']['provider_instance_id'] == 'fixture-instance'
    assert result['lease']['state'] == 'held'
    assert all(r['Action'] != 'TerminateCompShareInstance' for r in seen)


def test_recovery_label_cannot_adopt_an_instance_with_wrong_spec(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], GPU=2)]
    with pytest.raises(AppError) as caught:
        lifecycle.reconcile(token)
    assert caught.value.code == 'cloud_instance_conflict'
    assert leases.current()['provider_instance_id'] is None
    assert leases.current()['state'] == 'held'


def test_recovery_scans_all_pages_and_rejects_duplicate_labels(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    rows = [instance('unrelated-'+str(i), UHostId='other-'+str(i)) for i in range(100)]
    rows[0] = instance(state['created_label'])
    rows.append(instance(state['created_label'], UHostId='duplicate-instance'))
    state['instances'] = rows
    with pytest.raises(AppError) as caught:
        lifecycle.reconcile(token)
    assert caught.value.code == 'cloud_instance_conflict'
    assert leases.current()['provider_instance_id'] is None
    assert [r['Offset'] for r in seen if r['Action']=='DescribeCompShareInstance'] == ['0', '100']


def test_cleanup_observes_stop_then_termination_before_confirming_release(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'])]
    result = lifecycle.cleanup(token, 'discard')
    assert seen[-1]['Action'] == 'StopCompShareInstance'
    assert result['intent']['stop_requested'] is True
    assert result['lease']['instance_state'] == 'unknown'
    assert result['lease']['state'] == 'held'
    state['instances'][0]['State'] = 'Stopped'
    result = lifecycle.cleanup(token, 'discard')
    assert seen[-1]['Action'] == 'TerminateCompShareInstance'
    assert seen[-1]['ReleaseUDisk'] == 'false'
    assert result['lease']['instance_state'] == 'stopped'
    assert result['intent']['terminate_acknowledged'] is True
    assert result['lease']['state'] == 'held'
    state['instances'] = []
    result = InstanceLifecycle(leases, lifecycle.provider).reconcile(token)
    assert result['lease']['state'] == 'released'
    assert leases.current() is None


def test_termination_timeout_keeps_failed_cleanup_and_retries_same_identity(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_timeout'] = True
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, 'discard')
    assert caught.value.code == 'cloud_timeout'
    row = leases.current()
    assert row['cleanup_state'] == 'failed'
    assert row['provider_instance_id'] == 'fixture-instance'
    assert row['state'] == 'held'
    state['terminate_timeout'] = False
    assert lifecycle.cleanup(token, 'discard')['intent']['terminate_acknowledged'] is True
    state['instances'] = []
    assert lifecycle.reconcile(token)['lease']['state'] == 'released'


def test_single_empty_query_does_not_confirm_uncertain_termination(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_result'] = {'UHostId': 'other-instance', 'InRecycle': 'No'}
    with pytest.raises(AppError):
        lifecycle.cleanup(token, 'discard')
    state['describe_sequence'] = [
        {'TotalCount': 0, 'UHostSet': []},
        {'TotalCount': 1, 'UHostSet': [instance(state['created_label'], State='Stopped')]},
    ]
    result = lifecycle.reconcile(token)
    assert result['lease']['state'] == 'held'
    assert result['lease']['instance_state'] == 'stopped'


def test_multiple_created_ids_are_uncertain_instead_of_binding_first(environment):
    leases, lifecycle, seen, state = environment
    state['create_result'] = {'UHostIds': ['fixture-instance', 'other-instance']}
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert caught.value.code == 'cloud_invalid_response'
    assert leases.current()['provider_instance_id'] is None
    assert leases.current()['create_state'] == 'requested'
    assert leases.current()['state'] == 'held'


def test_unverified_termination_ack_releases_after_repeated_exact_absence(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_result'] = {'UHostId': 'other-instance', 'InRecycle': 'No'}
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, 'discard')
    assert caught.value.code == 'cloud_invalid_response'
    state['instances'] = []
    result = lifecycle.reconcile(token)
    assert result['lease']['state'] == 'released'
    assert result['intent']['terminate_acknowledged'] is False


def test_invalid_spec_rejected_before_network_or_persistence(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, {**SPEC, 'cpu': -1})
    assert caught.value.code == 'validation_error'
    assert seen == []
    assert leases.current()['create_state'] == 'not_requested'


def test_negative_cpu_cannot_be_selected():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'cpu': -1})
    assert caught.type.__name__ == 'ValidationError'


def test_empty_bound_listing_with_nonzero_total_cannot_confirm_deletion(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    lifecycle.cleanup(token, 'discard')
    state['describe_result'] = {'TotalCount': 1, 'UHostSet': []}
    with pytest.raises(AppError) as caught:
        lifecycle.reconcile(token)
    assert caught.value.code == 'cloud_invalid_response'
    assert leases.current()['state'] == 'held'


def test_recovery_rejects_instance_predating_the_reservation(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], CreateTime=1)]
    with pytest.raises(AppError) as caught:
        lifecycle.reconcile(token)
    assert caught.value.code == 'cloud_instance_conflict'
    assert leases.current()['provider_instance_id'] is None


def test_spec_rejects_memory_multiple():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'memory_mb': 32769})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_region_whitespace():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'region': 'fixture region'})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_zone_blank():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'zone': ''})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_image_blank():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'image_id': ''})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_gpu_blank():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'gpu_type': ''})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_cpu_platform():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'cpu_platform': 'unknown'})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_charge_dynamic():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'charge_type': 'Dynamic'})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_disk_empty():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'boot_disk_gb': 0})
    assert caught.type.__name__ == 'ValidationError'


def test_spec_rejects_disk_unknown():
    with pytest.raises(Exception) as caught:
        InstanceSpec(**{**SPEC, 'boot_disk_type': 'attached-disk'})
    assert caught.type.__name__ == 'ValidationError'


def test_invalid_capacity_shape_is_safe_provider_error(environment):
    leases, lifecycle, seen, state = environment
    state['capacity'] = [{'Gpu': 1, 'Cpu': 8, 'Mem': '32', 'ResourceEnough': True}]
    token = leases.reserve('attempt', uuid.uuid4())
    try:
        lifecycle.create(token, InstanceSpec(**SPEC))
    except Exception as error:
        assert isinstance(error, AppError), 'Malformed capacity must produce a sanitized AppError'
        assert error.code == 'cloud_invalid_response'
    else:
        pytest.fail('Malformed capacity cannot dispatch creation')
    assert len(seen) == 1
    assert leases.current()['create_state'] == 'not_requested'


def test_unsafe_created_id_never_persists_provider_text(environment):
    leases, lifecycle, seen, state = environment
    state['create_result'] = {'UHostIds': ['private credential value']}
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert caught.value.code == 'cloud_invalid_response'
    assert 'private credential value' not in str(caught.value)
    assert leases.current()['provider_instance_id'] is None


def test_wrong_stop_ack_does_not_imply_instance_stopped(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'])]
    state['stop_result'] = {'UHostId': 'other-instance'}
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, 'discard')
    assert caught.value.code == 'cloud_invalid_response'
    assert leases.current()['instance_state'] == 'unknown'
    assert leases.current()['state'] == 'held'


def test_start_requires_a_verified_stopped_instance_and_never_infers_success(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    result = lifecycle.start(token)
    assert seen[-1]['Action'] == 'StartCompShareInstance'
    assert seen[-1]['UHostId'] == 'fixture-instance'
    assert result['observation']['State'] == 'Stopped'
    assert result['requested_state'] == 'Running'
    assert result['intent']['start_requested'] is True
    assert result['lease']['state'] == 'held'


def test_start_rejects_wrong_ack_and_cleanup_owned_instance(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['start_result'] = {'UHostId': 'other-instance'}
    with pytest.raises(AppError) as caught:
        lifecycle.start(token)
    assert caught.value.code == 'cloud_invalid_response'

    leases.allow_cleanup(token, 'discard')
    with pytest.raises(AppError) as caught:
        lifecycle.start(token)
    assert caught.value.code == 'cloud_instance_cleanup_started'


def test_partial_recovery_listing_never_binds_from_incomplete_page(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    state['describe_result'] = {'TotalCount': 2, 'UHostSet': [instance(state['created_label'])]}
    with pytest.raises(AppError) as caught:
        lifecycle.reconcile(token)
    assert caught.value.code == 'cloud_invalid_response'
    assert len([r for r in seen if r['Action']=='DescribeCompShareInstance']) == 1
    assert leases.current()['provider_instance_id'] is None


def test_terminal_cleanup_is_idempotent_and_never_touches_next_owner(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    lifecycle.cleanup(token, 'discard')
    state['instances'] = []
    lifecycle.reconcile(token)
    next_token = leases.reserve('trial', uuid.uuid4())
    count = len(seen)
    try:
        result = lifecycle.cleanup(token, 'discard')
    except AppError as error:
        pytest.fail('Terminal cleanup should return the completed reservation: '+error.code)
    assert result['lease']['state'] == 'released'
    assert len(seen) == count
    assert leases.current()['id'] == str(next_token.reservation_id)


def test_reconcile_confirms_cleanup_when_instance_vanishes_before_terminate_ack(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    leases.allow_cleanup(token, 'discard')
    state['instances'] = []
    result = lifecycle.reconcile(token)
    assert result['lease']['state'] == 'released'
    assert result['lease']['cleanup_state'] == 'confirmed'
    assert result['lease']['instance_state'] == 'deleted'
    assert result['intent']['terminate_acknowledged'] is False
    assert leases.current() is None


def test_malformed_observed_instance_is_safe_error_and_keeps_gpu(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = ['private vendor text']
    try:
        lifecycle.reconcile(token)
    except Exception as error:
        assert isinstance(error, AppError), 'Bad provider rows must be sanitized errors'
        assert error.code == 'cloud_invalid_response'
        assert 'private vendor text' not in str(error)
    else:
        pytest.fail('Malformed instance cannot be reconciled')
    assert leases.current()['state'] == 'held'


def test_malformed_recovery_rows_cannot_escape_as_key_or_type_error(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [None]
    try:
        lifecycle.reconcile(token)
    except Exception as error:
        assert isinstance(error, AppError), 'Recovery must reject malformed provider data safely'
        assert error.code == 'cloud_invalid_response'
    else:
        pytest.fail('Malformed recovery must be rejected')
    assert leases.current()['create_state'] == 'requested'


def test_changed_spec_is_rejected_without_another_cloud_request(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    count = len(seen)
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**{**SPEC, 'cpu': 16}))
    assert caught.value.code == 'gpu_creation_conflict'
    assert len(seen) == count
    assert lifecycle.reconcile(token)['intent']['spec'] == SPEC

@pytest.mark.parametrize('exited,policy,code', [(False,'discard','gpu_process_unverified'), (True,'discard','gpu_outputs_unverified')])
def test_cleanup_never_discards_unknown_process_or_successful_unsynced_outputs(environment, exited, policy, code):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    leases.execution_requested(token)
    if exited:
        leases.record_process_exit(token, 'fixture-instance', 0)
    count = len(seen)
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, policy)
    assert caught.value.code == code
    assert len(seen) == count
    assert leases.current()['state'] == 'held'

def test_empty_recovery_never_releases_or_recreates(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    state['create_timeout'] = True
    with pytest.raises(AppError):
        lifecycle.create(token, InstanceSpec(**SPEC))
    result = lifecycle.reconcile(token)
    assert result['lease']['create_state'] == 'requested'
    assert result['lease']['state'] == 'held'
    with pytest.raises(AppError) as caught:
        leases.reserve('trial', uuid.uuid4())
    assert caught.value.code == 'gpu_busy'
    assert len([r for r in seen if r['Action']=='CreateCompShareInstance']) == 1

@pytest.mark.parametrize('operation',['create','cleanup','reconcile'])
def test_forged_owner_cannot_reach_provider(environment, operation):
    from modelforge.modules.resources import LeaseToken
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    forged = LeaseToken(token.reservation_id, 'attempt', uuid.uuid4(), token.generation)
    args = (InstanceSpec(**SPEC),) if operation=='create' else ('discard',) if operation=='cleanup' else ()
    with pytest.raises(AppError) as caught:
        getattr(lifecycle,operation)(forged,*args)
    assert caught.value.code == 'stale_gpu_lease'
    assert seen == []

def test_safe_projection_never_returns_password_or_raw_provider_data(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], Password='private-instance-password', SshLoginCommand='secret command', Extra='private vendor text')]
    result = lifecycle.reconcile(token)
    import json
    text = json.dumps(result)
    assert 'private-instance-password' not in text and 'secret command' not in text
    assert 'private vendor text' not in text

@pytest.mark.parametrize('remote_state',['Starting','Stopping','Install','Rebooting','Unexpected'])
def test_intermediate_instance_state_never_dispatches_cleanup(environment, remote_state):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State=remote_state)]
    result = lifecycle.cleanup(token,'discard')
    assert result['lease']['state'] == 'held'
    assert seen[-1]['Action']=='DescribeCompShareInstance'


def test_write_timeout_directs_reconciliation_instead_of_blind_retry(environment):
    leases, lifecycle, seen, state = environment
    state['create_timeout'] = True
    token = leases.reserve('attempt', uuid.uuid4())
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert '核对' in caught.value.message
    assert 'provider secret' not in caught.value.message


def test_two_concurrent_creates_dispatch_once_with_committed_intent(environment):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    barrier = threading.Barrier(2)
    def callback(wire):
        if wire['Action'] == 'CheckCompShareResourceCapacity':
            barrier.wait(timeout=8)
        if wire['Action'] == 'CreateCompShareInstance':
            row = GpuLeases(leases.pool).current()
            assert row['create_state'] == 'requested'
            assert row['create_operation_id'] is not None
            with pytest.raises(AppError) as caught:
                leases.reserve('trial',uuid.uuid4())
            assert caught.value.code == 'gpu_busy'
    state['callback'] = callback
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: InstanceLifecycle(leases,lifecycle.provider).create(token,InstanceSpec(**SPEC)),range(2)))
    assert len([r for r in seen if r['Action']=='CreateCompShareInstance']) == 1
    assert leases.current()['provider_instance_id'] == 'fixture-instance'
    assert all(r['lease']['state']=='held' for r in results)

def test_successful_outputs_allow_cleanup_only_after_external_persistence_confirmation(environment):
    leases,lifecycle,seen,state = environment
    token=leases.reserve('attempt',uuid.uuid4())
    lifecycle.create(token,InstanceSpec(**SPEC))
    leases.execution_requested(token)
    leases.record_process_exit(token,'fixture-instance',0)
    state['instances']=[instance(state['created_label'],State='Stopped')]
    result=lifecycle.cleanup(token,'outputs_persisted')
    assert result['intent']['terminate_acknowledged'] is True
    state['instances']=[]
    assert lifecycle.reconcile(token)['lease']['state']=='released'


def test_migration_downgrade_preserves_held_intent_and_allows_completed_history(environment):
    import subprocess
    import sys
    leases,lifecycle,seen,state = environment
    token=leases.reserve('attempt',uuid.uuid4())
    lifecycle.create(token,InstanceSpec(**SPEC))
    try:
        failed=subprocess.run([sys.executable,'-m','alembic','downgrade','0009_gpu_leases'],capture_output=True,text=True)
        assert failed.returncode != 0, 'Downgrade must reject held provider intents'
        assert 'Held instance intents prevent downgrade' in failed.stderr
        assert lifecycle.reconcile(token)['intent']['spec']==SPEC
        state['instances']=[instance(state['created_label'],State='Stopped')]
        lifecycle.cleanup(token,'discard')
        state['instances']=[]
        lifecycle.reconcile(token)
        completed=subprocess.run([sys.executable,'-m','alembic','downgrade','0009_gpu_leases'],capture_output=True,text=True)
        assert completed.returncode == 0, completed.stderr
        assert leases.get(token.reservation_id)['state']=='released'
    finally:
        upgraded=subprocess.run([sys.executable,'-m','alembic','upgrade','head'],capture_output=True,text=True)
        assert upgraded.returncode == 0, upgraded.stderr


@pytest.mark.parametrize('creation_state', ['not_requested', 'requested', 'bound'])
def test_cleanup_without_adapter_intent_rejects_without_partial_write(environment, creation_state):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    if creation_state != 'not_requested':
        creation = leases.begin_creation(token, 'fixture-region')
        if creation_state == 'bound':
            leases.bind_instance(token, creation['operation_id'], 'fixture-instance')
    before = leases.get(token.reservation_id)
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, 'discard')
    assert caught.value.code == 'gpu_instance_intent_missing'
    assert leases.get(token.reservation_id) == before
    with leases.pool.connection() as c:
        assert c.execute('SELECT count(*) AS n FROM ucloud_instance_intents').fetchone()['n'] == 0
    assert seen == []


@pytest.mark.parametrize('mode', ['construct', 'copy'])
@pytest.mark.parametrize('invalid', [dict(charge_type='Dynamic'), dict(boot_disk_gb=0), dict(cpu=8.0)])
def test_create_revalidates_instance_spec_before_any_side_effect(environment, mode, invalid):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    spec = (InstanceSpec.model_construct(**{**SPEC, **invalid}) if mode == 'construct'
            else InstanceSpec(**SPEC).model_copy(update=invalid))
    before = leases.get(token.reservation_id)
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, spec)
    assert caught.value.code == 'validation_error'
    assert leases.get(token.reservation_id) == before
    with leases.pool.connection() as c:
        assert c.execute('SELECT count(*) AS n FROM ucloud_instance_intents').fetchone()['n'] == 0
    assert seen == []


@pytest.mark.parametrize('creation_state', ['requested', 'bound'])
def test_create_cannot_adopt_kernel_only_creation_without_snapshot(environment, creation_state):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    creation = leases.begin_creation(token, 'fixture-region')
    if creation_state == 'bound':
        leases.bind_instance(token, creation['operation_id'], 'fixture-instance')
    before = leases.get(token.reservation_id)
    with pytest.raises(AppError) as caught:
        lifecycle.create(token, InstanceSpec(**SPEC))
    assert caught.value.code == 'gpu_instance_intent_missing'
    assert leases.get(token.reservation_id) == before
    with leases.pool.connection() as c:
        assert c.execute('SELECT count(*) AS n FROM ucloud_instance_intents').fetchone()['n'] == 0
    assert seen == []


@pytest.mark.parametrize('recycle', [True, False, 'Maybe', '', 0, 1])
def test_invalid_recycle_ack_requires_repeated_exact_absence(environment, recycle):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_result'] = {'UHostId': 'fixture-instance', 'InRecycle': recycle}
    with pytest.raises(AppError) as caught:
        lifecycle.cleanup(token, 'discard')
    assert caught.value.code == 'cloud_invalid_response'
    state['instances'] = []
    result = lifecycle.reconcile(token)
    assert result['intent']['terminate_acknowledged'] is False
    assert result['lease']['state'] == 'released'


def test_termination_ack_without_recycle_field_is_valid(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_result'] = {'UHostId': 'fixture-instance'}
    result = lifecycle.cleanup(token, 'discard')
    assert seen[-1]['Action'] == 'TerminateCompShareInstance'
    assert result['intent']['terminate_acknowledged'] is True
    assert result['lease']['state'] == 'held'
    state['instances'] = []
    assert lifecycle.reconcile(token)['lease']['state'] == 'released'


def test_valid_recycle_yes_requires_later_absence_before_release(environment):
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    lifecycle.create(token, InstanceSpec(**SPEC))
    state['instances'] = [instance(state['created_label'], State='Stopped')]
    state['terminate_result'] = {'UHostId': 'fixture-instance', 'InRecycle': 'Yes'}
    result = lifecycle.cleanup(token, 'discard')
    assert result['intent']['terminate_acknowledged'] is True
    assert result['lease']['state'] == 'held'
    assert lifecycle.reconcile(token)['lease']['state'] == 'held'
    state['instances'] = []
    assert lifecycle.reconcile(token)['lease']['state'] == 'released'


def test_spot_is_rejected_before_persistence_or_provider_dispatch(environment):
    from pydantic import ValidationError
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    before = leases.get(token.reservation_id)
    for mode in ('normal', 'construct', 'copy'):
        with pytest.raises((AppError, ValidationError)) as caught:
            spec = (InstanceSpec(**{**SPEC, 'charge_type': 'Spot'}) if mode == 'normal'
                    else InstanceSpec.model_construct(**{**SPEC, 'charge_type': 'Spot'}) if mode == 'construct'
                    else InstanceSpec(**SPEC).model_copy(update={'charge_type': 'Spot'}))
            lifecycle.create(token, spec)
        if isinstance(caught.value, AppError):
            assert caught.value.code == 'validation_error'
        assert leases.get(token.reservation_id) == before
        with leases.pool.connection() as c:
            assert c.execute('SELECT count(*) AS n FROM ucloud_instance_intents').fetchone()['n'] == 0
        assert seen == []


def test_downgrade_blocks_creation_between_guard_and_drop(environment):
    import importlib.util
    import time
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path
    leases, lifecycle, seen, state = environment
    token = leases.reserve('attempt', uuid.uuid4())
    migration_path = Path('migrations/versions/0010_ucloud_instance_intents.py')
    loader = importlib.util.spec_from_file_location('intent_migration', migration_path)
    migration = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(migration)
    guarded = threading.Event()
    original_op = migration.op
    with leases.pool.connection() as connection:
        class PausingOp:
            def execute(self, statement):
                if statement.startswith('DROP TABLE'):
                    guarded.set()
                    deadline = time.monotonic() + 5
                    completed = False
                    blocked = False
                    while time.monotonic() < deadline:
                        if future.done():
                            completed = True
                            future.result()
                            break
                        with leases.pool.connection() as observer:
                            blocked = observer.execute("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation=to_regclass('ucloud_instance_intents') AND NOT granted) AS blocked").fetchone()['blocked']
                        if blocked:
                            break
                        threading.Event().wait(0.01)
                    assert blocked and not completed, 'Creation committed between downgrade guard and DROP'
                    raise RuntimeError('test rollback after guard')
                connection.execute(statement)
        migration.op = PausingOp()
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                def create_after_guard():
                    assert guarded.wait(timeout=5)
                    return lifecycle.create(token, InstanceSpec(**SPEC))
                future = executor.submit(create_after_guard)
                try:
                    with pytest.raises(RuntimeError, match='test rollback after guard'):
                        migration.downgrade()
                finally:
                    guarded.set()
                    connection.rollback()
                assert future.result(timeout=8)['lease']['create_state'] == 'bound'
        finally:
            migration.op = original_op
    assert len([r for r in seen if r['Action'] == 'CreateCompShareInstance']) == 1
    assert lifecycle.reconcile(token)['intent']['spec'] == SPEC
