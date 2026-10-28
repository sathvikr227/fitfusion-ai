# Model 5 — round 2 protocol (pre-registered)

Written and committed on 2026-10-28, **after** round 1's training curves were inspected and
**before** round 1's evaluation results were seen. Round 2 runs only if round 1 fails its serving
rule. The environment, reward, safety mask, baselines and serving rule are unchanged from
`PROTOCOL.md`; only PPO's training settings change.

## Why

Training logs of round 1 (`models/reports/rl_ppo_logs/`): every seed starts near −10 (episodes
of about 25 weeks) and by about 25k timesteps collapses to returns near −23 with 7-week
episodes, i.e. INCREASE until the user churns. INCREASE pays a small reward at once (the Strava
adaptation curve), while the churn penalty arrives weeks later. With SB3's default entropy
coefficient of 0, the policy stops exploring before it learns the delayed cost. This is a known
PPO failure mode (premature entropy collapse), not a property of the task: always-MAINTAIN
scores about −9.5 in the same simulator.

## What changes

| Setting | Round 1 | Round 2 candidates |
|---|---|---|
| ent_coef | 0.0 (default) | **0.01, 0.05** |
| total_timesteps | 100,000 | **300,000** |
| everything else | SB3 defaults | unchanged |

The slides' "about 100k timesteps" becomes 300k. This is reported as a deviation from the slides.

## Selection, then a single test

1. Train both candidates with seed 42 on the training environment.
2. **Validation:** 200 standard episodes, seeds 200000–200199. Pick the candidate with the
   higher mean return; ties go to 0.01.
3. Train the chosen configuration with seeds 0 and 1 too (stability).
4. **Test, once:** 500 standard episodes on seeds 300000–300499 and 500 stressed episodes on
   seeds 300500–300999. These are new seeds, never seen in round 1 or in validation. Every
   policy is evaluated on them: PPO (each seed), the threshold rule, always-MAINTAIN, random.
5. **Serving rule:** identical to round 1, applied to the round-2 test seeds. Round 1's
   evaluation seeds are not used for any decision in round 2.

If round 2 also fails, the masked threshold rule keeps serving and both rounds are reported.
