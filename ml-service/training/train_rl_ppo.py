"""Model 5 — PPO adaptive-replan agent on the rebuilt FitFusionEnv.

Implements demos/model5_rl/PROTOCOL.md (committed before training):
  * PPO (MlpPolicy, SB3 defaults), 100,000 timesteps, seeds 42 (served candidate), 0, 1, 2;
  * the safety mask applied inside the environment and to every evaluated policy;
  * 500 standard + 500 stressed evaluation episodes on seeds never used in training;
  * baselines: threshold rule (shipped today), always-MAINTAIN, random;
  * paired bootstrap CIs; serving rule fixed in advance.

All results are SIMULATED.

    .venv/Scripts/python.exe -m training.calibrate_rl_env     # real-data curves first
    .venv/Scripts/python.exe -u -m training.train_rl_ppo        # ~20 min

Writes models/rl_ppo_agent.zip + rl_ppo_meta.json, models/reports/rl_ppo.json and figures.
"""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from stable_baselines3 import PPO  # noqa: E402
from stable_baselines3.common.monitor import Monitor  # noqa: E402

from app.rl_env import (  # noqa: E402
    CHURN_PENALTY,
    Assumptions,
    Calibration,
    FitFusionEnv,
    rule_based_action,
    safe_action,
)
from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402

ARTIFACT, META = "rl_ppo_agent.zip", "rl_ppo_meta.json"
MODEL_VERSION = "rl-ppo-v2"
TIMESTEPS = 100_000
SEEDS = [42, 0, 1, 2]
EVAL_EPISODES = 500
EVAL_SEED_START = 100_000
BOOTSTRAP = 2000
ACTIONS = ["REDUCE", "MAINTAIN", "INCREASE"]
LOG_DIR = REPORT_DIR / "rl_ppo_logs"


def make_env(cal: Calibration, stress: bool = False, monitor: str | None = None):
    env = FitFusionEnv(cal, Assumptions(), stress=stress)
    return Monitor(env, monitor) if monitor else env


def train(cal: Calibration, seed: int, timesteps: int = TIMESTEPS, ent_coef: float = 0.0,
          log_name: str | None = None) -> PPO:
    env = make_env(cal, monitor=str(LOG_DIR / (log_name or f"seed_{seed}")))
    env.reset(seed=seed)
    model = PPO("MlpPolicy", env, seed=seed, verbose=0, device="cpu", ent_coef=ent_coef)
    model.learn(total_timesteps=timesteps)
    return model


def evaluate(cal: Calibration, policy, stress: bool, seed_start: int = EVAL_SEED_START,
             episodes: int = EVAL_EPISODES) -> pd.DataFrame:
    """One row per episode; every policy sees the same evaluation seeds."""
    env = make_env(cal, stress=stress)
    rows = []
    for i in range(episodes):
        obs, _ = env.reset(seed=seed_start + i + (episodes if stress else 0))
        rng = np.random.default_rng(seed_start + i)
        total, done, counts = 0.0, False, [0, 0, 0]
        churned = 0.0
        while not done:
            action = safe_action(policy(obs, rng), obs)
            counts[action] += 1
            obs, reward, terminated, truncated, info = env.step(action)
            total += reward
            churned = max(churned, info["churn"])
            done = terminated or truncated
        rows.append({"return": total, "injuries": env.injuries, "churn": churned,
                     "fitness": env.fitness, "weeks": env.week, **{a: c for a, c in zip(ACTIONS, counts)}})
    return pd.DataFrame(rows)


def ci(values: np.ndarray) -> list[float]:
    rng = np.random.default_rng(42)
    idx = rng.integers(0, len(values), size=(BOOTSTRAP, len(values)))
    means = values[idx].mean(axis=1)
    return [round(float(np.percentile(means, 2.5)), 4), round(float(np.percentile(means, 97.5)), 4)]


def summarise(df: pd.DataFrame) -> dict:
    total_actions = df[ACTIONS].to_numpy().sum()
    return {
        "mean_return": round(float(df["return"].mean()), 4), "return_ci95": ci(df["return"].to_numpy()),
        "injuries_per_episode": round(float(df["injuries"].mean()), 4),
        "churn_rate": round(float(df["churn"].mean()), 4),
        "mean_fitness_change_pct": round(100 * float(df["fitness"].mean()), 3),
        "action_distribution": {a: round(float(df[a].sum() / total_actions), 4) for a in ACTIONS},
    }


def paired(a: pd.DataFrame, b: pd.DataFrame, column: str) -> dict:
    diff = a[column].to_numpy() - b[column].to_numpy()
    return {"difference": round(float(diff.mean()), 4), "ci95": ci(diff)}


def ppo_policy(model: PPO, include_trajectory: bool = True):
    def act(obs, _rng):
        o = obs.copy()
        if not include_trajectory:
            o[3] = 0.0
        return int(model.predict(o, deterministic=True)[0])
    return act


def learning_curves() -> dict:
    curves = {}
    for seed in SEEDS:
        log = pd.read_csv(LOG_DIR / f"seed_{seed}.monitor.csv", skiprows=1)
        steps = log["l"].cumsum()
        curves[seed] = (steps.to_numpy(), log["r"].rolling(100, min_periods=20).mean().to_numpy())
    return curves


def draw(curves: dict, standard: dict, stressed: dict) -> str:
    fig, axes = plt.subplots(1, 3, figsize=(17, 4.8))
    for seed, (steps, r) in curves.items():
        axes[0].plot(steps, r, label=f"seed {seed}", lw=1.2)
    axes[0].set(title="PPO learning curves (rolling mean of 100 episodes)", xlabel="timesteps (weeks)",
                ylabel="episode return")
    axes[0].legend(fontsize=8)
    for ax, results, title in ((axes[1], standard, "Standard scenarios"), (axes[2], stressed, "Stressed assumptions")):
        names = list(results)
        means = [results[n]["mean_return"] for n in names]
        err = np.array([[m - results[n]["return_ci95"][0], results[n]["return_ci95"][1] - m]
                        for n, m in zip(names, means)]).T
        ax.bar(names, means, yerr=err, capsize=4,
               color=["#7c3aed" if n.startswith("PPO") else "#94a3b8" for n in names])
        ax.set(title=f"{title}: mean return, 500 episodes (95% CI)", ylabel="episode return")
        ax.tick_params(axis="x", rotation=30)
    fig.tight_layout()
    path = REPORT_DIR / "rl_ppo.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path.name


def main() -> None:
    banner("Model 5 — PPO agent on the rebuilt FitFusionEnv (simulated)")
    ensure_dirs()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cal = Calibration.from_json(MODEL_DIR / "rl_calibration.json")

    models = {}
    for seed in SEEDS:
        print(f"[train] seed {seed}: {TIMESTEPS:,} timesteps", flush=True)
        models[seed] = train(cal, seed)

    policies = {f"PPO seed {s}": ppo_policy(m) for s, m in models.items()}
    policies.update({
        "Threshold rule": lambda o, _r: rule_based_action(o),
        "Always MAINTAIN": lambda o, _r: 1,
        "Random": lambda o, r: int(r.integers(3)),
        "PPO seed 42, no trajectory": ppo_policy(models[42], include_trajectory=False),
    })

    results, frames = {}, {}
    for stress in (False, True):
        key = "stressed" if stress else "standard"
        frames[key] = {name: evaluate(cal, pol, stress) for name, pol in policies.items()}
        results[key] = {name: summarise(df) for name, df in frames[key].items()}
        print(f"\n[{key}]", flush=True)
        for name, s in results[key].items():
            print(f"  {name:28s} return {s['mean_return']:+.3f} {s['return_ci95']}  injuries "
                  f"{s['injuries_per_episode']:.2f}  churn {s['churn_rate']:.3f}  fitness "
                  f"{s['mean_fitness_change_pct']:+.2f}%  {s['action_distribution']}", flush=True)

    comparisons = {}
    for key in ("standard", "stressed"):
        f = frames[key]
        comparisons[key] = {
            f"PPO seed 42 minus {b}": {"return": paired(f["PPO seed 42"], f[b], "return"),
                                       "injuries": paired(f["PPO seed 42"], f[b], "injuries")}
            for b in ("Threshold rule", "Always MAINTAIN", "Random", "PPO seed 42, no trajectory")
        }
    std = results["standard"]
    best = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: std[b]["mean_return"])
    vs_best = comparisons["standard"][f"PPO seed 42 minus {best}"]["return"]
    vs_rule_inj = comparisons["standard"]["PPO seed 42 minus Threshold rule"]["injuries"]
    serve = vs_best["ci95"][0] > 0 and vs_rule_inj["ci95"][0] <= 0
    stressed_best = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: results["stressed"][b]["mean_return"])
    decision = {
        "rule": "serve PPO seed 42 iff paired return vs best baseline has CI low > 0 AND injuries not "
                "significantly higher than the threshold rule (standard scenarios)",
        "best_baseline": best, "return_vs_best": vs_best, "injuries_vs_rule": vs_rule_inj, "serve": bool(serve),
        "wins_on_stressed_too": bool(comparisons["stressed"][f"PPO seed 42 minus {stressed_best}"]["return"]["ci95"][0] > 0),
    }
    print(f"\n[decision] {decision}", flush=True)

    figure = draw(learning_curves(), results["standard"], results["stressed"])
    models[42].save(MODEL_DIR / ARTIFACT)
    meta = {"model_version": MODEL_VERSION, "serve": bool(serve), "timesteps": TIMESTEPS, "seed": 42,
            "standard_mean_return": std["PPO seed 42"]["mean_return"], "churn_penalty": CHURN_PENALTY}
    (MODEL_DIR / META).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"[artifact] wrote {MODEL_DIR / ARTIFACT} and {META}", flush=True)

    write_report("rl_ppo", {
        "status": "SIMULATED — every number comes from FitFusionEnv, not from real users",
        "protocol": "demos/model5_rl/PROTOCOL.md (committed 1b3c057 before training)",
        "calibration": "models/reports/rl_calibration.json", "calibration_source": cal.source,
        "assumptions_default": Assumptions().__dict__, "churn_penalty": CHURN_PENALTY,
        "ppo": {"algorithm": "PPO MlpPolicy (stable-baselines3 defaults)", "timesteps": TIMESTEPS, "seeds": SEEDS},
        "evaluation": {"episodes": EVAL_EPISODES, "standard_seeds": [EVAL_SEED_START, EVAL_SEED_START + EVAL_EPISODES - 1],
                       "stressed_seeds": [EVAL_SEED_START + EVAL_EPISODES, EVAL_SEED_START + 2 * EVAL_EPISODES - 1]},
        "results": results, "comparisons": comparisons, "decision": decision, "figure": figure,
    })


if __name__ == "__main__":
    main()
