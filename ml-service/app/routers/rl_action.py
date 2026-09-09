"""Model 5 — POST /rl/action (PPO policy, final intensity decision)."""

from __future__ import annotations

import logging

import numpy as np
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..features import RL_ACTION_INTENSITY_DELTA, RL_ACTIONS
from ..model_registry import ModelRegistry, get_registry
from ..rl_env import rule_based_action
from ..schemas import RLActionResponse, RLStateRequest

log = logging.getLogger("ml-service.rl")
router = APIRouter(prefix="/rl", tags=["rl"])


def build_state(req: RLStateRequest) -> np.ndarray:
    """State vector exactly as the reference guide constructs it."""
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


@router.post("/action", response_model=RLActionResponse)
def rl_action(
    req: RLStateRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> RLActionResponse:
    state = build_state(req)

    if reg.rl_agent is None:
        log.warning("PPO agent unavailable (%s) — serving threshold policy",
                    reg.errors.get("rl", "not loaded"))
        index = rule_based_action(state)
        action = RL_ACTIONS[index]
        return RLActionResponse(
            action=action,
            intensity_delta=RL_ACTION_INTENSITY_DELTA[action],
            confidence=0.5,
            state=[round(float(v), 4) for v in state],
            model_version="fallback-thresholds",
            stub=True,
        )

    action_index, _states = reg.rl_agent.predict(state, deterministic=True)
    index = int(np.asarray(action_index).reshape(-1)[0])
    action = RL_ACTIONS[index]

    # Policy probability for the chosen action, so the UI can show how sure the
    # agent is rather than a hardcoded number.
    confidence = 0.0
    try:
        import torch

        with torch.no_grad():
            obs_tensor, _ = reg.rl_agent.policy.obs_to_tensor(state)
            distribution = reg.rl_agent.policy.get_distribution(obs_tensor)
            probabilities = distribution.distribution.probs[0].cpu().numpy()
            confidence = float(probabilities[index])
    except Exception:  # noqa: BLE001 - confidence is cosmetic, the action is not
        log.debug("could not read policy probabilities", exc_info=True)

    return RLActionResponse(
        action=action,
        intensity_delta=RL_ACTION_INTENSITY_DELTA[action],
        confidence=round(confidence, 4),
        state=[round(float(v), 4) for v in state],
        model_version="rl-ppo-v1",
        stub=False,
    )
