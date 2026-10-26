"""Stage 1 — POST /predict/calories (session energy expenditure).

Two methods, chosen per request:

  heart_rate  Keytel et al. (2005) HR equation with a linear population
              correction fitted on the WEEE calorimetry data
              (models/calorie_energy.json). Validated for cardio sessions whose
              average HR lies inside the validated range. Expected error is
              reported with every answer.
  met_table   MET × weight × hours. Used when there is no heart rate, the
              session is not cardio, age or sex is unknown, the HR is outside
              the validated range, or the calibration is not loaded.

A trained XGBoost HR model was evaluated for this stage and not shipped: it
tied calibrated Keytel on held-out participants (training/calibrate_calorie_hr.py).

`/predict/calorie` is kept as an alias for callers written against Step 1.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..energy import keytel_kcal_per_min
from ..model_registry import ModelRegistry, get_registry
from ..schemas import CalorieRequest, CalorieResponse

log = logging.getLogger("ml-service.calorie")
router = APIRouter(prefix="/predict", tags=["calorie"])

# MET per workout class — the estimate used whenever the HR method cannot run.
MET_BY_TYPE = {"Cardio": 7.5, "Strength": 5.0, "Yoga": 2.5, "HIIT": 8.0}
INTENSITY_MULTIPLIER = {"low": 0.85, "moderate": 1.0, "high": 1.15}


def met_calories(req: CalorieRequest) -> float:
    met = MET_BY_TYPE.get(req.workout_type or "Strength", 5.0)
    kcal = met * req.weight_kg * (req.duration_hours or 0.0)
    return round(kcal * INTENSITY_MULTIPLIER[req.intensity], 1)


def _met_response(req: CalorieRequest, reason: str, version: str, stub: bool) -> CalorieResponse:
    kcal = met_calories(req)
    minutes = req.duration_min or 0.0
    return CalorieResponse(
        calories=kcal,
        kcal_per_min=round(kcal / minutes, 2) if minutes > 0 else 0.0,
        method="met_table",
        validated=False,
        expected_error_kcal_per_min=None,
        reason=reason,
        baseline_met_calories=kcal,
        model_version=version,
        workout_type=req.workout_type or "Strength",
        stub=stub,
    )


@router.post("/calories", response_model=CalorieResponse)
@router.post("/calorie", response_model=CalorieResponse, include_in_schema=False)
def predict_calories(
    req: CalorieRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> CalorieResponse:
    energy = reg.calorie
    if energy is None:
        log.warning("energy calibration unavailable (%s) — serving MET estimate",
                    reg.errors.get("calorie", "not loaded"))
        return _met_response(req, "calibration not loaded", "fallback-met", stub=True)

    version = energy.get("model_version", "energy-keytel-cal-v1")
    low, high = energy["validated_hr_range_bpm"]

    if req.avg_hr is None:
        return _met_response(req, "no average heart rate supplied", version, stub=False)
    if req.workout_type not in energy.get("validated_workout_types", ["Cardio"]):
        return _met_response(
            req, f"heart-rate method is validated for cardio only, not {req.workout_type}",
            version, stub=False,
        )
    if req.age is None or req.sex is None:
        return _met_response(req, "age and sex are needed for the heart-rate method",
                             version, stub=False)
    if not low <= req.avg_hr <= high:
        return _met_response(
            req, f"average heart rate {req.avg_hr:g} bpm is outside the validated "
                 f"range {low:g}-{high:g} bpm", version, stub=False,
        )

    raw = float(keytel_kcal_per_min(req.avg_hr, req.weight_kg, req.age, req.sex == "female"))
    per_min = max(0.0, energy["intercept"] + energy["slope"] * raw)
    minutes = req.duration_min or 0.0

    return CalorieResponse(
        calories=round(per_min * minutes, 1),
        kcal_per_min=round(per_min, 2),
        method="heart_rate",
        validated=True,
        expected_error_kcal_per_min=round(float(energy["expected_mae_kcal_per_min"]), 2),
        reason=None,
        baseline_met_calories=met_calories(req),
        model_version=version,
        workout_type=req.workout_type or "Cardio",
        stub=False,
    )
