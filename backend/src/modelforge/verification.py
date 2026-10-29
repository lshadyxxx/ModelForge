"""Real HTTP, PostgreSQL and MinIO acceptance probes. No fixture success paths."""
import argparse
import hashlib
import json
import os
from contextlib import contextmanager
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone
import httpx
from minio.error import S3Error
from modelforge.bootstrap import Resources
from modelforge.settings import get_settings
from modelforge.infrastructure.minio import read_object


class CheckFailed(RuntimeError):
    pass


class VerificationFailure(RuntimeError):
    def __init__(self, stage, message):
        super().__init__(message)
        self.stage = stage


@contextmanager
def stage(name, message):
    try:
        yield
    except VerificationFailure:
        raise
    except CheckFailed as error:
        raise VerificationFailure(name, str(error)) from error
    except Exception as error:
        # Driver/HTTP errors may contain credentials; retain only a fixed safe message.
        raise VerificationFailure(name, message) from error


def ensure(condition, message):
    if not condition:
        raise CheckFailed(message)


def payload(run_id):
    return ("ModelForge persistence probe: " + run_id + chr(10) + "真实存储验收 ✓" + chr(10)).encode() * 100


def check_receipt(receipt, resources, client):
    with stage("receipt_load", "Receipt identity is invalid"):
        file_id = uuid.UUID(receipt["file_id"])
    with stage("postgres_metadata", "Cannot query PostgreSQL metadata"):
        with resources.pool.connection() as connection:
            row = connection.execute("SELECT * FROM files WHERE id=%s", (file_id,)).fetchone()
        ensure(row is not None, "PostgreSQL metadata missing")
        for key in ["bucket", "object_key", "sha256", "size_bytes"]:
            ensure(row[key] == receipt[key], "Metadata mismatch: " + key)
        ensure(row["state"] == "available", "File not available")
    with stage("minio_read", "Cannot read MinIO object"):
        direct = read_object(resources.store, row["bucket"], row["object_key"])
    with stage("http_download", "HTTP file download failed"):
        downloaded = client.get("/api/v1/files/" + str(file_id) + "/content")
        downloaded.raise_for_status()
    with stage("checksum", "Content verification failed"):
        expected = payload(receipt["run_id"])
        ensure(direct == downloaded.content == expected, "Content differs")
        ensure(len(direct) == receipt["size_bytes"], "Size differs")
        ensure(hashlib.sha256(direct).hexdigest() == receipt["sha256"], "SHA256 differs")
    return {"postgres_metadata": "pass", "minio_read": "pass", "http_download": "pass", "checksum": "pass"}


def cleanup(receipt, resources, client):
    with stage("http_delete", "HTTP file deletion failed"):
        response = client.delete("/api/v1/files/" + receipt["file_id"])
        if response.status_code != 404:
            response.raise_for_status()
    with stage("postgres_cleanup", "Cannot confirm metadata cleanup"):
        with resources.pool.connection() as connection:
            row = connection.execute("SELECT id FROM files WHERE id=%s", (uuid.UUID(receipt["file_id"]),)).fetchone()
        ensure(row is None, "Metadata cleanup incomplete")
    with stage("minio_cleanup", "Cannot confirm object cleanup"):
        try:
            resources.store.stat_object(receipt["bucket"], receipt["object_key"])
        except S3Error as error:
            ensure(error.code == "NoSuchKey", "Unexpected object deletion result")
        else:
            raise CheckFailed("Object cleanup incomplete")


def persist_receipt(handle, receipt):
    handle.seek(0)
    handle.write(json.dumps(receipt, indent=2))
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())


def reset_pending(receipt_path):
    with stage("receipt_reset", "Cannot archive pending receipt"):
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        ensure(receipt.get("state") == "upload_pending" and not receipt.get("file_id"),
               "Only unresolved pending receipts may be archived; use cleanup for known files")
        archive = receipt_path.with_name(receipt_path.name + ".unresolved-" + uuid.uuid4().hex)
        receipt_path.rename(archive)
    print(json.dumps({"result": "pending_archived", "run_id": receipt.get("run_id"),
                      "archive": str(archive), "remote_cleanup_confirmed": False,
                      "message": "Remote outcome remains unknown; retain archive for reconciliation. A new probe may use the original path."}))


def run(mode, receipt_path, base_url, run_id):
    resources, receipt, receipt_file = None, None, None
    try:
        with stage("configuration", "Cannot initialize verification resources"):
            resources = Resources.open(get_settings())
        with httpx.Client(base_url=base_url, timeout=12, trust_env=False) as client:
            if mode in ["lifecycle", "prepare"]:
                with stage("receipt_prepare", "Cannot reserve receipt; choose a new writable receipt path"):
                    ensure(not receipt_path.exists(), "Receipt already exists; verify or clean it before creating another probe")
                    receipt_path.parent.mkdir(parents=True, exist_ok=True)
                    run_id = run_id or uuid.uuid4().hex
                    # Establish a durable local recovery slot before creating remote data.
                    receipt_file = receipt_path.open("x", encoding="utf-8")
                    receipt_file.write(json.dumps({"run_id": run_id, "state": "upload_pending"}))
                    receipt_file.flush()
                    os.fsync(receipt_file.fileno())
                with stage("http_upload", "HTTP file upload failed; inspect status and cleanup identity"):
                    response = client.post("/api/v1/files", content=payload(run_id))
                    if response.status_code != 201:
                        result = response.json()
                        file_id = result.get("error", {}).get("details", {}).get("file_id")
                        if file_id:
                            identity = str(uuid.UUID(file_id))
                            receipt = {"file_id": identity, "run_id": run_id, "state": "upload_failed",
                                       "bucket": resources.settings.minio_bucket, "object_key": "files/" + identity,
                                       "size_bytes": len(payload(run_id)), "sha256": hashlib.sha256(payload(run_id)).hexdigest()}
                            with stage("receipt_persist", "Cannot persist cleanup identity; use recovery_receipt"):
                                persist_receipt(receipt_file, receipt)
                        response.raise_for_status()
                    result = response.json()
                    receipt = {"file_id": str(uuid.UUID(result["id"])), "run_id": run_id,
                               **{key: result[key] for key in ["bucket", "object_key", "sha256", "size_bytes"]}}
                with stage("receipt_persist", "Upload succeeded but receipt could not be persisted; use recovery_receipt for cleanup"):
                    persist_receipt(receipt_file, receipt)
                    receipt_file.close()
                    receipt_file = None
            else:
                with stage("receipt_load", "Cannot read receipt; restore recovery_receipt if available"):
                    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            checks = check_receipt(receipt, resources, client) if mode != "cleanup" else {}
            if mode != "prepare":
                cleanup(receipt, resources, client)
                checks["object_deleted"] = checks["metadata_deleted"] = "pass"
                with stage("receipt_cleanup", "Remote cleanup succeeded but local receipt could not be removed"):
                    receipt_path.unlink()
            print(json.dumps({"result": "pass", "mode": mode, "run_id": receipt["run_id"],
                              "file_id": receipt["file_id"], "size_bytes": receipt["size_bytes"],
                              "sha256": receipt["sha256"], "checks": checks,
                              "retained_for_restart": mode == "prepare",
                              "checked_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False))
    except Exception:
        if receipt and receipt.get("file_id"):
            print(json.dumps({"cleanup_required_file_id": receipt["file_id"],
                              "recovery_receipt": receipt}), file=sys.stderr)
        raise
    finally:
        if receipt_file is not None:
            receipt_file.close()
        if resources is not None:
            resources.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["lifecycle", "prepare", "verify", "cleanup", "reset-pending"])
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--base-url", default="http://api:8102")
    parser.add_argument("--run-id")
    args = parser.parse_args()
    try:
        if args.mode == "reset-pending":
            reset_pending(args.receipt)
        else:
            run(args.mode, args.receipt, args.base_url, args.run_id)
    except Exception as error:
        # Do not print transport exceptions: they may include URLs with credentials.
        print(json.dumps({"result": "fail", "mode": args.mode, "stage": error.stage if isinstance(error, VerificationFailure) else "verification",
                          "message": str(error) if isinstance(error, VerificationFailure) else "Verification incomplete; inspect status and retry cleanup"}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
