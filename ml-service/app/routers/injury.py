from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..schemas import InjuryRequest, InjuryResponse

router = APIRouter(prefix="/predict", tags=["injury"])


@router.post("/injury", response_model=InjuryResponse)
def predict_injury(req: InjuryRequest, _: None = Depends(require_bearer)) -> InjuryResponse:
    # Crude heuristic stub: bumps risk on the muscle groups the user has historically injured,
    # and on low sleep / high volume. Real model lands in Step 4.
    base = {"knee": 0.05, "back": 0.05, "shoulder": 0.05}
    for prior in req.prior_injuries:
        key = prior.lower()
        if key in base:
            base[key] += 0.25
    if req.sleep_avg_hours is not None and req.sleep_avg_hours < 6:
        for k in base:
            base[k] += 0.05
    if req.weekly_volume_sets is not None and req.weekly_volume_sets > 80:
        base["back"] += 0.05
        base["shoulder"] += 0.05
    if req.weekly_high_impact_sessions is not None and req.weekly_high_impact_sessions > 3:
        base["knee"] += 0.05
    return InjuryResponse(
        risk={k: round(min(v, 0.95), 3) for k, v in base.items()},
        model_version="stub-heuristic-v0",
        stub=True,
    )
