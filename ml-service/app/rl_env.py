"""FitFusionEnv — the simulated user the PPO agent trains against (Model 5).

Rebuilt 2026-10-28 to demos/model5_rl/PROTOCOL.md. Lives under `app/` so the
service, the tests and the trainer share one definition of the state, the
safety mask and the baseline rule.

State (5 dims in [0, 1], as the slides specify):
    [completion_rate, sleep_avg/10, injury_flag, trajectory_score/2, min(streak,14)/14]
Actions: 0 REDUCE, 1 MAINTAIN, 2 INCREASE (planned load ×0.85 / ×1 / ×1.15).
One step = one simulated week; one episode = one simulated user (≤ 26 weeks).

Real-data parts (models/rl_calibration.json, from training/calibrate_rl_env.py):
  * weekly fitness change vs load ratio (Strava logs),
  * injury relative risk vs acute:chronic ratio and the baseline weekly risk (runners),
  * weekly sleep mean / spread / persistence (SoccerMon).
Assumed parts (no real data; stress-tested): adherence response, capacity growth,
injury duration, churn.

Reward: 100·Δfitness − 3·injury onset − 20·churn (see CHURN_PENALTY). Completion earns nothing by itself.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces

REDUCE, MAINTAIN, INCREASE = 0, 1, 2
LOAD_STEP = (0.85, 1.0, 1.15)
LOAD_MIN, LOAD_MAX = 0.4, 2.5
SLEEP_FLOOR_FOR_INCREASE = 5.5
# Raised from the pre-registered 5 (RESULTS.md, deviation 2): at 5, ending the episode by
# churning every user avoided more injury cost than it lost, so "always INCREASE" scored best.
CHURN_PENALTY = 20.0
# Model 4's label thresholds, applied to the simulated 4-week fitness change.
IMPROVE_THRESHOLD, REGRESS_THRESHOLD = 0.0223, 0.0211


def safe_action(action: int, observation) -> int:
    """Hard safety mask: never INCREASE while injured or with < 5.5 h average sleep."""
    action = int(action)
    injured = float(observation[2]) >= 0.5
    short_sleep = float(observation[1]) * 10.0 < SLEEP_FLOOR_FOR_INCREASE
    if action == INCREASE and (injured or short_sleep):
        return MAINTAIN
    return action


def rule_based_action(observation) -> int:
    """The thresholds FitFusion shipped before the agent, with the safety mask."""
    completion = float(observation[0])
    action = REDUCE if completion < 0.60 else INCREASE if completion > 0.85 else MAINTAIN
    return safe_action(action, observation)


@dataclass
class Calibration:
    """Real-data curves. The neutral default (flat curves) is for tests only."""

    gain_edges: list[float] = field(default_factory=lambda: [0.0])
    gain_weekly: list[float] = field(default_factory=lambda: [0.0])
    rr_edges: list[float] = field(default_factory=lambda: [0.0])
    rr_values: list[float] = field(default_factory=lambda: [1.0])
    base_weekly_injury: float = 0.05
    sleep_mean: float = 7.5
    sleep_sd: float = 0.7
    sleep_rho: float = 0.5
    source: str = "neutral default (tests only)"

    @classmethod
    def from_json(cls, path: str | Path) -> "Calibration":
        c = json.loads(Path(path).read_text(encoding="utf-8"))
        gain = [b for b in c["adaptation"]["bins"] if b["n"] >= c.get("min_bin_n", 200)]
        risk = [b for b in c["injury"]["bins"] if b.get("relative_risk") is not None]
        return cls(
            gain_edges=[b["lo"] for b in gain], gain_weekly=[b["weekly_gain"] for b in gain],
            rr_edges=[b["lo"] for b in risk], rr_values=[b["relative_risk"] for b in risk],
            base_weekly_injury=float(c["injury"]["baseline_weekly_probability"]),
            sleep_mean=float(c["sleep"]["mean"]), sleep_sd=float(c["sleep"]["sd"]),
            sleep_rho=float(c["sleep"]["lag1_autocorrelation"]), source=str(path),
        )

    @staticmethod
    def _lookup(edges: list[float], values: list[float], x: float) -> float:
        index = int(np.searchsorted(edges, x, side="right")) - 1
        return float(values[max(0, min(index, len(values) - 1))])

    def weekly_gain(self, load_ratio: float) -> float:
        return self._lookup(self.gain_edges, self.gain_weekly, load_ratio)

    def relative_risk(self, acwr: float) -> float:
        return self._lookup(self.rr_edges, self.rr_values, acwr)


@dataclass
class Assumptions:
    """No real data exists for these; the stressed scenarios scale each by U(0.75, 1.25)."""

    adherence: float = 0.85          # completion at a sustainable load, good sleep, no injury
    overload_drop: float = 0.6       # completion lost per unit of load above capacity
    sleep_effect: float = 0.04       # completion change per hour of sleep vs 7 h
    noise: float = 0.07              # week-to-week completion noise (sd)
    injury_weeks: float = 2.0        # mean injury duration in weeks
    capacity_per_fitness: float = 5.0  # sustainable load grows 5% per 1% pace improvement
    weeks: int = 26

    def stressed(self, rng: np.random.Generator) -> "Assumptions":
        scale = lambda: float(rng.uniform(0.75, 1.25))  # noqa: E731
        return replace(self, adherence=min(0.98, self.adherence * scale()),
                       overload_drop=self.overload_drop * scale(), sleep_effect=self.sleep_effect * scale(),
                       noise=self.noise * scale(), injury_weeks=self.injury_weeks * scale(),
                       capacity_per_fitness=self.capacity_per_fitness * scale())


class FitFusionEnv(gym.Env):
    """One episode = one simulated user coached week by week."""

    metadata = {"render_modes": []}

    def __init__(self, calibration: Calibration | None = None, assumptions: Assumptions | None = None,
                 stress: bool = False, include_trajectory: bool = True):
        super().__init__()
        self.calibration = calibration or Calibration()
        self.base_assumptions = assumptions or Assumptions()
        self.stress = stress
        self.include_trajectory = include_trajectory
        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(5,), dtype=np.float32)
        self.action_space = spaces.Discrete(3)
        self._rng = np.random.default_rng()
        self.reset()

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        rng, cal = self._rng, self.calibration
        self.a = self.base_assumptions.stressed(rng) if self.stress else self.base_assumptions
        self.fitness = 0.0
        self.fitness_history = [0.0] * 4
        self.load = 1.0
        self.done_loads = [self.a.adherence] * 4
        self.sleep = float(np.clip(rng.normal(cal.sleep_mean, cal.sleep_sd), 3.0, 11.0))
        self.injured_weeks = 0
        self.completion = self.a.adherence
        self.streak = 0
        self.trajectory = 1
        self.low_weeks = 0
        self.week = 0
        self.injuries = 0
        return self._observation(), {}

    def _observation(self) -> np.ndarray:
        trajectory = self.trajectory / 2.0 if self.include_trajectory else 0.0
        return np.array([np.clip(self.completion, 0, 1), np.clip(self.sleep / 10.0, 0, 1),
                         1.0 if self.injured_weeks > 0 else 0.0, trajectory,
                         min(self.streak, 14) / 14.0], dtype=np.float32)

    def step(self, action: int):
        rng, cal, a = self._rng, self.calibration, self.a
        applied = safe_action(action, self._observation())
        self.load = float(np.clip(self.load * LOAD_STEP[applied], LOAD_MIN, LOAD_MAX))

        # Sleep: AR(1) around the SoccerMon mean.
        self.sleep = float(np.clip(cal.sleep_mean + cal.sleep_rho * (self.sleep - cal.sleep_mean)
                                   + np.sqrt(1 - cal.sleep_rho ** 2) * cal.sleep_sd * rng.normal(), 3.0, 11.0))

        injured = self.injured_weeks > 0
        capacity = 1.0 + a.capacity_per_fitness * max(self.fitness, -0.15)
        completion = (a.adherence - a.overload_drop * max(0.0, self.load / capacity - 1.0)
                      - 0.5 * injured + a.sleep_effect * (self.sleep - 7.0) + rng.normal(0, a.noise))
        self.completion = float(np.clip(completion, 0.0, 1.0))

        done_load = self.load * self.completion
        chronic4 = float(np.mean(self.done_loads[-4:]))
        load_ratio = done_load / chronic4 if chronic4 > 1e-6 else 1.0
        acwr_base = float(np.mean([done_load, *self.done_loads[-2:]]))
        acwr = done_load / acwr_base if acwr_base > 1e-6 else 1.0
        self.done_loads.append(done_load)

        gain = cal.weekly_gain(load_ratio)
        self.fitness += gain
        self.fitness_history.append(self.fitness)

        onset = 0.0
        if injured:
            self.injured_weeks -= 1
        elif rng.random() < min(0.9, cal.base_weekly_injury * cal.relative_risk(acwr)):
            onset = 1.0
            self.injuries += 1
            self.injured_weeks = int(rng.geometric(1.0 / max(a.injury_weeks, 1.0)))

        self.streak = self.streak + 1 if self.completion >= 0.5 else 0
        churn = 0.0
        if self.completion < 0.2:
            self.low_weeks += 1
            churn = float(self.low_weeks >= 2)
        else:
            self.low_weeks = 0

        change = self.fitness - self.fitness_history[-5]
        self.trajectory = 2 if change > IMPROVE_THRESHOLD else 0 if change < -REGRESS_THRESHOLD else 1

        reward = 100.0 * gain - 3.0 * onset - CHURN_PENALTY * churn
        self.week += 1
        info = {"applied_action": applied, "gain": gain, "injury_onset": onset, "churn": churn,
                "load": self.load, "load_ratio": load_ratio, "acwr": acwr, "fitness": self.fitness}
        return self._observation(), float(reward), bool(churn), self.week >= a.weeks, info
