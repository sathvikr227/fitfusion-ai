import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .model_registry import registry
from .routers import calorie, injury, recommend, rl_action, trajectory
from .schemas import HealthResponse

logging.basicConfig(level=settings.LOG_LEVEL.upper())
log = logging.getLogger("ml-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.ML_SERVICE_API_KEY:
        log.warning("ML_SERVICE_API_KEY is not set — all authenticated endpoints return 503.")

    settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    log.info("ml-service starting. MODEL_DIR=%s", settings.MODEL_DIR.resolve())

    # Load every artifact once, here, so no request pays the cost. A missing
    # artifact is logged and its endpoint falls back rather than failing boot.
    registry.load_all()
    loaded = registry.loaded_names()
    log.info("models loaded: %s", ", ".join(loaded) if loaded else "(none)")
    for name, error in registry.errors.items():
        log.warning("model %s unavailable: %s", name, error)

    yield


app = FastAPI(
    title="FitFusion ML Service",
    version="1.0.0",
    description=(
        "5-model intelligence layer for FitFusion AI: XGBoost+SHAP calorie "
        "predictor, hybrid recommender, multi-label injury risk, Transformer "
        "trajectory, and a PPO adaptive-replan agent."
    ),
    lifespan=lifespan,
)


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(
        ok=True,
        service="fitfusion-ml",
        version=app.version,
        models_loaded=registry.loaded_names(),
        models_status=registry.status(),
        model_errors=registry.errors,
    )


@app.get("/health", response_model=HealthResponse, include_in_schema=False)
def health() -> HealthResponse:
    return healthz()


app.include_router(calorie.router)
app.include_router(recommend.router)
app.include_router(injury.router)
app.include_router(trajectory.router)
app.include_router(rl_action.router)
