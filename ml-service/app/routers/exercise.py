"""Stage 2b — POST /recommend/exercises (content-based exercise recommendations).

Cosine similarity between the session profile (target muscles, goal, level) and
each free-exercise-db exercise, after hard filters for equipment, injuries,
level and target muscles. See app/exercise_recommender.py and
training/build_exercise_index.py. Content-based only: no exercise interaction
data exists to support collaborative filtering.

Without the index the endpoint returns no exercises (stub=True) and the caller
keeps its existing exercise selection.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_bearer
from ..exercise_recommender import ExerciseRecommenderError, recommend_exercises
from ..model_registry import ModelRegistry, get_registry
from ..schemas import ExerciseRequest, ExerciseResponse

log = logging.getLogger("ml-service.exercise")
router = APIRouter(tags=["recommend"])


@router.post("/recommend/exercises", response_model=ExerciseResponse)
def recommend_exercise_session(
    req: ExerciseRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> ExerciseResponse:
    if reg.exercise_index is None:
        log.warning("exercise index unavailable (%s) — returning no exercises",
                    reg.errors.get("exercise_recommender", "not loaded"))
        return ExerciseResponse(
            focus=req.focus, goal=req.goal or "", level="", allowed_equipment=[], injury_groups_excluded=[],
            excluded_counts={}, candidates_after_filters=0, recommendations=[],
            note="exercise index not loaded", model_version="fallback-empty", stub=True,
        )
    try:
        out = recommend_exercises(
            reg.exercise_index, focus=req.focus, goal=req.goal, training_style=req.training_style,
            activity_level=req.activity_level, injuries=req.injuries, equipment=req.equipment, k=req.k,
        )
    except ExerciseRecommenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExerciseResponse(**out, model_version=reg.exercise_index.get("model_version", "exercise-content-v1"))
