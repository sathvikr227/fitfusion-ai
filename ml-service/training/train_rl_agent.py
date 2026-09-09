"""Model 5 — PPO adaptive replan agent (stable-baselines3).

Trains PPO('MlpPolicy') on FitFusionEnv for 100,000 timesteps with the
documented hyperparameters, then evaluates it against the three-threshold rule
system FitFusion ships today over 500 episodes on identical seeds.

Also runs the ablation the guide asks for: the same agent trained with
trajectory_score zeroed out of the state, to show whether the Transformer input
earns its place.

    .venv/Scripts/python.exe -m training.train_rl_agent
"""

from __future__ import annotations

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.evaluation import evaluate_policy
from stable_baselines3.common.monitor import Monitor

from app.features import RL_ACTIONS
from app.rl_env import EnvConfig, FitFusionEnv, rule_based_action
from training.common import (
    MODEL_DIR,
    RANDOM_SEED,
    banner,
    ensure_dirs,
    load_pilot_csv,
    write_report,
)

ARTIFACT = "fitfusion_rl_agent"  # stable-baselines3 appends .zip

TOTAL_TIMESTEPS = 100_000
EVAL_EPISODES = 100
COMPARISON_EPISODES = 500

PPO_KWARGS = dict(
    learning_rate=3e-4,
    n_steps=2048,
    batch_size=64,
    n_epochs=10,
    verbose=0,
    seed=RANDOM_SEED,
)


def calibrate_from_pilot() -> tuple[EnvConfig, dict]:
    """Set environment parameters from the real pilot export when available."""
    rates = load_pilot_csv("completion_rates.csv")
    injuries = load_pilot_csv("injuries.csv")
    profiles = load_pilot_csv("profiles.csv")

    config = EnvConfig(rng_seed=RANDOM_SEED)
    source = {"completion": "default", "injury_rate": "default"}

    if rates is not None and not rates.empty:
        config.mean_completion = float(rates["completion_rate"].mean())
        std = float(rates["completion_rate"].std())
        if np.isfinite(std) and std > 0:
            config.std_completion = std
        source["completion"] = (
            f"pilot: {len(rates)} user-days across {rates['user_id'].nunique()} users"
        )

    if injuries is not None and profiles is not None and not profiles.empty:
        active = injuries[injuries["status"] == "active"]["user_id"].nunique() if not injuries.empty else 0
        config.injury_rate = float(active / len(profiles))
        source["injury_rate"] = f"pilot: {active}/{len(profiles)} users with an active injury"

    return config, {
        "mean_completion": config.mean_completion,
        "std_completion": config.std_completion,
        "injury_rate": config.injury_rate,
        "sources": source,
    }


def run_policy(policy, config: EnvConfig, episodes: int, label: str) -> dict:
    """Roll out a policy and collect reward, injury, churn, and action mix."""
    env = FitFusionEnv(config=config)
    rewards: list[float] = []
    injuries = 0
    churns = 0
    action_counts = np.zeros(len(RL_ACTIONS), dtype=int)

    for episode in range(episodes):
        obs, _ = env.reset(seed=10_000 + episode)  # identical seeds across policies
        total = 0.0
        done = False
        while not done:
            action = policy(obs)
            action_counts[action] += 1
            obs, reward, terminated, truncated, info = env.step(action)
            total += reward
            injuries += int(info["injury_event"])
            churns += int(info["churn_event"])
            done = terminated or truncated
        rewards.append(total)

    total_actions = int(action_counts.sum()) or 1
    result = {
        "policy": label,
        "episodes": episodes,
        "mean_reward": float(np.mean(rewards)),
        "std_reward": float(np.std(rewards)),
        "injury_events_per_episode": injuries / episodes,
        "churn_rate": churns / episodes,
        "action_distribution": {
            name: float(action_counts[i] / total_actions) for i, name in enumerate(RL_ACTIONS)
        },
    }
    return result


def train_agent(config: EnvConfig, include_trajectory: bool, label: str) -> PPO:
    env = Monitor(FitFusionEnv(config=config, include_trajectory=include_trajectory))
    agent = PPO("MlpPolicy", env, **PPO_KWARGS)
    print(f"  training {label} for {TOTAL_TIMESTEPS:,} timesteps ...")
    agent.learn(total_timesteps=TOTAL_TIMESTEPS, progress_bar=False)
    return agent


def main() -> None:
    banner("Model 5 — PPO adaptive replan agent")
    ensure_dirs()

    config, calibration = calibrate_from_pilot()
    print("\n  Environment calibration:")
    for key, value in calibration.items():
        print(f"    {key}: {value}")

    # ── Main agent ────────────────────────────────────────────────────────────
    print()
    agent = train_agent(config, include_trajectory=True, label="PPO (full state)")

    eval_env = Monitor(FitFusionEnv(config=config))
    mean_reward, std_reward = evaluate_policy(agent, eval_env, n_eval_episodes=EVAL_EPISODES)
    print(f"\n  evaluate_policy over {EVAL_EPISODES} episodes: "
          f"{mean_reward:.3f} +/- {std_reward:.3f}")

    # ── Policy comparison against the shipped rule system ─────────────────────
    def ppo_policy(obs):
        action, _ = agent.predict(obs, deterministic=True)
        return int(action)

    rl_result = run_policy(ppo_policy, config, COMPARISON_EPISODES, "ppo")
    rule_result = run_policy(rule_based_action, config, COMPARISON_EPISODES, "rule_based_thresholds")

    print(f"\n  Policy comparison over {COMPARISON_EPISODES} episodes (identical seeds):")
    header = f"    {'metric':32s} {'PPO':>12s} {'rule-based':>12s}"
    print(header)
    print("    " + "-" * (len(header) - 4))
    for key in ("mean_reward", "injury_events_per_episode", "churn_rate"):
        print(f"    {key:32s} {rl_result[key]:12.4f} {rule_result[key]:12.4f}")
    print(f"\n    PPO action mix       : {rl_result['action_distribution']}")
    print(f"    rule-based action mix: {rule_result['action_distribution']}")

    degenerate = max(rl_result["action_distribution"].values()) > 0.95
    print(f"    Policy degenerate (one action > 95%)? {'YES' if degenerate else 'no'}")

    # ── Ablation: state without trajectory_score ──────────────────────────────
    print()
    ablation_agent = train_agent(config, include_trajectory=False, label="PPO (no trajectory)")

    def ablation_policy(obs):
        action, _ = ablation_agent.predict(obs, deterministic=True)
        return int(action)

    ablation_result = run_policy(
        ablation_policy, config, COMPARISON_EPISODES, "ppo_without_trajectory"
    )
    print(
        f"\n  Ablation (trajectory_score removed): mean_reward="
        f"{ablation_result['mean_reward']:.4f} vs full state "
        f"{rl_result['mean_reward']:.4f}"
    )

    path = MODEL_DIR / ARTIFACT
    agent.save(str(path))
    print(f"\n[artifact] {path}.zip")

    write_report(
        "rl_agent",
        {
            "artifact": f"{ARTIFACT}.zip",
            "algorithm": "PPO('MlpPolicy') via stable-baselines3",
            "total_timesteps": TOTAL_TIMESTEPS,
            "hyperparameters": {k: v for k, v in PPO_KWARGS.items() if k != "verbose"},
            "environment": "FitFusionEnv (custom Gymnasium env, 5-dim Box state, Discrete(3))",
            "calibration": calibration,
            "evaluate_policy": {
                "episodes": EVAL_EPISODES,
                "mean_reward": float(mean_reward),
                "std_reward": float(std_reward),
            },
            "comparison": {"ppo": rl_result, "rule_based": rule_result},
            "ablation_without_trajectory": ablation_result,
            "policy_degenerate": degenerate,
        },
    )


if __name__ == "__main__":
    main()
