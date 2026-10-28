"""Model 5 — environment, safety mask, baseline rule, endpoint and artifact checks."""

from __future__ import annotations

import json
import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.model_registry import ModelRegistry, get_registry  # noqa: E402
from app.rl_env import (  # noqa: E402
    INCREASE,
    MAINTAIN,
    REDUCE,
    Assumptions,
    Calibration,
    FitFusionEnv,
    rule_based_action,
    safe_action,
)
from training.common import MODEL_DIR, REPORT_DIR  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
AUTH = {"Authorization": "Bearer test-key"}
client = TestClient(app)
CAL = MODEL_DIR / "rl_calibration.json"
needs_calibration = pytest.mark.skipif(not CAL.exists(), reason="rl_calibration.json not built")
needs_agent = pytest.mark.skipif(not (MODEL_DIR / "rl_ppo_meta.json").exists(), reason="PPO not trained")


def obs(completion=0.9, sleep=8.0, injured=0.0, trajectory=1, streak=3):
    return np.array([completion, sleep / 10, injured, trajectory / 2, streak / 14], dtype=np.float32)


# ── safety mask and baseline rule ─────────────────────────────────────────────
@pytest.mark.parametrize("state, expected", [
    (obs(), INCREASE),
    (obs(injured=1.0), MAINTAIN),
    (obs(sleep=5.0), MAINTAIN),
])
def test_safety_mask_blocks_increase_only_when_unsafe(state, expected):
    assert safe_action(INCREASE, state) == expected
    assert safe_action(REDUCE, state) == REDUCE
    assert safe_action(MAINTAIN, state) == MAINTAIN


def test_threshold_rule_is_masked():
    assert rule_based_action(obs(completion=0.5)) == REDUCE
    assert rule_based_action(obs(completion=0.7)) == MAINTAIN
    assert rule_based_action(obs(completion=0.95)) == INCREASE
    assert rule_based_action(obs(completion=0.95, injured=1.0)) == MAINTAIN


# ── environment ───────────────────────────────────────────────────────────────
def test_env_contract_and_determinism():
    env = FitFusionEnv(Calibration())
    o1, _ = env.reset(seed=7)
    assert o1.shape == (5,) and env.observation_space.contains(o1)
    trace1 = [env.step(1)[1] for _ in range(5)]
    env.reset(seed=7)
    trace2 = [env.step(1)[1] for _ in range(5)]
    assert trace1 == trace2


def test_env_applies_the_mask_inside_step():
    env = FitFusionEnv(Calibration())
    env.reset(seed=1)
    env.injured_weeks = 3
    _, _, _, _, info = env.step(INCREASE)
    assert info["applied_action"] == MAINTAIN


def test_episode_ends_at_26_weeks_or_churn():
    env = FitFusionEnv(Calibration())
    env.reset(seed=3)
    weeks, done = 0, False
    while not done:
        _, _, terminated, truncated, info = env.step(MAINTAIN)
        weeks += 1
        done = terminated or truncated
    assert weeks <= Assumptions().weeks
    assert truncated or info["churn"] == 1.0


def test_stressed_assumptions_stay_within_25_percent():
    base = Assumptions()
    s = base.stressed(np.random.default_rng(0))
    for name in ("overload_drop", "sleep_effect", "noise", "injury_weeks", "capacity_per_fitness"):
        assert 0.75 * getattr(base, name) <= getattr(s, name) <= 1.25 * getattr(base, name)


@needs_calibration
def test_calibration_curves_are_real_and_ordered():
    cal = Calibration.from_json(CAL)
    assert cal.gain_edges == sorted(cal.gain_edges) and len(cal.gain_weekly) >= 5
    assert cal.weekly_gain(0.3) < cal.weekly_gain(2.5)  # Strava: more load, more improvement
    assert 0.0 < cal.base_weekly_injury < 0.2
    assert 6.0 < cal.sleep_mean < 9.5


# ── endpoint ──────────────────────────────────────────────────────────────────
def test_rl_endpoint_falls_back_to_masked_rule_without_agent(tmp_path):
    empty = ModelRegistry(model_dir=tmp_path)
    empty.load_all()
    app.dependency_overrides[get_registry] = lambda: empty
    try:
        body = {"user_id": "u1", "completion_rate": 0.95, "sleep_avg": 8, "injury_flag": 1}
        r = TestClient(app).post("/rl/action", json=body, headers=AUTH).json()
        assert r["stub"] is True and r["reason"]
        assert r["action"] == "MAINTAIN"  # rule says INCREASE, the mask forbids it while injured
    finally:
        app.dependency_overrides.clear()


@needs_agent
def test_endpoint_never_increases_while_injured_or_short_of_sleep():
    for completion in (0.2, 0.5, 0.7, 0.9, 1.0):
        for trajectory in (0, 1, 2):
            for injured, sleep in ((1, 8.0), (0, 5.0)):
                body = {"user_id": "u1", "completion_rate": completion, "sleep_avg": sleep,
                        "injury_flag": injured, "trajectory_score": trajectory, "streak": 5}
                assert client.post("/rl/action", json=body, headers=AUTH).json()["action"] != "INCREASE"


@needs_agent
def test_artifact_matches_report():
    meta = json.loads((MODEL_DIR / "rl_ppo_meta.json").read_text(encoding="utf-8"))
    report = json.loads((REPORT_DIR / "rl_ppo.json").read_text(encoding="utf-8"))
    assert meta["serve"] == report["decision"]["serve"]
    assert meta["standard_mean_return"] == report["results"]["standard"]["PPO seed 42"]["mean_return"]
