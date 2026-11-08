"""Worker driver for advisory diagnosis jobs."""
from __future__ import annotations

import logging
import os
import socket
import threading
import uuid

from modelforge.errors import AppError

from .checkpoint import (
    checkpoint_saver,
    cleanup_expired,
)
from .evidence import EvidenceCollector
from .generator import LangChainOpenAIGenerator
from .graph import build_diagnosis_graph, graph_config, initial_state
from .repository import DiagnosisRepository
from .validator import ReportValidator


logger = logging.getLogger(__name__)


class LeaseHeartbeat:
    """Renew a diagnosis lease while a long model call is in flight."""

    def __init__(
        self,
        repository,
        *,
        job_id,
        owner: str,
        fencing_token: int,
        lease_seconds: int,
        interval_seconds: float | None = None,
    ):
        self.repository = repository
        self.job_id = job_id
        self.owner = owner
        self.fencing_token = fencing_token
        self.lease_seconds = lease_seconds
        self.interval_seconds = interval_seconds or max(
            1.0,
            min(lease_seconds / 3, 30.0),
        )
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread = None
        self.last_error = None

    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def __enter__(self):
        self._thread = threading.Thread(
            target=self._run,
            name=f'diagnosis-lease-{self.job_id}',
            daemon=True,
        )
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False

    def close(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=max(1.0, min(self.interval_seconds, 5.0)))

    def raise_if_lost(self) -> None:
        if self.lost:
            raise AppError(
                409,
                'diagnosis_lease_lost',
                '诊断任务租约已失效，不能继续写入。',
            )

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                renewed = self.repository.heartbeat(
                    self.job_id,
                    self.owner,
                    self.fencing_token,
                    self.lease_seconds,
                )
            except Exception as error:
                self.last_error = type(error).__name__
                logger.warning(
                    'Diagnosis lease heartbeat failed; retrying without secrets'
                )
                continue
            if not renewed:
                self._lost.set()
                return


class DiagnosisWorker:
    def __init__(self, resources, *, generator=None):
        self.resources = resources
        self.settings = resources.settings
        self.repository = DiagnosisRepository(resources)
        self.collector = EvidenceCollector(resources)
        self.generator = generator
        self.validator = ReportValidator()
        self.owner = (
            f'{socket.gethostname()}:{os.getpid()}:'
            f'{uuid.uuid4().hex[:12]}'
        )
        self._ticks = 0

    def run_once(self) -> bool:
        if not self.settings.ai_enabled:
            return False
        self._ticks += 1
        if self._ticks % 100 == 0:
            try:
                cleanup_expired(self.resources.pool, self.settings)
            except Exception:
                logger.warning('Diagnosis checkpoint cleanup failed; reports remain intact')
        job = self.repository.claim(
            self.owner,
            self.settings.ai_lease_seconds,
            self.settings.ai_max_attempts,
        )
        if not job:
            return False
        generator = self.generator
        try:
            generator = generator or LangChainOpenAIGenerator(self.settings)
            with LeaseHeartbeat(
                self.repository,
                job_id=job['id'],
                owner=self.owner,
                fencing_token=job['fencing_token'],
                lease_seconds=self.settings.ai_lease_seconds,
            ) as heartbeat:
                with checkpoint_saver(self.settings) as saver:
                    graph = build_diagnosis_graph(
                        repository=self.repository,
                        collector=self.collector,
                        generator=generator,
                        validator=self.validator,
                        checkpointer=saver,
                        job_id=job['id'],
                        attempt_id=job['attempt_id'],
                        owner=self.owner,
                        fencing_token=job['fencing_token'],
                        comparison_mode=job.get('comparison_mode', 'none'),
                        baseline_attempt_id=job.get('baseline_attempt_id'),
                    )
                    graph.invoke(
                        initial_state(job['id'], job['attempt_id']),
                        config=graph_config(job['id']),
                    )
                heartbeat.raise_if_lost()
            current = self.repository.get_job(job['id'])
            if current['state'] == 'running':
                raise AppError(
                    503,
                    'diagnosis_workflow_incomplete',
                    'Diagnosis graph ended without publishing or failing',
                )
        except Exception as error:
            usage_method = getattr(generator, 'usage', None)
            if callable(usage_method):
                try:
                    self.repository.set_usage(
                        job['id'],
                        self.owner,
                        job['fencing_token'],
                        usage_method(),
                    )
                except Exception:
                    pass
            code = (
                error.code
                if isinstance(error, AppError)
                else 'diagnosis_dependency_failed'
            )
            try:
                self.repository.retry_or_fail(
                    job['id'],
                    owner=self.owner,
                    fencing_token=job['fencing_token'],
                    error_code=code,
                    max_attempts=self.settings.ai_max_attempts,
                )
            except AppError:
                logger.warning(
                    'Diagnosis job lease was lost before failure was persisted'
                )
            # Never log provider messages: they can contain URLs or credentials.
            logger.warning('Diagnosis job did not complete: %s', code)
            return True
        return True
