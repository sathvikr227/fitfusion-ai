# Model 3 — round 2 protocol (pre-registered)

> **Amendment 1 (2026-11-08) is at the end of this file and replaces the data, features
> and candidates below.** It was made after a leakage check and before any round-2 model
> was scored. The first training run was stopped before it printed or saved any result.

Written and committed on 2026-11-08, **before** any round-2 feature was modelled
or scored. Round 1 (`PROTOCOL.md`, `RESULTS.md`) stays as it is; this is a second,
separately reported attempt. The owner asked for it ("suggest alternatives to make
them work… get the best possible solution", 2026-11-08).

## What is already known (disclosed so the reader can discount it)

- Round 1's 14 test athletes have been scored. Logistic regression did better than
  XGBoost there (0.669 vs 0.589) and worse on the 60 development athletes (0.566 vs
  0.598). Adding logistic regression to the candidates below is partly informed by
  that. This is why round 2 is evaluated on **all 74 athletes by repeated grouped
  cross-validation with nested selection**, and why the round-1 split is reported only
  as a secondary, not-fresh number.
- Profiling done before writing this (no model fitted): the day rows are 41,700
  consecutive-day pairs plus gaps of 8–37+ days (mostly 22+, after injuries). For every
  consecutive pair, row *t*'s "2 days before" equals row *t−1*'s "1 day before"
  (100% of 41,700 pairs), so each athlete's daily series can be rebuilt exactly from
  the overlapping 7-day windows.

## Why round 1 failed, and what changes

1. Round 1 used only the 7 days before each event, so load could not be compared with
   the athlete's own normal load. Spikes relative to one's own baseline (acute:chronic
   ratio, week-on-week change) are the best-supported load signal in the literature.
   **Change:** rebuild each athlete's series and add 28-day features.
2. A single 14-athlete test set gave a CI 0.19 wide. **Change:** every athlete is
   scored out-of-fold, five times over.
3. Previous injury is the most consistently reported risk factor in running, and
   FitFusion records it (`injuries.date_occurred`). **Change:** add days since the
   previous injury.

FULL-only variables (zones, perceived exertion, recovery) are **not** used: FitFusion
cannot compute them, so a model that needs them cannot be served.

## Data

Same file and checksum as round 1 (`day_approach_maskedID_timeseries.csv`, Lövdal et
al. 2021, doi:10.34894/UWU9PV, CC0): 42,766 athlete-days, 74 athletes, 583 injury days.
Label unchanged: injury on the event day.

**Series reconstruction.** For athlete *a*, the load of variable *v* on calendar day
*d* is read from any row whose 7-day window covers *d*. Overlaps must agree exactly;
the build fails if they do not. Days no row covers are **unknown** (not zero).

## Features (computed from days strictly before the event day)

Variables v ∈ {sessions, total_km, strength, alt_hours} (the four FitFusion variables
of round 1, same units and clipping).

`LOAD` set (19 features):

| Feature | Definition |
|---|---|
| `acute_v` (×4) | sum over days −7…−1 |
| `chronic_v` (×4) | 7 × mean daily value over the **known** days in −28…−1 |
| `acwr_v` (×4) | acute / chronic, clipped to [0, 3]; chronic = 0 → 1 if acute = 0, else 3 |
| `km_week_change` | acute km − 7 × mean daily km over the known days in −14…−8; 0 if fewer than 4 of those days are known |
| `km_max_day_7d` | largest single-day km in −7…−1 |
| `km_monotony_7d` | mean / sd of daily km over −7…−1 (sd = 0 → 0) |
| `km_long_share_7d` | `km_max_day_7d` / acute km (0 if acute km = 0) |
| `rest_days_7d` | days with 0 sessions in −7…−1 |
| `rest_days_28d_share` | share of known days in −28…−1 with 0 sessions |
| `strength_gap_days` | days since the last strength day in the known window, capped at 28 |

`LOAD+HIST` = `LOAD` + `days_since_prev_injury`: days since the athlete's previous
injury day in the data, capped at 365; 365 if none is recorded. (In FitFusion: days
since the most recent `injuries.date_occurred`, 365 if none in the last year.)

The number of known history days is **not** a feature: in the data, short history
mostly means "just back from an injury gap", which would not mean the same thing for
a new FitFusion user.

## Candidate procedure (one procedure, chosen by nested CV, is what gets served)

Inner selection, inside each outer training fold, by pooled out-of-fold ROC-AUC over
an athlete-grouped `StratifiedGroupKFold(5, shuffle=True, random_state=42)`:

| Family | Feature set | Grid |
|---|---|---|
| Logistic regression (standardised, L2, unweighted) | LOAD, LOAD+HIST | C ∈ {0.01, 0.1, 1} |
| XGBoost (lr 0.03, subsample 0.8, colsample 0.8, min_child_weight 20, scale_pos_weight) | LOAD+HIST | depth {1, 2, 3} × trees {100, 300} |

12 configurations. Ties (to 4 decimals) go to logistic regression, then the smaller C
/ shallower model. The winner is refitted on the whole outer training fold and Platt-
calibrated on its inner out-of-fold scores, so probabilities are comparable across
folds.

## Outer evaluation (primary)

`StratifiedGroupKFold(5, shuffle=True)` by athlete, repeated with seeds 42, 43, 44, 45,
46. Every athlete is scored out-of-fold once per repeat.

- **Primary metric:** ROC-AUC of each row's mean out-of-fold calibrated probability
  over the 5 repeats, with a 95% CI from an athlete-cluster bootstrap (2,000 resamples,
  seed 42).
- Also reported: pooled ROC-AUC of each repeat, PR-AUC, Brier score, calibration slope
  and intercept, which configuration won in each outer fold.
- **Lift at the serving threshold:** injury-day rate among days at or above the
  threshold divided by the rate below it, with the same bootstrap CI.

**Baselines on the same outer folds:** prevalence; ACWR rule (score = `acwr_total_km`);
7-day sessions rule (round 1's best simple rule); round 1's procedure re-run (XGB-APP,
depth 3 × 200, Platt); logistic regression on round 1's APP features (C = 1, balanced).
Paired bootstrap CIs for: candidate − round-1 XGB-APP, candidate − LogReg-APP,
candidate − 7-day sessions rule.

## Serving rule (fixed now)

Serve the final procedure (nested selection re-run on all 74 athletes, refitted,
Platt-calibrated on its out-of-fold scores) **if and only if the lower bound of the
95% CI of the primary ROC-AUC is above 0.55**. This bar is stricter than round 1's
0.50, because 74 athletes give a tighter interval and a model that only just beats
chance is not worth showing to users.

If it fails, nothing changes in production: the region rules alone keep serving and
`overall_risk` stays `null`.

**Threshold for `overall_elevated`.** The 90th percentile of the final model's
out-of-fold calibrated probabilities ("top 10% of training days"). The response
also carries `relative_risk` = probability / training prevalence.

## Secondary (not fresh, reported for continuity)

The chosen procedure trained on round 1's 60 development athletes and scored on its 14
test athletes, next to round 1's numbers.

## Serving changes if it passes

- `POST /predict/injury-risk` accepts 7 to 28 days in `recent_days` (oldest first,
  ending yesterday) and an optional `days_since_last_injury`. With fewer than 28 days
  the chronic features use the days supplied, exactly as unknown days are skipped in
  training; a missing `days_since_last_injury` is set to 365 and listed in `imputed`.
- The Next.js history read sends 28 days and the most recent `injuries.date_occurred`.
- Region rules, their levels, pain holds and exercise stripping are unchanged.
- The fallback contract is unchanged: no service, no artifact, or a failed rule means
  region rules alone.

---

## Amendment 1 — 2026-11-08, before any round-2 result

### What was found

A leakage check on the rebuilt daily series (label counts only, no model) showed that
the day-approach file has **no rows in the 21 days before any injury**:

| | injury rows (583) | other rows (42,183) |
|---|---|---|
| previous row is the day before | 0% | 98.9% |
| known days in −14…−8 (mean of 7) | **0.0** | 6.7 |
| full 28-day history known | **0%** | 79.3% |

So any feature computed from more than the row's own 7 days tells the model "this row has
a hole in its history", which is the label. The same exclusion makes
`days_since_prev_injury` leak: inside each interval between two injuries the injury row is
always the one with the largest value. The first round-2 run used these features; it was
stopped before it printed or saved any metric, and its code path is removed.

### What replaces the data, features and candidates above

**Data.** `week_approach_maskedID_timeseries.csv` from the same dataset (doi:10.34894/UWU9PV,
v2, CC0; SHA-256 `261ba3a4…5a31`, recorded in `data/runners/SOURCE.txt`): 42,798 rows,
74 athletes, 575 injury events. Each row already holds weekly summaries of the three
weeks before the event day (week 0 = days −7…−1, week 1 = −14…−8, week 2 = −21…−15),
computed by the dataset authors from their complete logs. No series is rebuilt, so the
missing-row pattern cannot enter a feature.

**Features (`WEEK`, 22, all computable by FitFusion):**

| Feature | Definition |
|---|---|
| `sessions_w{0,1,2}` | nr. sessions |
| `rest_days_w{0,1,2}` | nr. rest days |
| `km_w{0,1,2}` | total kms |
| `max_km_day_w{0,1,2}` | max km one day |
| `alt_hours_w{0,1,2}` | total hours alternative training |
| `strength_w{0,1,2}` | nr. strength trainings |
| `acwr_km` | km_w0 / mean(km_w0, km_w1, km_w2), clipped to [0, 3]; chronic 0 → 1 if acute 0, else 3 |
| `acwr_sessions` | same for sessions |
| `km_change_w01` | km_w0 − km_w1 |
| `long_run_share_w0` | max_km_day_w0 / km_w0 (0 if km_w0 = 0) |

Zones, perceived exertion, training success and recovery are excluded (FitFusion has no
equivalent). The dataset's own `rel total kms` columns are not used; the derived features
above are computed by `app/injury_load.py` for training and serving alike.

**Candidates (9 configurations, nested selection exactly as above):** logistic regression
(standardised, L2, unweighted) with C ∈ {0.01, 0.1, 1}, then XGBoost (settings as above)
with depth {1, 2, 3} × trees {100, 300}. Tie-break order as listed.

**Baselines (same outer folds, paired):** prevalence; ACWR rule (score = `acwr_km`);
weekly sessions rule (score = `sessions_w0`); **Week-0 only**: logistic regression (C = 1,
balanced) on the six week-0 variables, the 7-day analogue of round 1, to show whether the
two earlier weeks add anything. Round 1's day-file numbers (0.589 / 0.669) are quoted for
reference only; they are on different rows and cannot be paired.

**Leakage screen (new, before results are accepted).** Univariate ROC-AUC of every feature
is reported. Any single feature above 0.75 stops the analysis for investigation.

**Unchanged:** outer repeated grouped CV (seeds 42–46), primary metric and bootstrap,
calibration, the serving rule (**CI lower bound > 0.55**), the p90 `overall_elevated`
threshold, region rules.

**Secondary (not fresh):** train on all athletes except round 1's 14 test athletes (by
athlete ID, from `models/reports/injury_load.json`), score those 14.

**Serving changes if it passes:** `recent_days` holds 21 days (oldest first, ending
yesterday); FitFusion's days are summed into the three weeks with the round-1 day mapping
(sessions, running km, strength day, alternative hours), rest days = days with no session,
strength trainings = strength days. With fewer than 21 days the overall score is not
computed (`overall_risk: null`, listed in `imputed`). No injury-history input is added.
