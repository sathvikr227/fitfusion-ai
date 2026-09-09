"""FitFusionEnv — the simulated user the PPO agent trains against (Model 5).

Lives under `app/` rather than `training/` so the service, the tests, and the
trainer all share one definition of the environment and its state layout.

State (5 dims, all normalised to [0, 1], exactly as the reference guide lists):

    [completion_rate, sleep_avg/10, injury_flag, trajectory_score/2, min(streak,14)/14]

Actions: 0 = REDUCE, 1 = MAINTAIN, 2 = INCREASE (plan intensity ∓15%).

Reward, per the guide:
    +1.0  next-week completion rate improves
    -2.0  an injury event occurs
    -0.5  the user churns (completion < 0.2 for two consecutive weeks)
     0.0  otherwise

Dynamics note. A naive simulator makes REDUCE dominant: cutting the plan always
raises the share of sessions completed, so "+1 when completion improves" would
train a degenerate always-REDUCE policy. This environment models training
adaptation instead — a latent `ability` that grows under productive overload and
decays under chronic undertraining. Reducing forever therefore erodes the very
ability that produces future completion, which gives the agent a real optimum to
find rather than a trivial one.

Default parameters are calibrated from the live FitFusion pilot export
(`training/export_pilot_data.py`); the trainer passes the measured values in.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import gymnasium as gym
import numpy as np
from gymnasium import spaces

# Pilot-derived fallbacks, used only when the trainer supplies nothing.
DEFAULT_MEAN_COMPLETION = 0.857
DEFAULT_STD_COMPLETION = 0.246
DEFAULT_INJURY_RATE = 0.105

WEEKS_PER_EPISODE = 12
CHURN_THRESHOLD = 0.2
INTENSITY_MIN = 0.55
INTENSITY_MAX = 1.60


@dataclass
class EnvConfig:
    """Calibration knobs, all sourced from pilot data where one exists."""

    mean_completion: float = DEFAULT_MEAN_COMPLETION
    std_completion: float = DEFAULT_STD_COMPLETION
    injury_rate: float = DEFAULT_INJURY_RATE
    weeks_per_episode: int = WEEKS_PER_EPISODE

    # Training-response model.
    overload_low: float = 0.95   # below this, the week was too easy
    overload_high: float = 1.25  # above this, the week was too hard
    ability_gain: float = 0.020  # weekly ability gain in the productive band
    ability_decay: float = 0.015 # weekly loss when chronically undertrained
    overreach_decay: float = 0.010

    # Injury hazard terms.
    injury_overreach_weight: float = 0.10
    injury_sleep_weight: float = 0.05
    injury_streak_weight: float = 0.03

    completion_noise: float = 0.07
    sleep_noise: float = 0.6
    fatigue_penalty: float = 0.60
    sleep_influence: float = 0.15
    injury_penalty: float = 0.25

    rng_seed: int | None = None
    _unused: dict = field(default_factory=dict, repr=False)


class FitFusionEnv(gym.Env):
    """One episode = one simulated user coached over `weeks_per_episode` weeks."""

    metadata = {"render_modes": []}

    def __init__(self, config: EnvConfig | None = None, include_trajectory: bool = True):
        super().__init__()
        self.config = config or EnvConfig()
        # `include_trajectory=False` powers the ablation the guide asks for:
        # the dimension stays in the observation but is zeroed out.
        self.include_trajectory = include_trajectory

        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(5,), dtype=np.float32)
        self.action_space = spaces.Discrete(3)

        self._rng = np.random.default_rng(self.config.rng_seed)
        self._reset_internals()

    # ── internals ─────────────────────────────────────────────────────────────
    def _reset_internals(self) -> None:
        cfg = self.config
        self.ability = float(
            np.clip(self._rng.normal(cfg.mean_completion, cfg.std_completion), 0.15, 1.0)
        )
        self.intensity = 1.0
        self.sleep_avg = float(np.clip(self._rng.normal(7.0, 1.0), 3.5, 10.0))
        self.injury_flag = 0.0
        self.streak = float(self._rng.integers(0, 8))
        self.completion = float(np.clip(self.ability + self._rng.normal(0, 0.05), 0.0, 1.0))
        self.prev_completion = self.completion
        self.trajectory = 1  # PLATEAU
        self.low_weeks = 0
        self.week = 0
        self.injury_events = 0
        self.churn_events = 0

    def _observation(self) -> np.ndarray:
        trajectory_norm = (self.trajectory / 2.0) if self.include_trajectory else 0.0
        return np.array(
            [
                np.clip(self.completion, 0.0, 1.0),
                np.clip(self.sleep_avg / 10.0, 0.0, 1.0),
                float(self.injury_flag),
                trajectory_norm,
                min(self.streak, 14.0) / 14.0,
            ],
            dtype=np.float32,
        )

    def _challenge(self) -> float:
        """Assigned load relative to what the user can currently sustain."""
        return self.intensity / max(self.ability, 0.15)

    # ── gym API ───────────────────────────────────────────────────────────────
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            self._rng = np.random.default_rng(seed)
            super().reset(seed=seed)
        self._reset_internals()
        return self._observation(), {}

    def step(self, action: int):
        cfg = self.config
        action = int(action)

        # 1. Apply the intensity decision (0 → −15%, 1 → 0%, 2 → +15%).
        delta = (-0.15, 0.0, 0.15)[action]
        self.intensity = float(
            np.clip(self.intensity * (1.0 + delta), INTENSITY_MIN, INTENSITY_MAX)
        )

        # 2. Sleep drifts week to week, independent of the agent.
        self.sleep_avg = float(
            np.clip(self.sleep_avg + self._rng.normal(0, cfg.sleep_noise), 3.5, 10.0)
        )

        challenge = self._challenge()

        # 3. Training adaptation: ability responds to how well the load is pitched.
        if cfg.overload_low <= challenge <= cfg.overload_high:
            self.ability += cfg.ability_gain
        elif challenge < cfg.overload_low - 0.10:
            self.ability -= cfg.ability_decay
        elif challenge > cfg.overload_high + 0.15:
            self.ability -= cfg.overreach_decay
        self.ability = float(np.clip(self.ability, 0.15, 1.0))

        # 4. Injury hazard rises with overreach, poor sleep, and long streaks.
        hazard = (
            cfg.injury_rate * 0.25
            + cfg.injury_overreach_weight * max(0.0, challenge - cfg.overload_high)
            + cfg.injury_sleep_weight * max(0.0, (6.5 - self.sleep_avg) / 2.0)
            + cfg.injury_streak_weight * (min(self.streak, 14.0) / 14.0)
        )
        if self.injury_flag:
            hazard *= 1.5
        injury_event = float(self._rng.random() < np.clip(hazard, 0.0, 0.9))
        if injury_event:
            self.injury_events += 1
            self.injury_flag = 1.0
        elif self.injury_flag and self._rng.random() < 0.4:
            self.injury_flag = 0.0  # recovered

        # 5. Completion for the week that follows.
        fatigue = max(0.0, self.intensity - 1.0)
        sleep_factor = (self.sleep_avg - 5.0) / 3.0
        completion = (
            self.ability * (1.0 - cfg.fatigue_penalty * fatigue)
            + cfg.sleep_influence * (sleep_factor - 0.5)
            - cfg.injury_penalty * self.injury_flag
            + self._rng.normal(0.0, cfg.completion_noise)
        )
        self.prev_completion = self.completion
        self.completion = float(np.clip(completion, 0.0, 1.0))

        # 6. Streak and churn bookkeeping.
        if self.completion >= 0.5:
            self.streak += 1
        else:
            self.streak = 0.0

        churn_event = 0.0
        if self.completion < CHURN_THRESHOLD:
            self.low_weeks += 1
            if self.low_weeks >= 2:
                churn_event = 1.0
                self.churn_events += 1
        else:
            self.low_weeks = 0

        # 7. Trajectory label the Transformer would emit for this user.
        change = self.completion - self.prev_completion
        self.trajectory = 2 if change > 0.05 else (0 if change < -0.05 else 1)

        # 8. Reward, exactly as documented.
        reward = 0.0
        if self.completion > self.prev_completion:
            reward += 1.0
        reward -= 2.0 * injury_event
        reward -= 0.5 * churn_event

        self.week += 1
        terminated = bool(churn_event)
        truncated = self.week >= cfg.weeks_per_episode

        info = {
            "injury_event": injury_event,
            "churn_event": churn_event,
            "ability": self.ability,
            "intensity": self.intensity,
            "challenge": challenge,
        }
        return self._observation(), float(reward), terminated, truncated, info


def rule_based_action(observation: np.ndarray) -> int:
    """The thresholds FitFusion ships today, used as the RL comparison baseline.

    Mirrors `/api/adaptive-replan`: under 60% completion reduce, over 85%
    increase, otherwise hold.
    """
    completion = float(observation[0])
    if completion < 0.60:
        return 0  # REDUCE
    if completion > 0.85:
        return 2  # INCREASE
    return 1  # MAINTAIN
