# Model 4 — pre-registered evaluation protocol

Written and committed on 2026-10-28, **before** any sequence was built, any label
threshold computed or any model trained. The only things looked at beforehand
are the file structure and the run-level distributions below. Changes made after
this commit go under "Deviations" in RESULTS.md.

## Why the design changed

The slides ask for a PyTorch TransformerEncoder (2 layers, 4 heads) that reads
the last 4 sessions and predicts IMPROVE / PLATEAU / REGRESS, with accuracy above
65%, from a "pilot cohort of 12 users".

- The old model was trained on pseudo-sequences regrouped from the cross-sectional
  Gym Members data, with a proxy completion rate and a synthetic day of week. It
  never saw a real sequence (accuracy 0.459 vs majority class 0.389). Retired.
- FitFusion's Supabase history is seeded or test data (confirmed by the user,
  2026-10-28), and only three weeks long. It is not used for training and never
  presented as pilot data.

Decision (user, 2026-10-28): train on the open Strava running logs of Afonseca,
Watanabe & Duarte (Figshare doi:10.6084/m9.figshare.16620238, CC BY 4.0).

## Data

`run_ww_2019_d.parquet` and `run_ww_2020_d.parquet`: one row per athlete per
day, with 0 km on rest days. Columns: datetime, athlete, distance (km), duration
(min), gender, age group, country, major. 36,412 athletes. In 2019 there are
4,677,389 run-days, a median of 120 per athlete.

**Session** = a day with a run. **Cleaning** (fixed now): a run-day is kept only
if 1 <= distance <= 60 km and 3.0 <= pace <= 15 min/km (pace = duration / distance).
Days outside these limits are dropped, not repaired.

## Performance measure and label

Raw pace mixes easy, long and fast runs. Each run is therefore converted to an
**equivalent 10 km pace** with Riegel's published formula, which has no fitted
parameters and so cannot leak information:

    T_10k = duration x (10 / distance) ^ 1.06,    pace_10k = T_10k / 10

**Window** = 8 consecutive sessions of one athlete, all within 56 days. Sessions
1-4 are the input; sessions 5-8 are the outcome.

    change = median(pace_10k of sessions 5-8) / median(pace_10k of sessions 1-4) - 1

Lower pace is faster, so a negative change is an improvement.
IMPROVE if change < q1, REGRESS if change > q2, otherwise PLATEAU, where q1 and q2
are the 1/3 and 2/3 quantiles of `change` over the **training athletes only**.
This balances the classes in training, so the majority-class baseline sits near 1/3.

Windows are non-overlapping (stride 8) within each athlete.

## Input features (per session, 4 sessions)

| Feature | FitFusion source |
|---|---|
| distance_km | `cardio_logs.distance_km` |
| duration_h | `cardio_logs.duration_minutes / 60` |
| pace_10k (min/km) | derived the same way |
| gap_days (days since the previous session; the first session uses the gap before it) | `cardio_logs.date` |
| day_of_week | `cardio_logs.date` |

All features are standardised with training-set means and standard deviations.
The slides' `completion_rate` and `workout_type` do not exist in running logs, so
they are not inputs. In FitFusion, the model applies to users' **running** cardio
sessions only (activity matching run/jog/treadmill, with a distance). Users
without 4 such sessions in the last 56 days get the existing completion-slope
fallback, labelled as a rule.

## Split

Athletes are shuffled with seed 42 and split 70 / 15 / 15 into train /
validation / test. No athlete appears in two splits. The test set is scored
**once**, at the end.

## Models

- **Transformer (candidate).** Linear embedding to d_model 32, learned positional
  embedding, TransformerEncoder (2 layers, 4 heads, feed-forward 128, dropout 0.1),
  mean-pooled, then a linear head to 3 classes. Adam lr 1e-3, batch 512, at most 20
  epochs; keep the epoch with the best validation macro-F1; seed 42.
  Seeds 0, 1 and 2 are also trained, and their test accuracy is reported for stability.
- **Baselines**, all on the same windows:
  1. Majority class (from training).
  2. Last-delta rule: compare pace_10k of session 4 with the median of sessions 1-3
     using the same q1/q2.
  3. Multinomial logistic regression on the 20 flattened features.
  4. HistGradientBoostingClassifier on the 20 flattened features (default
     settings, early stopping on a 10% internal split, seed 42).

## Metrics

On test athletes: accuracy (primary; slide target > 65%), macro-F1, per-class
precision and recall, and the confusion matrix. 95% CIs come from an
athlete-cluster bootstrap (1,000 resamples, seed 42). Paired bootstrap CIs are
computed for the accuracy differences transformer minus each baseline.

## Serving rule

Serve the transformer **if and only if** the lower bound of its test accuracy
95% CI is above the majority-class accuracy. If a baseline is significantly
better (its paired difference CI lies entirely below 0), that is reported and the
choice goes back to the user, as with Models 1 and 3. Whether 65% is reached is
reported as measured.

## Inference contract

`POST /predict/trajectory` keeps its response (`label`, `trajectory_score`,
`probs`, `sessions_used`, `model_version`, `stub`). It accepts exactly the last 4
valid running sessions (oldest first). Fewer sessions, or invalid values, get a
422 or the rule fallback; neither is ever a silent guess.
