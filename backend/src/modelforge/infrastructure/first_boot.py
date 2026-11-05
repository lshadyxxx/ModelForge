"""One-time instance identity bootstrap followed by key-only OpenSSH."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import string
import subprocess
import tempfile
import time
from typing import Callable

from modelforge.errors import AppError
from .remote import Endpoint


_HOST_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.:-]{0,252}")
_INSTANCE_RE = re.compile(r"[A-Za-z0-9_-]{1,120}")


def temporary_password() -> str:
    alphabet = string.ascii_letters + string.digits
    value = (
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + secrets.choice(string.digits)
        + "".join(secrets.choice(alphabet) for _ in range(21))
    )
    if not (
        8 <= len(value) <= 32
        and any(character.isupper() for character in value)
        and any(character.islower() for character in value)
        and any(character.isdigit() for character in value)
    ):
        raise RuntimeError("password_policy_unavailable")
    return value


def password_sha256(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise AppError(422, "validation_error", "Use a nonempty bootstrap password")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class EndpointRegistry:
    """Writable backend-only endpoint metadata; contains no private key bytes."""

    def __init__(self, settings):
        self.settings = settings
        self.file = Path(settings.ssh_endpoints_file)
        self.directory = self.file.parent

    def _load(self) -> dict:
        if not self.file.exists():
            return {}
        try:
            value = json.loads(self.file.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, TypeError):
            raise AppError(503, "ssh_configuration_invalid", "Backend SSH endpoint registry is invalid") from None
        if not isinstance(value, dict):
            raise AppError(503, "ssh_configuration_invalid", "Backend SSH endpoint registry is invalid")
        return value

    def _atomic(self, value: dict):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.file.with_name(self.file.name + "." + secrets.token_hex(8) + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, self.file)

    def material_paths(self, instance_id: str) -> tuple[Path, Path, Path]:
        if not isinstance(instance_id, str) or not _INSTANCE_RE.fullmatch(instance_id):
            raise AppError(422, "validation_error", "Invalid provider instance identity")
        base = "mf-" + instance_id
        return (
            self.directory / (base + "-ed25519"),
            self.directory / (base + "-ed25519.pub"),
            self.directory / (base + "-known_hosts"),
        )

    def get(self, instance_id: str) -> Endpoint | None:
        record = self._load().get(instance_id)
        if record is None:
            return None
        try:
            return Endpoint(**record).validate()
        except AppError:
            return None

    def register_instance(self, instance_id: str, host: str, port: int, user: str,
                          private_key: Path, known_hosts: Path) -> Endpoint:
        if not _HOST_RE.fullmatch(host):
            raise AppError(502, "provider_host_invalid", "Provider host identity is invalid")
        if not isinstance(user, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,31}", user):
            raise AppError(502, "provider_user_invalid", "Provider SSH user is invalid")
        if type(port) is not int or not 1 <= port <= 65535:
            raise AppError(502, "provider_port_invalid", "Provider SSH port is invalid")
        endpoint = Endpoint(
            host=host,
            user=user,
            port=port,
            private_key=str(private_key),
            known_hosts=str(known_hosts),
        ).validate()
        value = self._load()
        value[instance_id] = {
            "host": endpoint.host,
            "port": endpoint.port,
            "user": endpoint.user,
            "private_key": endpoint.private_key,
            "known_hosts": endpoint.known_hosts,
            "root": endpoint.root,
            "python": endpoint.python,
        }
        self._atomic(value)
        return endpoint

    def remove(self, instance_id: str, *, delete_material: bool = False):
        value = self._load()
        if instance_id in value:
            del value[instance_id]
            self._atomic(value)
        if delete_material:
            for path in self.material_paths(instance_id):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass


class FirstBoot:
    """Perform temporary-password login, key installation and rotation.

    The temporary password is held in memory only. Credential state is returned
    as stable facts; no password or complete login command is persisted.
    """

    def __init__(self, settings, lifecycle, registry: EndpointRegistry | None = None):
        self.settings = settings
        self.lifecycle = lifecycle
        self.registry = registry or EndpointRegistry(settings)

    @staticmethod
    def parse_endpoint(command: str) -> tuple[str, int, str]:
        try:
            parts = shlex.split(command)
        except ValueError:
            raise AppError(502, "provider_ssh_identity_invalid", "Provider SSH command is not parseable") from None
        users = [part for part in parts if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,31}@[^@]+", part or "")]
        if len(users) != 1:
            raise AppError(502, "provider_ssh_identity_invalid", "Provider SSH command has no unique user and host")
        user, host = users[0].rsplit("@", 1)
        if not _HOST_RE.fullmatch(host):
            raise AppError(502, "provider_ssh_identity_invalid", "Provider SSH host is invalid")
        port = None
        for index, item in enumerate(parts[:-1]):
            if item in ("-p", "-P"):
                candidate = parts[index + 1]
                if candidate.isdigit() and 1 <= int(candidate) <= 65535:
                    port = int(candidate)
                break
        if port is None:
            raise AppError(502, "provider_ssh_identity_invalid", "Provider SSH command has no verified port")
        return host, port, user

    def _ssh_base(self, endpoint: Endpoint, *, password_mode: bool):
        base = [
            self.settings.ssh_executable, "-F", os.devnull, "-T",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "GlobalKnownHostsFile=" + os.devnull,
            "-o", "UserKnownHostsFile=" + endpoint.known_hosts,
            "-o", "IdentitiesOnly=yes",
            "-o", "IdentityAgent=none",
            "-o", "ClearAllForwardings=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=10",
            "-o", "ServerAliveCountMax=3",
        ]
        if password_mode:
            base += [
                "-o", "BatchMode=no",
                "-o", "PasswordAuthentication=yes",
                "-o", "PubkeyAuthentication=no",
                "-o", "PreferredAuthentications=password",
                "-o", "KbdInteractiveAuthentication=no",
                "-o", "NumberOfPasswordPrompts=1",
            ]
        else:
            base += [
                "-o", "BatchMode=yes",
                "-o", "PasswordAuthentication=no",
                "-o", "KbdInteractiveAuthentication=no",
                "-o", "PreferredAuthentications=publickey",
                "-i", endpoint.private_key,
            ]
        base += ["-p", str(endpoint.port), f"{endpoint.user}@{endpoint.host}"]
        return base

    def _password_run(self, endpoint: Endpoint, password: str, script: str, *,
                      timeout: int = 120) -> subprocess.CompletedProcess:
        askpass_dir = Path(tempfile.mkdtemp(prefix="mf-askpass-"))
        askpass = askpass_dir / "askpass"
        try:
            askpass.write_text("#!/bin/sh\nprintf '%s\\n' \"$MF_ASKPASS_VALUE\"\n", encoding="ascii")
            askpass.chmod(0o700)
            env = {
                key: value for key, value in os.environ.items()
                if not key.startswith("SSH_")
            }
            env.update({
                "MF_ASKPASS_VALUE": password,
                "SSH_ASKPASS": str(askpass),
                "SSH_ASKPASS_REQUIRE": "force",
                "DISPLAY": "modelforge-bootstrap",
            })
            command = self._ssh_base(endpoint, password_mode=True) + ["sh -s"]
            setsid = shutil.which("setsid")
            if setsid:
                command = [setsid, "-w", *command]
            return subprocess.run(
                command,
                input=script.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise AppError(503, "bootstrap_transport_failed", "Secure instance bootstrap transport failed") from None
        finally:
            for child in askpass_dir.iterdir():
                child.unlink(missing_ok=True)
            askpass_dir.rmdir()

    def _key_run(self, endpoint: Endpoint, script: str, *, timeout: int = 120) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                self._ssh_base(endpoint, password_mode=False) + ["sh -s"],
                input=script.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
                env={key: value for key, value in os.environ.items() if not key.startswith("SSH_")},
            )
        except (OSError, subprocess.TimeoutExpired):
            raise AppError(503, "bootstrap_transport_failed", "Key-only bootstrap transport failed") from None

    def _key_login(self, endpoint: Endpoint) -> bool:
        result = self._key_run(endpoint, "set -eu\nid -un\n", timeout=45)
        return result.returncode == 0 and result.stdout.strip() == endpoint.user.encode()

    def _password_login(self, endpoint: Endpoint, password: str) -> bool:
        result = self._password_run(
            endpoint,
            password,
            "set -eu\nid -un\n",
            timeout=45,
        )
        return result.returncode == 0 and result.stdout.strip() == endpoint.user.encode()

    def _scan_host_keys(self, host: str, port: int, destination: Path) -> str:
        keyscan = shutil.which("ssh-keyscan")
        keygen = shutil.which("ssh-keygen")
        if not keyscan or not keygen:
            raise AppError(503, "bootstrap_tools_missing", "Backend image lacks OpenSSH bootstrap tools")
        rounds: list[set[tuple[str, str]]] = []
        for _ in range(3):
            try:
                result = subprocess.run(
                    [keyscan, "-T", "10", "-t", "ed25519,ecdsa,rsa", "-p", str(port), host],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=40,
                    check=False,
                    env={key: value for key, value in os.environ.items() if not key.startswith("SSH_")},
                )
            except (OSError, subprocess.TimeoutExpired):
                raise AppError(503, "bootstrap_host_key_unavailable", "Provider host keys could not be observed") from None
            parsed: set[tuple[str, str]] = set()
            for line in result.stdout.decode("ascii", errors="replace").splitlines():
                fields = line.split()
                if len(fields) >= 3 and fields[1] in {
                    "ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256",
                    "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
                }:
                    parsed.add((fields[1], fields[2]))
            if result.returncode or not parsed:
                raise AppError(503, "bootstrap_host_key_unstable", "Provider host keys were incomplete")
            rounds.append(parsed)
        stable = set.intersection(*rounds)
        if not stable:
            raise AppError(503, "bootstrap_host_key_unstable", "Provider host keys changed during bootstrap")
        alias = f"[{host}]:{port}"
        payload = "".join(
            f"{alias} {algorithm} {key_material}\n"
            for algorithm, key_material in sorted(stable)
        ).encode("ascii")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_bytes(payload)
        destination.chmod(0o600)
        fingerprint = subprocess.run(
            [keygen, "-E", "sha256", "-lf", str(destination)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
            text=True,
        )
        match = re.search(r"SHA256:[A-Za-z0-9+/=]+", fingerprint.stdout)
        if fingerprint.returncode or match is None:
            raise AppError(503, "bootstrap_host_key_invalid", "Provider host key fingerprint is unavailable")
        return match.group(0)

    @staticmethod
    def _generate_key(private: Path, public: Path) -> str:
        keygen = shutil.which("ssh-keygen")
        if not keygen:
            raise AppError(503, "bootstrap_tools_missing", "Backend image lacks ssh-keygen")
        private.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        private.unlink(missing_ok=True)
        public.unlink(missing_ok=True)
        try:
            result = subprocess.run(
                [keygen, "-q", "-t", "ed25519", "-N", "", "-C", "modelforge-managed-training", "-f", str(private)],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise AppError(503, "bootstrap_key_generation_failed", "Per-instance SSH key generation failed") from None
        if result.returncode:
            raise AppError(503, "bootstrap_key_generation_failed", "Per-instance SSH key generation failed")
        private.chmod(0o600)
        public.chmod(0o600)
        line = public.read_text(encoding="utf-8").strip()
        if not line.startswith("ssh-ed25519 "):
            raise AppError(503, "bootstrap_key_generation_failed", "Generated SSH public key is invalid")
        return line

    @staticmethod
    def _install_key_script(public_line: str) -> str:
        encoded = base64.b64encode(public_line.encode("utf-8")).decode("ascii")
        return (
            "set -eu\n"
            "umask 077\n"
            "mkdir -p \"$HOME/.ssh\"\n"
            "touch \"$HOME/.ssh/authorized_keys\"\n"
            f"printf '%s' '{encoded}' | base64 -d | "
            "grep -Fqx -f - \"$HOME/.ssh/authorized_keys\" 2>/dev/null || "
            f"printf '%s\\n' '{encoded}' | base64 -d >> \"$HOME/.ssh/authorized_keys\"\n"
            "chmod 700 \"$HOME/.ssh\"\n"
            "chmod 600 \"$HOME/.ssh/authorized_keys\"\n"
        )

    def _disable_password(self, endpoint: Endpoint) -> None:
        """Disable the provider account password after key-only access is proven.

        `passwd -l` is deliberately used instead of retaining a new password.
        That keeps the credential out of the process and works after a Worker
        restart where the temporary provider password can no longer be read.
        """
        script = (
            "set -eu\n"
            "user=\"$(id -un)\"\n"
            "passwd -l \"$user\" >/dev/null\n"
            "passwd -S \"$user\" | awk '{print $2}'\n"
        )
        result = self._key_run(endpoint, script, timeout=45)
        state = result.stdout.decode("ascii", errors="replace").strip().splitlines()
        if result.returncode or not state or state[-1] not in {"L", "LK"}:
            raise AppError(
                503,
                "credential_disable_failed",
                "实例密码未能确认禁用；训练不会开始。",
            )

    def _wait_provider_state(self, token, wanted: str, timeout: int = 300,
                             observe: Callable | None = None) -> None:
        deadline = time.monotonic() + timeout
        observation = observe or self.lifecycle.observe
        while time.monotonic() < deadline:
            result = observation(token)
            row = result.get("observation") if isinstance(result, dict) else None
            if row and row.get("State") == wanted:
                return
            time.sleep(4)
        raise AppError(503, "bootstrap_state_timeout", "Provider instance did not reach the required bootstrap state")

    def _rotate(self, token, endpoint: Endpoint, old_password: str,
                temporary_sha256: str | None) -> dict:
        new_password = temporary_password()
        self.lifecycle.reset_password(token, new_password)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if not self._key_login(endpoint):
                time.sleep(3)
                continue
            if not self._password_login(endpoint, old_password):
                return {"transitioned": False, "old_password_rejected": True}
            time.sleep(3)
        raise AppError(
            409,
            "credential_rotation_unverified",
            "登录凭据轮换未能确认旧密码失效；训练不会开始。",
            {"temporary_password_sha256": temporary_sha256},
        )

    def _finish_with_disabled_password(self, endpoint: Endpoint, *,
                                       temporary_sha256: str | None,
                                       old_password: str | None = None,
                                       recovery: str = "password_disabled_after_worker_restart") -> dict:
        self._disable_password(endpoint)
        old_password_rejected = None
        if old_password is not None:
            if self._password_login(endpoint, old_password):
                raise AppError(
                    503,
                    "credential_disable_unverified",
                    "实例密码未能确认失效；训练不会开始。",
                )
            old_password_rejected = True
        # A key-only connection remains usable while the provider password is
        # no longer accepted. The fact is intentionally distinct from a
        # provider-side reset, because no old password was available.
        return {
            "state": "ready",
            "credential_state": "password_disabled",
            "host_key_fingerprint": self._fingerprint_from_known_hosts(
                Path(endpoint.known_hosts)
            ),
            "endpoint_epoch": 1,
            "auth_mode": "key_only",
            "old_password_rejected": old_password_rejected,
            "rotation_transitioned": False,
            "credential_recovery": recovery,
        }

    @staticmethod
    def _fingerprint_from_known_hosts(path: Path) -> str:
        keygen = shutil.which("ssh-keygen")
        if not keygen:
            raise AppError(503, "bootstrap_tools_missing", "Backend image lacks ssh-keygen")
        try:
            result = subprocess.run(
                [keygen, "-E", "sha256", "-lf", str(path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=20,
                check=False,
                text=True,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise AppError(503, "bootstrap_host_key_invalid", "Provider host key fingerprint is unavailable") from None
        match = re.search(r"SHA256:[A-Za-z0-9+/=]+", result.stdout)
        if result.returncode or match is None:
            raise AppError(503, "bootstrap_host_key_invalid", "Provider host key fingerprint is unavailable")
        return match.group(0)

    def bootstrap(self, token, *, attempt_id: str, temporary_sha256: str | None = None) -> dict:
        observation = self.lifecycle.bootstrap_observation(token)
        if observation.get("state") != "Running":
            return {"state": "pending", "provider_state": observation.get("state")}
        command = observation.get("ssh_login_command")
        password64 = observation.get("password_base64")
        if not command:
            raise AppError(502, "provider_ssh_identity_invalid", "Provider did not return an SSH login command")
        host, port, user = self.parse_endpoint(command)
        instance_id = observation.get("instance_id")
        if not isinstance(instance_id, str) or not _INSTANCE_RE.fullmatch(instance_id):
            raise AppError(502, "provider_instance_invalid", "Bootstrap observation has no verified instance identity")
        private, public, known_hosts = self.registry.material_paths(instance_id)
        endpoint = self.registry.get(instance_id)
        if endpoint is None or endpoint.host != host or endpoint.port != port:
            fingerprint = self._scan_host_keys(host, port, known_hosts)
            if not private.exists() or not public.exists():
                public_line = self._generate_key(private, public)
            else:
                public_line = public.read_text(encoding="utf-8").strip()
            endpoint = self.registry.register_instance(
                instance_id, host, port, user, private, known_hosts
            )
        else:
            fingerprint = self._fingerprint_from_known_hosts(known_hosts)
        key_login = self._key_login(endpoint)
        password = ""
        if not key_login:
            if not password64:
                raise AppError(409, "temporary_password_unavailable", "Temporary instance credential is unavailable; retain the instance")
            try:
                password = base64.b64decode(password64, validate=True).decode("ascii")
            except (ValueError, UnicodeDecodeError):
                raise AppError(502, "provider_credential_invalid", "Temporary provider credential is invalid") from None
            if not 8 <= len(password) <= 128:
                raise AppError(502, "provider_credential_invalid", "Temporary provider credential is invalid")
            if not self._password_login(endpoint, password):
                raise AppError(503, "bootstrap_transport_failed", "Temporary password login could not be confirmed")
            script = self._install_key_script(public.read_text(encoding="utf-8").strip())
            result = None
            for install_attempt in range(3):
                result = self._password_run(endpoint, password, script)
                if result.returncode == 0:
                    break
                if install_attempt < 2:
                    time.sleep(4)
            if result is None or result.returncode:
                raise AppError(
                    503,
                    "bootstrap_key_install_failed",
                    "Per-instance public key installation failed",
                    {
                        "attempts": 3,
                        "last_returncode": result.returncode if result else None,
                        "stdout_sha256": hashlib.sha256(result.stdout or b"").hexdigest() if result else None,
                        "stderr_sha256": hashlib.sha256(result.stderr or b"").hexdigest() if result else None,
                    },
                )
            if not self._key_login(endpoint):
                raise AppError(503, "bootstrap_key_login_failed", "Key-only login could not be verified")
        else:
            try:
                password = base64.b64decode(password64, validate=True).decode("ascii") if password64 else ""
            except (ValueError, UnicodeDecodeError):
                raise AppError(502, "provider_credential_invalid", "Temporary provider credential is invalid") from None
        if password and temporary_sha256 and password_sha256(password) != temporary_sha256:
            raise AppError(
                409,
                "credential_reconciliation_required",
                "实例密码已在未记录的状态下变化；为避免误判，训练不会开始。",
            )
        if not password:
            # The endpoint registry can survive a Worker restart while the
            # one-time provider password is no longer returned. The key is
            # already proven; lock the account password instead of pretending
            # that a provider-side reset happened.
            return self._finish_with_disabled_password(
                endpoint,
                temporary_sha256=temporary_sha256,
            )
        try:
            rotation = self._rotate(token, endpoint, password, temporary_sha256)
        except AppError:
            # ResetCompShareInstancePassword is not reliable for every
            # supported image/host path. Once key-only access is proven,
            # locking the account password and verifying that the provider
            # password no longer authenticates is the safe fallback.
            return self._finish_with_disabled_password(
                endpoint,
                temporary_sha256=temporary_sha256,
                old_password=password,
                recovery="password_disabled_after_reset_error",
            )
        endpoint = self.registry.get(instance_id)
        if endpoint is None:
            raise AppError(503, "ssh_endpoint_registration_failed", "Backend endpoint registration disappeared")
        return {
            "state": "ready",
            "credential_state": "rotated",
            "host_key_fingerprint": fingerprint,
            "endpoint_epoch": 1,
            "auth_mode": "key_only",
            "old_password_rejected": rotation["old_password_rejected"],
            "rotation_transitioned": rotation["transitioned"],
        }

    def ensure_runtime(self, instance_id: str, provider_profile: str) -> dict:
        if provider_profile == "training-base-b":
            return {"installed": False, "runtime_source": "prebuilt"}
        endpoint = self.registry.get(instance_id)
        if endpoint is None:
            raise AppError(503, "ssh_endpoint_registration_failed", "Managed instance endpoint is not registered")
        script = Path(__file__).parents[1].joinpath("runtimes", "prepare-gpu-runtime.sh").read_bytes()
        started = time.monotonic()
        # The script must be streamed as stdin while the mode is a positional
        # argument. Use a direct OpenSSH invocation so the no-venv bootstrap
        # path does not depend on the runtime being installed already.
        try:
            process = subprocess.run(
                self._ssh_base(endpoint, password_mode=False) + ["bash -s -- train"],
                input=script,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=1800,
                check=False,
                env={key: value for key, value in os.environ.items() if not key.startswith("SSH_")},
            )
        except (OSError, subprocess.TimeoutExpired):
            raise AppError(503, "runtime_install_timeout", "训练运行时安装超时或被中断") from None
        if process.returncode:
            raise AppError(503, "runtime_install_failed", "训练运行时安装失败，训练未开始")
        return {
            "installed": True,
            "runtime_source": "cold_install",
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }


def endpoint_registry(settings) -> EndpointRegistry:
    return EndpointRegistry(settings)
