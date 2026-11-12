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
# calibrate_rl_env.py writes the same numbers to models/ (gitignored) and to
# models/reports/ (committed), so a fresh clone can still check the real curves.
CAL = next((p for p in (MODEL_DIR / "rl_calibration.json", REPORT_DIR / "rl_calibration.json") if p.exists()),
           MODEL_DIR / "rl_calibration.json")
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
    name = {3: "rl_ppo_round3.json", 2: "rl_ppo_round2.json"}.get(meta.get("round", 1), "rl_ppo.json")
    report = json.loads((REPORT_DIR / name).read_text(encoding="utf-8"))
    pre_registered = meta.get("pre_registered_serve", meta["serve"])
    assert pre_registered == report["decision"]["serve"]
    # Serving against the pre-registered rule is allowed only as a recorded owner override.
    if meta["serve"] != pre_registered:
        override = meta["owner_override"]
        assert override["date"] and override["basis"] and override["pre_registered_failure"]
    assert meta["standard_mean_return"] == report["results"]["standard"]["PPO seed 42"]["mean_return"]


@needs_agent
def test_served_agent_with_all_inputs_never_increases_while_injured_or_short_of_sleep():
    meta = json.loads((MODEL_DIR / "rl_ppo_meta.json").read_text(encoding="utf-8"))
    if not meta.get("serve"):
        pytest.skip("no agent served")
    for completion in (0.2, 0.5, 0.7, 0.9, 1.0):
        for intensity in (0.4, 1.0, 1.6, 2.5):
            for previous in ("REDUCE", "MAINTAIN", "INCREASE"):
                for injured, sleep in ((1, 8.0), (0, 5.0)):
                    body = {"user_id": "u1", "completion_rate": completion, "sleep_avg": sleep,
                            "injury_flag": injured, "trajectory_score": 2, "streak": 9,
                            "planned_intensity": intensity, "previous_action": previous}
                    r = client.post("/rl/action", json=body, headers=AUTH).json()
                    assert r["action"] != "INCREASE"
                    if meta.get("observation_dims", 5) == 7:
                        assert r["stub"] is False and r["model_version"] == meta["model_version"]


# ── round 3 (PROTOCOL_ROUND3.md) ──────────────────────────────────────────────
def test_round2_environment_is_unchanged_by_default():
    """Round-3 options are off by default, so rounds 1-2 reproduce exactly."""
    env = FitFusionEnv(Calibration())
    o, _ = env.reset(seed=5)
    assert o.shape == (5,) and env.calibration.rr_smooth is None


def test_observe_load_adds_planned_intensity_and_previous_action():
    env = FitFusionEnv(Calibration(), observe_load=True)
    o, _ = env.reset(seed=5)
    assert o.shape == (7,) and env.observation_space.contains(o)
    assert o[5] == pytest.approx(1.0 / 2.5) and o[6] == pytest.approx(0.5)   # load 1.0, MAINTAIN
    o, *_ = env.step(INCREASE)
    assert o[5] == pytest.approx(1.15 / 2.5) and o[6] == pytest.approx(1.0)
    env.injured_weeks = 3
    o, *_ = env.step(INCREASE)                       # masked to MAINTAIN: the obs shows what was applied
    assert o[5] == pytest.approx(1.15 / 2.5) and o[6] == pytest.approx(0.5)


@needs_calibration
def test_smooth_injury_curve_is_monotone_and_anchored_at_one():
    cal = Calibration.from_json(CAL, injury="smooth")
    assert cal.rr_smooth["kind"] == "logistic"
    assert cal.relative_risk(1.0) == pytest.approx(1.0)
    values = [cal.relative_risk(x) for x in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0)]
    assert values == sorted(values) and values[-1] == values[-2]          # clipped at ACWR 3
    with pytest.raises(ValueError):
        Calibration.from_json(CAL, injury="wiggly")


def test_training_wrappers_keep_the_expected_return_and_end_at_week_26():
    from training.train_rl_ppo_round3 import ExpectedInjury, HorizonIsTerminal

    env = HorizonIsTerminal(ExpectedInjury(FitFusionEnv(Calibration())))
    env.reset(seed=11)
    steps, done = 0, False
    while not done:
        _, _, terminated, truncated, info = env.step(MAINTAIN)
        steps += 1
        done = terminated or truncated
        assert truncated is False                                  # nothing is bootstrapped past week 26
    assert steps == Assumptions().weeks or info["churn"] == 1.0
    assert 0.0 <= info["injury_probability"] <= 0.9


def test_seven_input_agent_needs_both_extra_inputs(tmp_path):
    """With a 7-input agent, a request without planned_intensity/previous_action gets the
    masked rule and says why, instead of guessing the missing inputs."""
    from app.routers.rl_action import agent_state, build_state
    from app.schemas import RLStateRequest

    req = RLStateRequest(user_id="u", completion_rate=0.9, sleep_avg=8, injury_flag=0)
    state = build_state(req)
    assert agent_state(req, state, 5) is state
    assert agent_state(req, state, 7) is None
    full = RLStateRequest(user_id="u", completion_rate=0.9, sleep_avg=8, injury_flag=0,
                          planned_intensity=3.0, previous_action="REDUCE")
    obs7 = agent_state(full, state, 7)
    assert obs7.shape == (7,) and obs7[5] == pytest.approx(1.0) and obs7[6] == pytest.approx(0.0)
