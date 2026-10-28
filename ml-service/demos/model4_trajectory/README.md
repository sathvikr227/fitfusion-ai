# Model 4 — Transformer running-trajectory predictor (teacher demo)

**What it does.** It reads a user's last 4 running sessions and predicts whether their next 4 runs
will be faster (**IMPROVE**), about the same (**PLATEAU**) or slower (**REGRESS**). The adaptive
replan uses this to decide whether to push, hold or ease off.

**How it is built**
- A PyTorch TransformerEncoder (2 layers, 4 heads), trained on real Strava running logs of
  34,753 marathon runners (Afonseca et al., CC BY 4.0, 1,091,424 eight-session windows).
- Performance = **Riegel-equivalent 10 km pace**, so long slow runs and short fast runs compare
  fairly. Labels use the training athletes' tertiles (±about 2%).
- The protocol was committed before training (`PROTOCOL.md`, commit `a2de032`).

**Result.** Test accuracy **0.481** on 5,214 held-out athletes. It beats gradient boosting, logistic
regression, a last-delta rule and the majority class, each with a significant margin. **Served.**
The 65% slide target is not met; `RESULTS.md` explains why.

| File | Contents |
|---|---|
| `PROTOCOL.md` | evaluation plan and serving rule, committed before training |
| `DATA_SOURCES.md` | the dataset: link, licence, funnel, label definition, limitations |
| `RESULTS.md` | every metric, baselines, seeds, the target, and the decision |
| `demo.py` | the demonstration: data, label, sample prediction, real held-out athletes, API call |
| `sample_input.json` | the labelled (illustrative) example input |
| `outputs/demo_output.txt`, `outputs/demo_output.json` | the actual output of `demo.py` |
| `outputs/test_results.txt` | the Model 4 Python and TypeScript tests and their results |
| `outputs/training_log.txt` | the full training console log |

Figure written by training: `models/reports/trajectory_runs.png`.

Code, kept where the service uses it:

| Path | Role |
|---|---|
| `training/data_strava.py` | verify the files (MD5), clean, build 8-session windows, label |
| `training/train_trajectory_runs.py` | split, train (4 seeds), baselines, bootstrap CIs, artifact |
| `app/trajectory_runs.py` | features, Riegel pace, the model class, inference (shared by API, demo, tests) |
| `app/routers/trajectory.py` | `POST /predict/trajectory`, with the rule fallback and `reason` |
| `web/src/lib/ml-service/run-sessions.ts` | turns `cardio_logs` into the model's 4 sessions |
| `tests/test_model4_trajectory.py`, `web/src/lib/ml-service/run-sessions.test.mjs` | tests |

## How to run (Windows, from `ml-service\`)

```powershell
.venv\Scripts\python.exe -m training.data_strava              # verify the download (~2 min)
.venv\Scripts\python.exe -u -m training.train_trajectory_runs # ~3.5 h on a laptop CPU (4 seeds)
.venv\Scripts\python.exe demos\model4_trajectory\demo.py      # ~3 min (loads 309 MB of logs)
.venv\Scripts\python.exe -m pytest -q tests\test_model4_trajectory.py
cd ..\web ; npm test
```

Download links are in `DATA_SOURCES.md` (no login needed).

## How to present it (about 5 minutes)

1. **Why it was rebuilt** (`demo.py` section 1). The old "sequences" were rows from a one-off
   survey, so no real person's sessions were in order. FitFusion's own history is test data.
2. **Real data and a fair label** (section 2). 1.09M real windows; Riegel pace; thresholds set on
   training athletes only.
3. **The plan was fixed first** (`PROTOCOL.md`, commit `a2de032`).
4. **A prediction** (section 3) and **real held-out runners** (section 4). Accuracy is recomputed
   live and matches the report.
5. **Honest evaluation** (section 6, `RESULTS.md`): beats four baselines with CIs, stable over 4
   seeds, below the 65% target, and why.
6. **Limits in the app.** It only reads running sessions; everyone else gets the labelled rule.
