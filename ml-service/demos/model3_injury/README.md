# Model 3 — injury risk from training load (teacher demo)

**What it does.** It estimates whether a user's last 3 weeks of training put them at higher risk of
injury, and marks which body areas (knee, back, shoulder, hamstring) need care. The output is an
informational risk indicator, **not a diagnosis**.

**How it is built**
- **Overall risk (ML, served).** XGBoost (depth 2, 100 trees, Platt-calibrated) trained on real
  injuries of 74 competitive runners (Lövdal et al. 2021, CC0, 575 injury events). Its input is
  three weekly summaries of the load FitFusion also records: sessions, rest days, running km,
  longest run, other cardio hours, strength sessions, plus four derived features (22 in all).
- **Body regions (rules).** No open dataset has real labels for the four regions, so a fixed rule
  table sets each region's level from two questions. Is it a recorded injury or pain area? Do
  recent exercises load it? The model's "elevated" flag raises those levels. See `PROTOCOL.md`.
- **Exploratory knee model.** Trained on SoccerMon (elite footballers' real injury reports). It is
  never served: only 5 players ever reported a knee injury.

**Status: served (round 2), with a weak signal.**
- **Round 1** (7 days, one test split) failed its rule: ROC-AUC 0.589, CI [0.482, 0.667].
- **Round 2** (`PROTOCOL_ROUND2.md`, pre-registered and then amended *before* any result) scored
  every athlete out-of-fold: **ROC-AUC 0.595 [0.563, 0.626]**. The lower bound is above the
  pre-registered 0.55, so it is served.
- It does **not** beat a logistic regression on last week alone, or "sessions last week"
  significantly. `RESULTS.md` has every number and limitation.

| File | Contents |
|---|---|
| `PROTOCOL.md` | round 1 plan and serving rule, committed before training (`1340716`) |
| `PROTOCOL_ROUND2.md` | round 2 plan (`d2ef8ec`) and Amendment 1, the leakage fix (`fb9dbb0`), both before any round-2 result |
| `DATA_SOURCES.md` | both datasets: links, licences, counts, label definitions, limitations |
| `RESULTS.md` | every metric, the baselines, the targets and the decisions, rounds 1 and 2 |
| `demo.py` | the demonstration: data, leakage check, prediction, SHAP, API call, evaluation |
| `sample_input.json` | the labelled (illustrative) example input: 21 days |
| `outputs/demo_output.txt`, `outputs/demo_output.json` | the actual output of `demo.py` |
| `outputs/shap_sample.png` | SHAP explanation of the sample input |
| `outputs/training_log_round2.txt` | the round-2 training run, as printed |
| `outputs/test_results.txt` | the Model 3 Python and TypeScript tests and their results |

Figures written by training: `models/reports/injury_load_round2_roc_calibration.png` and
`injury_load_round2_features.png` for round 2. Round 1: `injury_load_roc_pr.png`,
`injury_load_confusion.png`, `injury_load_shap.png`, `injury_load_calibration.png`. Part B:
`injury_soccermon_knee.png`.

Code, kept where the service uses it:

| Path | Role |
|---|---|
| `training/data_runners.py`, `training/data_soccermon.py` | load and verify the datasets (checksums, counts) |
| `training/train_injury_load_round2.py` | round 2: leakage screen, nested repeated CV, bootstrap, artifact |
| `training/train_injury_load.py` | round 1 (kept as the record) |
| `training/train_injury_soccermon_knee.py` | Part B: exploratory knee analysis |
| `app/injury_load.py` | feature mapping (days → weeks), calibration, region rules (shared by API, demo, tests) |
| `app/routers/injury.py` | `POST /predict/injury-risk` |
| `web/src/lib/ml-service/history.ts` | reads the last 21 days from Supabase for the endpoint |
| `web/src/lib/ml-service/injury-rules.ts` | the same rules and day mapping in the app, plus exercise stripping |
| `tests/test_model3_injury.py`, `tests/test_smoke.py`, `web/src/lib/ml-service/injury-rules.test.mjs` | tests |

## How to run (Windows, from `ml-service\`)

**1. Data.** No login is needed; see `DATA_SOURCES.md` for the links. Put both runners CSVs in
`data\runners\` and unzip SoccerMon's `subjective.zip` into `data\soccermon\extracted\`. Then check
them against the recorded checksums:

```powershell
.venv\Scripts\python.exe -m training.data_runners
.venv\Scripts\python.exe -m training.data_soccermon
```

**2. Train.** Run these one at a time.

```powershell
.venv\Scripts\python.exe -u -m training.train_injury_load_round2    # ~6 min: the served model
.venv\Scripts\python.exe -m training.train_injury_load              # ~25 min: round 1, for the record
.venv\Scripts\python.exe -m training.train_injury_soccermon_knee    # ~3 min
```

**3. Demo and tests.**

```powershell
.venv\Scripts\python.exe demos\model3_injury\demo.py
.venv\Scripts\python.exe -m pytest -q tests\test_model3_injury.py tests\test_smoke.py
cd ..\web ; npm test
```

## How to present it (about 6 minutes)

1. **The problem with the old model** (`demo.py` section 1). Its labels were rules over its own
   inputs, so F1 = 1.0 meant nothing. Round 1 then used real injuries but failed its rule.
2. **Real data** (section 2 and `DATA_SOURCES.md`). There are 575 real injury events from 74
   runners. No open data has knee/back/shoulder/hamstring labels at the scale needed (SoccerMon table).
3. **A leak caught before it could inflate the result** (section 3). The day file has no rows in
   the 3 weeks before any injury, so longer history would have "predicted" injuries from the gap.
   The protocol was amended before any number existed, and a leakage screen guards the run.
4. **The plan was fixed first** (`PROTOCOL_ROUND2.md`: commits `d2ef8ec` and `fb9dbb0`, both
   before training).
5. **A prediction** (sections 4–7): the 21-day input as three weeks, the overall risk, region
   levels with their reasons, the SHAP factors, and the same answer from the API.
6. **Honest evaluation** (section 8 and `RESULTS.md`): out-of-fold on all 74 athletes, CIs,
   baselines. It passes the rule, but the signal is weak and no better than a simple last-week
   model.
7. **Safety.** Whatever the model says, recorded injuries and reported pain still strip exercises,
   pain blocks any volume increase, and the weekly increase stays capped.
