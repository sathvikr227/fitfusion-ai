# Model 5 — round 3 protocol (pre-registered)

Written and committed on 2026-11-08, **after** exploratory runs on development seeds only
(400000–400999) and **before** any round-3 candidate was trained for selection or any
validation or test seed was used. The owner asked to "make it work… get the best possible
solution" (2026-11-08). Rounds 1 and 2 (`PROTOCOL.md`, `PROTOCOL_ROUND2.md`) stay as reported.

## What the exploration found (development seeds only, disclosed)

1. **Rounds 1–2 failed because of the training setup, not PPO.**
   - Under every sensible policy the simulator's weekly reward is slightly negative: about
     −0.37 a week under always-MAINTAIN. Fitness drifts down, as in the Strava data, and injuries
     happen regardless.
   - Week 26 was returned as *truncated*. Stable-Baselines3 then bootstraps the value as if the
     user continued forever. At γ = 0.99, staying is worth about −0.37 / 0.01 ≈ −37, while
     churning costs −20 once and ends the episode.
   - So in PPO's view, making the user quit was optimal. That is exactly the
     INCREASE-until-churn policy every round-1/2 seed found (return ≈ −23).
   - The evaluation, by contrast, scores the real 26-week return.
   - Evidence: with fixed action probabilities, raising P(INCREASE) from uniform lowers the
     26-week return (−12.1 → −14.5). The true gradient points away from where PPO went.
2. **Treating week 26 as the true end fixes the collapse.** In 8 of 8 variants, no policy churned
   everyone. The best reached +0.22 to +0.24 over always-MAINTAIN on 300 dev users (± 0.26).
3. **The binned injury curve was exploitable.**
   - A planner with full state scored −8.42 against −9.60 for MAINTAIN in the round-1/2
     simulator. Most of that came from steering into bins with fewer injuries; the 0–0.6 bin has
     RR 0.60 from 34 injuries.
   - With a smooth logistic curve (below), that planner gains only +0.36 ± 0.60.
4. **The simulator leaves little headroom.**
   - The best simple rule found on dev seeds ("REDUCE if completion < 0.3, else MAINTAIN") gains
     +0.27 ± 0.26.
   - A rule that sees the hidden load gains +0.26.
   - The gain comes almost entirely from avoiding churn.
   - Learning also oscillates between checkpoints.

## Changes from round 2

**Environment (applies to every policy, baselines included):**
- **Injury relative risk** = 2-parameter logistic fit of daily injury on ACWR, clipped to [0, 3],
  instead of the 7-bin table. Data: runners week file, 40,063 days, 559 injuries.
  - Intercept −4.419; slope +0.156, 95% CI [−0.016, +0.344] (athlete bootstrap).
  - RR = 0.93 at ACWR 0.5, 1.17 at 2.0, 1.36 at 3.0.
  - Stored as `injury.smooth` in `models/rl_calibration.json`
    (`training/calibrate_rl_env.py --smooth-only`). Loaded with `Calibration.from_json(path, injury="smooth")`.
- Unchanged: reward 100·Δfitness − 3·injury onset − 20·churn, the safety mask, the dynamics, the
  assumptions and their ±25% stress test, and the 26-week episodes.

**Training only (evaluation is unchanged: sampled rewards, 26-week return):**
- `HorizonIsTerminal`: week 26 ends the episode as *terminated*, so nothing is bootstrapped past
  the task's real end.
- `ExpectedInjury`: the training reward uses −3·P(onset) instead of the sampled −3·onset. The
  expected return is identical and the variance is lower. The sampled onset still drives the
  simulated user.

**Candidates** (all PPO `MlpPolicy`, 8 parallel envs, ent_coef 0.01, both training wrappers):

| Name | Observation | γ | GAE λ | lr | n_steps / env | batch |
|---|---|---|---|---|---|---|
| PPO-5-MC | the slides' 5 dims | 1.0 | 1.0 | 1e-4 | 2048 | 512 |
| PPO-7-MC | 5 dims + planned intensity / 2.5 + previous applied action / 2 | 1.0 | 1.0 | 1e-4 | 2048 | 512 |
| PPO-5-GAE | the slides' 5 dims | 0.99 | 0.95 | 3e-4 | 1024 | 256 |

The 7-dim state is a deviation from the slides. Both extra values can be computed by the app from
`workout_plans.ml_meta`: planned intensity = product of (1 + applied `intensity_delta`) over past
replans, clipped to [0.4, 2.5]; previous action = the last replan's applied action.

## Selection, then a single test

1. Train each candidate with seed 42 for **1,000,000 timesteps**. Save checkpoints at 200k, 400k,
   600k, 800k and 1M.
2. **Validation.** Score all 15 (candidate, checkpoint) pairs on **1,000 standard episodes, seeds
   500000–500999**. Pick the highest mean return. Ties to 4 decimals go to the earlier checkpoint,
   then to the candidate listed first.
3. Train the chosen candidate with seeds 0 and 1 (stability, reported only). Their checkpoint is
   the one chosen in step 2.
4. **Test, once.** **2,000 standard episodes on seeds 600000–601999** and 2,000 stressed episodes
   on seeds 602000–603999. All seeds are new.
   - Policies: chosen PPO (seed 42, served candidate), PPO seeds 0 and 1, threshold rule,
     always-MAINTAIN, random, and the dev-tuned rule "REDUCE if completion < 0.3, else MAINTAIN".
     That last rule is reported as a ceiling reference, not as a gate.
   - The first 500 episodes of each set are also reported, the slides' size.

## Serving rule (round 1's, on the round-3 test seeds)

Serve the chosen PPO (seed 42) **iff**, on the 2,000 standard test episodes:
1. the paired return difference against the best of {threshold rule, always-MAINTAIN} has a 95%
   CI lower bound > 0, **and**
2. its injuries per episode are not significantly higher than the threshold rule's (the paired CI
   includes or lies below 0).

Stressed results are reported either way. A policy that wins only on the standard set is flagged.
If it fails, the masked threshold rule keeps serving (`stub: true` with a `reason`).

## Serving changes if it passes

- PPO-5 wins: `POST /rl/action` is unchanged; the agent reads the existing 5-dim state.
- PPO-7 wins: `RLStateRequest` gains optional `planned_intensity` (0.4–2.5) and `previous_action`.
  `/api/adaptive-replan` computes them from past `ml_meta`. If either is missing, the masked rule
  answers with `stub: true` and a `reason`. The agent never guesses them.
- `safe_action` and the app's own guards (pain hold, progression cap, injury stripping) are
  unchanged and apply on top.
- Every number stays labelled SIMULATED.
