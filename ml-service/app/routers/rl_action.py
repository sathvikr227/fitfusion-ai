from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..schemas import RLActionResponse, RLStateRequest

router = APIRouter(prefix="/rl", tags=["rl"])


@router.post("/action", response_model=RLActionResponse)
def rl_action(req: RLStateRequest, _: None = Depends(require_bearer)) -> RLActionResponse:
    # Mirrors the current if/else block in /api/adaptive-replan, with injury + trajectory added.
    if req.injury_flag >= 0.5 or req.sleep_avg < 5.5:
        return RLActionResponse(action="REDUCE", confidence=0.7, model_version="stub-rules-v0", stub=True)
    if req.completion_rate < 0.6 or req.trajectory_score < -0.2:
        return RLActionResponse(action="REDUCE", confidence=0.65, model_version="stub-rules-v0", stub=True)
    if req.completion_rate > 0.85 and req.trajectory_score > 0.2:
        return RLActionResponse(action="INCREASE", confidence=0.7, model_version="stub-rules-v0", stub=True)
    return RLActionResponse(action="MAINTAIN", confidence=0.6, model_version="stub-rules-v0", stub=True)
