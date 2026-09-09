"""Model 3 — POST /predict/injury-risk (multi-label XGBoost).

Scores are PROXY injury risk from biomechanical thresholds, not clinical
diagnoses. `/predict/injury` is kept as an alias for the Step 1 skeleton.
"""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import (
    COL_AGE,
    COL_BMI,
    COL_DURATION,
    COL_EXPERIENCE,
    COL_FREQUENCY,
    COL_RESTING_BPM,
    INJURY_FEATURES,
    INJURY_LABELS,
    INJURY_RISK_THRESHOLD,
)
from ..model_registry import ModelRegistry, get_registry
from ..routers.recommend import canonical_injuries
from ..schemas import InjuryRequest, InjuryResponse
from ..supabase_reader import SupabaseUnavailable, fetch_injury_features

log = logging.getLogger("ml-service.injury")
router = APIRouter(prefix="/predict", tags=["injury"])

# Sleep is not a model feature (the training dataset has no sleep column), but
# it is a documented risk signal FitFusion does record. It is applied as a
# bounded multiplier on top of the model score rather than being smuggled into
# the feature vector.
SLEEP_DEBT_THRESHOLD = 6.5
SLEEP_PENALTY_PER_HOUR = 0.06
PRIOR_INJURY_BOOST = 0.15
MAX_RISK = 0.99

REQUEST_TO_COLUMN = {
    "age": COL_AGE,
    "bmi": COL_BMI,
    "resting_bpm": COL_RESTING_BPM,
    "session_duration_hours": COL_DURATION,
    "workout_frequency": COL_FREQUENCY,
    "experience_level": COL_EXPERIENCE,
}


def heuristic_risk(req: InjuryRequest, priors: list[str]) -> dict[str, float]:
    """Rule-based scores used when the artifact is missing, so the endpoint
    still degrades to something meaningful rather than to zeros."""
    base = {label: 0.10 for label in INJURY_LABELS}
    if req.sleep_avg_hours is not None and req.sleep_avg_hours < SLEEP_DEBT_THRESHOLD:
        deficit = SLEEP_DEBT_THRESHOLD - req.sleep_avg_hours
        for label in base:
            base[label] += min(0.25, SLEEP_PENALTY_PER_HOUR * deficit)
    if req.workout_frequency and req.workout_frequency > 5:
        base["knee"] += 0.15
        base["hamstring"] += 0.15
    if req.bmi and req.bmi > 27:
        base["back"] += 0.15
    for group in priors:
        if group in base:
            base[group] += PRIOR_INJURY_BOOST
    return {k: round(min(v, MAX_RISK), 3) for k, v in base.items()}


@router.post("/injury-risk", response_model=InjuryResponse)
@router.post("/injury", response_model=InjuryResponse, include_in_schema=False)
def predict_injury_risk(
    req: InjuryRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> InjuryResponse:
    source: str = "request"
    supplied = {field: getattr(req, field) for field in REQUEST_TO_COLUMN}

    # Documented contract: {user_id} alone is enough when the service has its
    # own Supabase credentials. Next.js sends features and skips this branch.
    if all(value is None for value in supplied.values()):
        try:
            fetched = fetch_injury_features(req.user_id)
            for field, value in fetched.items():
                if field in supplied and value is not None:
                    supplied[field] = value
                    setattr(req, field, value)
            if fetched.get("sleep_avg_hours") is not None and req.sleep_avg_hours is None:
                req.sleep_avg_hours = fetched["sleep_avg_hours"]
            if fetched.get("prior_injuries") and not req.prior_injuries:
                req.prior_injuries = fetched["prior_injuries"]
            source = "supabase"
        except SupabaseUnavailable:
            log.info("no features supplied and Supabase not configured; imputing defaults")
        except Exception:  # noqa: BLE001 - never fail the request on a read error
            log.exception("Supabase fetch failed for user %s; imputing defaults", req.user_id)

    priors = canonical_injuries(req.prior_injuries)

    if reg.injury is None:
        log.warning("injury model unavailable (%s) — serving heuristic scores",
                    reg.errors.get("injury", "not loaded"))
        risk = heuristic_risk(req, priors)
        return InjuryResponse(
            risk=risk,
            threshold=INJURY_RISK_THRESHOLD,
            flagged=[k for k, v in risk.items() if v >= INJURY_RISK_THRESHOLD],
            source="fallback",
            model_version="fallback-heuristic",
            stub=True,
        )

    bundle = reg.injury
    defaults = bundle.get("imputation_defaults", {})
    imputed: list[str] = []
    values: dict[str, float] = {}

    for field, column in REQUEST_TO_COLUMN.items():
        value = supplied.get(field)
        if value is None:
            imputed.append(column)
            value = defaults.get(column, 0.0)
        values[column] = float(value)

    row = np.array([[values[name] for name in INJURY_FEATURES]], dtype=float)

    risk: dict[str, float] = {}
    for label, estimator in zip(bundle["labels"], bundle["estimators"]):
        probability = float(estimator.predict_proba(row)[0][1])
        risk[label] = probability

    # Recovery signals the training dataset cannot express, applied on top.
    if req.sleep_avg_hours is not None and req.sleep_avg_hours < SLEEP_DEBT_THRESHOLD:
        deficit = SLEEP_DEBT_THRESHOLD - float(req.sleep_avg_hours)
        bump = min(0.20, SLEEP_PENALTY_PER_HOUR * deficit)
        risk = {k: v + bump for k, v in risk.items()}

    for group in priors:
        if group in risk:
            risk[group] += PRIOR_INJURY_BOOST

    risk = {k: round(min(max(v, 0.0), MAX_RISK), 3) for k, v in risk.items()}
    flagged = [label for label, score in risk.items() if score >= INJURY_RISK_THRESHOLD]

    return InjuryResponse(
        risk=risk,
        threshold=INJURY_RISK_THRESHOLD,
        flagged=flagged,
        features_used={k: round(v, 3) for k, v in values.items()},
        imputed=imputed,
        source=source,
        model_version=bundle.get("model_version", "injury-xgb-multilabel-v1"),
        disclaimer=bundle.get(
            "disclaimer",
            "Proxy injury-risk scores derived from biomechanical thresholds. "
            "Not a clinical diagnosis.",
        ),
        stub=False,
    )
