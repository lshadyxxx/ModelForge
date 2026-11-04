import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from modelforge.errors import AppError
from modelforge.modules.serving.use_cases import Serving, project_lifecycle


LEASE = {
    'state': 'released',
    'created_at': '2026-11-04T08:00:00+00:00',
    'released_at': '2026-11-04T08:03:00+00:00',
    'create_state': 'bound',
    'process_state': 'exited',
    'process_cancelled': True,
    'exit_code': 0,
    'instance_state': 'deleted',
    'cleanup_policy': 'discard',
    'cleanup_state': 'confirmed',
    'cleanup_error_code': None,
    'events': [
        {'action': 'reserved', 'recorded_at': '2026-11-04T08:00:00+00:00'},
        {'action': 'renewed', 'recorded_at': '2026-11-04T08:00:05+00:00'},
        {'action': 'instance_bound', 'recorded_at': '2026-11-04T08:00:10+00:00'},
        {'action': 'process_exited', 'recorded_at': '2026-11-04T08:01:00+00:00'},
        {'action': 'cleanup_allowed', 'recorded_at': '2026-11-04T08:01:01+00:00'},
        {'action': 'instance_stopped', 'recorded_at': '2026-11-04T08:02:00+00:00'},
        {'action': 'deletion_confirmed', 'recorded_at': '2026-11-04T08:02:30+00:00'},
        {'action': 'released', 'recorded_at': '2026-11-04T08:03:00+00:00'},
    ],
}


def trial(**overrides):
    return {
        'id': uuid.uuid4(),
        'state': 'stopped',
        'lease_id': uuid.uuid4(),
        **overrides,
    }


def test_projection_returns_exact_whitelist_and_event_times():
    result = project_lifecycle(trial(), {
        **LEASE,
        'owner_kind': 'trial',
        'owner_id': 'secret-owner',
        'generation': 91,
        'provider_instance_id': 'secret-provider-id',
        'region': 'secret-region',
        'heartbeat_at': 'secret-heartbeat',
    })
    assert result['status'] == 'tracked'
    assert result['process'] == {
        'state': 'exited',
        'exit_code': 0,
        'cancelled': True,
        'exited_at': '2026-11-04T08:01:00+00:00',
    }
    assert result['instance'] == {
        'state': 'deleted',
        'stopped_at': '2026-11-04T08:02:00+00:00',
        'deleted_at': '2026-11-04T08:02:30+00:00',
    }
    assert result['cleanup'] == {
        'policy': 'discard',
        'state': 'confirmed',
        'error_code': None,
    }
    assert result['lease'] == {
        'state': 'released',
        'created_at': '2026-11-04T08:00:00+00:00',
        'released_at': '2026-11-04T08:03:00+00:00',
    }
    assert all(event['action'] != 'renewed' for event in result['events'])
    serialized = repr(result)
    for forbidden in ('secret-owner', 'secret-provider-id', 'secret-region', 'secret-heartbeat', 'generation'):
        assert forbidden not in serialized


def test_unreserved_trial_is_explicit_and_does_not_need_lease_lookup():
    assert project_lifecycle({'id': uuid.uuid4(), 'lease_id': None}, {}) == {'status': 'not_reserved'}


def test_event_cap_keeps_the_latest_fifty_without_renewal_noise():
    events = []
    started = datetime(2026, 11, 4, 8, 0, tzinfo=timezone.utc)
    for index in range(160):
        action = 'renewed' if index % 2 else 'instance_bound'
        events.append({
            'action': action,
            'recorded_at': (started + timedelta(seconds=index)).isoformat(),
        })
    result = project_lifecycle(trial(), {**LEASE, 'events': events})
    assert len(result['events']) == 50
    assert result['events'][0]['recorded_at'] == '2026-11-04T08:01:00+00:00'
    assert result['events'][-1]['recorded_at'] == '2026-11-04T08:02:38+00:00'
    assert all(event['action'] != 'renewed' for event in result['events'])


def test_missing_lease_degrades_to_unavailable_without_erasing_trial(monkeypatch):
    identifier = uuid.uuid4()
    row = {
        'id': identifier,
        'state': 'stopped',
        'lease_id': uuid.uuid4(),
        'error_code': None,
    }
    service = Serving(SimpleNamespace(pool=object()))
    monkeypatch.setattr(service, 'get', lambda value: row)

    def missing(self, reservation_id):
        raise AppError(404, 'gpu_reservation_not_found', 'GPU reservation not found')

    monkeypatch.setattr('modelforge.modules.serving.use_cases.GpuLeases.get', missing)
    result = service.get_with_lifecycle(identifier)
    assert result['id'] == identifier
    assert result['state'] == 'stopped'
    assert result['lifecycle'] == {'status': 'unavailable', 'error_code': 'lifecycle_unavailable'}
