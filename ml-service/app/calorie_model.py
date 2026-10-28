"""Model 1 inference — calibrated XGBoost heart-rate energy model with SHAP.

One function used by POST /predict/calories, the teacher demo
(demos/model1_calorie/demo.py) and the tests, so all three run the same code.

    kcal/min = intercept + slope × XGBoost(age, is_female, height_cm, weight_kg, hr)

The XGBoost model (models/calorie_hr_model.pkl) is trained on Malaga treadmill
calorimetry; the linear correction (models/calorie_energy.json) is fitted on the
WEEE lab protocol. See training/train_calorie_hr.py and calibrate_calorie_hr.py.

Explanations are exact TreeSHAP values from XGBoost's own `pred_contribs`, the
same algorithm as `shap.TreeExplainer`, so serving does not import `shap`. The
calibration is linear, so each contribution is scaled by the slope and the
contributions still add up exactly to the returned kcal/min.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import xgboost as xgb

from .energy import CALORIE_HR_FEATURES


class CalorieModelError(ValueError):
    """Raised for an unusable artifact or an invalid input row."""


@dataclass
class CaloriePrediction:
    kcal_per_min: float
    raw_model_kcal_per_min: float
    base_kcal_per_min: float
    contributions: dict[str, float]
    inputs: dict[str, float]
    warnings: list[str] = field(default_factory=list)


def check_bundle(bundle: Any) -> None:
    """Fail loudly at load time rather than predicting with a mismatched model."""
    if not isinstance(bundle, dict) or "model" not in bundle:
        raise CalorieModelError("calorie_hr_model.pkl is not a model bundle")
    names = list(bundle.get("feature_names", []))
    if names != CALORIE_HR_FEATURES:
        raise CalorieModelError(
            f"feature order mismatch: artifact {names}, code {CALORIE_HR_FEATURES}"
        )


def predict_with_explanation(
    bundle: dict[str, Any],
    energy: dict[str, Any],
    *,
    age: float,
    is_female: bool,
    height_cm: float,
    weight_kg: float,
    hr: float,
) -> CaloriePrediction:
    """Calibrated kcal/min for one session plus its per-feature SHAP breakdown."""
    inputs = {
        "age": float(age),
        "is_female": 1.0 if is_female else 0.0,
        "height_cm": float(height_cm),
        "weight_kg": float(weight_kg),
        "hr": float(hr),
    }
    row = np.array([[inputs[name] for name in CALORIE_HR_FEATURES]], dtype=float)
    if not np.all(np.isfinite(row)):
        raise CalorieModelError("all inputs must be finite numbers")

    try:
        intercept = float(energy["model_intercept"])
        slope = float(energy["model_slope"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CalorieModelError("calibration has no XGBoost coefficients") from exc

    booster = bundle["model"].get_booster()
    matrix = xgb.DMatrix(row, feature_names=CALORIE_HR_FEATURES)
    raw = float(booster.predict(matrix)[0])
    # Last column is the bias term (expected value); the rest are per-feature SHAP.
    contribs = booster.predict(matrix, pred_contribs=True)[0]

    contributions = {
        name: round(float(slope * contribs[i]), 4) for i, name in enumerate(CALORIE_HR_FEATURES)
    }
    base = intercept + slope * float(contribs[-1])
    kcal = max(0.0, intercept + slope * raw)

    warnings: list[str] = []
    for name, (low, high) in (bundle.get("training_range_p1_p99") or {}).items():
        if name in inputs and not low <= inputs[name] <= high:
            warnings.append(
                f"{name} {inputs[name]:g} is outside the training range {low:g}-{high:g}; "
                "the estimate is less certain"
            )

    return CaloriePrediction(
        kcal_per_min=round(kcal, 3),
        raw_model_kcal_per_min=round(raw, 3),
        base_kcal_per_min=round(base, 4),
        contributions=contributions,
        inputs=inputs,
        warnings=warnings,
    )
