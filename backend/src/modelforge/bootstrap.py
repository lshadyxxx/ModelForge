from dataclasses import dataclass
from modelforge.settings import Settings
from modelforge.infrastructure.postgres import create_pool
from modelforge.infrastructure.minio import create_store


@dataclass
class Resources:
    settings: Settings
    pool: object
    store: object

    @classmethod
    def open(cls, settings: Settings):
        pool = create_pool(settings)
        pool.open(wait=False)
        return cls(settings, pool, create_store(settings))

    def close(self):
        self.pool.close(timeout=3)
        self.store._http.clear()
