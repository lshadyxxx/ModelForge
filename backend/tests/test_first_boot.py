import base64
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from modelforge.errors import AppError
from modelforge.infrastructure.first_boot import FirstBoot, temporary_password
from modelforge.infrastructure.remote import Endpoint


def _boot(tmp_path, *, key_login=True, password=None):
    class Lifecycle:
        def bootstrap_observation(self, token):
            return {
                "state": "Running",
                "instance_id": "instance-1",
                "ssh_login_command": "ssh -p 2222 root@example.test",
                "password_base64": password,
            }

    class Registry:
        def material_paths(self, instance_id):
            return (
                tmp_path / "key",
                tmp_path / "key.pub",
                tmp_path / "known_hosts",
            )

        def get(self, instance_id):
            return Endpoint(
                host="example.test",
                user="root",
                port=2222,
                private_key=str(tmp_path / "key"),
                known_hosts=str(tmp_path / "known_hosts"),
            )

    settings = SimpleNamespace(ssh_executable="ssh")
    boot = FirstBoot(settings, Lifecycle(), Registry())
    boot._key_login = lambda endpoint: key_login
    boot._disable_password = lambda endpoint: None
    boot._fingerprint_from_known_hosts = lambda path: "SHA256:fixture"
    return boot


def test_temporary_password_is_policy_compliant():
    value = temporary_password()
    assert 8 <= len(value) <= 32
    assert any(character.isupper() for character in value)
    assert any(character.islower() for character in value)
    assert any(character.isdigit() for character in value)


def test_key_only_resume_disables_provider_password_without_secret(tmp_path):
    boot = _boot(tmp_path, key_login=True, password=None)
    result = boot.bootstrap(object(), attempt_id="attempt-1", temporary_sha256=None)
    assert result["state"] == "ready"
    assert result["credential_state"] == "password_disabled"
    assert result["old_password_rejected"] is None
    assert result["credential_recovery"] == "password_disabled_after_worker_restart"


def test_missing_key_and_missing_provider_password_never_claims_success(tmp_path):
    boot = _boot(tmp_path, key_login=False, password=None)
    with pytest.raises(AppError) as caught:
        boot.bootstrap(object(), attempt_id="attempt-1", temporary_sha256=None)
    assert caught.value.code == "temporary_password_unavailable"


def test_provider_reset_failure_locks_and_verifies_old_password(tmp_path):
    old_password = "TemporaryPassword123"
    boot = _boot(
        tmp_path,
        key_login=True,
        password=base64.b64encode(old_password.encode()).decode(),
    )
    boot._disable_password = lambda endpoint: None
    boot._password_login = lambda endpoint, password: False
    boot._rotate = lambda *args, **kwargs: (_ for _ in ()).throw(
        AppError(502, "cloud_api_error", "fixture reset failure")
    )
    result = boot.bootstrap(object(), attempt_id="attempt-1", temporary_sha256=None)
    assert result["state"] == "ready"
    assert result["credential_state"] == "password_disabled"
    assert result["old_password_rejected"] is True
    assert result["credential_recovery"] == "password_disabled_after_reset_error"


def test_provider_reset_failure_blocks_when_old_password_still_works(tmp_path):
    old_password = "TemporaryPassword123"
    boot = _boot(
        tmp_path,
        key_login=True,
        password=base64.b64encode(old_password.encode()).decode(),
    )
    boot._disable_password = lambda endpoint: None
    boot._password_login = lambda endpoint, password: True
    boot._rotate = lambda *args, **kwargs: (_ for _ in ()).throw(
        AppError(502, "cloud_api_error", "fixture reset failure")
    )
    with pytest.raises(AppError) as caught:
        boot.bootstrap(object(), attempt_id="attempt-1", temporary_sha256=None)
    assert caught.value.code == "credential_disable_unverified"


def test_key_installation_retries_one_transient_failure(tmp_path):
    old_password = "TemporaryPassword123"
    boot = _boot(
        tmp_path,
        key_login=False,
        password=base64.b64encode(old_password.encode()).decode(),
    )
    (tmp_path / "key.pub").write_text(
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture modelforge\n",
        encoding="utf-8",
    )
    logins = iter([False, True])
    boot._key_login = lambda endpoint: next(logins)
    boot._password_login = lambda endpoint, password: True
    boot._password_run = lambda *args, **kwargs: (
        subprocess.CompletedProcess(args, 1, b"", b"transient")
        if boot._password_run_calls == 0
        else subprocess.CompletedProcess(args, 0, b"", b"")
    )
    boot._password_run_calls = 0
    original_run = boot._password_run

    def counted_run(*args, **kwargs):
        value = original_run(*args, **kwargs)
        boot._password_run_calls += 1
        return value

    boot._password_run = counted_run
    boot._rotate = lambda *args, **kwargs: {
        "transitioned": True,
        "old_password_rejected": True,
    }
    result = boot.bootstrap(object(), attempt_id="attempt-1", temporary_sha256=None)
    assert result["state"] == "ready"
    assert boot._password_run_calls == 2
