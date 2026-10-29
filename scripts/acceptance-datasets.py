"""Verify the DatasetVersion lifecycle against real Compose PostgreSQL and MinIO."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
BASE = ["docker", "compose", "--project-name", "modelforge", "--project-directory", str(ROOT)]


def ensure(condition: bool, message: str):
    if not condition:
        raise RuntimeError(message)


def run_command(parts: list[str], *, input_text: str | None = None):
    result = subprocess.run(
        BASE + parts,
        cwd=ROOT,
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    ensure(result.returncode == 0, f"Command failed: {parts}\n{result.stderr}")
    return result.stdout.strip()


def psql(sql: str) -> str:
    return run_command(["exec", "-T", "postgres", "psql", "-U", "modelforge", "-d", "modelforge", "-At", "-c", sql])


def minio_probe(bucket: str, key: str) -> dict:
    code = (
        "import hashlib,json; "
        "from modelforge.settings import get_settings; "
        "from modelforge.infrastructure.minio import create_store,read_object; "
        f"s=get_settings(); m=create_store(s); b={bucket!r}; k={key!r}; "
        "d=read_object(m,b,k); "
        "print(json.dumps({'size':len(d),'sha256':hashlib.sha256(d).hexdigest()}))"
    )
    return json.loads(run_command(["exec", "-T", "api", "python", "-c", code]))


def minio_json_probe(bucket: str, key: str) -> dict:
    code = (
        "import json; "
        "from modelforge.settings import get_settings; "
        "from modelforge.infrastructure.minio import create_store,read_object; "
        f"s=get_settings(); m=create_store(s); b={bucket!r}; k={key!r}; "
        "print(read_object(m,b,k).decode('utf-8'))"
    )
    return json.loads(run_command(["exec", "-T", "api", "python", "-c", code]))


def request(method: str, path: str, body: bytes | None = None, query: str = ""):
    url = f"http://127.0.0.1:8102{path}{query}"
    headers = {"Content-Type": "application/x-ndjson"} if body is not None else {}
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, raw, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def main():
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    valid = b"\n".join(
        json.dumps(
            {"messages": [{"role": "user", "content": f"question-{index}"}, {"role": "assistant", "content": f"answer-{index}"}]}
        ).encode()
        for index in range(10)
    ) + b"\n"
    invalid = b'{"messages":[{"role":"user","content":"missing assistant"}]}\n{"messages":[{"role":[],"content":"bad role"}]}\nnot-json\n'
    created_id = None
    invalid_id = None
    try:
        status, raw, _ = request("POST", "/api/v1/datasets", valid, f"?name=acceptance-{run_id}")
        ensure(status == 201, f"Dataset create failed: {status} {raw!r}")
        created = json.loads(raw)
        created_id = created["id"]
        ensure(created["object_key"].startswith(f"datasets/{created['dataset_id']}/"), "Object key does not preserve dataset identity")
        direct = json.loads(psql(f"SELECT row_to_json(x) FROM (SELECT state,sample_count,sha256 FROM dataset_versions WHERE id='{created_id}'::uuid) x;"))
        ensure(direct["state"] == "draft" and direct["sample_count"] == 10, "PostgreSQL DatasetVersion metadata mismatch")
        source_probe = minio_probe(created["bucket"], created["object_key"])
        ensure(source_probe == {"size": len(valid), "sha256": hashlib.sha256(valid).hexdigest()}, "MinIO source object mismatch")

        status, raw, _ = request("POST", f"/api/v1/dataset-versions/{created_id}/split")
        ensure(status == 200, f"Split failed: {status} {raw!r}")
        split = json.loads(raw)
        ensure(split["split_object_key"] and split["split_sha256"], "Split metadata missing")
        manifest = minio_json_probe(created["bucket"], split["split_object_key"])
        ensure(len(manifest["validation_lines"]) == 1 and len(manifest["train_lines"]) == 9, "Unexpected 10% split")
        split_probe = minio_probe(created["bucket"], split["split_object_key"])
        ensure(split_probe["sha256"] == split["split_sha256"], "MinIO split manifest checksum mismatch")
        status, raw, _ = request("POST", f"/api/v1/dataset-versions/{created_id}/split")
        ensure(status == 200 and json.loads(raw)["split_sha256"] == split["split_sha256"], "Split retry changed the manifest")

        status, raw, _ = request("POST", f"/api/v1/dataset-versions/{created_id}/publish")
        ensure(status == 200 and json.loads(raw)["state"] == "published", "Publish failed")
        status, raw, headers = request("GET", f"/api/v1/dataset-versions/{created_id}/content")
        ensure(status == 200 and raw == valid, "Dataset download bytes mismatch")
        checksum_header = next((value for name, value in headers.items() if name.lower() == "x-content-sha256"), None)
        ensure(checksum_header == hashlib.sha256(valid).hexdigest(), "Dataset download checksum mismatch")

        status, raw, _ = request("POST", "/api/v1/datasets", invalid, f"?name=invalid-{run_id}")
        ensure(status == 422, f"Invalid dataset unexpectedly accepted: {status}")
        details = json.loads(raw)["error"]["details"]
        invalid_id = details["version_id"]
        ensure(any(error["line"] == 1 for error in details["errors"]), "Missing physical-line validation error")
        invalid_row = json.loads(request("GET", f"/api/v1/dataset-versions/{invalid_id}")[1])
        ensure(invalid_row["state"] == "invalid", "Invalid DatasetVersion was published")
        ensure(request("DELETE", f"/api/v1/dataset-versions/{invalid_id}")[0] == 204, "Invalid DatasetVersion cleanup failed")

        psql(f"INSERT INTO dataset_version_references(dataset_version_id,reference_type,reference_id) VALUES ('{created_id}'::uuid,'acceptance','dataset-reference');")
        status, raw, _ = request("DELETE", f"/api/v1/dataset-versions/{created_id}")
        ensure(status == 409, f"Referenced DatasetVersion deletion was not blocked: {status} {raw!r}")
        reference_body = json.loads(raw)
        ensure(reference_body["error"]["details"]["references"][0]["reference_type"] == "acceptance", "Reference reason missing")
        psql(f"DELETE FROM dataset_version_references WHERE dataset_version_id='{created_id}'::uuid;")
        ensure(request("DELETE", f"/api/v1/dataset-versions/{created_id}")[0] == 204, "DatasetVersion deletion failed")
        ensure(request("GET", f"/api/v1/dataset-versions/{created_id}")[0] == 404, "Deleted DatasetVersion remains visible")
        print(json.dumps({"status": "pass", "run_id": run_id, "version_id": created_id, "source_sha256": hashlib.sha256(valid).hexdigest(), "validation_split": manifest["validation_lines"]}, ensure_ascii=False))
    finally:
        if invalid_id:
            request("DELETE", f"/api/v1/dataset-versions/{invalid_id}")
        if created_id:
            psql(f"DELETE FROM dataset_version_references WHERE dataset_version_id='{created_id}'::uuid;")
            request("DELETE", f"/api/v1/dataset-versions/{created_id}")


if __name__ == "__main__":
    main()
