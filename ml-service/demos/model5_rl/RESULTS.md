# Model 5 — results (all SIMULATED)

Every number below comes from the simulator `FitFusionEnv`, not from real users. Sources:
`models/reports/rl_calibration.json`, `rl_ppo.json` (round 1) and `rl_ppo_round2.json`
(round 2). Both protocols were committed before their results existed: `PROTOCOL.md`
(`1b3c057`) and `PROTOCOL_ROUND2.md` (`1b6e228`, committed before round 1 was scored).

## Headline

- **PPO is not served.** In both pre-registered rounds, every PPO run converges to the same
  degenerate policy: INCREASE about 90% of the time until the simulated user quits. Mean return
  is about −23 against −8.8 to −9.6 for the baselines, and 100% of users churn.
- **What serves in the app:** the threshold rule FitFusion already used, now behind a **hard
  safety mask** (never INCREASE while injured or on < 5.5 h sleep). The endpoint says so: `stub:
  true`, `reason: "agent failed its pre-registered serving rule"`.
- **What this model contributes:**
  - an honest audit of the old agent;
  - a simulator calibrated on three real datasets;
  - a safety mask enforced in code;
  - a documented negative result. Off-the-shelf PPO with these settings learns a short-term
    exploit that a simple rule avoids.

## Real-data calibration

From `training/calibrate_rl_env.py`; see `DATA_SOURCES.md` for the full tables.

- **Fitness vs load (Strava, 2.56M athlete-weeks).** Pace over the next 4 weeks changes from
  −1.96% (load < 0.5× the previous 4-week mean) to +1.79% (≥ 2×).
- **Injury vs acute:chronic ratio (runners, 40,063 days).** Relative risk is nearly flat
  (0.60–1.25). The weekly baseline is 9.0%.
- **Sleep (SoccerMon, 3,071 player-weeks).** Mean 8.11 h, sd 0.65, week-to-week correlation 0.52.

## Round 1 — as pre-registered (PPO defaults, 100k timesteps, seeds 42/0/1/2)

Standard scenarios, 500 episodes, seeds 100000–100499:

| Policy | Mean return [95% CI] | Injuries / user | Churn | Fitness | Actions R / M / I |
|---|---|---|---|---|---|
| **PPO (all 4 seeds identical)** | **−23.28** [−23.47, −23.09] | 0.55 | **100%** | −1.65% | 0 / 11 / 89% |
| Always MAINTAIN | **−9.21** [−9.60, −8.83] | 2.01 | 1.2% | −2.95% | 0 / 100 / 0% |
| Threshold rule (masked) | −9.44 [−9.84, −9.03] | 2.03 | 2.2% | −2.92% | 18 / 62 / 20% |
| Random (masked) | −11.95 [−12.57, −11.34] | 1.91 | 15% | −3.22% | 34 / 37 / 29% |

Paired: PPO − always-MAINTAIN = **−14.08** [−14.44, −13.73]; PPO − rule = −13.85
[−14.23, −13.46]. PPO has fewer injuries (−1.48 per user) only because its users are gone by
week 7. Stressed scenarios give the same picture: PPO − rule = −13.03 [−13.51, −12.53].
**Decision: not served.**

## Round 2 — as pre-registered (entropy bonus, 300k timesteps)

| Step | Result |
|---|---|
| Validation (seeds 200000–200199), ent_coef 0.01 | −23.12; 100% churn |
| Validation, ent_coef 0.05 | −23.12; 100% churn (same deterministic policy) |
| Chosen | 0.01 (tie rule) |
| **Test, standard (new seeds 300000–300499)** | PPO **−23.18** [−23.36, −23.01] vs always-MAINTAIN **−8.83** [−9.17, −8.48] and rule −9.57 [−10.04, −9.13] |
| Paired PPO − best baseline | **−14.36** [−14.66, −14.05] |
| Test, stressed (seeds 300500–300999) | PPO −23.36 vs rule −10.00 and MAINTAIN −10.83 |

**Decision: not served.** The round-2 agent is kept as `rl_ppo_agent_round2.zip` for the record.

Figures: `models/reports/rl_calibration.png`, `rl_ppo.png`, `rl_ppo_round2.png` (learning curves
plus return with CIs). Logs: `outputs/training_log_round1.txt`, `outputs/training_log_round2.txt`.

## Why PPO fails here

The training curves show every seed starting near −10 and collapsing to about −23 within about
25k timesteps. INCREASE earns a small reward at once, because the Strava curve pays for load
jumps. The cost (adherence collapses, then the user churns) arrives 4–7 weeks later, and it is
not visible in the 5-number state the slides specify: the state has no "current load" field. The
agent learns to push. A myopic shortcut beats a delayed penalty under these conditions, and a
stronger exploration bonus did not change it. Options that were **not** tried, because they
would change the spec or need a new protocol:
- add the planned load to the state;
- shape the reward with the adherence drop;
- use a longer horizon or a different algorithm.

The ablation without the trajectory input gives an identical policy. It ignores that input
entirely.

## Safety (holds whatever answers)

- `safe_action` is unit-tested and applied inside the simulator, in every evaluated policy and
  in `POST /rl/action`.
- A test sweeps 30 states and confirms the endpoint never returns INCREASE while injured or on
  < 5.5 h sleep.
- The app's own guards stay on top: pain notes block INCREASE, there is a +10% weekly volume
  cap, and exercises loading injured areas are stripped.

## Slide targets

| Target | Status |
|---|---|
| PPO via Stable-Baselines3, about 100k timesteps | done (round 1: 100k; round 2: 300k) |
| 500 test episodes vs the rule-based baseline | done: 500 standard + 500 stressed, twice |
| PPO beats the rule | **not met**: worse by about 14 return points in both rounds |
| Environment calibrated on pilot data | replaced: the pilot data was seeded, so real public datasets were used |

## Deviations from the protocol

1. **Injury ACWR window.** The protocol said 28-day chronic load from the runners' daily file.
   That file omits most days before each injury (20% coverage for injury rows vs 82% for
   others), so the dataset's week-approach file is used instead: last week ÷ mean of the last 3
   weeks (a 21-day chronic window).
2. **Churn penalty 5 → 20.** The pre-training sanity check (fixed policies on development seeds)
   showed that at −5, ending episodes by churning every user avoided more injury cost than it
   lost: "always INCREASE" scored best (−8.27) while churning 100% of users. At −20 every
   trivial policy lands at −9.5 to −10 and churning scores −23. The change was made before any
   policy was trained, and is recorded in `app/rl_env.py` (`CHURN_PENALTY`).
3. **Round 2** (pre-registered separately, see above).
