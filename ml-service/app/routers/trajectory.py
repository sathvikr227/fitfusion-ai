"""Model 4 — POST /predict/trajectory (PyTorch TransformerEncoder)."""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import SEQUENCE_LENGTH, TRAJECTORY_CLASSES, encode_workout_type
from ..model_registry import ModelRegistry, get_registry
from ..schemas import SessionFeatures, TrajectoryRequest, TrajectoryResponse

log = logging.getLogger("ml-service.trajectory")
router = APIRouter(prefix="/predict", tags=["trajectory"])

# Slope either side of which the rule-based fallback calls it improving/regressing.
FALLBACK_DELTA = 0.05


def to_matrix(sessions: list[SessionFeatures]) -> np.ndarray:
    """Build the (SEQUENCE_LENGTH, 4) tensor input.

    Sessions arrive oldest-first. Shorter histories are left-padded by repeating
    the earliest session, which keeps the most recent sessions in the positions
    the model was trained to weight most heavily.
    """
    window = sessions[-SEQUENCE_LENGTH:]
    while len(window) < SEQUENCE_LENGTH:
        window.insert(0, window[0])

    return np.array(
        [
            [
                float(s.duration),
                float(s.completion_rate),
                float(encode_workout_type(s.workout_type)),
                float(s.day_of_week),
            ]
            for s in window
        ],
        dtype=np.float32,
    )


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


@router.post("/trajectory", response_model=TrajectoryResponse)
def predict_trajectory(
    req: TrajectoryRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> TrajectoryResponse:
    if reg.trajectory_model is None or reg.trajectory_meta is None:
        log.warning("trajectory model unavailable (%s) — serving slope heuristic",
                    reg.errors.get("trajectory", "not loaded"))
        label, probs = rule_based_trajectory(req.sessions)
        return TrajectoryResponse(
            label=label,
            trajectory_score=TRAJECTORY_CLASSES.index(label),
            probs=probs,
            sessions_used=len(req.sessions),
            model_version="fallback-slope",
            stub=True,
        )

    import torch

    meta = reg.trajectory_meta
    mean = np.asarray(meta["feature_mean"], dtype=np.float32)
    std = np.asarray(meta["feature_std"], dtype=np.float32)
    std = np.where(std == 0, 1.0, std)

    matrix = (to_matrix(req.sessions) - mean) / std
    tensor = torch.tensor(matrix, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        logits = reg.trajectory_model(tensor)
        probabilities = torch.softmax(logits, dim=1)[0].tolist()

    index = int(np.argmax(probabilities))
    return TrajectoryResponse(
        label=TRAJECTORY_CLASSES[index],
        trajectory_score=index,
        probs={
            name: round(float(prob), 4)
            for name, prob in zip(TRAJECTORY_CLASSES, probabilities)
        },
        sessions_used=len(req.sessions),
        model_version=meta.get("model_version", "trajectory-transformer-v1"),
        stub=False,
    )
