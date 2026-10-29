import urllib3
from minio import Minio
from modelforge.settings import Settings


def create_store(settings: Settings) -> Minio:
    return Minio(settings.minio_endpoint, access_key=settings.minio_access_key.get_secret_value(),
                 secret_key=settings.minio_secret_key.get_secret_value(), secure=settings.minio_secure,
                 http_client=urllib3.PoolManager(timeout=urllib3.Timeout(connect=2, read=2),
                                                retries=False, maxsize=4))


def read_object(store, bucket: str, key: str) -> bytes:
    response = store.get_object(bucket, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()
