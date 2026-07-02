import logging

from fastapi import FastAPI

from .config import settings
from .routers import calorie, injury, recommend, rl_action, trajectory

logging.basicConfig(level=settings.LOG_LEVEL.upper())
log = logging.getLogger("ml-service")

app = FastAPI(
    title="FitFusion ML Service",
    version="0.1.0",
    description="5-model intelligence layer for FitFusion AI. Step 1 = stubs.",
)


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "service": "fitfusion-ml",
        "version": app.version,
        "models_loaded": [],  # populated by later steps as real artifacts land
    }


app.include_router(calorie.router)
app.include_router(recommend.router)
app.include_router(injury.router)
app.include_router(trajectory.router)
app.include_router(rl_action.router)


@app.on_event("startup")
def on_startup() -> None:
    if not settings.ML_SERVICE_API_KEY:
        log.warning("ML_SERVICE_API_KEY is not set — all authenticated endpoints will return 503.")
    settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    log.info("ml-service started. MODEL_DIR=%s", settings.MODEL_DIR.resolve())
