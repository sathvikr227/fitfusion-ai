# Model 1 — results

Every number here is copied from JSON reports that the training scripts write:

- `models/reports/calorie_hr.json`
- `models/reports/calorie_hr_calibration.json`
- `models/reports/calorie_gym_comparison.json`

Re-running the scripts reproduces them exactly: a re-run on 2026-10-27 matched the September run
value for value.

## Served model: calibrated XGBoost on lab calorimetry

**Algorithm.** `XGBRegressor(max_depth=2, n_estimators=600)` with monotone constraints, so energy
can only rise with heart rate and with weight. It was chosen by 5-fold cross-validation grouped by
person, against Ridge and XGBoost at depths 3 and 4.

**Output.** kcal/min = 0.3075 + 0.6185 × XGBoost. That linear correction is fitted on WEEE.
Multiplying by the session's minutes gives the session's calories.

### 1. Cross-validation on Malaga (10,186 windows, 840 people; each person entirely in one fold)

| Method | MAE (kcal/min) | RMSE | R² |
|---|---|---|---|
| **XGBoost depth 2 (selected)** | **1.50** | **2.01** | **0.770** |
| Ridge with physiological interactions | 1.55 | 2.02 | 0.768 |
| Keytel (2005) equation | 2.16 | 2.74 | 0.573 |
| FitFusion MET table | 1.75 | 2.34 | 0.687 |
| XGBoost without heart rate (ablation) | 3.41 | — | 0.084 |

Heart rate carries most of the signal: removing it drops R² from 0.77 to 0.08.

### 2. External test on WEEE (40 exercise segments, 16 people never seen in training), uncalibrated

| Method | MAE (kcal/min) | RMSE | Bias |
|---|---|---|---|
| **XGBoost** | **2.88** | **3.21** | +2.63 |
| Keytel (2005) | 3.91 | 4.32 | +3.82 |
| FitFusion MET table | 3.90 | 4.47 | +2.59 |

XGBoost beat Keytel for 15 of 16 people (Wilcoxon p = 0.0002) and beat the MET table for 14 of 16
(p = 0.0063). Both decision rules, fixed before training, passed. But every method overestimates
on WEEE, because Malaga's participants are mostly trained athletes.

### 3. Calibration, scored leave-one-participant-out on WEEE

The correction is fitted on 15 people and scored on the 16th, 16 times over. Every method gets the
identical correction.

| Method | MAE (kcal/min) | RMSE | R² | Error on a 30-min session |
|---|---|---|---|---|
| **XGBoost, calibrated (served)** | **1.27** | 1.66 | 0.449 | ±38 kcal |
| Keytel, calibrated (fallback) | 1.29 | 1.65 | 0.461 | ±39 kcal |
| MET table, calibrated | 1.69 | 2.18 | 0.056 | ±51 kcal |

Calibrated XGBoost against calibrated Keytel: MAE 1.22 vs 1.30 per person, better for 12 of 16
people, **Wilcoxon p = 0.16, which is not significant.** XGBoost's advantage over Keytel does not
survive calibration. XGBoost is served because the project specifies an explainable XGBoost
predictor, and the two methods tie; it is not more accurate than Keytel. Calibration itself
matters: it cuts the model's MAE from 2.88 to 1.27 (p = 0.002).

### Explainability (SHAP)

Mean |SHAP| on the WEEE segments, in kcal/min before calibration:

| Feature | Mean \|SHAP\| |
|---|---|
| Heart rate | 3.24 |
| Sex | 0.52 |
| Weight | 0.42 |
| Height | 0.39 |
| Age | 0.11 |

Every API response carries a per-prediction SHAP breakdown. `demo.py` checks it against the `shap`
library (they agree to within 0.00002 kcal/min) and draws it as a waterfall plot.

### Target from the slides

The slides' target was "MAE < 25 kcal on a held-out 20% split" of the Gym Members data. On real
calorimetry the served model's error is ±1.27 kcal/min, about ±38 kcal for a 30-minute session.
**On that scale the 25 kcal target is not met.** The comparison below shows why 25 kcal was never
reachable with real labels for the slide features.

## Comparison: XGBoost + SHAP on Gym Members (the slide design, not served)

**Setup.** One held-out 20% test split (195 of 973 rows, `random_state` 42). 5-fold CV on the 80%
only. `XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.1)`.

| Model (test set) | MAE (kcal) | RMSE | R² | Train CV MAE |
|---|---|---|---|---|
| XGBoost, slide features | **86.0** | 111.4 | 0.851 | 89.6 ± 4.3 |
| XGBoost, slide features + Avg_BPM + sex | 22.2 | 35.7 | 0.985 | 22.3 ± 1.1 |
| Linear regression on duration only | 95.0 | 123.6 | 0.817 | — |
| Training mean | 231.2 | 288.9 | 0.000 | — |
| FitFusion MET table | 416.9 | 497.9 | −1.972 | — |

**Target MAE < 25 kcal with the slide features: not met (86.0).**

**Why**
1. The labels ignore workout type: yoga and HIIT both come out at 716.5 kcal/h (figure
   `models/reports/calorie_gym_label_check.png`).
2. A Keytel-form formula on Avg_BPM, sex, weight, age and duration explains R² = 0.991 of the
   labels. The slide features leave out the two inputs the labels depend on, Avg_BPM and sex.
3. Adding those two inputs gets under 25 kcal (22.2), but only by re-learning the formula that
   appears to have produced the labels. That is not evidence about real calorie burn, so this
   model is reported, not served.
4. With the slide features, SHAP puts duration first (figure `models/reports/calorie_gym_shap.png`),
   and the model barely beats a straight line on duration (86.0 vs 95.0).

## Figures

| File | Shows |
|---|---|
| `outputs/shap_waterfall_sample.png` | SHAP waterfall for the sample input |
| `../../models/reports/calorie_hr_bland_altman.png` | external test agreement (Bland–Altman) |
| `../../models/reports/calorie_hr_calibration.png` | effect of calibration |
| `../../models/reports/calorie_gym_label_check.png` | Gym Members labels against MET-expected values |
| `../../models/reports/calorie_gym_shap.png` | SHAP importance for both Gym Members models |
