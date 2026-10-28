# Model 1 — XGBoost + SHAP calorie burn predictor (teacher demo)

**What it does.** It estimates the calories burned in a cardio session from average heart rate,
age, sex, height, weight and duration, and explains each estimate with SHAP. It replaces the
app's static MET-table lookup when a heart rate is logged.

**What is served**
- An XGBoost regressor trained on real lab calorimetry from the Malaga treadmill dataset
  (840 people).
- A linear correction fitted on a second lab dataset (WEEE, 16 people).
- The Keytel (2005) equation, calibrated the same way, as the fallback.
- The MET table for sessions the model isn't validated for: non-cardio work, no heart rate, or a
  heart rate outside 83.5–182.7 bpm.

**Comparison model, not served.** The slide design (XGBoost on the Kaggle Gym Members dataset) is
trained and evaluated here too, and `RESULTS.md` explains why it is not used.

| File | Contents |
|---|---|
| `DATA_SOURCES.md` | the three datasets: links, licences, counts, cleaning, limitations |
| `RESULTS.md` | every metric, the baselines, the targets, and whether they were met |
| `demo.py` | the demonstration: loads the artifacts, predicts, explains, calls the API |
| `sample_input.json` | the labelled example input |
| `outputs/demo_output.txt` | the actual output of `demo.py` |
| `outputs/shap_waterfall_sample.png` | SHAP explanation of the sample prediction |
| `outputs/sample_cleaned_*.csv`, `outputs/malaga_cleaning_funnel.json` | cleaned training and test rows |
| `outputs/test_results.txt` | the 40 calorie and API tests and their results |

Code, kept where the service uses it:

| Path | Role |
|---|---|
| `training/data_malaga.py`, `training/data_weee.py` | load and clean the datasets |
| `training/train_calorie_hr.py` | train, cross-validate, run the external test, save the model |
| `training/calibrate_calorie_hr.py` | leave-one-participant-out calibration; writes the served calibration |
| `training/train_calorie_gym_comparison.py` | the Gym Members comparison model |
| `app/calorie_model.py` | the inference function with SHAP, shared by the API, this demo and the tests |
| `app/routers/calorie.py` | `POST /predict/calories` |
| `tests/test_model1_calorie.py` | 20 tests: loading, inference, SHAP, invalid and missing input |

## 1. Setup (Windows, from `ml-service\`)

```powershell
cd ml-service
py -3.11 -m venv .venv            # skip if .venv already exists
.venv\Scripts\pip install -r requirements.txt
```

The code was run with Python 3.12.10, xgboost 3.4.1, shap 0.52.0, scikit-learn 1.9.0 and
pandas 3.0.5.

**Datasets.** These are needed only for training and for the `--samples` export, not for the demo.
Download them into `ml-service\data\`:
- Malaga: https://physionet.org/content/treadmill-exercise-cardioresp/1.0.1/. Extract the folder
  into `data\malaga\`.
- WEEE: https://zenodo.org/records/6420886, `dataset.zip`. Extract it to `data\weee\dataset\`.
- Gym Members: https://www.kaggle.com/datasets/valakhorasani/gym-members-exercise-dataset. Save
  the CSV as `data\gym_members_exercise_tracking.csv`.

**Artifacts.** `models\calorie_hr_model.pkl` and `models\calorie_energy.json` are gitignored, like
every model artifact in this repo. They are produced by step 3 below.

## 2. Run the demonstration

```powershell
.venv\Scripts\python.exe demos\model1_calorie\demo.py
```

It prints, in this order:
1. The artifacts it loaded, with SHA-256 fingerprints and the tree count.
2. The input.
3. The raw model output and the calibrated kcal/min and kcal.
4. The SHAP breakdown, checked against the `shap` library.
5. The same request answered by the FastAPI endpoint.
6. The evaluation evidence from the reports.

Everything is computed when you run it. Change `heart_rate` in `sample_input.json` (or pass your
own JSON file) and the prediction and SHAP values change.

```powershell
.venv\Scripts\python.exe demos\model1_calorie\demo.py my_input.json
.venv\Scripts\python.exe demos\model1_calorie\demo.py --samples      # also export cleaned data samples
```

## 3. Re-train from scratch (about 1.5 minutes on a laptop CPU)

```powershell
.venv\Scripts\python.exe -m training.train_calorie_hr                # Malaga train + WEEE external test
.venv\Scripts\python.exe -m training.calibrate_calorie_hr            # calibration + served artifact
.venv\Scripts\python.exe -m training.train_calorie_gym_comparison    # Gym Members comparison
```

The seed is fixed (`RANDOM_SEED = 42`), so a re-run reproduces the reports exactly.

## 4. Tests

```powershell
.venv\Scripts\python.exe -m pytest tests\test_model1_calorie.py -v
.venv\Scripts\python.exe -m pytest -q                                # whole ML service
```

## 5. Through the API and the app

```powershell
$env:ML_SERVICE_API_KEY = "local-demo"
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
# in a second window:
curl.exe -X POST http://127.0.0.1:8000/predict/calories -H "Authorization: Bearer local-demo" -H "Content-Type: application/json" -d "{\"age\":21,\"sex\":\"male\",\"height_cm\":175,\"weight_kg\":72,\"avg_hr\":150,\"duration_min\":30,\"exercise\":\"Running\"}"
```

In FitFusion, go to Progress → Cardio and log a run with an average heart rate. For this to work,
`web\.env.local` needs `ML_SERVICE_URL=http://localhost:8000`, and `ML_SERVICE_API_KEY` must equal
the value above. The confirmation then says "estimated by the XGBoost model" and lists the SHAP
factors. Without a height in your profile, the app uses the Keytel fallback and says so in the
response (`fallback_reason`).

## Response format (`POST /predict/calories`)

| Field | Meaning |
|---|---|
| `calories`, `kcal_per_min` | the estimate |
| `estimator` | `xgboost`, `keytel` or `met`: which method produced the number |
| `method` | `heart_rate` or `met_table` |
| `validated` | true only for the heart-rate methods |
| `expected_error_kcal_per_min` | the held-out MAE of the method used |
| `explanation` | `base_kcal_per_min` + the sum of `contributions` = `kcal_per_min`; also the `inputs` and `raw_model_kcal_per_min` |
| `warnings` | inputs outside the training range (age 14–55, height 156–195 cm, weight 49–104 kg, HR 72–189) |
| `reason` / `fallback_reason` | why MET or Keytel was used instead of the model |

Invalid values return HTTP 422 with the field and the allowed range: height outside 100–250 cm,
age outside 10–100, HR outside 30–230, or a non-numeric value.

## Limitations

- **XGBoost ties Keytel once both are calibrated** (MAE 1.27 vs 1.29, p = 0.16). It is served
  because the project requires an explainable XGBoost model, not because it is more accurate.
- Validated for cardio only: cycling and treadmill walking and running. Strength, yoga and HIIT
  use the MET table.
- The training population is mostly male athletes, and the calibration set has only 16 people.
- The expected error is ±1.27 kcal/min, about ±38 kcal per 30 minutes. The slides' 25 kcal
  target is not met.
- These are estimates for fitness tracking, not medical measurements.
