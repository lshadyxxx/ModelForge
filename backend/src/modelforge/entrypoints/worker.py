from fastapi import FastAPI
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import threading

from modelforge.bootstrap import Resources, execution_workers
from modelforge.errors import configure_errors
from modelforge.modules.models import ModelImports
from modelforge.modules.diagnosis import DiagnosisWorker
from modelforge.settings import get_settings

logger = logging.getLogger(__name__)


def import_loop(resources, stop):
    imports = ModelImports(resources)
    while not stop.is_set():
        try:
            active = imports.run_once(stop)
        except Exception:
            # Keep signed URLs and dependency credentials out of logs.
            logger.warning('Model importer dependency operation failed; durable work remains recoverable')
            active = False
        if not active:
            stop.wait(1)


def execution_loop(resources, stop):
    training, serving = execution_workers(resources)
    while not stop.is_set():
        try:
            training.run_once()
            serving.run_once()
        except Exception:
            logger.warning('Execution dependency unavailable; resources remain held for reconciliation')
        stop.wait(2)


def diagnosis_loop(resources, stop):
    diagnosis = DiagnosisWorker(resources)
    poll_seconds = max(0.5, float(resources.settings.ai_worker_poll_seconds))
    while not stop.is_set():
        try:
            active = diagnosis.run_once()
        except Exception:
            logger.warning(
                'Diagnosis dependency unavailable; durable job remains recoverable'
            )
            active = False
        stop.wait(0.1 if active else poll_seconds)


@asynccontextmanager
async def lifespan(app):
    import asyncio
    resources = Resources.open(get_settings())
    stop = threading.Event()
    thread = threading.Thread(target=import_loop, args=(resources, stop), name='model-importer')
    thread.start()
    execution_thread = threading.Thread(target=execution_loop, args=(resources, stop), name="execution-worker")
    execution_thread.start()
    diagnosis_thread = threading.Thread(
        target=diagnosis_loop,
        args=(resources, stop),
        name="diagnosis-worker",
    )
    diagnosis_thread.start()
    app.state.import_thread = thread
    app.state.diagnosis_thread = diagnosis_thread
    try:
        yield
    finally:
        stop.set()
        await asyncio.to_thread(thread.join)
        await asyncio.to_thread(execution_thread.join)
        await asyncio.to_thread(diagnosis_thread.join)
        resources.close()

app = FastAPI(title="ModelForge Worker probe", docs_url=None, redoc_url=None, lifespan=lifespan)
configure_errors(app)


@app.get("/health/live")
def live():
    return {"status": "alive", "service": "worker", "checked_at": datetime.now(timezone.utc).isoformat(),
            "scope": "process_only"}
