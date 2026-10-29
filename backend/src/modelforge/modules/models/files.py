"""Verified formal-file registry; no training or dataset semantics yet."""
import hashlib
import io
import uuid
from minio.error import S3Error
from modelforge.errors import AppError
from modelforge.infrastructure.minio import read_object


class FileRegistry:
    def __init__(self, resources):
        self.pool, self.store = resources.pool, resources.store
        self.bucket = resources.settings.minio_bucket

    def get(self, file_id):
        try:
            with self.pool.connection() as connection:
                row = connection.execute("SELECT * FROM files WHERE id = %s", (file_id,)).fetchone()
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "PostgreSQL is unavailable") from error
        if row is None:
            raise AppError(404, "not_found", "File not found")
        return row

    def _state(self, file_id, state):
        with self.pool.connection() as connection:
            connection.execute("UPDATE files SET state=%s, updated_at=now() WHERE id=%s", (state, file_id))

    def upload(self, data: bytes, content_type: str):
        file_id = uuid.uuid4()
        digest = hashlib.sha256(data).hexdigest()
        key = "files/" + str(file_id)
        try:
            with self.pool.connection() as connection:
                connection.execute("INSERT INTO files (id,bucket,object_key,size_bytes,sha256,content_type,state) VALUES (%s,%s,%s,%s,%s,%s,'pending')",
                                   (file_id, self.bucket, key, len(data), digest, content_type))
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "Cannot confirm file metadata creation",
                           {"file_id": str(file_id)}) from error
        try:
            self.store.put_object(self.bucket, key, io.BytesIO(data), len(data), content_type=content_type)
            downloaded = read_object(self.store, self.bucket, key)
            if len(downloaded) != len(data) or hashlib.sha256(downloaded).hexdigest() != digest:
                raise ValueError("Stored content mismatch")
            self._state(file_id, "available")
            return self.get(file_id)
        except Exception as error:
            try:
                self._state(file_id, "upload_failed")
            except Exception:
                pass  # A persisted pending row still truthfully indicates incomplete publication.
            raise AppError(503, "dependency_unavailable", "File upload or verification failed; retry cleanup with file_id",
                           {"file_id": str(file_id)}) from error

    def download(self, file_id):
        row = self.get(file_id)
        if row["state"] != "available":
            raise AppError(409, "conflict", "File is not available")
        try:
            data = read_object(self.store, row["bucket"], row["object_key"])
            if len(data) != row["size_bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
                raise ValueError("Content checksum mismatch")
            return row, data
        except Exception as error:
            raise AppError(503, "dependency_unavailable", "Cannot read verified file content") from error

    def delete(self, file_id):
        row = self.get(file_id)
        try:
            self._state(file_id, "deleting")
            self.store.remove_object(row["bucket"], row["object_key"])
            try:
                self.store.stat_object(row["bucket"], row["object_key"])
            except S3Error as error:
                if error.code != "NoSuchKey":
                    raise
            else:
                raise ValueError("Object still exists")
            with self.pool.connection() as connection:
                connection.execute("DELETE FROM files WHERE id=%s", (file_id,))
        except Exception as error:
            try:
                self._state(file_id, "delete_failed")
            except Exception:
                pass
            raise AppError(503, "dependency_unavailable", "File cleanup incomplete; retry deletion",
                           {"file_id": str(file_id)}) from error
