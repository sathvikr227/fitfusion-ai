"""Model 5 teacher demo — PPO adaptive-replan agent behind a hard safety mask.

Shows the audit of the old agent, the real-data calibration of the simulator, the
training bug that sank rounds 1-2 (computed live), the decision for the labelled
state in sample_input.json from what the app serves (the masked rule) and from the
round-3 PPO agent, one simulated user coached by the round-1 agent, the round-3
agent and the rule on the same seed, the same request through the FastAPI
endpoint, and the evaluation. EVERYTHING HERE IS SIMULATED.

Run from ml-service/:

    .venv\\Scripts\\python.exe demos\\model5_rl\\demo.py
    .venv\\Scripts\\python.exe demos\\model5_rl\\demo.py my_state.json

Output is saved to outputs/demo_output.txt and outputs/demo_output.json.
"""

from __future__ import annotations

import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_SERVICE = HERE.parent.parent
sys.path.insert(0, str(ML_SERVICE))
os.chdir(ML_SERVICE)
os.environ.setdefault("ML_SERVICE_API_KEY", "demo-key")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402
from stable_baselines3 import PPO  # noqa: E402

from app.rl_env import (  # noqa: E402
    LOAD_MAX,
    MAINTAIN,
    Assumptions,
    Calibration,
    FitFusionEnv,
    rule_based_action,
    safe_action,
)

MODEL_DIR = ML_SERVICE / "models"
REPORTS = MODEL_DIR / "reports"
ROUND3 = MODEL_DIR / "rl_round3"
OUT = HERE / "outputs"
ACTIONS = ["REDUCE", "MAINTAIN", "INCREASE"]
RESULT: dict = {}


def section(title: str) -> None:
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def state_vector(s: dict) -> np.ndarray:
    return np.array([s["completion_rate"], min(s["sleep_avg"] / 10, 1), s["injury_flag"],
                     s["trajectory_score"] / 2, min(s["streak"], 14) / 14], dtype=np.float32)


def with_load(state: np.ndarray, s: dict) -> np.ndarray:
    load = float(np.clip(s.get("planned_intensity", 1.0), 0.4, LOAD_MAX)) / LOAD_MAX
    previous = ACTIONS.index(s.get("previous_action", "MAINTAIN")) / 2
    return np.concatenate([state, np.array([load, previous], dtype=np.float32)])


def coach(env: FitFusionEnv, policy, seed: int) -> list[dict]:
    obs, _ = env.reset(seed=seed)
    trace, done = [], False
    while not done:
        action = safe_action(policy(obs), obs)
        new_obs, reward, terminated, truncated, info = env.step(action)
        trace.append({"week": env.week, "action": ACTIONS[action], "completion": float(new_obs[0]),
                      "injured": bool(new_obs[2]), "load": info["load"], "fitness_pct": 100 * info["fitness"],
                      "reward": reward, "churn": info["churn"]})
        obs, done = new_obs, terminated or truncated
    return trace


def main() -> None:
    OUT.mkdir(exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    input_path = Path(args[0]) if args else HERE / "sample_input.json"
    sample = json.loads(input_path.read_text(encoding="utf-8"))
    served_meta = load_json(MODEL_DIR / "rl_ppo_meta.json") or {}
    r3 = load_json(REPORTS / "rl_ppo_round3.json")
    r3_meta = load_json(ROUND3 / "rl_ppo_meta_round3.json")
    agent1 = PPO.load(str(MODEL_DIR / "rl_ppo_agent.zip"), device="cpu")          # round 1 (not served)
    agent3 = PPO.load(str(ROUND3 / "rl_ppo_agent_round3.zip"), device="cpu")      # round 3 (not served)
    cal_bins = Calibration.from_json(MODEL_DIR / "rl_calibration.json")
    cal = Calibration.from_json(MODEL_DIR / "rl_calibration.json", injury="smooth")

    section("1. Why Model 5 was rebuilt")
    old_path = REPORTS / "rl_agent.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))["comparison"]
        print(f"  Original agent: mean reward {old['ppo']['mean_reward']} vs threshold rule "
              f"{old['rule_based']['mean_reward']}; it chose REDUCE "
              f"{old['ppo']['action_distribution']['REDUCE']:.0%} of the time.")
    print("  Cause: it was paid +1 whenever completion rose, so cutting the plan always 'won'. Its")
    print("  calibration came from 2 seeded test users. Safety was learned, not enforced.")

    section("2. The simulator: real-data curves (models/reports/rl_calibration.json)")
    print("  Fitness change per week by load ratio (Strava, 2.56M athlete-weeks):")
    for lo, g in zip(cal.gain_edges, cal.gain_weekly):
        print(f"    load ratio >= {lo:<5g} -> {100 * g:+.3f}% pace per week")
    s = cal.rr_smooth
    print(f"  Injury relative risk vs ACWR (runners, {s['days']:,} days, {s['injuries']} injuries):")
    print(f"    round 3, logistic fit: slope {s['slope']:+.3f} [{s['slope_ci95'][0]:+.3f}, {s['slope_ci95'][1]:+.3f}]")
    for x in (0.5, 1.0, 1.5, 2.0, 3.0):
        print(f"      ACWR {x:<4g} -> RR {cal.relative_risk(x):.2f}   (rounds 1-2 bins: {cal_bins.relative_risk(x):.2f})")
    print(f"  Baseline weekly injury probability {cal.base_weekly_injury:.3f}; sleep mean "
          f"{cal.sleep_mean:.2f} h, sd {cal.sleep_sd:.2f}, persistence {cal.sleep_rho:.2f} (SoccerMon)")
    print("  Adherence, capacity growth, injury duration and churn are ASSUMPTIONS (DATA_SOURCES.md).")

    section("3. The bug that sank rounds 1-2 (computed now, development seeds 400000-400199)")
    env = FitFusionEnv(cal)
    weekly = []
    for i in range(200):
        obs, _ = env.reset(seed=400_000 + i)
        done = False
        while not done:
            obs, r, term, trunc, _ = env.step(MAINTAIN)
            weekly.append(r)
            done = term or trunc
    per_week = float(np.mean(weekly))
    print(f"  Average reward per week under always-MAINTAIN: {per_week:+.3f} (fitness drifts down, injuries happen)")
    print(f"  Week 26 was 'truncated', so PPO valued a user who stays as if they trained forever:")
    print(f"    {per_week:+.3f} / (1 - 0.99) = {per_week / 0.01:+.1f}   vs   quitting (churn) = -20 once")
    print("  -> pushing the user until they quit looked BETTER to PPO. Every round-1/2 seed learned exactly that.")
    print("  Round 3 makes week 26 the real end (what the evaluation scores) and the collapse disappears.")
    RESULT["bug"] = {"reward_per_week_maintain": per_week, "infinite_horizon_value": per_week / 0.01}

    section("4. Labelled sample state -> decision")
    print(f"  {sample.get('_label', '')}")
    state = state_vector(sample)
    obs7 = with_load(state, sample)
    rule = rule_based_action(state)
    raw3 = int(agent3.predict(obs7, deterministic=True)[0])
    print(f"  State (5 slide inputs): {[round(float(x), 3) for x in state]}  + round-3 inputs: "
          f"{[round(float(x), 3) for x in obs7[5:]]}")
    print(f"  SERVED (masked threshold rule): {ACTIONS[rule]}")
    print(f"  Round-3 PPO (evaluated, not served): raw {ACTIONS[raw3]} -> after mask {ACTIONS[safe_action(raw3, obs7)]}")
    injured = obs7.copy()
    injured[2] = 1.0
    raw_inj = int(agent3.predict(injured, deterministic=True)[0])
    print(f"  Same user, injured: PPO raw {ACTIONS[raw_inj]} -> {ACTIONS[safe_action(raw_inj, injured)]}; rule "
          f"{ACTIONS[rule_based_action(injured[:5])]} (the mask never allows INCREASE while injured or on < 5.5 h sleep)")
    RESULT["sample"] = {"served_rule": ACTIONS[rule], "ppo_round3_raw": ACTIONS[raw3],
                        "ppo_round3_masked": ACTIONS[safe_action(raw3, obs7)]}

    section("5. One simulated user, 26 weeks, same seed 123")
    runs = (("PPO round 1", FitFusionEnv(cal), lambda o: int(agent1.predict(o, deterministic=True)[0])),
            ("PPO round 3", FitFusionEnv(cal, observe_load=True), lambda o: int(agent3.predict(o, deterministic=True)[0])),
            ("Threshold rule", FitFusionEnv(cal), rule_based_action))
    for name, env, policy in runs:
        trace = coach(env, policy, seed=123)
        acts = "".join(t["action"][0] for t in trace)
        end = "QUIT (churn)" if trace[-1]["churn"] else "stayed 26 weeks"
        print(f"  {name:15s} R/M/I by week: {acts}")
        print(f"  {'':15s} return {sum(t['reward'] for t in trace):+.2f}, fitness {trace[-1]['fitness_pct']:+.2f}%, "
              f"injured weeks {sum(t['injured'] for t in trace)}, final load {trace[-1]['load']:.2f}, {end}")
        RESULT[f"episode_{name}"] = trace

    section("6. Same request through the FastAPI endpoint")
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    settings.ML_SERVICE_API_KEY = "demo-key"
    with TestClient(app) as client:
        body = {k: v for k, v in sample.items() if not k.startswith("_")}
        resp = client.post("/rl/action", json=body, headers={"Authorization": "Bearer demo-key"})
    print(f"  HTTP {resp.status_code}")
    print("  " + json.dumps(resp.json(), indent=2).replace("\n", "\n  "))
    print(f"  Served agent metadata: round {served_meta.get('round', 1)}, serve={served_meta.get('serve')}")
    RESULT["api_response"] = resp.json()

    section("7. Evaluation evidence (SIMULATED; models/reports/rl_ppo_round3.json)")
    if r3:
        v = r3["validation"]["chosen"]
        print(f"  Chosen on 1,000 validation episodes: {v['candidate']} at {v['checkpoint']:,} timesteps")
        for key in ("standard", "stressed"):
            print(f"  Test, {key} (2,000 new simulated users):")
            for name, m in r3["results"][key].items():
                print(f"    {name:34s} return {m['mean_return']:+.3f} {m['return_ci95']}  injuries "
                      f"{m['injuries_per_episode']:.2f}  churn {m['churn_rate']:.3f}  fitness "
                      f"{m['mean_fitness_change_pct']:+.2f}%")
        for name, c in r3["comparisons"]["standard"].items():
            if "seed 0" in name or "seed 1" in name:
                continue
            print(f"  {name:52s} Δreturn {c['return']['difference']:+.3f} {c['return']['ci95']}  "
                  f"Δinjuries {c['injuries']['difference']:+.4f} {c['injuries']['ci95']}")
        d = r3["decision"]
        print(f"  Serving rule: return vs best baseline CI low > 0 -> {d['return_vs_best']['ci95'][0] > 0}; "
              f"injuries not higher than the rule -> {d['injuries_vs_rule']['ci95'][0] <= 0}; SERVE = {d['serve']}")
        post = load_json(REPORTS / "rl_ppo_round3_posthoc_exposure.json")
        if post:
            e = post["post_hoc_exposure"]
            lo, hi = post["ppo_minus_rule_per_100_weeks"][1:]
            print(f"  Post-hoc (does not change the decision): injuries per 100 user-weeks PPO "
                  f"{e['PPO']['injuries_per_100_weeks']:.3f} vs rule {e['Rule']['injuries_per_100_weeks']:.3f} "
                  f"[diff CI {lo:+.3f}, {hi:+.3f}]: the extra injuries come from users PPO keeps.")
    for name, path in (("Round 1", REPORTS / "rl_ppo.json"), ("Round 2", REPORTS / "rl_ppo_round2.json")):
        rep = load_json(path)
        if rep:
            std = rep["results"]["standard"]
            print(f"  {name}: PPO seed 42 {std['PPO seed 42']['mean_return']:+.2f} (churn "
                  f"{std['PPO seed 42']['churn_rate']:.0%}) vs threshold rule {std['Threshold rule']['mean_return']:+.2f}"
                  f" -> not served")
    if r3_meta:
        RESULT["round3_meta"] = r3_meta

    (OUT / "demo_output.json").write_text(json.dumps(RESULT, indent=2, default=float), encoding="utf-8")
    print(f"\n[saved] {OUT / 'demo_output.json'}")


if __name__ == "__main__":
    buffer = io.StringIO()

    class Tee(io.TextIOBase):
        def write(self, s):
            sys.__stdout__.write(s)
            buffer.write(s)
            return len(s)

    with redirect_stdout(Tee()):
        main()
    (OUT / "demo_output.txt").write_text(buffer.getvalue(), encoding="utf-8")
    print(f"\n[saved] {OUT / 'demo_output.txt'}")
