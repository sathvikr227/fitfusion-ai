# Training pipelines

Five reproducible scripts, one per model. Each downloads its dataset, trains,
evaluates, writes an artifact into `../models/`, and saves its **real** metrics
to `../models/reports/<model>.json`.

Run every command from the `ml-service/` directory.

## Setup (once)

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Python 3.11 or 3.12. Not 3.13+ — torch and xgboost wheels lag there.

## Datasets

Both come from Kaggle's public download endpoint and need **no credentials**.
`training/common.py` fetches and caches them into `ml-service/data/` on first
run, so there is nothing to download by hand.

| Key | Slug | Rows | Used by |
|---|---|---|---|
| `gym` | `valakhorasani/gym-members-exercise-dataset` | 973 | models 1–4 |
| `food` | `shrutisaxena/food-nutrition-dataset` | 7,413 | model 2 |

If Kaggle ever blocks the anonymous endpoint, download the archives manually and
drop `gym_members_exercise_tracking.csv` and `food.csv` into `ml-service/data/`.

## Pilot data (optional but recommended)

```bash
.venv/Scripts/python.exe -m training.export_pilot_data
```

Reads the live FitFusion tables and writes CSVs to `data/pilot/`. Credentials
come from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, or from
`web/.env.local` when running inside a checkout.

The RL environment calibrates its completion-rate distribution and injury rate
from this export. Without it the trainer falls back to documented defaults and
says so in its output.

## Build order

Run in this order — later models assume the earlier artifacts exist.

```bash
.venv/Scripts/python.exe -m training.train_calorie      # ~10 s
.venv/Scripts/python.exe -m training.train_recommender  # ~30 s
.venv/Scripts/python.exe -m training.train_injury       # ~15 s
.venv/Scripts/python.exe -m training.train_transformer  # ~2 min
.venv/Scripts/python.exe -m training.train_rl_agent     # ~25 min
```

| Script | Artifacts |
|---|---|
| `train_calorie.py` | `calorie_model.pkl` |
| `train_recommender.py` | `rec_scaler.pkl`, `user_matrix.pkl`, `food_index.pkl` |
| `train_injury.py` | `injury_risk_model.pkl` |
| `train_transformer.py` | `transformer_model.pt`, `transformer_meta.json` |
| `train_rl_agent.py` | `fitfusion_rl_agent.zip` |

Everything in `models/` is gitignored — artifacts are produced by training and
shipped out of band.

## Running on Google Colab

The scripts are plain modules with no notebook dependency, so a Colab cell only
needs the repo and the requirements:

```python
!git clone <your-repo-url> fitfusion && cd fitfusion/ml-service && pip install -r requirements.txt
%cd fitfusion/ml-service
!python -m training.train_calorie
```

None of the five models needs a GPU. The Transformer is 2 layers at d_model=32
and trains on CPU in about two minutes; PPO is CPU-bound on the environment
step, so a GPU runtime makes it no faster.

## Verifying a trained model

```bash
.venv/Scripts/python.exe -m pytest -q
```

Tests that need an artifact skip themselves when it is missing, so the suite is
meaningful before and after training. `/healthz` also reports exactly which
models loaded and why any failed.

## Notes on the numbers

`models/reports/*.json` holds the metrics each run actually produced, including
where a documented target was not met. Two findings are recorded there rather
than smoothed over:

- **The documented knee label matches zero rows.** `knee_risk = Resting_BPM > 80
  AND Workout_Frequency > 5` is unsatisfiable on this dataset (resting BPM tops
  out at 74, frequency at 5). `train_injury.py` detects the degenerate rule and
  substitutes a quantile-calibrated form of the same two signals, recording the
  substituted rule in the artifact and the report.
- **The shoulder label is not identifiable from the documented features.** It
  keys on `Workout_Type == Strength`, which the documented feature list excludes.
  The script prints an ablation showing shoulder F1 rising from 0.29 to 1.00 once
  `Workout_Type` is added. The shipped model keeps the documented features.
