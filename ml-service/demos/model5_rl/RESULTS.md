# Model 5 — results (all SIMULATED)

## Round 3 — the training bug found and fixed; PPO now learns, but narrowly fails its serving rule

Sources:
- `models/reports/rl_ppo_round3.json`, written by `training/train_rl_ppo_round3.py`;
- `outputs/training_log_round3.txt`;
- figure `models/reports/rl_ppo_round3.png`;
- the post-hoc check `models/reports/rl_ppo_round3_posthoc_exposure.json`.

Plan: `PROTOCOL_ROUND3.md`, committed (`b1accfc`) before any round-3 candidate was trained for
selection and before any validation or test seed was used.

### Headline

- **Why rounds 1–2 failed: a training-setup bug, not PPO itself.**
  - The simulator's weekly reward is slightly negative under every sensible policy: about −0.37
    a week. Fitness drifts down, as in the Strava data, and injuries happen anyway.
  - Week 26 was returned as *truncated*, so Stable-Baselines3 valued every surviving user as if
    they trained forever. At γ = 0.99 that is about −37, while quitting costs −20 once.
  - So in PPO's view, making the user quit was optimal, and every round-1/2 seed found exactly
    that policy.
  - Round 3 treats week 26 as the true end, which is what the evaluation scores. The collapse is
    gone in every run. The figure's left panel shows training returns holding near −9.3 instead
    of falling to −23.
- **PPO now beats the best baseline:** +0.122 return per user, 95% CI [+0.045, +0.211], on 2,000
  new test users. Against the threshold rule the app serves today it is +0.377 [+0.257, +0.506].
  On the stressed scenarios it is +0.412 [+0.304, +0.531].
- **It is not served, by the pre-registered rule.**
  - It has 0.0135 more injuries per user than the threshold rule, CI [+0.005, +0.024], and the
    rule requires "not significantly more".
  - A post-hoc check, which does not change the decision, shows why: per week trained, the
    injury rate is the same. PPO keeps users who would have quit under the rule (churn 0.1% vs
    2.6%), and staying users can still get injured.
- **The gain is small, and a one-line rule matches it.** "REDUCE if completion < 0.3, else
  MAINTAIN", found on development seeds, scores −0.022 [−0.041, −0.004] better than PPO. All of the
  improvement comes from avoiding churn. No policy improves fitness: every one ends at −2.9% to
  −3.0% pace.

### Exploration before the protocol (development seeds 400000–400999 only)

| Finding | Evidence (300 dev users) |
|---|---|
| A full-state planner exploited the noisy injury bins | −8.42 vs −9.60 for MAINTAIN in the old simulator. With the smooth curve, only +0.36 ± 0.60 |
| Headroom in the smoothed simulator is about +0.27 | best simple rule +0.265 ± 0.257; rule that sees the hidden load +0.261 |
| PPO collapses whatever its settings… | 8 of 8 variants (reward normalisation, Monte Carlo returns, expected-injury reward, 5 or 7 inputs): INCREASE-until-churn (−23.2) or always-REDUCE (−10.2) |
| …because of the time-limit bootstrap | with fixed action probabilities, raising P(INCREASE) lowers the real return (−12.1 → −14.5), so the true gradient points away from where PPO went |
| Treating week 26 as terminal fixes it | 8 of 8 variants stop collapsing; the best reach +0.22 to +0.24 |

### Changes in round 3

- **Environment, for every policy:** injury relative risk from a 2-parameter logistic fit on ACWR
  (slope +0.156 [−0.016, +0.344]) instead of 7 noisy bins. See `DATA_SOURCES.md`.
- **Training only**, evaluation unchanged:
  - `HorizonIsTerminal`: week 26 ends the episode.
  - `ExpectedInjury`: −3·P(onset) instead of −3·onset, so the expected return is identical.
- **Candidates:**
  - PPO-5-MC: the slides' 5 inputs, γ 1, Monte Carlo returns.
  - **PPO-7-MC:** 5 inputs + planned intensity + previous action.
  - PPO-5-GAE: 5 inputs, γ 0.99, GAE 0.95.
  - Each trained 1M timesteps with checkpoints every 200k.

### Validation (1,000 episodes, seeds 500000–500999)

| | 200k | 400k | 600k | 800k | 1M |
|---|---|---|---|---|---|
| PPO-5-MC | −9.609 | −9.719 | −9.628 | −9.763 | −9.605 |
| **PPO-7-MC** | −9.274 | −9.167 | −9.151 | **−9.126** | −9.151 |
| PPO-5-GAE | −9.531 | −9.207 | −9.185 | −9.256 | −9.187 |

Baselines on the same seeds: always-MAINTAIN −9.321, threshold rule −9.419. **Chosen: PPO-7-MC at
800k.** No checkpoint of any candidate churned more than 0.3% of users. The 5-input candidates
also stopped collapsing, and PPO-5-GAE came within 0.06 of the winner.

### Test, once (2,000 standard episodes, seeds 600000–601999; 2,000 stressed, 602000–603999)

| Policy | Standard return [95% CI] | Injuries / user | Churn | Fitness | Actions R / M / I | Stressed return |
|---|---|---|---|---|---|---|
| **PPO seed 42** (candidate) | **−9.090** [−9.255, −8.935] | 2.03 | 0.1% | −3.00% | 33 / 32 / 35% | **−9.962** |
| PPO seed 0 (stability) | −9.086 | 2.03 | 0.1% | −3.00% | 12 / 78 / 10% | −9.941 |
| PPO seed 1 (stability) | −9.118 | 2.03 | 0.1% | −3.02% | 47 / 3 / 50% | −10.011 |
| Always MAINTAIN | −9.213 [−9.397, −9.041] | 2.03 | 0.9% | −2.95% | 0 / 100 / 0% | −11.151 |
| Threshold rule (serves today) | −9.468 [−9.667, −9.264] | 2.01 | 2.6% | −2.91% | 18 / 61 / 20% | −10.374 |
| Random | −12.028 | 1.91 | 15.5% | −3.19% | 33 / 38 / 29% | −12.929 |
| Dev-tuned rule (REDUCE if c < 0.3), reference | −9.068 [−9.231, −8.914] | 2.03 | 0.1% | −2.98% | 3 / 97 / 0% | −10.002 |

| Paired, PPO seed 42 minus… | Return (standard) | Injuries (standard) | Return (stressed) |
|---|---|---|---|
| always MAINTAIN (best baseline) | **+0.122 [+0.045, +0.211]** | +0.002 [−0.003, +0.006] | +1.190 [+0.980, +1.419] |
| threshold rule | +0.377 [+0.257, +0.506] | **+0.0135 [+0.005, +0.024]** | +0.412 [+0.304, +0.531] |
| dev-tuned rule | −0.022 [−0.041, −0.004] | +0.000 [−0.005, +0.005] | +0.040 [−0.010, +0.098] |

**The slides' size** (first 500 episodes): PPO −9.077 vs MAINTAIN −9.220 (+0.143 [−0.011,
+0.339]) and vs the rule −9.259 (+0.182 [+0.019, +0.378]). At 500 episodes the gain over MAINTAIN
is not significant. That is why the protocol fixed 2,000 in advance.

### Decision (as pre-registered)

| Rule | Result |
|---|---|
| Paired return vs the best baseline (always-MAINTAIN): CI lower bound > 0 | +0.045 → **met** |
| Injuries not significantly higher than the threshold rule | CI [+0.005, +0.024] → **not met** |
| **Serve PPO** | **no** → the masked threshold rule keeps serving (`stub: true`, with a `reason`) |
| Wins on stressed scenarios too | yes (+0.41 vs the rule) |

### Post-hoc: where the extra injuries come from (does not change the decision)

| Same 2,000 test users | PPO | Threshold rule |
|---|---|---|
| Weeks in the programme per user | 26.00 | 25.76 |
| Injuries per 100 user-weeks | 7.797 | 7.816 → difference −0.020 [−0.046, +0.008] |
| Users who stay all 26 weeks under both (1,948): injuries each | 2.022 | 2.025 |

Per week of training, PPO is as safe as the rule. The per-user criterion counted the rule's
quitters as "fewer injuries". Choosing the criterion now, after seeing this, would be a post-hoc
change. That is why it is recorded here and left to the owner, as Model 3's round-1 choice was.

### Limitations

- **Everything is simulated.** The adherence, churn and capacity numbers are assumptions;
  fitness, injury and sleep come from real data (`DATA_SOURCES.md`).
- **The effect is tiny.** +0.12 return per user is about 1 user in 125 kept from quitting. Every
  policy loses about 3% pace, because the Strava data shows week-to-week load changes barely move
  4-week pace.
- **PPO is not better than a one-line rule.** The three PPO seeds behave very differently (seed 1
  alternates REDUCE and INCREASE; seed 0 mostly MAINTAINs) yet score the same. The simulator's
  return is flat across many policies, so the agent's specific pattern is not a learned coaching
  insight.
- **The 7-input state deviates from the slides' 5.** The 5-input candidates no longer collapse
  either, but they scored lower on validation.
- **Training-time changes.** `HorizonIsTerminal` and `ExpectedInjury` change how PPO learns, not
  what it is scored on.

### What changed in code

- `app/rl_env.py`:
  - `Calibration.from_json(..., injury="smooth")`;
  - `FitFusionEnv(observe_load=True)`;
  - `info["injury_probability"]`.
  - All of these are off by default, so rounds 1–2 reproduce.
- `training/calibrate_rl_env.py --smooth-only` and `training/train_rl_ppo_round3.py`.
- `POST /rl/action` accepts optional `planned_intensity` and `previous_action`. A 7-input agent
  without them answers with the masked rule and a `reason`. Not served now, so nothing changes in
  the app's behaviour.
- The round-3 agent is kept in `models/rl_round3/` (`rl_ppo_agent_round3.zip` +
  `rl_ppo_meta_round3.json`). `models/rl_ppo_agent.zip` is untouched.

---

## Rounds 1 and 2

Every number below comes from the simulator `FitFusionEnv`, not from real users. Sources:
`models/reports/rl_calibration.json`, `rl_ppo.json` (round 1) and `rl_ppo_round2.json`
(round 2). Both protocols were committed before their results existed: `PROTOCOL.md`
(`1b3c057`) and `PROTOCOL_ROUND2.md` (`1b6e228`, committed before round 1 was scored).

### Headline (rounds 1–2)

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

> **Superseded by round 3 (top of this file).** The explanation below was the best guess on
> 2026-10-28. Round 3 found the actual cause: week 26 was returned as *truncated*, so PPO
> valued a surviving user as an endless stream of slightly negative weeks, and making them quit
> looked better. Adding the load to the state alone did not fix it; treating week 26 as the
> real end did.

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
