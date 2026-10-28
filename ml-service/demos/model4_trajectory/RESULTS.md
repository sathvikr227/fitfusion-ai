# Model 4 — results

All numbers come from `models/reports/trajectory_runs.json`, written by
`training/train_trajectory_runs.py`. The protocol and serving rule were committed (`a2de032`,
`PROTOCOL.md`) **before** any window was built or any model trained. The full console log is
`outputs/training_log.txt`.

## Headline

- **Served.** The Transformer beats every baseline on 5,214 held-out athletes, each difference
  significant: accuracy **0.481** [0.478, 0.484] vs 0.334 for always guessing the most common class.
- **The slide target (accuracy > 65%) is not met.** Measured accuracy is 0.481 on three balanced
  classes. Pace on Strava also moves with terrain, weather and effort choice, which caps how
  predictable it is.
- **Stable.** Four training seeds give test accuracy 0.481–0.482.

## Data and labels

| | |
|---|---|
| Windows (8 sessions within 56 days) | 1,091,424 from 34,753 athletes |
| Train / validation / test | 763,342 / 164,174 / 163,908 windows; 24,327 / 5,212 / 5,214 athletes |
| Label thresholds (training athletes' tertiles) | IMPROVE if the 10 km-equivalent pace gets more than **2.23% faster**; REGRESS if more than **2.11% slower**; otherwise PLATEAU |
| Test class counts | REGRESS 54,513 · PLATEAU 54,815 · IMPROVE 54,580 |

## Training

The Transformer has d_model 32, 4 heads, 2 layers, feed-forward 128 and dropout 0.1. It used Adam
(lr 1e-3), batch 512 and 20 epochs, with seed 42. The best validation macro-F1 was 0.4821 at
**epoch 12**, and that epoch is the one kept. Validation accuracy rose from 0.474 (epoch 1) to
about 0.48 by epoch 4 and then flattened.

| Seed | Best validation macro-F1 | Test accuracy |
|---|---|---|
| **42 (served)** | 0.4821 | **0.4807** |
| 0 | 0.4827 | 0.4816 |
| 1 | 0.4831 | 0.4806 |
| 2 | 0.4824 | 0.4807 |

## Test athletes — scored once (95% CI: athlete-cluster bootstrap, 1,000 resamples)

| Model | Accuracy [95% CI] | Macro-F1 [95% CI] |
|---|---|---|
| **Transformer** | **0.4807** [0.4779, 0.4836] | **0.4804** [0.4775, 0.4833] |
| Gradient boosting (flattened features) | 0.4637 [0.4607, 0.4667] | 0.4609 [0.4578, 0.4638] |
| Logistic regression | 0.4063 [0.4032, 0.4092] | 0.4050 [0.4017, 0.4080] |
| Last-delta rule | 0.3558 [0.3531, 0.3586] | 0.3541 [0.3512, 0.3569] |
| Majority class | 0.3344 [0.3299, 0.3388] | 0.1671 [0.1654, 0.1687] |

**Paired accuracy differences (Transformer minus …):**

| Baseline | Δ | 95% CI |
|---|---|---|
| Majority | +0.146 | [+0.141, +0.151] |
| Last-delta rule | +0.125 | [+0.121, +0.128] |
| Logistic regression | +0.074 | [+0.071, +0.078] |
| Gradient boosting | **+0.017** | **[+0.015, +0.019]** |

**Per class (Transformer):**

| Class | Precision | Recall |
|---|---|---|
| REGRESS | 0.467 | 0.473 |
| PLATEAU | 0.457 | 0.439 |
| IMPROVE | 0.517 | 0.531 |

Confusion matrix (rows actual, columns predicted; REGRESS, PLATEAU, IMPROVE):
`[[25,763, 14,996, 13,754], [17,403, 24,049, 13,363], [12,059, 13,535, 28,986]]`.
Most errors are to a neighbouring class: REGRESS and IMPROVE are mistaken for each other
less often than either is mistaken for PLATEAU.

Figure: `models/reports/trajectory_runs.png` (training curve, confusion matrix, accuracy with CIs).

## Decision (as pre-registered)

| Rule | Result |
|---|---|
| Serve iff the lower bound of the test accuracy CI > majority accuracy | 0.4779 > 0.3344 → **served** |
| Any baseline significantly better? | **none** (gradient boosting is significantly *worse*, by 0.017) |
| Slide target accuracy > 0.65 | **not met** (0.481) |

## What this means in the app

`/api/adaptive-replan` and `/api/ml-insights` send a user's last 4 running days from
`cardio_logs`, summed per day as in the training data, plus the run day before them for the first
gap. Users without such runs, or whose runs are outside 1–60 km or 3–15 min/km, or span more than
56 days, get the completion-slope rule. That response says `stub: true` and gives a `reason`.
Strength-only users are therefore always on the rule, which is stated rather than hidden.

## Deviations from the protocol

None in the method. One operational note: the run was restarted once early on (epoch 1 of seed
42), because the session's background-command time limit was shorter than the run. It restarted
from scratch with the same seed and code; epoch 1 reproduced exactly (loss 1.0428), and only the
results of the complete run are reported. A cosmetic `loss.item()` change silenced a PyTorch
warning and does not affect any number.
