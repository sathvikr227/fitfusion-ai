"""Model 3 — POST /predict/injury-risk (training-load injury risk + region rules).

The overall risk is an XGBoost model trained on real injuries of 74 competitive
runners (Lövdal et al. 2021, CC0), from the last 7 days of training load. That
label has no body part, so knee/back/shoulder/hamstring come from the fixed
rules in `app.injury_load.region_levels`, never from the model.

Informational risk indicator only, not a diagnosis. `/predict/injury` is kept as
an alias for the Step 1 skeleton.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import INJURY_LABELS, INJURY_RISK_THRESHOLD, canonical_injuries, exercise_targets_muscle_group
from ..injury_load import features_from_days, predict_overall, region_levels
from ..model_registry import ModelRegistry, get_registry
from ..schemas import DayLoad, InjuryRequest, InjuryResponse
from ..supabase_reader import SupabaseUnavailable, fetch_injury_features

log = logging.getLogger("ml-service.injury")
router = APIRouter(prefix="/predict", tags=["injury"])

DEFAULT_DISCLAIMER = (
    "Informational injury-risk indicator, not a medical diagnosis. Body regions "
    "are flagged by fixed rules, not predicted."
)


def loaded_regions(exercises: list[str]) -> set[str]:
    return {g for g in INJURY_LABELS if any(exercise_targets_muscle_group(name, g) for name in exercises)}


@router.post("/injury-risk", response_model=InjuryResponse)
@router.post("/injury", response_model=InjuryResponse, include_in_schema=False)
def predict_injury_risk(
    req: InjuryRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> InjuryResponse:
    source: str = "request"

    # Documented contract: {user_id} alone is enough when the service has its
    # own Supabase credentials. Next.js sends the features and skips this.
    if req.recent_days is None:
        try:
            fetched = fetch_injury_features(req.user_id)
            req.recent_days = [DayLoad(**day) for day in fetched["recent_days"]]
            req.recent_exercises = req.recent_exercises or fetched["recent_exercises"]
            req.prior_injuries = req.prior_injuries or fetched["prior_injuries"]
            source = "supabase"
        except SupabaseUnavailable:
            log.info("no recent_days supplied and Supabase not configured; overall risk unavailable")
        except Exception:  # noqa: BLE001 - never fail the request on a read error
            log.exception("Supabase fetch failed for user %s; overall risk unavailable", req.user_id)

    recorded = set(canonical_injuries(req.prior_injuries))
    loaded = loaded_regions(req.recent_exercises)

    bundle = reg.injury
    usable = bundle is not None and bundle.get("serve", False)
    overall = relative = threshold = None
    elevated = False
    features: dict[str, float] = {}
    imputed: list[str] = []

    if not usable:
        why = reg.errors.get("injury", "not loaded") if bundle is None else "failed its serving rule"
        log.warning("injury model unavailable (%s) — serving region rules only", why)
    elif req.recent_days is None:
        imputed.append("recent_days")
    else:
        features = features_from_days([day.model_dump() for day in req.recent_days])
        overall = predict_overall(bundle, features)
        threshold = float(bundle["threshold"])
        relative = overall / float(bundle["prevalence"])
        elevated = overall >= threshold

    risk, basis = region_levels(recorded, loaded, elevated)
    flagged = [region for region, level in risk.items() if level >= INJURY_RISK_THRESHOLD]

    return InjuryResponse(
        risk=risk,
        threshold=INJURY_RISK_THRESHOLD,
        flagged=flagged,
        basis=basis,
        overall_risk=round(overall, 5) if overall is not None else None,
        relative_risk=round(relative, 3) if relative is not None else None,
        overall_threshold=round(threshold, 5) if threshold is not None else None,
        overall_elevated=elevated,
        features_used={k: round(v, 3) for k, v in features.items()},
        imputed=imputed,
        source="fallback" if not usable else source,
        model_version=bundle.get("model_version", "injury-load-xgb-v1") if usable else "rules-only",
        disclaimer=bundle.get("disclaimer", DEFAULT_DISCLAIMER) if usable else DEFAULT_DISCLAIMER,
        stub=not usable,
    )
