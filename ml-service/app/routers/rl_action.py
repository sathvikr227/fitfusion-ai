"""Model 5 — POST /rl/action (PPO policy behind a hard safety mask).

The agent was trained and evaluated in the rebuilt FitFusionEnv
(demos/model5_rl/). Whatever answers — PPO or the threshold rule — the action
passes through `safe_action`: never INCREASE while injured or on < 5.5 h sleep.
If the agent is missing or failed its pre-registered serving rule, the masked
threshold rule answers with `stub: true` and a `reason`.
"""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import RL_ACTION_INTENSITY_DELTA, RL_ACTIONS
from ..model_registry import ModelRegistry, get_registry
from ..rl_env import rule_based_action, safe_action
from ..schemas import RLActionResponse, RLStateRequest

log = logging.getLogger("ml-service.rl")
router = APIRouter(prefix="/rl", tags=["rl"])


def build_state(req: RLStateRequest) -> np.ndarray:
    """State vector exactly as the environment builds it."""
    return np.array(
        [
            float(np.clip(req.completion_rate, 0.0, 1.0)),
            float(np.clip(req.sleep_avg / 10.0, 0.0, 1.0)),
            float(np.clip(req.injury_flag, 0.0, 1.0)),
            float(np.clip(req.trajectory_score / 2.0, 0.0, 1.0)),
            float(min(req.streak, 14.0) / 14.0),
        ],
        dtype=np.float32,
    )


def response(index: int, raw: int, state: np.ndarray, confidence: float, version: str,
             reason: str | None, stub: bool) -> RLActionResponse:
    action = RL_ACTIONS[index]
    return RLActionResponse(
        action=action,
        intensity_delta=RL_ACTION_INTENSITY_DELTA[action],
        confidence=round(confidence, 4),
        state=[round(float(v), 4) for v in state],
        model_version=version,
        masked=index != raw,
        reason=reason,
        stub=stub,
    )


@router.post("/action", response_model=RLActionResponse)
def rl_action(
    req: RLStateRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> RLActionResponse:
    state = build_state(req)
    meta = reg.rl_meta or {}

    if reg.rl_agent is None or not meta.get("serve", False):
        reason = (f"agent unavailable ({reg.errors.get('rl', 'not loaded')})" if reg.rl_agent is None
                  else "agent failed its pre-registered serving rule")
        index = rule_based_action(state)  # already masked
        return response(index, index, state, 0.5, "rule-thresholds-masked", reason, stub=True)

    raw, _states = reg.rl_agent.predict(state, deterministic=True)
    raw = int(np.asarray(raw).reshape(-1)[0])
    index = safe_action(raw, state)

    # Policy probability of the action actually returned, so the UI can show
    # how sure the agent is rather than a hardcoded number.
    confidence = 0.0
    try:
        import torch

        with torch.no_grad():
            obs_tensor, _ = reg.rl_agent.policy.obs_to_tensor(state)
            probabilities = reg.rl_agent.policy.get_distribution(obs_tensor).distribution.probs[0].cpu().numpy()
            confidence = float(probabilities[index])
    except Exception:  # noqa: BLE001 - confidence is cosmetic, the action is not
        log.debug("could not read policy probabilities", exc_info=True)

    return response(index, raw, state, confidence, meta.get("model_version", "rl-ppo-v2"), None, stub=False)
