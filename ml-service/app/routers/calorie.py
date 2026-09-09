"""Model 1 — POST /predict/calories (XGBoost + SHAP).

`/predict/calorie` is kept as an alias so callers written against the Step 1
skeleton keep working.
"""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import (
    CALORIE_FEATURE_LABELS,
    CALORIE_FEATURES,
    COL_AGE,
    COL_BMI,
    COL_DURATION,
    COL_RESTING_BPM,
    COL_WEIGHT,
    COL_WORKOUT_TYPE,
    FALLBACK_AGE,
    FALLBACK_BMI,
    FALLBACK_RESTING_BPM,
    WORKOUT_TYPE_MAP,
)
from ..model_registry import ModelRegistry, get_registry
from ..schemas import CalorieRequest, CalorieResponse, ShapFeature

log = logging.getLogger("ml-service.calorie")
router = APIRouter(prefix="/predict", tags=["calorie"])

# MET per dataset workout class — the rule the model replaces, still reported
# alongside every prediction so the two can be compared in the UI.
MET_BY_TYPE = {"Cardio": 7.5, "Strength": 5.0, "Yoga": 2.5, "HIIT": 8.0}
INTENSITY_MULTIPLIER = {"low": 0.85, "moderate": 1.0, "high": 1.15}

TOP_SHAP_FEATURES = 5


def met_calories(req: CalorieRequest) -> float:
    met = MET_BY_TYPE.get(req.workout_type or "Strength", 5.0)
    kcal = met * req.weight_kg * (req.duration_hours or 0.0)
    return round(kcal * INTENSITY_MULTIPLIER[req.intensity], 1)


@router.post("/calories", response_model=CalorieResponse)
@router.post("/calorie", response_model=CalorieResponse, include_in_schema=False)
def predict_calories(
    req: CalorieRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> CalorieResponse:
    baseline = met_calories(req)

    if reg.calorie is None:
        log.warning("calorie model unavailable (%s) — serving MET estimate",
                    reg.errors.get("calorie", "not loaded"))
        return CalorieResponse(
            calories=baseline,
            baseline_met_calories=baseline,
            model_version="fallback-met",
            workout_type=req.workout_type or "Strength",
            imputed=[],
            stub=True,
        )

    bundle = reg.calorie
    defaults = bundle.get("imputation_defaults", {})
    imputed: list[str] = []

    def take(value: float | None, column: str, hard_default: float) -> float:
        if value is not None:
            return float(value)
        imputed.append(column)
        return float(defaults.get(column, hard_default))

    values = {
        COL_AGE: take(req.age, COL_AGE, FALLBACK_AGE),
        COL_WEIGHT: float(req.weight_kg),
        COL_BMI: take(req.bmi, COL_BMI, FALLBACK_BMI),
        COL_RESTING_BPM: take(req.resting_bpm, COL_RESTING_BPM, FALLBACK_RESTING_BPM),
        COL_DURATION: float(req.duration_hours or 0.0),
        COL_WORKOUT_TYPE: float(WORKOUT_TYPE_MAP[req.workout_type or "Strength"]),
    }

    row = np.array([[values[name] for name in CALORIE_FEATURES]], dtype=float)
    scaled = bundle["scaler"].transform(row)
    prediction = float(bundle["model"].predict(scaled)[0])

    shap_features: list[ShapFeature] = []
    base_value = bundle.get("expected_value")
    if reg.calorie_explainer is not None:
        try:
            shap_values = reg.calorie_explainer.shap_values(scaled)[0]
            ranked = sorted(
                zip(CALORIE_FEATURES, shap_values),
                key=lambda kv: abs(kv[1]),
                reverse=True,
            )[:TOP_SHAP_FEATURES]
            shap_features = [
                ShapFeature(
                    feature=name,
                    label=CALORIE_FEATURE_LABELS.get(name, name),
                    impact=round(float(impact), 1),
                    value=round(values[name], 2),
                )
                for name, impact in ranked
            ]
        except Exception:  # noqa: BLE001 - explanation is optional, prediction is not
            log.exception("SHAP explanation failed; returning prediction without it")

    return CalorieResponse(
        calories=round(max(prediction, 0.0), 1),
        baseline_met_calories=baseline,
        model_version=bundle.get("model_version", "calorie-xgb-v1"),
        workout_type=req.workout_type or "Strength",
        shap_top_features=shap_features,
        shap_base_value=round(float(base_value), 1) if base_value is not None else None,
        imputed=imputed,
        stub=False,
    )
