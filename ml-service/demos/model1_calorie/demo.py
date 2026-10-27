"""Model 1 teacher demo — calibrated XGBoost calorie model with SHAP.

Loads the trained artifacts, runs one prediction for the input in
sample_input.json (or a file you pass), prints the SHAP breakdown, saves a SHAP
waterfall plot, and shows the same request answered by the FastAPI endpoint.

Run from ml-service/:

    .venv\\Scripts\\python.exe demos\\model1_calorie\\demo.py
    .venv\\Scripts\\python.exe demos\\model1_calorie\\demo.py my_input.json
    .venv\\Scripts\\python.exe demos\\model1_calorie\\demo.py --samples   # also export cleaned-data samples

Everything printed is computed now from the files in models/; nothing is
hardcoded. Output is also written to outputs/demo_output.txt.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_SERVICE = HERE.parent.parent
sys.path.insert(0, str(ML_SERVICE))
os.chdir(ML_SERVICE)
os.environ.setdefault("ML_SERVICE_API_KEY", "demo-key")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

import joblib  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shap  # noqa: E402

from app.calorie_model import check_bundle, predict_with_explanation  # noqa: E402
from app.energy import CALORIE_HR_FEATURES, keytel_kcal_per_min  # noqa: E402

MODEL_DIR = ML_SERVICE / "models"
OUT = HERE / "outputs"
LABELS = {"age": "Age (years)", "is_female": "Female (1 yes, 0 no)", "height_cm": "Height (cm)",
          "weight_kg": "Weight (kg)", "hr": "Average heart rate (bpm)"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def section(title: str) -> None:
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def export_samples() -> None:
    """Write 20 cleaned rows of each training/test dataset for the viva."""
    from training.data_malaga import load_malaga_windows
    from training.data_weee import load_weee_segments

    malaga, funnel = load_malaga_windows(verbose=False)
    malaga.head(20).to_csv(OUT / "sample_cleaned_malaga_training_windows.csv", index=False)
    (OUT / "malaga_cleaning_funnel.json").write_text(json.dumps(funnel, indent=2), encoding="utf-8")
    for step in funnel:
        print(f"    {step}")
    weee = load_weee_segments()
    weee[weee["included"] & weee["is_exercise"]].head(20).to_csv(
        OUT / "sample_cleaned_weee_test_segments.csv", index=False)
    people = next((c for c in ("person_id", "ID") if c in malaga), None)
    print(f"  Malaga training windows: {len(malaga):,} rows"
          + (f" from {malaga[people].nunique()} people" if people else ""))
    print(f"  WEEE exercise test segments used: {int((weee['included'] & weee['is_exercise']).sum())}")
    print(f"  wrote {OUT / 'sample_cleaned_malaga_training_windows.csv'}")
    print(f"  wrote {OUT / 'sample_cleaned_weee_test_segments.csv'}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    input_path = Path(args[0]) if args else HERE / "sample_input.json"
    session = json.loads(input_path.read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)

    print("=" * 72)
    print("  FitFusion Model 1 — calibrated XGBoost energy-expenditure model + SHAP")
    print("=" * 72)

    section("1. Trained artifacts loaded from disk")
    model_path = MODEL_DIR / "calorie_hr_model.pkl"
    energy_path = MODEL_DIR / "calorie_energy.json"
    bundle = joblib.load(model_path)
    check_bundle(bundle)
    energy = json.loads(energy_path.read_text(encoding="utf-8"))
    booster = bundle["model"].get_booster()
    print(f"  model        {model_path.name}  sha256 {sha256(model_path)}…  ({type(bundle['model']).__name__}, "
          f"{booster.num_boosted_rounds()} trees, version {bundle['model_version']})")
    print(f"  calibration  {energy_path.name}  sha256 {sha256(energy_path)}…  ({energy['model_version']})")
    print(f"  features     {CALORIE_HR_FEATURES}")
    print(f"  calibration  kcal/min = {energy['model_intercept']} + {energy['model_slope']} × XGBoost output")

    section(f"2. Input ({input_path.name}) — {session.get('_label', 'user-supplied example')}")
    inputs = {k: session[k] for k in ("age", "sex", "height_cm", "weight_kg", "avg_hr", "duration_min")}
    for k, v in inputs.items():
        print(f"  {k:13s} {v}")

    pred = predict_with_explanation(
        bundle, energy, age=session["age"], is_female=session["sex"].lower() == "female",
        height_cm=session["height_cm"], weight_kg=session["weight_kg"], hr=session["avg_hr"],
    )
    minutes = float(session["duration_min"])

    section("3. Prediction")
    print(f"  XGBoost raw output           {pred.raw_model_kcal_per_min:7.3f} kcal/min")
    print(f"  after WEEE calibration       {pred.kcal_per_min:7.3f} kcal/min")
    print(f"  session ({minutes:g} min)            {pred.kcal_per_min * minutes:7.1f} kcal")
    print(f"  expected error (held-out)    ±{energy['model_expected_mae_kcal_per_min']} kcal/min "
          f"(≈ ±{energy['model_expected_mae_kcal_per_min'] * minutes:.0f} kcal for this session)")
    keytel = energy["intercept"] + energy["slope"] * float(keytel_kcal_per_min(
        session["avg_hr"], session["weight_kg"], session["age"], session["sex"].lower() == "female"))
    met = 7.5 * session["weight_kg"] * minutes / 60
    print(f"  for comparison: calibrated Keytel {keytel * minutes:.1f} kcal, MET table {met:.1f} kcal")
    for w in pred.warnings:
        print(f"  WARNING: {w}")

    section("4. SHAP explanation (kcal/min, after calibration)")
    print(f"  baseline (average training prediction)   {pred.base_kcal_per_min:+.3f}")
    for name, value in sorted(pred.contributions.items(), key=lambda kv: -abs(kv[1])):
        print(f"  {LABELS[name]:40s} {value:+.3f}   (input {pred.inputs[name]:g})")
    total = pred.base_kcal_per_min + sum(pred.contributions.values())
    print(f"  {'sum = prediction':40s} {total:+.3f}   (model said {pred.kcal_per_min:.3f})")

    # Same numbers through the shap library, drawn as a waterfall.
    row = np.array([[pred.inputs[n] for n in CALORIE_HR_FEATURES]])
    explainer = shap.TreeExplainer(bundle["model"])
    values = explainer.shap_values(row)[0] * energy["model_slope"]
    base = energy["model_intercept"] + energy["model_slope"] * float(np.ravel(explainer.expected_value)[0])
    explanation = shap.Explanation(values=values, base_values=base, data=row[0],
                                   feature_names=[LABELS[n] for n in CALORIE_HR_FEATURES])
    shap.plots.waterfall(explanation, show=False)
    plt.title("Why this estimate? SHAP contributions (kcal/min)")
    plt.tight_layout()
    plt.savefig(OUT / "shap_waterfall_sample.png", dpi=130, bbox_inches="tight")
    plt.close()
    print(f"  shap library agrees: max difference {np.max(np.abs(values - np.array([pred.contributions[n] for n in CALORIE_HR_FEATURES]))):.5f} kcal/min")
    print(f"  saved {OUT / 'shap_waterfall_sample.png'}")

    section("5. Same request through the FastAPI endpoint POST /predict/calories")
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    settings.ML_SERVICE_API_KEY = "demo-key"
    with TestClient(app) as client:
        body = {k: session[k] for k in ("age", "sex", "height_cm", "weight_kg", "avg_hr", "duration_min")}
        body["exercise"] = session.get("exercise", "Running")
        resp = client.post("/predict/calories", json=body, headers={"Authorization": "Bearer demo-key"})
    print(f"  HTTP {resp.status_code}")
    print("  " + json.dumps(resp.json(), indent=2).replace("\n", "\n  "))

    section("6. Evaluation evidence (from models/reports, produced by the training scripts)")
    hr = json.loads((MODEL_DIR / "reports" / "calorie_hr.json").read_text(encoding="utf-8"))
    cal = json.loads((MODEL_DIR / "reports" / "calorie_hr_calibration.json").read_text(encoding="utf-8"))
    cv = hr["cross_validation"]["results"]
    print(f"  Malaga 5-fold CV by person:  XGBoost MAE {cv['xgb_depth2']['mae']} kcal/min, R² {cv['xgb_depth2']['r2']}"
          f"   | Keytel {cv['keytel_2005']['mae']}")
    ext = hr["external_test"]["exercise"]
    print(f"  WEEE external test (16 people, uncalibrated): XGBoost {ext['model_1']['mae']}  Keytel "
          f"{ext['keytel_2005']['mae']}  MET table {ext['fitfusion_met_table']['mae']} kcal/min")
    lin = cal["results"]["linear"]
    p = cal["paired_comparisons"]["calibrated_model_vs_calibrated_keytel"]
    print(f"  WEEE leave-one-person-out, calibrated: XGBoost {lin['model_1']['mae']}  Keytel "
          f"{lin['keytel_2005']['mae']}  MET {lin['fitfusion_met_table']['mae']} kcal/min  "
          f"(XGBoost vs Keytel Wilcoxon p = {p['wilcoxon_p']})")
    gym_path = MODEL_DIR / "reports" / "calorie_gym_comparison.json"
    if gym_path.exists():
        gym = json.loads(gym_path.read_text(encoding="utf-8"))
        t = gym["test_results"]
        print(f"  Gym Members comparison (slide design, 20% test): MAE {t['xgb_slide_features']['mae']} kcal "
              f"(target < 25: {'met' if gym['target_met_with_slide_features'] else 'NOT met'}); "
              f"labels explained R² {gym['label_checks']['r2_keytel_form_linear_model_all_rows']} by a Keytel-form formula")

    if "--samples" in sys.argv:
        section("7. Cleaned data samples")
        export_samples()


if __name__ == "__main__":
    buffer = io.StringIO()

    class Tee(io.TextIOBase):
        def write(self, s):
            sys.__stdout__.write(s)
            buffer.write(s)
            return len(s)

    with redirect_stdout(Tee()):
        main()
    (OUT / "demo_output.txt").write_text(buffer.getvalue(), encoding="utf-8")
    print(f"\n[saved] {OUT / 'demo_output.txt'}")
