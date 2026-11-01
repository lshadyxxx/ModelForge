"""Serving-owned boundary; runtime implementations do not write platform state."""
from dataclasses import dataclass
from typing import Protocol

@dataclass(frozen=True)
class ServingPlan:
    files: dict[str, bytes]
    argv: tuple[str, ...]

class ServingExecutor(Protocol):
    def prepare(self, model_path: str, config: dict, adapter_fingerprint: str) -> ServingPlan: ...
    def ready(self, health: dict, adapter_fingerprint: str) -> bool: ...
