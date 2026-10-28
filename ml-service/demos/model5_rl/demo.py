"""Model 5 teacher demo — PPO adaptive-replan agent behind a hard safety mask.

Shows the audit of the old agent, the real-data calibration of the simulator, the
agent's decision for the labelled state in sample_input.json (and what the safety
mask does when the same user is injured), one simulated user coached week by week
by PPO and by the threshold rule on the same random seed, the same request through
the FastAPI endpoint, and the evaluation. EVERYTHING HERE IS SIMULATED.

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

from app.rl_env import Calibration, FitFusionEnv, rule_based_action, safe_action  # noqa: E402

MODEL_DIR = ML_SERVICE / "models"
REPORTS = MODEL_DIR / "reports"
OUT = HERE / "outputs"
ACTIONS = ["REDUCE", "MAINTAIN", "INCREASE"]
RESULT: dict = {}


def section(title: str) -> None:
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def state_vector(s: dict) -> np.ndarray:
    return np.array([s["completion_rate"], min(s["sleep_avg"] / 10, 1), s["injury_flag"],
                     s["trajectory_score"] / 2, min(s["streak"], 14) / 14], dtype=np.float32)


def coach(env: FitFusionEnv, policy, seed: int) -> list[dict]:
    obs, _ = env.reset(seed=seed)
    trace, done = [], False
    while not done:
        action = safe_action(policy(obs), obs)
        new_obs, reward, terminated, truncated, info = env.step(action)
        trace.append({"week": env.week, "action": ACTIONS[action], "completion": float(new_obs[0]),
                      "sleep": float(new_obs[1] * 10), "injured": bool(new_obs[2]), "load": info["load"],
                      "fitness_pct": 100 * info["fitness"], "reward": reward})
        obs, done = new_obs, terminated or truncated
    return trace


def main() -> None:
    OUT.mkdir(exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    input_path = Path(args[0]) if args else HERE / "sample_input.json"
    sample = json.loads(input_path.read_text(encoding="utf-8"))
    report = json.loads((REPORTS / "rl_ppo.json").read_text(encoding="utf-8"))
    meta = json.loads((MODEL_DIR / "rl_ppo_meta.json").read_text(encoding="utf-8"))
    agent = PPO.load(str(MODEL_DIR / "rl_ppo_agent.zip"), device="cpu")
    cal = Calibration.from_json(MODEL_DIR / "rl_calibration.json")

    section("1. Why Model 5 was rebuilt")
    old_path = REPORTS / "rl_agent.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))["comparison"]
        print(f"  Old agent: mean reward {old['ppo']['mean_reward']} vs threshold rule "
              f"{old['rule_based']['mean_reward']}; it chose REDUCE "
              f"{old['ppo']['action_distribution']['REDUCE']:.0%} of the time.")
    print("  Cause: it was paid +1 whenever completion rose, so cutting the plan always 'won'. Its")
    print("  calibration came from 2 seeded test users. Safety was learned, not enforced.")

    section("2. The simulator: real-data curves (models/reports/rl_calibration.json)")
    print("  Fitness change per week by load ratio (Strava, 2.56M athlete-weeks):")
    for lo, g in zip(cal.gain_edges, cal.gain_weekly):
        print(f"    load ratio >= {lo:<5g} → {100 * g:+.3f}% pace per week")
    print("  Injury relative risk by acute:chronic ratio (runners, 40,063 days):")
    for lo, r in zip(cal.rr_edges, cal.rr_values):
        print(f"    ACWR >= {lo:<4g} → RR {r:.2f}")
    print(f"  Baseline weekly injury probability {cal.base_weekly_injury:.3f}; sleep mean "
          f"{cal.sleep_mean:.2f} h, sd {cal.sleep_sd:.2f}, persistence {cal.sleep_rho:.2f} (SoccerMon)")
    print("  Adherence, capacity growth, injury duration and churn are ASSUMPTIONS (DATA_SOURCES.md).")

    section("3. Labelled sample state → decision")
    print(f"  {sample.get('_label', '')}")
    state = state_vector(sample)
    raw = int(agent.predict(state, deterministic=True)[0])
    print(f"  State vector: {np.round(state, 3).tolist()}")
    print(f"  PPO raw choice: {ACTIONS[raw]}   after safety mask: {ACTIONS[safe_action(raw, state)]}   "
          f"threshold rule: {ACTIONS[rule_based_action(state)]}")
    injured = state.copy()
    injured[2] = 1.0
    raw_inj = int(agent.predict(injured, deterministic=True)[0])
    print(f"  Same user, injured: PPO raw {ACTIONS[raw_inj]} → served {ACTIONS[safe_action(raw_inj, injured)]} "
          f"(the mask never allows INCREASE while injured or on < 5.5 h sleep)")
    RESULT["sample"] = {"ppo_raw": ACTIONS[raw], "served": ACTIONS[safe_action(raw, state)],
                        "rule": ACTIONS[rule_based_action(state)]}

    section("4. One simulated user, 26 weeks: PPO vs threshold rule (same seed 123)")
    for name, policy in (("PPO", lambda o: int(agent.predict(o, deterministic=True)[0])),
                         ("Threshold rule", rule_based_action)):
        trace = coach(FitFusionEnv(cal), policy, seed=123)
        acts = "".join(t["action"][0] for t in trace)
        print(f"  {name:15s} actions R/M/I by week: {acts}")
        print(f"  {'':15s} return {sum(t['reward'] for t in trace):+.2f}, fitness {trace[-1]['fitness_pct']:+.2f}%, "
              f"injured weeks {sum(t['injured'] for t in trace)}, final load {trace[-1]['load']:.2f}, "
              f"weeks {len(trace)}")
        RESULT[f"episode_{name}"] = trace

    section("5. Same request through the FastAPI endpoint")
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    settings.ML_SERVICE_API_KEY = "demo-key"
    with TestClient(app) as client:
        body = {k: v for k, v in sample.items() if not k.startswith("_")}
        resp = client.post("/rl/action", json=body, headers={"Authorization": "Bearer demo-key"})
    print(f"  HTTP {resp.status_code}")
    print("  " + json.dumps(resp.json(), indent=2).replace("\n", "\n  "))
    RESULT["api_response"] = resp.json()

    section("6. Evaluation evidence (SIMULATED; models/reports/rl_ppo.json)")
    for key in ("standard", "stressed"):
        print(f"  {key} scenarios, 500 episodes each:")
        for name, s in report["results"][key].items():
            print(f"    {name:28s} return {s['mean_return']:+.3f} {s['return_ci95']}  injuries "
                  f"{s['injuries_per_episode']:.2f}  churn {s['churn_rate']:.3f}  fitness "
                  f"{s['mean_fitness_change_pct']:+.2f}%")
    for name, c in report["comparisons"]["standard"].items():
        print(f"  {name:44s} Δreturn {c['return']['difference']:+.3f} {c['return']['ci95']}  "
              f"Δinjuries {c['injuries']['difference']:+.3f} {c['injuries']['ci95']}")
    print(f"  Decision: {report['decision']}")
    print(f"  Served in the app: {meta['serve']}")

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
