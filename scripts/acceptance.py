"""Verify the ModelForge Compose stack. Stops this project at completion; retains docker-db."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8102")
    parser.add_argument("--web", default="http://127.0.0.1:8092")
    parser.add_argument("--evidence", type=Path, default=ROOT / ".runtime/acceptance.jsonl")
    args = parser.parse_args()
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    receipts = ROOT / ".runtime/acceptance-receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    override = ROOT / ".runtime/migration-failure.compose.yaml"
    base = ["docker", "compose", "--project-name", "modelforge", "--project-directory", str(ROOT), "-f", str(ROOT/"compose.yaml")]
    def record(kind, **fields):
        with args.evidence.open("a", encoding="utf-8") as log:
            log.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "run_id": run_id, "kind": kind, **fields}, ensure_ascii=False) + chr(10))
    def command(parts, check=True, prefix=None):
        result = subprocess.run((prefix or base) + parts, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240)
        record("compose", arguments=parts, returncode=result.returncode, stdout=result.stdout, stderr=result.stderr)
        if check and result.returncode:
            raise RuntimeError("Compose failed: " + str(parts))
        return result
    def http(path, origin=None):
        url = (origin or args.api) + path
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                code, raw = response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            code, raw = error.code, error.read().decode()
        record("http", url=url, status=code, body=raw)
        return code, json.loads(raw) if raw.startswith("{") else raw
    def wait_status(down=None):
        end = time.monotonic()+50
        while time.monotonic() < end:
            try:
                code, body = http("/api/v1/status")
                expected = {name: "down" if name == down else "up" for name in ["api", "postgres", "minio", "worker"]}
                if code == 200 and all(body["components"][name]["state"] == state for name,state in expected.items()):
                    return body
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise AssertionError("Components did not reach expected state: " + str(down))
    def verify(mode):
        return command(["run", "--rm", "--no-deps", "-v", str(receipts)+":/receipts", "api", "python", "-m", "modelforge.verification", mode, "--receipt", "/receipts/"+run_id+".json", "--run-id", run_id])
    try:
        wait_status()
        ensure(http("/", args.web)[0] == 200, "Web root must return HTTP 200")
        ensure(http("/api/v1/status", args.web)[0] == 200, "Same-origin status must return HTTP 200")
        command(["run", "--rm", "--no-deps", "migrate"])
        command(["run", "--rm", "--no-deps", "migrate"])
        verify("lifecycle")
        verify("prepare")
        command(["down", "--timeout", "20"])
        command(["up", "-d", "--wait", "--wait-timeout", "180"])
        wait_status()
        verify("verify")
        api_id = command(["ps", "-q", "api"]).stdout.strip()
        api_started = command(["--format", "{{.State.StartedAt}}", api_id], prefix=["docker", "inspect"]).stdout.strip()
        for service in ["postgres", "minio", "worker"]:
            try:
                command(["stop", service])
                wait_status(service)
                if service == "postgres":
                    # Exceed the pool's retry window and the former eight-waiter
                    # limit, as a continuously polling workbench does.
                    end = time.monotonic() + 40
                    while time.monotonic() < end:
                        ensure(http("/api/v1/status", args.web)[1]["components"][service]["state"] == "down",
                               "Stopped PostgreSQL must remain down during extended outage")
                        time.sleep(1)
                ensure(http("/api/v1/health/live")[0] == 200, "API liveness must remain available")
                ensure(http("/api/v1/health/ready")[0] == (200 if service == "worker" else 503), "Readiness misreports dependency failure: " + service)
                ensure(http("/api/v1/status", args.web)[1]["components"][service]["state"] == "down", "Proxy status must reflect stopped dependency")
            finally:
                command(["start", service])
            wait_status()
            ensure(command(["ps", "-q", "api"]).stdout.strip() == api_id,
                   "Dependency recovery must not require API container recreation")
            ensure(command(["--format", "{{.State.StartedAt}}", api_id], prefix=["docker", "inspect"]).stdout.strip() == api_started,
                   "Dependency recovery must not require API restart")
        # The recovered API's own pool must support writes and reads too, not
        # merely fresh connections from an independent verification process.
        verify("lifecycle")
        command(["stop", "api"])
        command(["exec", "-T", "worker", "python", "-c", "import urllib.request; raise SystemExit(0 if urllib.request.urlopen('http://localhost:8103/health/live',timeout=2).status == 200 else 1)"])
        command(["start", "api"])
        wait_status()
        command(["stop", "web", "api", "worker"])
        command(["rm", "-f", "web", "api", "worker", "migrate"])
        override.write_text("services:"+chr(10)+"  migrate:"+chr(10)+"    command: [python, -c, 'raise SystemExit(37)']"+chr(10), encoding="utf-8")
        failed = command(["up", "-d", "api", "worker"], check=False, prefix=base+["-f", str(override)])
        ensure(failed.returncode != 0, "Failed migration allowed startup")
        ensure(not command(["ps", "--status", "running", "-q", "api", "worker"]).stdout.strip(), "Application running despite migration failure")
        command(["rm", "-f", "api", "worker", "migrate"])
        command(["up", "-d", "--wait", "--wait-timeout", "180"])
        wait_status()
        record("result", status="pass", note="Real CLI/HTTP gates passed; visual UI fault checks remain separate.")
        print("PASS: real service acceptance; evidence: " + str(args.evidence))
    except Exception as error:
        record("result", status="fail", error_type=type(error).__name__, message=str(error))
        raise
    finally:
        command(["down", "--timeout", "20"])
        if override.exists():
            override.unlink()


if __name__ == "__main__":
    main()
