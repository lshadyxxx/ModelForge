from __future__ import annotations

import uuid

import pytest

from modelforge.errors import AppError
from modelforge.modules.serving.acceptance import (
    AcceptanceDecision,
    CRITERIA_VERSION,
    InferenceAcceptance,
    acceptance_evidence_digest,
)


class Result:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class Store:
    def __init__(self, trial):
        self.trial = trial
        self.rows = []

    def connection(self):
        return Connection(self)


class Connection:
    def __init__(self, store):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, query, parameters=None):
        normalized = ' '.join(query.split())
        if 'FROM inference_trials t' in normalized:
            return Result(row=self.store.trial)
        if normalized.startswith('INSERT INTO training_inference_acceptance'):
            digest = parameters[6]
            existing = next(
                (
                    item for item in self.store.rows
                    if item['trial_id'] == parameters[3]
                    and item['criteria_version'] == parameters[5]
                    and item['evidence_digest'] == digest
                ),
                None,
            )
            if existing:
                return Result(row=None)
            self.store.rows.append({
                'id': parameters[0],
                'adapter_id': parameters[1],
                'adapter_fingerprint': parameters[2],
                'trial_id': parameters[3],
                'result': parameters[4],
                'criteria_version': parameters[5],
                'evidence_digest': parameters[6],
                'reviewer_ref': parameters[7],
                'accepted_at': parameters[8],
                'recorded_at': parameters[8],
            })
            return Result(row={'id': parameters[0]})
        if 'FROM training_inference_acceptance' in normalized:
            if 'evidence_digest=%s' in normalized:
                match = next(
                    (
                        item for item in self.store.rows
                        if item['trial_id'] == parameters[0]
                        and item['criteria_version'] == parameters[1]
                        and item['evidence_digest'] == parameters[2]
                    ),
                    None,
                )
                return Result(row=match)
            return Result(rows=list(reversed(self.store.rows)))
        raise AssertionError(('unexpected query', normalized, parameters))


def fixture():
    adapter_id = uuid.uuid4()
    trial_id = uuid.uuid4()
    trial = {
        'id': trial_id,
        'adapter_id': adapter_id,
        'state': 'ready',
        'stop_requested': False,
        'request_state': 'idle',
        'snapshot': {
            'base': {'id': 'base-qwen3', 'name': 'Qwen3-0.6B'},
            'config': {'epochs': 1},
            'adapter_fingerprint': 'a' * 64,
        },
        'adapter_fingerprint': 'a' * 64,
        'adapter_state': 'available',
    }
    resource = type('Resources', (), {})()
    resource.pool = Store(trial)
    acceptance = InferenceAcceptance(resource)
    decision = AcceptanceDecision(
        adapter_id=adapter_id,
        adapter_fingerprint='a' * 64,
        result='passed',
        criteria_version=CRITERIA_VERSION,
        reviewer_ref='qa-fixture',
    )
    return acceptance, resource.pool, trial_id, decision


def test_ready_trial_does_not_create_acceptance_automatically():
    acceptance, store, trial_id, _ = fixture()

    assert store.rows == []
    assert acceptance.list(trial_id) == []


def test_explicit_acceptance_is_tied_to_exact_adapter_and_trial():
    acceptance, store, trial_id, decision = fixture()

    row = acceptance.record(trial_id, decision)

    assert row['trial_id'] == trial_id
    assert row['adapter_id'] == decision.adapter_id
    assert row['adapter_fingerprint'] == decision.adapter_fingerprint
    assert row['result'] == 'passed'
    assert row['criteria_version'] == CRITERIA_VERSION
    assert row['reviewer_ref'] == 'qa-fixture'
    assert len(row['evidence_digest']) == 64
    assert len(store.rows) == 1


def test_acceptance_is_idempotent_for_the_same_frozen_evidence():
    acceptance, store, trial_id, decision = fixture()

    first = acceptance.record(trial_id, decision)
    second = acceptance.record(trial_id, decision)

    assert first['id'] == second['id']
    assert len(store.rows) == 1


def test_acceptance_rejects_fingerprint_mismatch_and_busy_trial():
    acceptance, store, trial_id, decision = fixture()
    mismatched = decision.model_copy(update={
        'adapter_fingerprint': 'b' * 64,
    })
    with pytest.raises(AppError) as error:
        acceptance.record(trial_id, mismatched)
    assert error.value.code == 'acceptance_adapter_mismatch'

    store.trial = {**store.trial, 'request_state': 'running'}
    with pytest.raises(AppError) as error:
        acceptance.record(trial_id, decision)
    assert error.value.code == 'acceptance_trial_not_ready'
    assert store.rows == []


def test_acceptance_digest_is_stable_and_snapshot_bound():
    arguments = {
        'adapter_fingerprint': 'a' * 64,
        'adapter_id': uuid.uuid4(),
        'criteria_version': CRITERIA_VERSION,
        'result': 'passed',
        'reviewer_ref': 'qa-fixture',
        'trial_id': uuid.uuid4(),
        'trial_snapshot': {'config': {'epochs': 1}},
    }

    first = acceptance_evidence_digest(**arguments)
    second = acceptance_evidence_digest(**arguments)
    changed = acceptance_evidence_digest(
        **{**arguments, 'trial_snapshot': {'config': {'epochs': 2}}}
    )

    assert first == second
    assert first != changed
    assert len(first) == 64
