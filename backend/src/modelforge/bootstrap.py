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


@dataclass(frozen=True)
class RemoteServices:
    channel: object
    lifecycle: object


def remote_services(resources):
    """Shared HTTP/Worker transport assembly; no model runtime is created."""
    from modelforge.infrastructure.remote import RemoteChannel
    from modelforge.infrastructure.ucloud import UCloudInstances
    from modelforge.modules.resources import GpuLeases, InstanceLifecycle
    return RemoteServices(RemoteChannel(resources.settings),
        InstanceLifecycle(GpuLeases(resources.pool),UCloudInstances(resources.settings,resources.source_http)))


def execution_workers(resources):
    """Worker-only preset assembly behind the module-owned executor contracts."""
    from modelforge.modules.training import TrainingWorker
    from modelforge.modules.serving import ServingWorker
    from modelforge.runtimes.executors import LlamaFactoryExecutor, VllmExecutor
    remote=remote_services(resources)
    return (TrainingWorker(resources,remote.channel,remote.lifecycle,LlamaFactoryExecutor()),
            ServingWorker(resources,remote.channel,remote.lifecycle,VllmExecutor()))
