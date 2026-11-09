# Model 3 — results

## Round 2 (served) — three weeks of training load

Numbers from `models/reports/injury_load_round2.json` and `outputs/training_log_round2.txt`.
Plan: `PROTOCOL_ROUND2.md`, committed before training (`d2ef8ec`), amended before any round-2
result existed (`fb9dbb0`, see "The leak" below).

### Headline

- **Served.** Out-of-fold ROC-AUC on all 74 athletes is **0.595 [95% CI 0.563, 0.626]**. The lower
  bound, 0.563, is above the pre-registered bar of 0.55.
- **The signal is real but weak.**
  - It beats the ACWR rule (+0.067 [+0.030, +0.102]).
  - It does **not** significantly beat "sessions last week" (+0.028 [−0.009, +0.065]).
  - It ties a logistic regression on the last week alone (+0.001 [−0.031, +0.028]). The two
    earlier weeks add nothing measurable.
- **Well calibrated.** Slope 0.95, where 1 is perfect. The risk it reports is a believable
  probability. Being right on average is not the same as ranking people well, so the Brier
  score matches prevalence-only.
- **The top-10% "elevated" flag** marks days with 1.33× the injury rate of the rest, CI
  [0.94, 1.80]. The interval includes 1, so the flag is not shown to be informative. It catches
  12% of injury days.
- **Not met: the slide target F1 > 0.75 per region.** It is not measurable either: no open dataset
  has knee/back/shoulder/hamstring labels. Regions stay rule-based.

### The leak caught before training (Amendment 1)

The first round-2 plan rebuilt 28 days of history from the day file. A label-count check, run
before any model was scored, found that file has **no rows in the 3 weeks before any injury**:

| | injury rows (583) | other rows (42,183) |
|---|---|---|
| previous row is the day before | 0% | 98.9% |
| known days in the week before the row's own 7 days (of 7) | 0.0 | 6.7 |

Any feature using that history would have identified injury rows by their gap. The first run was
stopped before it printed or saved a metric. The protocol was amended to use the dataset's week
file, which carries the 3 weeks inside each row. It also dropped "days since previous injury",
which leaks for the same reason. The run then had to pass a leakage screen: no single feature may
reach ROC-AUC 0.75. The most separating feature was `strength_w0` at 0.584.

### Evaluation design

- **Data.** Week file: 42,798 event days, 74 athletes, 575 injuries (1.34%). 22 features
  FitFusion can compute (`DATA_SOURCES.md`).
- **Outer loop.** 5-fold athlete-grouped CV, repeated with seeds 42–46. Every athlete is scored
  out-of-fold.
- **Inner loop.** Inside every outer training fold, the model was chosen among 9 configurations
  (logistic regression C ∈ {0.01, 0.1, 1}; XGBoost depth {1, 2, 3} × trees {100, 300}) by inner
  athlete-grouped CV. It was then Platt-calibrated on its inner out-of-fold scores.
- **Primary metric.** ROC-AUC of each row's mean out-of-fold probability, with a 95% CI from an
  athlete-cluster bootstrap (2,000 resamples).

### Results (all 74 athletes, out-of-fold)

| Model | ROC-AUC [95% CI] | PR-AUC |
|---|---|---|
| **Candidate** (nested selection; XGBoost won in all 25 outer folds) | **0.595** [0.563, 0.626] | 0.0176 |
| Week 0 only, logistic regression (the 7-day analogue of round 1) | 0.595 [0.563, 0.627] | 0.0170 |
| Rule: sessions last week | 0.567 [0.538, 0.597] | 0.0156 |
| Rule: ACWR (km) | 0.529 [0.508, 0.551] | 0.0143 |
| Prevalence only | 0.500 | 0.0134 |

Per-repeat pooled AUC: 0.599, 0.593, 0.598, 0.592, 0.592.

| Paired difference (ROC-AUC) | Δ | 95% CI |
|---|---|---|
| Candidate − week 0 only | +0.001 | [−0.031, +0.028] |
| Candidate − sessions rule | +0.028 | [−0.009, +0.065] |
| Candidate − ACWR rule | +0.067 | [+0.030, +0.102] |

**At the serving threshold** (p90 of out-of-fold probabilities, 0.0197):
- 9.3% of days flagged.
- Injury rate 1.73% on flagged days vs 1.30% on the rest: lift 1.33 [0.94, 1.80].
- Recall 12%.

**Secondary (not fresh).** Trained without round 1's 14 test athletes and scored on them:
ROC-AUC 0.597 [0.507, 0.677]. Round 1's numbers on those athletes were 0.589 (XGBoost) and 0.669
(logistic regression), from the day file, so they cannot be paired.

**Final served model.**
- XGBoost, depth 2 × 100 trees. Chosen by nested CV on all 74 athletes (inner AUC 0.609).
- Platt-calibrated. Training prevalence 0.0134.
- Top features by mean |SHAP|: strength sessions last week, strength sessions 2 weeks ago, km 3
  weeks ago, longest run last week, km 2 weeks ago, rest days last week.
- Figures: `models/reports/injury_load_round2_roc_calibration.png`, `injury_load_round2_features.png`.

### Decision (as pre-registered)

| Rule | Result |
|---|---|
| Serve iff the lower bound of the primary ROC-AUC 95% CI > 0.55 | 0.563 → **served** |
| Slide target F1 > 0.75 per region | **not met / not measurable** (no body-part labels) |

### Limitations (round 2)

- **Weak and not better than a simple model.** A user with the same last-week load gets almost
  the same ranking from a 6-number logistic regression. XGBoost is served because the nested
  selection chose it, not because it was shown to be better.
- **Population shift.** The model learned from competitive runners averaging about 50 km a week.
  FitFusion users mostly run far less, and low km pushes the score down (sample input: km 2
  weeks ago = 12 lowers the log-odds by 0.22). Scores for gym-only users are extrapolations.
- **Associations, not causes.** Strength sessions are the strongest feature. In competitive
  runners that may reflect rehab or niggles rather than strength work causing injury.
- **The "elevated" flag is not validated** (lift CI includes 1). It still feeds the region rule
  table and the RL injury flag, as the protocol specifies. Recorded injuries and pain strip
  exercises regardless.
- **Repeats overlapped.** `StratifiedGroupKFold` only uses its seed to break ties, so the 5
  repeats produced 13 distinct folds out of 25, not 25. The CI comes from the athlete bootstrap,
  not from the repeats, so it is unaffected.
- **Not a fresh test.** The analysis was pre-registered, but round 1's results were already
  known (`PROTOCOL_ROUND2.md`, "What is already known").

### What changed in the app

- `POST /predict/injury-risk` takes 21 days and returns `overall_risk`, `relative_risk`,
  `overall_elevated` and `overall_basis`. With only 7 days it returns `overall_risk: null` and
  says why in `imputed`.
- Next.js reads 21 days of `workout_logs` and `cardio_logs` (`web/src/lib/ml-service/history.ts`).
  The dashboard card and the replan directive say "last 3 weeks".

---

## Round 1 (not served) — seven days, single test split

All numbers come from `models/reports/injury_load.json` and
`models/reports/injury_soccermon_knee.json`, written by the training scripts. The protocol
and serving rule were committed (`1340716`, `PROTOCOL.md`) **before** any model was trained.

### Headline (round 1)

- **Real injury data now replaces the circular proxy labels.** The old F1 = 1.0 came from labels
  generated by rules over the model's own inputs.
- **The pre-registered serving rule was not met, so the XGBoost model is not served.** Its test
  ROC-AUC is 0.589, and the 95% CI [0.482, 0.667] includes chance (0.5). The endpoint serves the
  body-region rules alone and returns `overall_risk: null`.
- **The slide target (F1 > 0.75 per label) is not met.** Measured F1 is 0.042, overall only,
  because no open dataset has real knee/back/shoulder/hamstring labels.
- **Logistic regression is not served either (owner's decision, 2026-10-28).** It scored higher on
  the test athletes (0.669, CI [0.563, 0.747]) but lower on the development athletes (0.566 vs
  0.598). See "Owner's decision" below.

## Part A — overall injury risk (74 competitive runners)

**Split.** 60 development athletes (34,218 days, 465 injuries). **14 test athletes** (8,548 days,
118 injuries), scored once. No athlete appears in both sets (checked by a test).

**Model selection** (5-fold out-of-fold on the development athletes, mean fold ROC-AUC):

| depth × trees | APP | FULL |
|---|---|---|
| 2 × 200 | 0.6008 | **0.6221** |
| 2 × 400 | 0.594 | 0.611 |
| 3 × 200 | **0.6014** | 0.619 |
| 3 × 400 | 0.591 | 0.601 |
| 4 × 200 | 0.595 | 0.609 |
| 4 × 400 | 0.579 | 0.585 |

Chosen: APP depth 3 × 200, FULL depth 2 × 200. Out-of-fold ROC-AUC: XGB-APP 0.598,
LogReg-APP 0.566, XGB-FULL 0.621, LogReg-FULL 0.611. Platt calibration and the F1 threshold
(0.0169 for XGB-APP) were fitted on those out-of-fold predictions.

**Held-out test athletes** (95% CI = athlete-cluster bootstrap, 2,000 resamples):

| Model | ROC-AUC [95% CI] | PR-AUC | Precision | Recall | F1 | Days flagged |
|---|---|---|---|---|---|---|
| **XGB-APP** (candidate) | **0.589** [0.482, 0.667] | 0.022 | 0.022 | 0.364 | 0.042 | 22.4% |
| LogReg-APP | 0.669 [0.563, 0.747] | 0.031 | 0.053 | 0.195 | 0.083 | 5.1% |
| Rule-APP (7-day sessions) | 0.605 [0.534, 0.674] | 0.018 | — | — | — | — |
| XGB-FULL (all 10 variables) | 0.602 [0.513, 0.695] | 0.022 | 0.021 | 0.483 | 0.040 | 31.6% |
| LogReg-FULL | 0.671 [0.599, 0.729] | 0.029 | 0.026 | 0.458 | 0.050 | 24.2% |
| Rule-FULL (7-day km) | 0.519 [0.457, 0.630] | 0.014 | — | — | — | — |
| Prevalence only | 0.500 | 0.014 | — | — | — | — |

XGB-APP confusion matrix at its threshold: 43 of 118 injury days flagged, plus 1,871 false alarms
among 8,430 non-injury days. Brier score 0.0136.

**Paired differences** (ROC-AUC, same bootstrap resamples):

| Comparison | Δ | 95% CI |
|---|---|---|
| XGB-APP − LogReg-APP | −0.080 | [−0.131, −0.010] |
| XGB-APP − Rule-APP | −0.016 | [−0.128, +0.084] |
| XGB-FULL − XGB-APP (cost of FitFusion's missing inputs) | +0.013 | [−0.023, +0.055] |
| XGB-FULL − LogReg-FULL | −0.069 | [−0.125, +0.003] |

**Mean |SHAP| on test athletes (XGB-APP):** strength sessions in 7 days 0.196, km 6 days before
0.162, 7-day km 0.133, then km on single earlier days.

**Published reference.** Lövdal et al. (2021) report ROC-AUC 0.724 on this data. They used all 10
variables, bagged XGBoost and their own evaluation protocol, so the numbers are not directly
comparable. With the FULL set and a strict athlete-held-out test, we measure 0.60–0.67.

Figures: `models/reports/injury_load_roc_pr.png`, `injury_load_confusion.png`,
`injury_load_shap.png`, `injury_load_calibration.png`.

### Decision (as pre-registered)

| Rule | Result |
|---|---|
| Serve XGB-APP iff the lower bound of its test ROC-AUC CI > 0.50 | 0.482 → **not served** |
| Logistic regression significantly better on test? | yes (Δ CI below 0) → **choice goes back to the owner** |
| Slide target F1 > 0.75 | **not met** (0.042) |

### Owner's decision (2026-10-28): keep the pre-registered outcome

Logistic regression won on the 14 test athletes but lost on the 60 development athletes. With
this few athletes the ranking is not stable, and serving it *because* of the test result would
be choosing a model on the test set. The options were:

1. **Keep as is (pre-registered outcome).** ← **chosen**
2. Serve LogReg-APP, labelled as a post-hoc choice.
3. Run a post-hoc repeated athlete-grouped CV over all 74 athletes, then decide.

**What is served:** no overall ML score (`overall_risk: null`, `stub: true`). Body regions come
from the rule table, and recorded injuries and pain still strip exercises in the replan. The
XGBoost model, its evaluation and the logistic-regression comparison stay in the repo as the
evidence.

## Part B — knee injuries, SoccerMon (exploratory, never served)

21,153 player-days after exclusions (50 players). 40 positive days, from 10 knee episodes of
5 players; 4 of those players have usable rows. Prevalence 0.19%. Out-of-fold by player:

| Model | ROC-AUC [95% CI] | PR-AUC |
|---|---|---|
| XGBoost | 0.659 [0.172, 0.933] | 0.006 |
| Logistic regression | 0.661 [0.233, 0.953] | 0.006 |
| ACWR rule | 0.433 [0.032, 0.722] | 0.002 |

The intervals span almost the whole range. With 4 injured players, the data cannot show whether
any method predicts knee injury. This is why body regions are handled by rules.
Figure: `models/reports/injury_soccermon_knee.png`.

## Deviations from the protocol

1. **Knee episode count.** PROTOCOL.md quotes "14 episodes, 5 players", counted per side during
   label profiling. Its own definition (left and right merged) gives **10 episodes, 5 players**,
   and that definition is what was run. The definition is unchanged.
2. **Region-only serving.** Because the serving rule failed, `/predict/injury-risk` serves the
   region rules with `overall_elevated: false` and `stub: true`. This is the pre-registered
   behaviour, not a deviation; it is noted here because it is what users see.
