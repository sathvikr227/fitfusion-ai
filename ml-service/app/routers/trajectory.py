from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..schemas import TrajectoryRequest, TrajectoryResponse

router = APIRouter(prefix="/predict", tags=["trajectory"])


@router.post("/trajectory", response_model=TrajectoryResponse)
def predict_trajectory(req: TrajectoryRequest, _: None = Depends(require_bearer)) -> TrajectoryResponse:
    # Slope of total_volume across the supplied sessions; signed score in [-1, 1].
    vols = [s.total_volume for s in req.sessions]
    if len(vols) < 2:
        label = "plateau"
        score = 0.0
    else:
        first, last = vols[0], vols[-1]
        denom = max(abs(first), 1.0)
        raw = (last - first) / denom
        score = max(-1.0, min(1.0, raw))
        if score > 0.1:
            label = "improve"
        elif score < -0.1:
            label = "regress"
        else:
            label = "plateau"

    probs = {"improve": 0.0, "plateau": 0.0, "regress": 0.0}
    probs[label] = 0.6
    for k in probs:
        if k != label:
            probs[k] = 0.2

    return TrajectoryResponse(
        label=label,
        score=round(score, 3),
        probs=probs,
        model_version="stub-slope-v0",
        stub=True,
    )
