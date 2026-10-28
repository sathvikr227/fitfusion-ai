"""Model 5, round 2 — demos/model5_rl/PROTOCOL_ROUND2.md (committed 1b6e228).

Only PPO's training settings change: ent_coef in {0.01, 0.05}, 300,000 timesteps.
  1. train both with seed 42; pick the higher mean return on 200 VALIDATION episodes
     (seeds 200000-200199); ties go to 0.01;
  2. train the chosen setting with seeds 0 and 1 (stability);
  3. score every policy ONCE on new TEST seeds 300000-300499 (standard) and
     300500-300999 (stressed);
  4. apply round 1's serving rule unchanged.

All results are SIMULATED.

    .venv/Scripts/python.exe -u -m training.train_rl_ppo_round2     # ~50 min

Overwrites models/rl_ppo_agent.zip + rl_ppo_meta.json only if round 2 is served.
Always writes models/reports/rl_ppo_round2.json and rl_ppo_round2.png.
"""

from __future__ import annotations

import json

from app.rl_env import CHURN_PENALTY, Assumptions, Calibration, rule_based_action
from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs, write_report
from training.train_rl_ppo import (
    ARTIFACT,
    EVAL_EPISODES,
    LOG_DIR,
    META,
    evaluate,
    paired,
    ppo_policy,
    summarise,
    train,
)

MODEL_VERSION = "rl-ppo-v2-round2"
TIMESTEPS = 300_000
CANDIDATES = [0.01, 0.05]
VALIDATION_START, VALIDATION_EPISODES = 200_000, 200
TEST_START = 300_000
STABILITY_SEEDS = [0, 1]


def draw(curves: dict, standard: dict, stressed: dict) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd

    fig, axes = plt.subplots(1, 3, figsize=(17, 4.8))
    for label, path in curves.items():
        log = pd.read_csv(path, skiprows=1)
        axes[0].plot(log["l"].cumsum(), log["r"].rolling(100, min_periods=20).mean(), label=label, lw=1.1)
    axes[0].set(title="Round 2 learning curves (rolling mean of 100 episodes)", xlabel="timesteps (weeks)",
                ylabel="episode return")
    axes[0].legend(fontsize=7)
    for ax, results, title in ((axes[1], standard, "Test, standard"), (axes[2], stressed, "Test, stressed")):
        names = list(results)
        means = [results[n]["mean_return"] for n in names]
        err = np.array([[m - results[n]["return_ci95"][0], results[n]["return_ci95"][1] - m]
                        for n, m in zip(names, means)]).T
        ax.bar(names, means, yerr=err, capsize=4,
               color=["#7c3aed" if n.startswith("PPO") else "#94a3b8" for n in names])
        ax.set(title=f"{title}: mean return, 500 episodes (95% CI)", ylabel="episode return")
        ax.tick_params(axis="x", rotation=30)
    fig.tight_layout()
    path = REPORT_DIR / "rl_ppo_round2.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path.name


def main() -> None:
    banner("Model 5 — round 2 (entropy bonus, 300k timesteps; SIMULATED)")
    ensure_dirs()
    cal = Calibration.from_json(MODEL_DIR / "rl_calibration.json")

    candidates, validation = {}, {}
    for ent in CANDIDATES:
        print(f"[train] seed 42, ent_coef {ent}: {TIMESTEPS:,} timesteps", flush=True)
        candidates[ent] = train(cal, 42, TIMESTEPS, ent, log_name=f"round2_ent{ent}_seed_42")
        df = evaluate(cal, ppo_policy(candidates[ent]), False, VALIDATION_START, VALIDATION_EPISODES)
        validation[ent] = summarise(df)
        print(f"[validation] ent_coef {ent}: {validation[ent]}", flush=True)
    chosen = max(CANDIDATES, key=lambda e: (round(validation[e]["mean_return"], 4), -e))
    print(f"[select] ent_coef {chosen}", flush=True)

    models = {42: candidates[chosen]}
    for seed in STABILITY_SEEDS:
        print(f"[train] seed {seed}, ent_coef {chosen}", flush=True)
        models[seed] = train(cal, seed, TIMESTEPS, chosen, log_name=f"round2_ent{chosen}_seed_{seed}")

    policies = {f"PPO seed {s}": ppo_policy(m) for s, m in models.items()}
    policies.update({"Threshold rule": lambda o, _r: rule_based_action(o), "Always MAINTAIN": lambda o, _r: 1,
                     "Random": lambda o, r: int(r.integers(3)),
                     "PPO seed 42, no trajectory": ppo_policy(models[42], include_trajectory=False)})
    results, frames = {}, {}
    for stress in (False, True):
        key = "stressed" if stress else "standard"
        frames[key] = {n: evaluate(cal, p, stress, TEST_START, EVAL_EPISODES) for n, p in policies.items()}
        results[key] = {n: summarise(df) for n, df in frames[key].items()}
        print(f"\n[test {key}]", flush=True)
        for n, s in results[key].items():
            print(f"  {n:28s} return {s['mean_return']:+.3f} {s['return_ci95']}  injuries {s['injuries_per_episode']:.2f}"
                  f"  churn {s['churn_rate']:.3f}  fitness {s['mean_fitness_change_pct']:+.2f}%  {s['action_distribution']}",
                  flush=True)

    comparisons = {key: {f"PPO seed 42 minus {b}": {"return": paired(f["PPO seed 42"], f[b], "return"),
                                                    "injuries": paired(f["PPO seed 42"], f[b], "injuries")}
                         for b in ("Threshold rule", "Always MAINTAIN", "Random", "PPO seed 42, no trajectory")}
                   for key, f in frames.items()}
    std = results["standard"]
    best = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: std[b]["mean_return"])
    vs_best = comparisons["standard"][f"PPO seed 42 minus {best}"]["return"]
    vs_rule_inj = comparisons["standard"]["PPO seed 42 minus Threshold rule"]["injuries"]
    serve = vs_best["ci95"][0] > 0 and vs_rule_inj["ci95"][0] <= 0
    sbest = max(("Threshold rule", "Always MAINTAIN"), key=lambda b: results["stressed"][b]["mean_return"])
    decision = {"rule": "unchanged from round 1, on round-2 test seeds", "chosen_ent_coef": chosen,
                "best_baseline": best, "return_vs_best": vs_best, "injuries_vs_rule": vs_rule_inj,
                "serve": bool(serve),
                "wins_on_stressed_too": bool(comparisons["stressed"][f"PPO seed 42 minus {sbest}"]["return"]["ci95"][0] > 0)}
    print(f"\n[decision] {decision}", flush=True)

    curves = {f"seed 42, ent {e}": LOG_DIR / f"round2_ent{e}_seed_42.monitor.csv" for e in CANDIDATES}
    curves.update({f"seed {s}, ent {chosen}": LOG_DIR / f"round2_ent{chosen}_seed_{s}.monitor.csv" for s in STABILITY_SEEDS})
    figure = draw(curves, results["standard"], results["stressed"])
    if serve:
        models[42].save(MODEL_DIR / ARTIFACT)
        (MODEL_DIR / META).write_text(json.dumps({
            "model_version": MODEL_VERSION, "serve": True, "timesteps": TIMESTEPS, "ent_coef": chosen, "seed": 42,
            "standard_mean_return": std["PPO seed 42"]["mean_return"], "churn_penalty": CHURN_PENALTY,
            "round": 2}, indent=2), encoding="utf-8")
        print(f"[artifact] round-2 agent saved as {ARTIFACT}", flush=True)
    else:
        models[42].save(MODEL_DIR / "rl_ppo_agent_round2.zip")
        print("[artifact] round 2 not served; saved as rl_ppo_agent_round2.zip for the record", flush=True)

    write_report("rl_ppo_round2", {
        "status": "SIMULATED — every number comes from FitFusionEnv, not from real users",
        "protocol": "demos/model5_rl/PROTOCOL_ROUND2.md (committed 1b6e228 before round-1 evaluation)",
        "assumptions_default": Assumptions().__dict__, "timesteps": TIMESTEPS, "candidates": CANDIDATES,
        "validation": {"seeds": [VALIDATION_START, VALIDATION_START + VALIDATION_EPISODES - 1],
                       "results": {str(k): v for k, v in validation.items()}, "chosen_ent_coef": chosen},
        "test": {"standard_seeds": [TEST_START, TEST_START + EVAL_EPISODES - 1],
                 "stressed_seeds": [TEST_START + EVAL_EPISODES, TEST_START + 2 * EVAL_EPISODES - 1]},
        "results": results, "comparisons": comparisons, "decision": decision, "figure": figure,
    })


if __name__ == "__main__":
    main()
