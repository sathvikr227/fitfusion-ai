"""Model 3 teacher demo — training-load injury risk with rule-based body regions.

Shows the data and label, the class balance, a prediction for the labelled input
in sample_input.json (or a file you pass) with its SHAP breakdown, real held-out
athletes, the same request answered by the FastAPI endpoint, and the evaluation.

Run from ml-service/:

    .venv\\Scripts\\python.exe demos\\model3_injury\\demo.py
    .venv\\Scripts\\python.exe demos\\model3_injury\\demo.py my_input.json

Everything printed is computed now from the data and models/ files; nothing is
hardcoded. Output is saved to outputs/demo_output.txt and outputs/demo_output.json.
"""

from __future__ import annotations

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
import xgboost  # noqa: E402

from app.features import INJURY_LABELS, canonical_injuries  # noqa: E402
from app.injury_load import APP_FEATURES, features_from_days, platt, predict_overall, region_levels  # noqa: E402
from app.routers.injury import loaded_regions  # noqa: E402

MODEL_DIR = ML_SERVICE / "models"
REPORTS = MODEL_DIR / "reports"
OUT = HERE / "outputs"
RESULT: dict = {}


def section(title: str) -> None:
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def main() -> None:
    OUT.mkdir(exist_ok=True)
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else HERE / "sample_input.json"
    sample = json.loads(input_path.read_text(encoding="utf-8"))
    bundle = joblib.load(MODEL_DIR / "injury_load_model.pkl")
    report = load_json(REPORTS / "injury_load.json")

    section("1. Why Model 3 was rebuilt")
    old = load_json(REPORTS / "injury_risk.json")
    if old:
        knee = old["metrics"]["per_label"]["knee"]
        print(f"  Old model: {old['algorithm']} on {old['dataset']} ({old['rows']} rows).")
        print(f"  Its knee label was made by a rule over its own inputs: {knee['label_rule'][:90]}...")
        print(f"  Old knee F1 = {knee['f1']}: the model re-learned the rule. It never saw an injury.")
    print("  New model: real injuries of 74 runners (Part A, evaluated; NOT served, failed its rule) + real body-part")
    print("  reports from SoccerMon (Part B, exploratory only). See PROTOCOL.md.")

    section("2. The training data and its label (runners, CC0)")
    from training.data_runners import funnel, load_runners

    data = load_runners()
    f = funnel(data)
    for key, value in f.items():
        print(f"  {key:42s} {value}")
    print("  Label: injury on the event day (1) or not (0). Features: the 7 days before it.")
    print(f"  Class balance: {f['injury_days']:,} injury days vs {f['rows'] - f['injury_days']:,} "
          f"non-injury days → 1 in {round(1 / f['prevalence'])}.")
    RESULT["data"] = f

    section("3. Labelled sample input → model features")
    print(f"  Input file: {input_path.name}")
    print(f"  {sample.get('_label', '')}")
    print(f"  {'date':12s} {'sessions':>8s} {'run km':>7s} {'strength':>8s} {'other cardio h':>14s}")
    for day in sample["recent_days"]:
        print(f"  {day.get('date', ''):12s} {day['sessions']:>8} {day['total_km']:>7} {day['strength']:>8} {day['alt_hours']:>14}")
    row = features_from_days(sample["recent_days"])
    print("  Derived: " + ", ".join(f"{k} = {row[k]:g}" for k in APP_FEATURES if not k.split("_")[-1].startswith("d")))

    section("4. Prediction: overall risk (ML) + body regions (rules)")
    overall = predict_overall(bundle, row)
    elevated = overall >= bundle["threshold"]
    recorded = set(canonical_injuries(sample.get("prior_injuries", [])))
    loaded = loaded_regions(sample.get("recent_exercises", []))
    risk, basis = region_levels(recorded, loaded, elevated)
    print(f"  Model served: {bundle['serve']}  ({bundle['model_version']}, config {bundle['config']})")
    print(f"  Overall risk of an injury tomorrow: {overall:.4f}  "
          f"= {overall / bundle['prevalence']:.2f}x the training injury rate ({bundle['prevalence']:.4f})")
    print(f"  Elevated? {elevated}  (threshold {bundle['threshold']:.4f}, chosen on development athletes)")
    print(f"  Recorded injury regions: {sorted(recorded) or '-'};  loaded by recent exercises: {sorted(loaded) or '-'}")
    for region in INJURY_LABELS:
        flag = "FLAGGED" if risk[region] >= 0.7 else ""
        print(f"    {region:10s} level {risk[region]:.1f}  {basis[region]:58s} {flag}")
    print("  Levels are rule levels, not probabilities. Informational only, not a diagnosis.")
    RESULT["sample"] = {"overall_risk": overall, "elevated": bool(elevated), "risk": risk, "basis": basis}

    section("5. Why: SHAP contributions for this input (log-odds, before calibration)")
    x = np.array([[row[n] for n in APP_FEATURES]])
    contribs = bundle["model"].get_booster().predict(xgboost.DMatrix(x, feature_names=APP_FEATURES),
                                                     pred_contribs=True)[0]
    order = np.argsort(np.abs(contribs[:-1]))[::-1][:8]
    print(f"  base value {contribs[-1]:+.3f}")
    for i in order:
        print(f"    {APP_FEATURES[i]:16s} = {row[APP_FEATURES[i]]:<6g} → {contribs[i]:+.3f}")
    fig, ax = plt.subplots(figsize=(7, 4))
    names = [APP_FEATURES[i] for i in order][::-1]
    values = [contribs[i] for i in order][::-1]
    ax.barh(names, values, color=["#dc2626" if v > 0 else "#16a34a" for v in values])
    ax.axvline(0, color="k", lw=0.8)
    ax.set(title="Sample input: top SHAP contributions (red raises risk)", xlabel="log-odds contribution")
    fig.tight_layout()
    fig.savefig(OUT / "shap_sample.png", dpi=130)
    plt.close(fig)
    print(f"  [saved] outputs/shap_sample.png")

    section("6. Real held-out athletes (never used in training or tuning)")
    if report:
        test_ids = report["split"]["test"]["athlete_ids"]
        test = data[data["athlete"].isin(test_ids)]
        raw = bundle["model"].predict_proba(test[APP_FEATURES].to_numpy())[:, 1]
        p = platt(raw, bundle["platt_a"], bundle["platt_b"])
        y = test["injury"].to_numpy()
        print(f"  {len(test_ids)} test athletes, {len(test):,} days, {int(y.sum())} injuries")
        print(f"  Mean predicted risk on injury days    : {p[y == 1].mean():.4f}")
        print(f"  Mean predicted risk on non-injury days: {p[y == 0].mean():.4f}")
        flagged = p >= bundle["threshold"]
        print(f"  At the threshold: {int((flagged & (y == 1)).sum())} of {int(y.sum())} injury days flagged, "
              f"{int((flagged & (y == 0)).sum()):,} of {int((y == 0).sum()):,} non-injury days flagged")
        first_injury = test[test["injury"] == 1].iloc[0]
        print(f"  Example — athlete {int(first_injury['athlete'])}, day {int(first_injury['day'])} (injured): "
              f"7-day km {first_injury['total_km_7d']:g}, sessions {first_injury['sessions_7d']:g} → risk "
              f"{float(platt(bundle['model'].predict_proba(first_injury[APP_FEATURES].to_numpy(dtype=float).reshape(1, -1))[0, 1], bundle['platt_a'], bundle['platt_b'])):.4f}")
        RESULT["held_out"] = {"mean_risk_injury_days": float(p[y == 1].mean()),
                              "mean_risk_other_days": float(p[y == 0].mean())}

    section("7. Same request through the FastAPI endpoint")
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    settings.ML_SERVICE_API_KEY = "demo-key"
    with TestClient(app) as client:
        body = {k: v for k, v in sample.items() if not k.startswith("_")}
        resp = client.post("/predict/injury-risk", json=body, headers={"Authorization": "Bearer demo-key"})
    shown = {k: v for k, v in resp.json().items() if k != "features_used"}
    print(f"  HTTP {resp.status_code}")
    print("  " + json.dumps(shown, indent=2).replace("\n", "\n  "))
    RESULT["api_response"] = resp.json()

    section("8. Evaluation evidence (models/reports, written by the training scripts)")
    if report:
        print(f"  Test athletes: {report['split']['test']['athletes']}, injuries {report['split']['test']['injuries']}")
        print(f"  {'model':12s} {'ROC-AUC [95% CI]':24s} {'PR-AUC':>7s} {'F1':>6s} {'recall':>7s}")
        for name, m in report["test"].items():
            c = m.get("ci95", {}).get("roc_auc")
            auc = f"{m['roc_auc']:.3f}" + (f" [{c[0]:.3f}, {c[1]:.3f}]" if c else "")
            t = m.get("at_threshold", {})
            print(f"  {name:12s} {auc:24s} {m['pr_auc']:>7.3f} {t.get('f1', float('nan')):>6.3f} "
                  f"{t.get('recall', float('nan')):>7.3f}")
        for name, d in report["auc_differences"].items():
            print(f"  {name:28s} ΔAUC {d['difference']:+.3f} [{d['ci95'][0]:+.3f}, {d['ci95'][1]:+.3f}]")
        print(f"  Decision: {report['decision']}")
    knee = load_json(REPORTS / "injury_soccermon_knee.json")
    if knee:
        print(f"  Part B (SoccerMon knee, exploratory): {knee['funnel']['knee_episodes']} episodes from "
              f"{knee['funnel']['knee_players']} players")
        for name, m in knee["out_of_fold"].items():
            c = m.get("roc_auc_ci95")
            print(f"    {name:10s} ROC-AUC {m['roc_auc']:.3f}" + (f" [{c[0]:.3f}, {c[1]:.3f}]" if c else ""))

    (OUT / "demo_output.json").write_text(json.dumps(RESULT, indent=2, default=float), encoding="utf-8")
    print(f"\n[saved] {OUT / 'demo_output.json'}")


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
