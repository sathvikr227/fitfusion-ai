"""Model 5, round 3 — demos/model5_rl/PROTOCOL_ROUND3.md (committed b1accfc before training).

  * environment: smooth logistic injury curve (Calibration.from_json(..., injury="smooth"));
  * training only: week 26 is terminal (no bootstrap past the task's end) and the injury
    term of the reward is its expectation -3*P(onset) (same expected return);
  * 3 candidates x seed 42, 1M timesteps, checkpoints every 200k;
  * pick (candidate, checkpoint) on 1,000 validation episodes (seeds 500000-500999);
  * seeds 0 and 1 of the chosen candidate for stability;
  * test ONCE on 2,000 standard (600000-601999) + 2,000 stressed (602000-603999) episodes;
  * round 1's serving rule.

All results are SIMULATED.

    .venv/Scripts/python.exe -u -m training.train_rl_ppo_round3          # ~35 min, 3 processes in parallel

Writes models/rl_round3/ (checkpoints, logs), models/reports/rl_ppo_round3.json + .png.
Overwrites models/rl_ppo_agent.zip + rl_ppo_meta.json only if round 3 is served.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import gymnasium as gym
import numpy as np
import pandas as pd

from app.rl_env import (
    CHURN_PENALTY,
    MAINTAIN,
    REDUCE,
    Assumptions,
    Calibration,
    FitFusionEnv,
    rule_based_action,
    safe_action,
)
from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs, write_report
from training.train_rl_ppo import ACTIONS, ci, paired, summarise

MODEL_VERSION = "rl-ppo-v3-round3"
TIMESTEPS = 1_000_000
CHECKPOINTS = [200_000, 400_000, 600_000, 800_000, 1_000_000]
N_ENVS = 8
CANDIDATES: dict[str, dict] = {
    "PPO-5-MC": {"observe_load": False, "gamma": 1.0, "gae_lambda": 1.0, "learning_rate": 1e-4,
                 "n_steps": 2048, "batch_size": 512},
    "PPO-7-MC": {"observe_load": True, "gamma": 1.0, "gae_lambda": 1.0, "learning_rate": 1e-4,
                 "n_steps": 2048, "batch_size": 512},
    "PPO-5-GAE": {"observe_load": False, "gamma": 0.99, "gae_lambda": 0.95, "learning_rate": 3e-4,
                  "n_steps": 1024, "batch_size": 256},
}
ENT_COEF = 0.01
VALIDATION_START, VALIDATION_EPISODES = 500_000, 1_000
TEST_START, TEST_EPISODES = 600_000, 2_000
STRESSED_START = 602_000
SLIDE_EPISODES = 500
STABILITY_SEEDS = [0, 1]
OUT = MODEL_DIR / "rl_round3"
ARTIFACT, META = "rl_ppo_agent.zip", "rl_ppo_meta.json"


def calibration() -> Calibration:
    return Calibration.from_json(MODEL_DIR / "rl_calibration.json", injury="smooth")


class HorizonIsTerminal(gym.Wrapper):
    """Training only: week 26 is the real end of the task, so nothing is bootstrapped past it."""

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        return obs, reward, terminated or truncated, False, info


class ExpectedInjury(gym.Wrapper):
    """Training only: -3*onset -> -3*P(onset). Same expected return, lower variance."""

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        reward = reward + 3.0 * info["injury_onset"] - 3.0 * info["injury_probability"]
        return obs, reward, terminated, truncated, info


def checkpoint_path(name: str, seed: int, steps: int) -> Path:
    return OUT / f"{name}_seed{seed}_{steps // 1000}k.zip"


# ── training (one process per run) ────────────────────────────────────────────
def train_run(name: str, seed: int, until: int) -> None:
    import torch
    from stable_baselines3 import PPO
    from stable_baselines3.common.monitor import Monitor
    from stable_baselines3.common.vec_env import DummyVecEnv

    torch.set_num_threads(2)
    cfg = CANDIDATES[name]
    cal = calibration()
    OUT.mkdir(parents=True, exist_ok=True)

    def factory(rank: int):
        def make():
            env = FitFusionEnv(cal, Assumptions(), observe_load=cfg["observe_load"])
            env = Monitor(env, str(OUT / f"{name}_seed{seed}_env{rank}"))
            env = ExpectedInjury(env)
            env = HorizonIsTerminal(env)
            env.reset(seed=seed * 1000 + rank)
            return env
        return make

    venv = DummyVecEnv([factory(r) for r in range(N_ENVS)])
    model = PPO("MlpPolicy", venv, seed=seed, verbose=0, device="cpu", ent_coef=ENT_COEF,
                gamma=cfg["gamma"], gae_lambda=cfg["gae_lambda"], learning_rate=cfg["learning_rate"],
                n_steps=cfg["n_steps"], batch_size=cfg["batch_size"])
    # SB3 seeds env i with seed + i; give each run its own block so seeds 0 and 1 do not
    # train on the same simulated users (training seeds stay far below evaluation's 400000+).
    venv.seed(seed * 1000 + 1)
    done = 0
    for target in [c for c in CHECKPOINTS if c <= until]:
        model.learn(total_timesteps=target - done, reset_num_timesteps=False)
        done = target
        model.save(checkpoint_path(name, seed, target))
        print(f"[train] {name} seed {seed}: saved {target:,}", flush=True)


def launch(runs: list[tuple[str, int, int]]) -> None:
    procs = [subprocess.Popen([sys.executable, "-u", "-m", "training.train_rl_ppo_round3", "--train", n, str(s), str(u)])
             for n, s, u in runs]
    codes = [p.wait() for p in procs]
    if any(codes):
        raise SystemExit(f"training processes failed: {codes}")


# ── evaluation ────────────────────────────────────────────────────────────────
def evaluate(cal: Calibration, policy, start: int, episodes: int, stress: bool, observe_load: bool) -> pd.DataFrame:
    """One row per episode on seeds start..start+episodes-1. Same seeds = same simulated users."""
    env = FitFusionEnv(cal, Assumptions(), stress=stress, observe_load=observe_load)
    rows = []
    for i in range(episodes):
        obs, _ = env.reset(seed=start + i)
        rng = np.random.default_rng(start + i)
        total, done, counts, churned = 0.0, False, [0, 0, 0], 0.0
        while not done:
            action = safe_action(policy(obs, rng), obs)
            counts[action] += 1
            obs, reward, terminated, truncated, info = env.step(action)
            total += reward
            churned = max(churned, info["churn"])
            done = terminated or truncated
        rows.append({"return": total, "injuries": env.injuries, "churn": churned, "fitness": env.fitness,
                     "weeks": env.week, **{a: c for a, c in zip(ACTIONS, counts)}})
    return pd.DataFrame(rows)


def ppo_policy(model):
    return lambda obs, _rng: int(model.predict(obs, deterministic=True)[0])


BASELINES = {
    "Threshold rule": lambda o, _r: rule_based_action(o),
    "Always MAINTAIN": lambda o, _r: MAINTAIN,
    "Random": lambda o, r: int(r.integers(3)),
    "Dev-tuned rule (REDUCE if c<0.3)": lambda o, _r: REDUCE if float(o[0]) < 0.3 else MAINTAIN,
}


def learning_curves(names_seeds: list[tuple[str, int]]) -> dict:
    curves = {}
    for name, seed in names_seeds:
        frames = [pd.read_csv(p, skiprows=1) for p in sorted(OUT.glob(f"{name}_seed{seed}_env*.monitor.csv"))]
        if not frames:
            continue
        log = pd.concat(frames).sort_values("t")
        curves[f"{name} seed {seed}"] = (log["l"].cumsum().to_numpy(),
                                         log["r"].rolling(400, min_periods=50).mean().to_numpy())
    return curves


def draw(curves: dict, validation: dict, standard: dict, stressed: dict) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 4, figsize=(22, 4.8))
    for label, (steps, r) in curves.items():
        axes[0].plot(steps, r, label=label, lw=1.0)
    axes[0].set(title="Round 3 training returns (rolling 400 episodes;\ntraining reward = expected injury)",
                xlabel="timesteps (weeks)", ylabel="episode return")
    axes[0].legend(fontsize=7)
    for name in CANDIDATES:
        xs = [c // 1000 for c in CHECKPOINTS]
        ys = [validation[f"{name}@{c // 1000}k"]["mean_return"] for c in CHECKPOINTS]
        axes[1].plot(xs, ys, "o-", label=name)
    axes[1].axhline(validation["Always MAINTAIN"]["mean_return"], color="k", ls=":", lw=1, label="always MAINTAIN")
    axes[1].axhline(validation["Threshold rule"]["mean_return"], color="gray", ls="--", lw=1, label="threshold rule")
    axes[1].set(title="Validation (1,000 episodes) by checkpoint", xlabel="checkpoint (k timesteps)",
                ylabel="mean return")
    axes[1].legend(fontsize=7)
    for ax, results, title in ((axes[2], standard, "Test, standard"), (axes[3], stressed, "Test, stressed")):
        names = list(results)
        means = [results[n]["mean_return"] for n in names]
        err = np.array([[m - results[n]["return_ci95"][0], results[n]["return_ci95"][1] - m]
                        for n, m in zip(names, means)]).T
        ax.bar(range(len(names)), means, yerr=err, capsize=4,
               color=["#7c3aed" if n.startswith("PPO") else "#94a3b8" for n in names])
        ax.set_xticks(range(len(names)), names, rotation=35, ha="right", fontsize=7)
        lo = min(r for r in means if r > -20) - 1.0
        ax.set_ylim(lo, max(means) + 0.8)
        ax.set(title=f"{title}: mean return, {TEST_EPISODES:,} episodes (95% CI)", ylabel="episode return")
    fig.tight_layout()
    path = REPORT_DIR / "rl_ppo_round3.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path.name


def main() -> None:
    from stable_baselines3 import PPO

    started = time.time()
    banner("Model 5 — round 3 (horizon fix, smooth injury curve; SIMULATED)")
    ensure_dirs()
    OUT.mkdir(parents=True, exist_ok=True)
    cal = calibration()
    print(f"[calibration] {cal.source}; smooth injury slope {cal.rr_smooth['slope']:.4f}", flush=True)

    # 1. candidates, seed 42, in parallel
    banner("1. Train 3 candidates x seed 42 (1M timesteps, checkpoints every 200k)")
    launch([(name, 42, TIMESTEPS) for name in CANDIDATES])
    print(f"  ({time.time() - started:.0f}s)", flush=True)

    # 2. validation
    banner(f"2. Validation: {VALIDATION_EPISODES:,} standard episodes, seeds {VALIDATION_START}-"
           f"{VALIDATION_START + VALIDATION_EPISODES - 1}")
    validation: dict[str, dict] = {}
    for name, cfg in CANDIDATES.items():
        for c in CHECKPOINTS:
            model = PPO.load(str(checkpoint_path(name, 42, c)), device="cpu")
            df = evaluate(cal, ppo_policy(model), VALIDATION_START, VALIDATION_EPISODES, False, cfg["observe_load"])
            validation[f"{name}@{c // 1000}k"] = summarise(df)
            s = validation[f"{name}@{c // 1000}k"]
            print(f"  {name:10s} @{c // 1000:5d}k  return {s['mean_return']:+.4f}  churn {s['churn_rate']:.3f}  "
                  f"{s['action_distribution']}", flush=True)
    for bname in ("Threshold rule", "Always MAINTAIN"):
        validation[bname] = summarise(evaluate(cal, BASELINES[bname], VALIDATION_START, VALIDATION_EPISODES,
                                               False, False))
        print(f"  {bname:18s} return {validation[bname]['mean_return']:+.4f}", flush=True)
    order = [(n, c) for n in CANDIDATES for c in CHECKPOINTS]
    chosen_name, chosen_steps = max(
        order, key=lambda nc: (round(validation[f"{nc[0]}@{nc[1] // 1000}k"]["mean_return"], 4),
                               -CHECKPOINTS.index(nc[1]), -list(CANDIDATES).index(nc[0])))
    cfg = CANDIDATES[chosen_name]
    print(f"[select] {chosen_name} @ {chosen_steps:,} timesteps", flush=True)

    # 3. stability seeds
    banner(f"3. Stability: {chosen_name} with seeds {STABILITY_SEEDS} up to {chosen_steps:,}")
    launch([(chosen_name, s, chosen_steps) for s in STABILITY_SEEDS])
    models = {s: PPO.load(str(checkpoint_path(chosen_name, s, chosen_steps)), device="cpu")
              for s in [42, *STABILITY_SEEDS]}

    # 4. test, once
    banner(f"4. Test (once): {TEST_EPISODES:,} standard + {TEST_EPISODES:,} stressed episodes, new seeds")
    policies = {f"PPO seed {s}": (ppo_policy(m), cfg["observe_load"]) for s, m in models.items()}
    policies.update({n: (p, False) for n, p in BASELINES.items()})
    frames, results, slide = {}, {}, {}
    for stress, start, key in ((False, TEST_START, "standard"), (True, STRESSED_START, "stressed")):
        frames[key] = {n: evaluate(cal, p, start, TEST_EPISODES, stress, ol) for n, (p, ol) in policies.items()}
        results[key] = {n: summarise(df) for n, df in frames[key].items()}
        slide[key] = {n: summarise(df.iloc[:SLIDE_EPISODES]) for n, df in frames[key].items()}
        print(f"\n[test {key}]", flush=True)
        for n, s in results[key].items():
            print(f"  {n:34s} return {s['mean_return']:+.3f} {s['return_ci95']}  injuries {s['injuries_per_episode']:.2f}"
                  f"  churn {s['churn_rate']:.3f}  fitness {s['mean_fitness_change_pct']:+.2f}%  "
                  f"{s['action_distribution']}", flush=True)

    others = [n for n in policies if n != "PPO seed 42"]
    comparisons = {key: {f"PPO seed 42 minus {b}": {"return": paired(f["PPO seed 42"], f[b], "return"),
                                                    "injuries": paired(f["PPO seed 42"], f[b], "injuries"),
                                                    "churn": paired(f["PPO seed 42"], f[b], "churn")}
                         for b in others}
                   for key, f in frames.items()}
    slide_comparisons = {key: {b: paired(f["PPO seed 42"].iloc[:SLIDE_EPISODES], f[b].iloc[:SLIDE_EPISODES], "return")
                               for b in ("Threshold rule", "Always MAINTAIN")}
                         for key, f in frames.items()}
    std = results["standard"]
    best = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: std[b]["mean_return"])
    vs_best = comparisons["standard"][f"PPO seed 42 minus {best}"]["return"]
    vs_rule_inj = comparisons["standard"]["PPO seed 42 minus Threshold rule"]["injuries"]
    serve = vs_best["ci95"][0] > 0 and vs_rule_inj["ci95"][0] <= 0
    sbest = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: results["stressed"][b]["mean_return"])
    decision = {
        "rule": "round 1's: paired return vs best of {rule, MAINTAIN} CI low > 0 AND injuries not significantly "
                "higher than the rule (standard test, 2,000 episodes)",
        "chosen": {"candidate": chosen_name, "checkpoint": chosen_steps},
        "best_baseline": best, "return_vs_best": vs_best, "injuries_vs_rule": vs_rule_inj, "serve": bool(serve),
        "wins_on_stressed_too": bool(comparisons["stressed"][f"PPO seed 42 minus {sbest}"]["return"]["ci95"][0] > 0),
        "stressed_best_baseline": sbest,
    }
    for k in ("standard", "stressed"):
        for b, d in comparisons[k].items():
            print(f"  [{k}] {b:46s} return {d['return']['difference']:+.3f} {d['return']['ci95']}  "
                  f"injuries {d['injuries']['difference']:+.3f} {d['injuries']['ci95']}", flush=True)
    print(f"\n[decision] {decision}", flush=True)

    curves = learning_curves([(n, 42) for n in CANDIDATES] + [(chosen_name, s) for s in STABILITY_SEEDS])
    figure = draw(curves, validation, results["standard"], results["stressed"])
    agent = models[42]
    meta = {"model_version": MODEL_VERSION, "serve": bool(serve), "round": 3, "candidate": chosen_name,
            "observation_dims": 7 if cfg["observe_load"] else 5, "timesteps": chosen_steps, "seed": 42,
            "ent_coef": ENT_COEF, **{k: v for k, v in cfg.items() if k != "observe_load"},
            "injury_curve": "smooth", "standard_mean_return": std["PPO seed 42"]["mean_return"],
            "churn_penalty": CHURN_PENALTY}
    agent.save(OUT / "rl_ppo_agent_round3.zip")
    (OUT / "rl_ppo_meta_round3.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    if serve:
        agent.save(MODEL_DIR / ARTIFACT)
        (MODEL_DIR / META).write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"[artifact] round-3 agent SERVED: {ARTIFACT} + {META}", flush=True)
    else:
        print("[artifact] round 3 not served; agent kept in models/rl_round3/ for the record", flush=True)

    write_report("rl_ppo_round3", {
        "status": "SIMULATED — every number comes from FitFusionEnv, not from real users",
        "protocol": "demos/model5_rl/PROTOCOL_ROUND3.md (committed b1accfc before training)",
        "environment": {"injury_curve": cal.rr_smooth, "assumptions_default": Assumptions().__dict__,
                        "churn_penalty": CHURN_PENALTY},
        "training": {"timesteps": TIMESTEPS, "checkpoints": CHECKPOINTS, "n_envs": N_ENVS, "ent_coef": ENT_COEF,
                     "candidates": CANDIDATES, "wrappers": ["ExpectedInjury", "HorizonIsTerminal"]},
        "validation": {"seeds": [VALIDATION_START, VALIDATION_START + VALIDATION_EPISODES - 1], "results": validation,
                       "chosen": {"candidate": chosen_name, "checkpoint": chosen_steps}},
        "test": {"standard_seeds": [TEST_START, TEST_START + TEST_EPISODES - 1],
                 "stressed_seeds": [STRESSED_START, STRESSED_START + TEST_EPISODES - 1]},
        "results": results, "comparisons": comparisons,
        "slide_size_500": {"results": slide, "comparisons": slide_comparisons},
        "decision": decision, "meta": meta, "figure": figure, "runtime_seconds": round(time.time() - started),
    })


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--train":
        train_run(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
    else:
        main()
