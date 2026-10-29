from fastapi import FastAPI
from datetime import datetime, timezone
from modelforge.errors import configure_errors

app = FastAPI(title="ModelForge Worker probe", docs_url=None, redoc_url=None)
configure_errors(app)


@app.get("/health/live")
def live():
    return {"status": "alive", "service": "worker", "checked_at": datetime.now(timezone.utc).isoformat(),
            "scope": "process_only"}
