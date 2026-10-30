from dataclasses import dataclass
import httpx
from modelforge.settings import Settings
from modelforge.infrastructure.postgres import create_pool
from modelforge.infrastructure.minio import create_store


@dataclass
class Resources:
    settings: Settings
    pool: object
    store: object
    source_http: object = None

    @classmethod
    def open(cls, settings: Settings):
        pool = create_pool(settings)
        pool.open(wait=False)
        return cls(settings, pool, create_store(settings),
                   httpx.Client(timeout=httpx.Timeout(30, connect=10), trust_env=False,
                                follow_redirects=False, limits=httpx.Limits(max_connections=4)))

    def close(self):
        if self.source_http is not None:
            self.source_http.close()
        self.pool.close(timeout=3)
        self.store._http.clear()
