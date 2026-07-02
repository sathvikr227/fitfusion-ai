from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..schemas import CalorieRequest, CalorieResponse

router = APIRouter(prefix="/predict", tags=["calorie"])

# MET values mirror the rule-based table currently used in the Next.js app.
# This stub matches the existing fallback so behavior stays stable until the real model lands.
_MET_TABLE = {
    "running": 9.8,
    "cycling": 7.5,
    "walking": 3.8,
    "swimming": 7.0,
    "weights": 5.0,
    "weightlifting": 5.0,
    "strength": 5.0,
    "yoga": 2.5,
    "hiit": 8.0,
    "rowing": 7.0,
}
_INTENSITY_MULT = {"low": 0.85, "moderate": 1.0, "high": 1.15}


@router.post("/calorie", response_model=CalorieResponse)
def predict_calorie(req: CalorieRequest, _: None = Depends(require_bearer)) -> CalorieResponse:
    met = _MET_TABLE.get(req.exercise.lower(), 5.0)
    mult = _INTENSITY_MULT[req.intensity]
    kcal = met * req.weight_kg * (req.duration_min / 60.0) * mult
    return CalorieResponse(
        calories=round(kcal, 1),
        model_version="stub-met-v0",
        shap_top_features=[],
        stub=True,
    )
