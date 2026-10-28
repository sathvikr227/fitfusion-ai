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

The gym dataset comes from Kaggle's public download endpoint and needs **no
credentials**; `training/common.py` fetches and caches it into `ml-service/data/`.

| Key | Slug | Rows | Used by |
|---|---|---|---|
| `gym` | `valakhorasani/gym-members-exercise-dataset` | 973 | models 3–4 (not yet rebuilt) |

If Kaggle ever blocks the anonymous endpoint, download the archive manually and
drop `gym_members_exercise_tracking.csv` into `ml-service/data/`.

### Stage 2 dataset (manual download)

| Dataset | Source | Extract into | Role |
|---|---|---|---|
| Food.com Recipes and Interactions (Majumder et al., EMNLP 2019) | https://www.kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions | `data/foodcom/` (`RAW_recipes.csv`, `RAW_interactions.csv`) | recipes, nutrition, 1.13M ratings |

### Stage 1 datasets (manual download)

| Dataset | Source | Licence | Extract into | Role |
|---|---|---|---|---|
| Malaga treadmill maximal exercise tests v1.0.1 | https://physionet.org/content/treadmill-exercise-cardioresp/1.0.1/ | CC BY-NC-SA 4.0 | `data/malaga/` | training (VO2, VCO2, HR; 857 people) |
| WEEE | https://zenodo.org/records/6420886 | CC BY 4.0 | `data/weee/` | external test and calibration (VO2 Master calorimetry; 17 people) |

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
.venv/Scripts/python.exe -m training.train_calorie_hr        # ~1 min  (Stage 1 experiment)
.venv/Scripts/python.exe -m training.calibrate_calorie_hr    # ~10 s   (writes calorie_energy.json)
.venv/Scripts/python.exe -m training.train_calorie_gym_comparison  # ~10 s (slide design, comparison only)
.venv/Scripts/python.exe -m training.data_foodcom           # ~1.5 min (Stage 2 data + dietary flags)
.venv/Scripts/python.exe -m training.train_meal_recommender # ~30 min  (Stage 2 method comparison)
.venv/Scripts/python.exe -m training.evaluate_meal_rolling  # ~20 min  (Stage 2 final verdict)
.venv/Scripts/python.exe -m training.build_meal_catalog     # ~20 s   (writes meal_catalog.pkl)
.venv/Scripts/python.exe -m training.train_injury_load            # ~25 min (Model 3, runners; bootstrap CIs)
.venv/Scripts/python.exe -m training.train_injury_soccermon_knee  # ~3 min  (Model 3 Part B, exploratory)
.venv/Scripts/python.exe -u -m training.train_trajectory_runs  # ~3.5 h (Model 4, Strava; 4 seeds)
.venv/Scripts/python.exe -u -m training.calibrate_rl_env      # ~5 min  (Model 5 real-data curves)
.venv/Scripts/python.exe -u -m training.train_rl_ppo          # ~25 min (Model 5 round 1)
.venv/Scripts/python.exe -u -m training.train_rl_ppo_round2   # ~50 min (Model 5 round 2)
```

| Script | Artifacts |
|---|---|
| `train_calorie_hr.py` | `calorie_hr_model.pkl` (served, with calibration), `reports/calorie_hr.json`, `reports/calorie_hr_bland_altman.png` |
| `train_calorie_gym_comparison.py` | `calorie_gym_comparison.pkl` (comparison only, not served), `reports/calorie_gym_comparison.json`, `reports/calorie_gym_*.png` |
| `train_meal_hybrid.py` | `meal_hybrid.pkl` (weights + decision), `reports/meal_hybrid.json`, `reports/meal_hybrid_rolling.png` |
| `build_meal_hybrid_serving.py` | `meal_hybrid_serving.pkl` (served; `--cutoff 2018-01-01 --out meal_hybrid_demo.pkl` for the demo) |
| `build_exercise_index.py` | `exercise_index.pkl` (served), `reports/exercise_recommender.json` |
| `calibrate_calorie_hr.py` | `calorie_energy.json` (served calibration: XGBoost + Keytel fallback), `reports/calorie_hr_calibration.json`, `reports/calorie_hr_calibration.png` |
| `data_foodcom.py` | `data/processed/foodcom_*.pkl`, vegetarian audit sheets |
| `train_meal_recommender.py` | `meal_recommender.pkl` (evaluated, not served), `reports/meal_recommender.json` |
| `evaluate_meal_rolling.py` | `reports/meal_recommender_rolling.json` + `.png` (decision: DROP ML) |
| `build_meal_catalog.py` | `meal_catalog.pkl` (served), `reports/meal_catalog.json` |
| `train_injury_load.py` | `injury_load_model.pkl` (carries `serve`; currently False), `reports/injury_load.json`, `reports/injury_load_*.png` |
| `train_injury_soccermon_knee.py` | `reports/injury_soccermon_knee.json` + `.png` (exploratory, no artifact) |
| `train_injury.py` | RETIRED (circular proxy labels); `injury_risk_model.pkl` is no longer loaded |
| `train_trajectory_runs.py` | `trajectory_runs.pt` + `trajectory_runs_meta.json` (served), `reports/trajectory_runs.json` + `.png` |
| `train_transformer.py` | RETIRED (pseudo-sequences); `transformer_model.pt` is no longer loaded |
| `calibrate_rl_env.py` | `rl_calibration.json` (read by the trainers), `reports/rl_calibration.json` + `.png` |
| `train_rl_ppo.py` | `rl_ppo_agent.zip` + `rl_ppo_meta.json` (serve=false), `reports/rl_ppo.json` + `.png`, `reports/rl_ppo_logs/` |
| `train_rl_ppo_round2.py` | `rl_ppo_agent_round2.zip` (not served), `reports/rl_ppo_round2.json` + `.png` |
| `train_rl_agent.py` | RETIRED (completion reward, seeded pilot calibration); `fitfusion_rl_agent.zip` is no longer loaded |

Everything in `models/` is gitignored — artifacts are produced by training and
shipped out of band.

## Running on Google Colab

The scripts are plain modules with no notebook dependency, so a Colab cell only
needs the repo and the requirements:

```python
!git clone <your-repo-url> fitfusion && cd fitfusion/ml-service && pip install -r requirements.txt
%cd fitfusion/ml-service
!python -m training.train_injury
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
