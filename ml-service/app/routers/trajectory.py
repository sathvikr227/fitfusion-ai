"""Model 4 — POST /predict/trajectory (running-performance Transformer).

The model reads the last 4 running sessions (distance, duration, Riegel 10 km
pace, gap, weekday) and predicts whether the next 4 will be faster (IMPROVE),
similar (PLATEAU) or slower (REGRESS). It was trained on Strava logs of 34,753
runners (Afonseca et al., CC BY 4.0); see demos/model4_trajectory/.

Any request it cannot answer faithfully — fewer than 4 runs with a distance,
invalid runs, runs spread over more than 56 days, or a model that failed its
serving rule — gets the completion-rate slope rule, with `stub: true` and a
`reason`. It never guesses silently.
"""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import TRAJECTORY_CLASSES
from ..model_registry import ModelRegistry, get_registry
from ..schemas import SessionFeatures, TrajectoryRequest, TrajectoryResponse
from ..trajectory_runs import SEQ_LEN, WINDOW_SPAN_DAYS, predict_probs, session_matrix, valid_run

log = logging.getLogger("ml-service.trajectory")
router = APIRouter(prefix="/predict", tags=["trajectory"])

# Slope either side of which the rule-based fallback calls it improving/regressing.
FALLBACK_DELTA = 0.05


def rule_based_trajectory(sessions: list[SessionFeatures]) -> tuple[str, dict[str, float]]:
    """Completion-rate slope — the signal the app used before this model."""
    rates = [float(s.completion_rate) for s in sessions]
    if len(rates) < 2:
        label = "PLATEAU"
    else:
        delta = rates[-1] - float(np.mean(rates[:-1]))
        if delta > FALLBACK_DELTA:
            label = "IMPROVE"
        elif delta < -FALLBACK_DELTA:
            label = "REGRESS"
        else:
            label = "PLATEAU"

    probs = {name: 0.2 for name in TRAJECTORY_CLASSES}
    probs[label] = 0.6
    return label, probs


def model_input(sessions: list[SessionFeatures]) -> tuple[np.ndarray | None, str | None]:
    """The (4, 5) raw input from the last 4 sessions, or the reason it can't be built."""
    runs = sessions[-SEQ_LEN:]
    if len(runs) < SEQ_LEN:
        return None, f"needs {SEQ_LEN} running sessions, got {len(runs)}"
    if any(s.distance_km is None or s.gap_days is None for s in runs):
        return None, "the last 4 sessions are not all runs with distance and gap_days"
    if not all(valid_run(s.distance_km, s.duration * 60) for s in runs):
        return None, "a run is outside the trained range (1-60 km, 3-15 min/km)"
    if sum(s.gap_days for s in runs[1:]) > WINDOW_SPAN_DAYS:
        return None, f"the 4 runs span more than {WINDOW_SPAN_DAYS} days"
    raw = session_matrix([
        {"distance_km": s.distance_km, "duration_min": s.duration * 60, "gap_days": s.gap_days,
         "day_of_week": s.day_of_week}
        for s in runs
    ])
    return raw, None


def rule_response(req: TrajectoryRequest, reason: str) -> TrajectoryResponse:
    label, probs = rule_based_trajectory(req.sessions)
    return TrajectoryResponse(
        label=label,
        trajectory_score=TRAJECTORY_CLASSES.index(label),
        probs=probs,
        sessions_used=len(req.sessions),
        model_version="fallback-slope",
        reason=reason,
        stub=True,
    )


@router.post("/trajectory", response_model=TrajectoryResponse)
def predict_trajectory(
    req: TrajectoryRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> TrajectoryResponse:
    meta = reg.trajectory_meta
    if reg.trajectory_model is None or meta is None:
        reason = f"model unavailable ({reg.errors.get('trajectory', 'not loaded')})"
        log.warning("trajectory %s — serving slope rule", reason)
        return rule_response(req, reason)
    if not meta.get("serve", False):
        return rule_response(req, "model failed its pre-registered serving rule")

    raw, reason = model_input(req.sessions)
    if raw is None:
        return rule_response(req, reason)

    probabilities = predict_probs(reg.trajectory_model, meta, raw)[0]
    index = int(np.argmax(probabilities))
    return TrajectoryResponse(
        label=TRAJECTORY_CLASSES[index],
        trajectory_score=index,
        probs={name: round(float(p), 4) for name, p in zip(TRAJECTORY_CLASSES, probabilities)},
        sessions_used=SEQ_LEN,
        model_version=meta.get("model_version", "trajectory-runs-transformer-v1"),
        stub=False,
    )
