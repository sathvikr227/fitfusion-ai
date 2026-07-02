from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..schemas import RecommendItem, RecommendRequest, RecommendResponse

router = APIRouter(tags=["recommend"])

_SEED_WORKOUTS = [
    ("w_push_basic", "Push day: bench, OHP, dips"),
    ("w_pull_basic", "Pull day: rows, pulldowns, curls"),
    ("w_legs_basic", "Leg day: squat, RDL, lunges"),
    ("w_full_body", "Full-body strength circuit"),
    ("w_hiit_20", "20-min HIIT conditioning"),
]
_SEED_DIET = [
    ("d_high_protein", "High-protein balanced day (~2200 kcal)"),
    ("d_cut_modest", "Moderate cut (~1800 kcal)"),
    ("d_lean_bulk", "Lean bulk (~2700 kcal)"),
    ("d_mediterranean", "Mediterranean balanced"),
    ("d_veg_high_protein", "Vegetarian high protein"),
]


@router.post("/recommend", response_model=RecommendResponse)
def recommend(req: RecommendRequest, _: None = Depends(require_bearer)) -> RecommendResponse:
    pool = _SEED_WORKOUTS if req.kind == "workout" else _SEED_DIET
    items = [
        RecommendItem(item_id=i, name=n, score=round(1.0 - 0.1 * idx, 3))
        for idx, (i, n) in enumerate(pool[: req.top_k])
    ]
    return RecommendResponse(items=items, model_version="stub-seed-v0", stub=True)
