"""The DatasetVersion interface: validation, storage, publication, and deletion."""
from __future__ import annotations

import hashlib
import io
import json
import uuid
from typing import Any

from minio.error import S3Error
from psycopg.types.json import Jsonb

from modelforge.errors import AppError
from modelforge.infrastructure.minio import read_object
from .validation import DatasetLimits, build_split, validate_messages_jsonl


def _missing_object(error: S3Error) -> bool:
    return error.code in {"NoSuchKey", "NoSuchObject"}


class DatasetRegistry:
    """Own DatasetVersion rules while hiding PostgreSQL and MinIO details."""

    def __init__(self, resources):
        self.pool = resources.pool
        self.store = resources.store
        self.settings = resources.settings
        self.bucket = resources.settings.minio_bucket
        self.limits = DatasetLimits(
            max_bytes=resources.settings.dataset_file_limit_bytes,
            max_samples=resources.settings.dataset_sample_limit,
            max_line_bytes=resources.settings.dataset_line_limit_bytes,
            max_errors=resources.settings.dataset_validation_error_limit,
            preview_samples=resources.settings.dataset_preview_samples,
        )

    @staticmethod
    def _references_for(connection, version_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = list(connection.execute(
            "SELECT reference_type, reference_id, created_at FROM dataset_version_references WHERE dataset_version_id=%s ORDER BY created_at",
            (version_id,),
        ).fetchall())
        for row in rows:
            if hasattr(row.get("created_at"), "isoformat"):
                row["created_at"] = row["created_at"].isoformat()
        return rows

    @staticmethod
    def _select_row(connection, version_id: uuid.UUID, *, for_update: bool = False):
        query = """SELECT v.*, d.name AS dataset_name
                   FROM dataset_versions v JOIN datasets d ON d.id=v.dataset_id
                   WHERE v.id=%s"""
        if for_update:
            query += " FOR UPDATE"
        return connection.execute(query, (version_id,)).fetchone()

    def _row(self, version_id: uuid.UUID) -> dict[str, Any]:
        try:
            with self.pool.connection() as connection:
                row = self._select_row(connection, version_id)
                if row is None:
                    raise AppError(404, "not_found", "DatasetVersion not found")
                row["references"] = self._references_for(connection, version_id)
        except AppError:
            raise
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "PostgreSQL is unavailable") from error
        return row

    def list(self) -> list[dict[str, Any]]:
        try:
            with self.pool.connection() as connection:
                rows = connection.execute(
                    """SELECT d.id AS dataset_id, d.name, d.created_at,
                              v.id AS version_id, v.version_number, v.state,
                              v.size_bytes, v.sha256, v.sample_count, v.line_count,
                              v.created_at AS version_created_at, v.published_at
                       FROM datasets d JOIN dataset_versions v ON v.dataset_id=d.id
                       ORDER BY d.created_at DESC, v.version_number DESC"""
                ).fetchall()
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "PostgreSQL is unavailable") from error
        return list(rows)

    def create(self, data: bytes, name: str | None, dataset_id: uuid.UUID | None = None) -> dict[str, Any]:
        if dataset_id is None and (not name or not name.strip()):
            raise AppError(422, "validation_error", "Dataset name must not be empty", [{"path": "query.name", "message": "不能为空"}])
        result = validate_messages_jsonl(data, self.limits)
        version_id = uuid.uuid4()
        is_new_dataset = dataset_id is None
        dataset_id = dataset_id or uuid.uuid4()
        object_key = f"datasets/{dataset_id}/versions/{version_id}/source.jsonl"
        state = "draft" if result.valid else "invalid"
        try:
            with self.pool.connection() as connection:
                if is_new_dataset:
                    connection.execute("INSERT INTO datasets (id,name) VALUES (%s,%s)", (dataset_id, name.strip()))
                    version_number = 1
                else:
                    if connection.execute("SELECT 1 FROM datasets WHERE id=%s FOR UPDATE", (dataset_id,)).fetchone() is None:
                        raise AppError(404, "not_found", "Dataset not found")
                    version_number = connection.execute(
                        "SELECT COALESCE(MAX(version_number),0)+1 AS next_version FROM dataset_versions WHERE dataset_id=%s",
                        (dataset_id,),
                    ).fetchone()["next_version"]
                connection.execute(
                    """INSERT INTO dataset_versions
                       (id,dataset_id,version_number,bucket,object_key,size_bytes,sha256,line_count,sample_count,state,validation_errors,preview)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)""",
                    (version_id, dataset_id, version_number, self.bucket, object_key, len(data), result.sha256,
                     result.line_count, len(result.samples), Jsonb(result.errors), Jsonb(result.preview)),
                )
        except AppError:
            raise
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "Cannot create dataset metadata", {
                "dataset_id": str(dataset_id), "version_id": str(version_id),
            }) from error
        try:
            self.store.put_object(self.bucket, object_key, io.BytesIO(data), len(data), content_type="application/x-ndjson")
            if read_object(self.store, self.bucket, object_key) != data:
                raise ValueError("Dataset content mismatch")
            with self.pool.connection() as connection:
                connection.execute("UPDATE dataset_versions SET state=%s, updated_at=now() WHERE id=%s", (state, version_id))
        except Exception as error:
            cleanup_confirmed = True
            try:
                self.store.remove_object(self.bucket, object_key)
            except Exception:
                cleanup_confirmed = False
            self._set_state(version_id, "upload_failed")
            raise AppError(503, "dependency_unavailable", "Dataset upload or verification failed", {
                "dataset_id": str(dataset_id),
                "version_id": str(version_id),
                "bucket": self.bucket,
                "object_key": object_key,
                "cleanup_required": not cleanup_confirmed,
            }) from error
        row = self._row(version_id)
        if not result.valid:
            raise AppError(422, "dataset_invalid", "Dataset cannot be published until validation errors are fixed", {
                "dataset_id": str(dataset_id), "version_id": str(version_id), "errors": result.errors,
            })
        return row

    def create_version(self, data: bytes, dataset_id: uuid.UUID) -> dict[str, Any]:
        return self.create(data, None, dataset_id)

    def get(self, version_id: uuid.UUID) -> dict[str, Any]:
        row = self._row(version_id)
        row["split"] = None
        if row["split_object_key"]:
            try:
                stored = read_object(self.store, row["bucket"], row["split_object_key"])
                if hashlib.sha256(stored).hexdigest() != row["split_sha256"]:
                    raise ValueError("Dataset split checksum mismatch")
                manifest = json.loads(stored)
                inner_digest = manifest.pop("sha256", None)
                canonical = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
                if inner_digest != hashlib.sha256(canonical).hexdigest():
                    raise ValueError("Dataset split manifest checksum mismatch")
                row["split"] = {
                    "sample_count": manifest["sample_count"],
                    "train_count": len(manifest["train_lines"]),
                    "validation_count": manifest["validation_count"],
                    "requested_ratio": manifest["requested_ratio"],
                    "actual_ratio": manifest["actual_ratio"],
                    "seed": manifest["seed"],
                }
            except Exception as error:
                raise AppError(503, "dependency_unavailable", "Cannot read verified DatasetVersion split") from error
        return row

    def download(self, version_id: uuid.UUID) -> tuple[dict[str, Any], bytes]:
        row = self._row(version_id)
        if row["state"] not in {"draft", "invalid", "published"}:
            raise AppError(409, "conflict", "DatasetVersion is not downloadable", {"state": row["state"]})
        try:
            data = read_object(self.store, row["bucket"], row["object_key"])
            if len(data) != row["size_bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                raise ValueError("Dataset checksum mismatch")
            return row, data
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "Cannot read verified DatasetVersion") from error

    def split(self, version_id: uuid.UUID, ratio: float = 0.1, seed: int = 42) -> dict[str, Any]:
        object_written = False
        object_write_attempted = False
        row = None
        key = None
        try:
            with self.pool.connection() as connection:
                row = self._select_row(connection, version_id, for_update=True)
                if row is None:
                    raise AppError(404, "not_found", "DatasetVersion not found")
                if row["state"] not in {"draft", "published"}:
                    raise AppError(409, "conflict", "Only a valid DatasetVersion can be split", {"state": row["state"]})
                if row["split_object_key"]:
                    requested_ratio = row["split_requested_ratio"] if row["split_requested_ratio"] is not None else row["split_ratio"]
                    if float(requested_ratio) != ratio or row["split_seed"] != seed:
                        raise AppError(409, "conflict", "DatasetVersion already has a different split", {
                            "split_ratio": float(requested_ratio), "split_seed": row["split_seed"],
                        })
                    source = read_object(self.store, row["bucket"], row["object_key"])
                    if len(source) != row["size_bytes"] or hashlib.sha256(source).hexdigest() != row["sha256"]:
                        raise ValueError("Dataset checksum mismatch")
                    stored = read_object(self.store, row["bucket"], row["split_object_key"])
                    if hashlib.sha256(stored).hexdigest() != row["split_sha256"]:
                        raise ValueError("Dataset split checksum mismatch")
                    manifest = json.loads(stored)
                    inner_digest = manifest.pop("sha256", None)
                    canonical = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
                    if inner_digest != hashlib.sha256(canonical).hexdigest():
                        raise ValueError("Dataset split manifest checksum mismatch")
                else:
                    data = read_object(self.store, row["bucket"], row["object_key"])
                    if len(data) != row["size_bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                        raise ValueError("Dataset checksum mismatch")
                    result = validate_messages_jsonl(data, self.limits)
                    if not result.valid:
                        raise AppError(422, "dataset_invalid", "DatasetVersion validation is no longer valid", {"errors": result.errors})
                    try:
                        manifest = build_split(result.samples, ratio, seed)
                    except ValueError as error:
                        raise AppError(422, "validation_error", str(error), [{"path": "split", "message": str(error)}]) from error
                    key = f"datasets/{row['dataset_id']}/versions/{version_id}/split.json"
                    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
                    object_write_attempted = True
                    self.store.put_object(row["bucket"], key, io.BytesIO(encoded), len(encoded), content_type="application/json")
                    object_written = True
                    if read_object(self.store, row["bucket"], key) != encoded:
                        raise ValueError("Dataset split content mismatch")
                    connection.execute(
                        """UPDATE dataset_versions SET split_object_key=%s, split_sha256=%s, split_requested_ratio=%s, split_ratio=%s, split_seed=%s, updated_at=now()
                           WHERE id=%s""",
                        (key, hashlib.sha256(encoded).hexdigest(), manifest["requested_ratio"], manifest["actual_ratio"], seed, version_id),
                    )
        except AppError:
            raise
        except Exception as error:
            cleanup_confirmed = True
            if object_write_attempted:
                try:
                    self.store.remove_object(row["bucket"], key)
                except Exception:
                    cleanup_confirmed = False
            details = {"version_id": str(version_id)}
            if object_write_attempted:
                details.update({
                    "bucket": row["bucket"],
                    "object_key": key,
                    "cleanup_required": not cleanup_confirmed,
                })
            raise AppError(503, "dependency_unavailable", "Cannot persist DatasetVersion split", details) from error
        return self._row(version_id)

    def publish(self, version_id: uuid.UUID, ratio: float = 0.1, seed: int = 42) -> dict[str, Any]:
        row = self._row(version_id)
        if row["state"] == "published":
            self.split(version_id, ratio, seed)
            return row
        if row["state"] != "draft":
            raise AppError(409, "conflict", "Only a valid draft can be published", {"state": row["state"]})
        self.split(version_id, ratio, seed)
        try:
            with self.pool.connection() as connection:
                result = connection.execute(
                    "UPDATE dataset_versions SET state='published', published_at=now(), updated_at=now() WHERE id=%s AND state='draft'",
                    (version_id,),
                )
                if result.rowcount != 1:
                    raise AppError(409, "conflict", "DatasetVersion state changed before publication")
        except Exception as error:
            if isinstance(error, AppError):
                raise
            raise AppError(503, "dependency_unavailable", "Cannot publish DatasetVersion metadata") from error
        return self._row(version_id)

    def delete(self, version_id: uuid.UUID) -> None:
        try:
            with self.pool.connection() as connection:
                row = self._select_row(connection, version_id, for_update=True)
                if row is None:
                    raise AppError(404, "not_found", "DatasetVersion not found")
                references = self._references_for(connection, version_id)
                if references:
                    raise AppError(409, "conflict", "DatasetVersion is referenced and cannot be deleted", {"references": references})
                connection.execute("UPDATE dataset_versions SET state='deleting', updated_at=now() WHERE id=%s", (version_id,))
                for key in (row["object_key"], row["split_object_key"]):
                    if not key:
                        continue
                    self.store.remove_object(row["bucket"], key)
                    try:
                        self.store.stat_object(row["bucket"], key)
                    except S3Error as error:
                        if _missing_object(error):
                            continue
                        raise
                    raise ValueError("Dataset object still exists")
                connection.execute("DELETE FROM dataset_versions WHERE id=%s", (version_id,))
        except AppError:
            raise
        except Exception as error:
            self._set_state(version_id, "delete_failed")
            raise AppError(503, "dependency_unavailable", "Dataset cleanup incomplete; retry deletion", {"version_id": str(version_id)}) from error

    def _set_state(self, version_id: uuid.UUID, state: str) -> None:
        try:
            with self.pool.connection() as connection:
                connection.execute("UPDATE dataset_versions SET state=%s, updated_at=now() WHERE id=%s", (state, version_id))
        except Exception:
            pass

    def pin(self, version_id, reference_type, reference_id, *, connection):
        """Pin a published version inside the caller transaction, including its split."""
        row = self._select_row(connection, version_id, for_update=True)
        if row is None:
            raise AppError(404, 'not_found', 'DatasetVersion not found')
        if row['state'] != 'published' or not row['split_sha256']:
            raise AppError(409, 'dataset_not_published', 'Publish a dataset with a fixed split before training')
        connection.execute('''INSERT INTO dataset_version_references(dataset_version_id,reference_type,reference_id)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING''', (version_id, reference_type, reference_id))
        return {key: str(row[key]) if key == 'id' else row[key] for key in
                ('id','bucket','object_key','size_bytes','sha256','split_object_key','split_sha256','sample_count')}

    def execution_data(self, snapshot):
        """Return exact physical source lines using the published immutable manifest."""
        source = read_object(self.store, snapshot['bucket'], snapshot['object_key'])
        split = read_object(self.store, snapshot['bucket'], snapshot['split_object_key'])
        if (len(source) != snapshot['size_bytes'] or hashlib.sha256(source).hexdigest() != snapshot['sha256']
                or hashlib.sha256(split).hexdigest() != snapshot['split_sha256']):
            raise AppError(503, 'dataset_integrity_failed', 'Frozen dataset or split integrity verification failed')
        manifest = json.loads(split); lines = source.splitlines()
        return {role: [{'source_line': number, **json.loads(lines[number-1])} for number in manifest[key]]
                for role, key in [('train','train_lines'),('validation','validation_lines')]}
