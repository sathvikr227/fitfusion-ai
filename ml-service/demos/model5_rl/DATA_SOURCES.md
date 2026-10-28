# Model 5 — data sources

A reinforcement-learning agent learns by acting, so it is trained in a **simulator**
(`app/rl_env.py`), not on a fixed dataset. **Every result for Model 5 is simulated.** What makes
the simulator credible is where its numbers come from. Three of its curves are estimated from
real, public data already downloaded for Models 3 and 4; the rest are labelled assumptions.

The estimates are made by `training/calibrate_rl_env.py`, which writes
`models/reports/rl_calibration.json` and `rl_calibration.png`. They are **observational
associations**, used to make the simulator realistic; they are not causal effects.

## 1. Fitness adaptation vs training load — Strava running logs (real)

| | |
|---|---|
| Dataset | Afonseca, Watanabe & Duarte (2022), Figshare doi:10.6084/m9.figshare.16620238, **CC BY 4.0** (see `../model4_trajectory/DATA_SOURCES.md`) |
| Unit | 2,559,635 athlete-weeks |
| Load ratio | this week's km / mean km of the previous 4 weeks (weeks without a run count as 0) |
| Outcome | change in median 10 km-equivalent pace (Riegel), next 4 weeks vs previous 4; positive = faster |

| Load ratio | Athlete-weeks | Pace change over the next 4 weeks |
|---|---|---|
| < 0.5 | 466,171 | −1.96% |
| 0.5–0.7 | 226,796 | −1.09% |
| 0.7–0.85 | 235,620 | −0.83% |
| 0.85–1.0 | 307,781 | −0.58% |
| 1.0–1.15 | 341,782 | −0.26% |
| 1.15–1.3 | 265,309 | +0.01% |
| 1.3–1.5 | 227,606 | +0.22% |
| 1.5–2.0 | 260,575 | +0.61% |
| ≥ 2.0 | 227,995 | +1.79% |

The simulator uses the weekly rate (the value ÷ 4). Caveat: low-load weeks include illness and
tapering, and high-load weeks include build-ups before races, so part of this is selection, not
training effect.

## 2. Injury risk vs acute:chronic load — competitive runners (real)

| | |
|---|---|
| Dataset | Lövdal, den Hartigh & Azzopardi (2021), DataverseNL doi:10.34894/UWU9PV, **CC0** (see `../model3_injury/DATA_SOURCES.md`) |
| File | `week_approach_maskedID_timeseries.csv` (SHA-256 `261ba3a4…`), 40,063 event days with load |
| ACWR | last week's km / mean km of the last 3 weeks |
| Baseline | daily injury rate 1.36% → weekly probability **9.03%** |

| ACWR | Days | Injuries | Relative risk vs 0.8–1.3 |
|---|---|---|---|
| < 0.6 | 4,018 | 34 | 0.60 |
| 0.6–0.8 | 4,606 | 74 | 1.13 |
| 0.8–1.0 | 9,858 | 130 | 0.93 |
| 1.0–1.3 | 14,573 | 217 | 1.05 |
| 1.3–1.5 | 3,276 | 58 | 1.25 |
| 1.5–2.0 | 2,228 | 29 | 0.92 |
| ≥ 2.0 | 1,504 | 17 | 0.80 |

**Finding:** in these runners the injury risk is nearly flat across load spikes. The widely cited
"ACWR > 1.5 is dangerous" pattern does not show up here. The simulator uses what the data shows.
The 9% weekly baseline comes from elite runners and is probably high for gym members.

## 3. Sleep — SoccerMon (real)

| | |
|---|---|
| Dataset | Midoglu et al. (2024), Zenodo doi:10.5281/zenodo.10033832, **CC BY 4.0** |
| Unit | 3,071 player-weeks of self-reported sleep duration |
| Values | mean **8.11 h**, sd 0.65 h, week-to-week correlation **0.52** |

The simulator draws weekly sleep as an AR(1) process with these three numbers.

## 4. Assumptions (no real data)

FitFusion's own Supabase history is seeded test data, so nothing below is estimated. Each value
is varied by ±25% in the "stressed" evaluation.

| Assumption | Value | Meaning |
|---|---|---|
| adherence | 0.85 | completion at a sustainable load, average sleep, no injury |
| overload_drop | 0.6 | completion lost per unit of planned load above capacity |
| sleep_effect | 0.04 | completion change per hour of sleep vs 7 h |
| noise | 0.07 | week-to-week completion noise (sd) |
| injury_weeks | 2 | mean injury duration (geometric) |
| capacity_per_fitness | 5 | sustainable load grows 5% per 1% pace improvement |
| churn | completion < 0.2 for 2 weeks | user is lost; the episode ends |

## Retired

The old environment was calibrated on a "pilot export" of 2 FitFusion users, which turned out to
be seeded data. It is no longer used.
