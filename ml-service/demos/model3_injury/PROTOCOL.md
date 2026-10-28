# Model 3 — pre-registered evaluation protocol

Written and committed on 2026-10-28, **before** any model was trained or any
test result was seen. The profiling counts below come from reading the labels
only (no features were modelled). Anything changed after this commit is listed
under "Deviations" in RESULTS.md with the reason.

## Why the design changed

The slides ask for a multi-label XGBoost (knee, back, shoulder, hamstring) with
F1 > 0.75 per label, trained on "Gym Members + a Sports Injury Dataset".

- The old model labelled Gym Members rows with if-rules over its own input
  features (e.g. knee = Resting_BPM > 68 AND frequency >= 4). Its F1 = 1.0 is
  the model re-learning those rules. It never saw an injury. Retired.
- No open dataset we could verify has real knee/back/shoulder/hamstring labels.
  SoccerMon has real body locations, but only 15 of 50 players ever report an
  injury: knee 14 episodes from 5 players, back 7 from 2, **no shoulder at all**,
  and "thigh" does not separate hamstring from quadriceps.

Decision (user, 2026-10-28): **Part A** a real overall injury-risk model on the
runners data, served; body-part flags come from transparent rules. **Part B** an
exploratory knee classifier on SoccerMon, reported but never served.

---

## Part A — overall injury risk (runners), candidate for serving

**Data.** `day_approach_maskedID_timeseries.csv` (Lövdal, den Hartigh &
Azzopardi 2021, DataverseNL doi:10.34894/UWU9PV, CC0). 42,766 athlete-days,
74 athletes, 583 injury days (1.36%). Each row = one event day; features = the
7 preceding days x 10 variables (strictly before the event day, per the README);
label = injury on the event day. Injury labels for one athlete are at least 22
days apart, so no injury is counted twice.

**Feature sets.**

| Set | Variables (each for days -7 ... -1) | Why |
|---|---|---|
| `APP` | nr. sessions, total km, strength training, hours alternative | the four variables FitFusion can compute with the same meaning |
| `FULL` | all 10 (adds km Z3-4, km Z5-T1-T2, km sprinting, perceived exertion, training success, recovery) | upper bound; shows what FitFusion's missing inputs cost |

Both sets add deterministic 7-day sums of their volume variables and
`rest_days_7d` (days with 0 sessions). Nothing else is engineered.

FitFusion mapping for `APP` (per calendar day, last 7 days before the request):

| Runners variable | FitFusion source |
|---|---|
| nr. sessions | 1 if any `workout_logs` row that day (collapsed: duplicate rows are a known logging bug) + number of `cardio_logs` rows; capped at 2, the training maximum |
| total km | sum of `cardio_logs.distance_km` where the activity is running/jogging/treadmill |
| strength training | 1 if that day's `workout_logs` contain any exercise classed as Strength |
| hours alternative | `cardio_logs.duration_minutes / 60` for non-running activities (cycling, rowing, swimming, ...) |

**Split.** `StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)`
over athletes, stratified on the injury label; fold 0 is the **test set**
(about 20% of athletes) and is scored **once**, at the end. The other athletes
form the development set.

**Model selection (development set only).** `StratifiedGroupKFold(5, shuffle=True,
random_state=42)` by athlete. XGBoost grid: max_depth {2, 3, 4} x n_estimators
{200, 400}; learning_rate 0.03, subsample 0.8, colsample_bytree 0.8,
min_child_weight 5, scale_pos_weight = negatives/positives of the training fold.
Pick the configuration with the highest mean fold ROC-AUC; ties go to the
smaller model. Done separately for `APP` and `FULL`.

**Calibration and threshold (development set only).** Platt scaling fitted on
the out-of-fold scores of the chosen configuration; the final model is refitted
on the whole development set. Decision threshold t* = the calibrated
probability that maximises F1 on the out-of-fold predictions.

**Baselines (same test athletes).**
1. Prevalence only — constant score (ROC-AUC 0.5, PR-AUC = prevalence).
2. Workload rule — score = 7-day total km (`FULL`) or 7-day sessions (`APP`):
   "more load, more risk". ACWR is not computable: the rows hold only 7 days.
3. Logistic regression — standardised, class_weight="balanced", C = 1, same features.

**Metrics.** ROC-AUC (primary; the paper reports 0.724 with its own protocol),
PR-AUC, Brier score (calibrated XGBoost), and at the development-chosen
threshold: precision, recall, F1, confusion matrix. 95% CIs by athlete-cluster
bootstrap (2,000 resamples, seed 42). Paired bootstrap CIs for the AUC
differences XGB-APP minus LogReg-APP, XGB-APP minus Rule-APP, and XGB-FULL
minus XGB-APP.

**Serving rule.** Serve XGB-APP as the overall risk score **if and only if** the
lower bound of its test ROC-AUC 95% CI is above 0.50. Otherwise the endpoint
serves the region rules alone and returns `overall_risk: null`. If logistic
regression is significantly better (difference CI entirely below 0), that is
reported and the choice goes back to the user, as with Model 1.

**Slide target.** F1 > 0.75 is reported against honestly. At 1.36% prevalence it
is not expected to be reachable; the number will be stated as measured.

---

## Part B — knee injury (SoccerMon), exploratory, never served

**Data.** SoccerMon `subjective.zip` (Midoglu et al. 2024, Zenodo
10.5281/zenodo.10033832, CC BY 4.0). 50 rostered players, 2020-2021.

**Episodes and label.** A knee episode starts on the first `left_knee` or
`right_knee` report after 14 or more days without one (14 episodes, 5 players).
Row = player-day t; label = 1 if a knee episode starts on any of days t ... t+6.
Rows with a knee report in the 14 days before t are dropped (ongoing complaint),
as are rows with no wellness report in days t-7 ... t-1.

**Features (days t-7 ... t-1 only).** 7-day means of soreness, fatigue, sleep
duration, sleep quality, readiness, stress, mood; 7-day sum of daily load;
ACWR, ATL, CTL28, monotony, strain on day t-1; number of wellness reports in
the 7 days.

**Evaluation.** `StratifiedGroupKFold(5, shuffle=True, random_state=42)` by
player, giving out-of-fold scores for every row. Models: XGBoost (max_depth 2,
200 trees, learning_rate 0.05, scale_pos_weight, fixed in advance, no tuning),
logistic regression (as Part A), ACWR rule (score = ACWR on day t-1),
prevalence. Metrics: pooled ROC-AUC and PR-AUC with player-cluster bootstrap
CIs. With 5 injured players the result is descriptive whatever it shows; it is
**not served under any outcome**.

---

## Serving design (fixed before results)

The endpoint keeps its contract (`risk` per region, `threshold` 0.7, `flagged`,
`imputed`, `disclaimer`) and adds `overall_risk`, `relative_risk`,
`overall_elevated` and a per-region `basis`.

- `overall_risk` = calibrated XGB-APP probability of an injury on the next day,
  given the last 7 days. `relative_risk` = overall_risk / training prevalence.
  `overall_elevated` = overall_risk >= t*.
- A region is **recorded** if it appears in the profile's injuries, the injury
  tracker's active injuries, or reported pain, and **loaded** if the last 7 days'
  exercises load it (word-boundary exercise matcher).

| Region state | `risk[region]` (rule level, not a probability) | flagged (>= 0.7)? |
|---|---|---|
| recorded and overall elevated | 0.9 | yes |
| recorded, overall not elevated | 0.6 | no |
| loaded and overall elevated | 0.5 | no |
| loaded, overall not elevated | 0.2 | no |
| neither | 0.1 | no |

In `/api/adaptive-replan`: flagged regions strip exercises and add a rest day
(as before); `overall_elevated` sets the RL `injury_flag`. Pain holds, volume
caps and injury stripping still apply whatever the model says. Every response
states it is an informational risk indicator, not a diagnosis.
