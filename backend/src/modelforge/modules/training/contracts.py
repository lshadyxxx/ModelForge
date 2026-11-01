"""Training-owned boundary for runtime preparation and report interpretation."""
from dataclasses import dataclass
from typing import Callable, Protocol

@dataclass(frozen=True)
class TrainingPlan:
    files: dict[str, bytes]
    argv: tuple[str, ...]

class TrainingExecutor(Protocol):
    evidence_files: tuple[str, ...]
    required_evidence: frozenset[str]
    def prepare(self, dataset: dict, config: dict, model_path: str) -> TrainingPlan: ...
    def reports(self, read_json: Callable[[str], dict]) -> dict: ...
    def result(self, read_json: Callable[[str], dict]) -> dict: ...
    def failure_code(self, read_json: Callable[[str], dict]) -> str: ...
