# Model 3 — injury risk from training load (teacher demo)

**What it does.** It estimates whether a user's last 7 days of training put them at higher risk of
injury, and marks which body areas (knee, back, shoulder, hamstring) need care. The output is an
informational risk indicator, **not a diagnosis**.

**How it is built**
- **Overall risk (ML).** XGBoost trained on real injuries of 74 competitive runners (Lövdal et al.
  2021, CC0, 583 injuries), using the four training-load variables FitFusion also records:
  sessions, running km, strength sessions and other cardio hours.
- **Body regions (rules).** No open dataset has real labels for the four regions, so a fixed rule
  table decides each region's level: is it a recorded injury or pain area, and do recent exercises
  load it? See `PROTOCOL.md`.
- **Exploratory knee model.** Trained on SoccerMon (elite footballers' real injury reports). It is
  never served: only 5 players ever reported a knee injury.

**Status.** The XGBoost model failed the pre-registered serving rule (test ROC-AUC 0.589, CI
includes 0.5), so the app currently serves the region rules only. `RESULTS.md` has every number
and the owner's decision (2026-10-28) to keep the pre-registered outcome.

| File | Contents |
|---|---|
| `PROTOCOL.md` | evaluation plan and serving rule, committed before training |
| `DATA_SOURCES.md` | both datasets: links, licences, counts, label definitions, limitations |
| `RESULTS.md` | every metric, the baselines, the target, and the decision |
| `demo.py` | the demonstration: data, label, prediction, SHAP, held-out athletes, API call |
| `sample_input.json` | the labelled (illustrative) example input |
| `outputs/demo_output.txt`, `outputs/demo_output.json` | the actual output of `demo.py` |
| `outputs/shap_sample.png` | SHAP explanation of the sample input |
| `outputs/test_results.txt` | the Model 3 Python and TypeScript tests and their results |

Figures written by training: `models/reports/injury_load_roc_pr.png`, `injury_load_confusion.png`,
`injury_load_shap.png`, `injury_load_calibration.png`, `injury_soccermon_knee.png`.

Code, kept where the service uses it:

| Path | Role |
|---|---|
| `training/data_runners.py`, `training/data_soccermon.py` | load and verify the datasets (checksums, counts) |
| `training/train_injury_load.py` | Part A: selection, calibration, test, bootstrap CIs, artifact |
| `training/train_injury_soccermon_knee.py` | Part B: exploratory knee analysis |
| `app/injury_load.py` | feature mapping, calibration, region rules (shared by API, demo, tests) |
| `app/routers/injury.py` | `POST /predict/injury-risk` |
| `web/src/lib/ml-service/injury-rules.ts` | the same rules and day mapping in the app, plus exercise stripping |
| `tests/test_model3_injury.py`, `web/src/lib/ml-service/injury-rules.test.mjs` | tests |

## How to run (Windows, from `ml-service\`)

**1. Data.** No login is needed; see `DATA_SOURCES.md` for the links. Put the runners CSV in
`data\runners\` and unzip SoccerMon's `subjective.zip` into `data\soccermon\extracted\`. Then check
them against the recorded checksums:

```powershell
.venv\Scripts\python.exe -m training.data_runners
.venv\Scripts\python.exe -m training.data_soccermon
```

**2. Train.** Run these one at a time.

```powershell
.venv\Scripts\python.exe -m training.train_injury_load              # ~25 min on a laptop (bootstrap)
.venv\Scripts\python.exe -m training.train_injury_soccermon_knee    # ~3 min
```

**3. Demo and tests.**

```powershell
.venv\Scripts\python.exe demos\model3_injury\demo.py
.venv\Scripts\python.exe -m pytest -q tests\test_model3_injury.py
cd ..\web ; npm test
```

## How to present it (about 5 minutes)

1. **The problem with the old model** (`demo.py` section 1). Its labels were rules over its own
   inputs, so F1 = 1.0 meant nothing.
2. **Real data** (section 2 and `DATA_SOURCES.md`). There are 583 real injuries. Then show the
   SoccerMon table: no open data has knee/back/shoulder/hamstring labels at the scale needed.
3. **The plan was fixed first** (`PROTOCOL.md`, commit `1340716`, made before training).
4. **A prediction** (sections 3–5): the 7-day input, overall risk, region levels with their
   reasons, and the SHAP factors.
5. **Honest evaluation** (section 8 and `RESULTS.md`): 14 held-out athletes, baselines, CIs, and
   why the rule said "don't serve".
6. **Safety.** Whatever the model says, recorded injuries and reported pain still strip exercises,
   pain blocks any volume increase, and the weekly increase stays capped.
