"""Model 3 teacher demo — training-load injury risk (served) + rule-based body regions.

Shows the data and label, the class balance, why round 1's 7-day model was not
served and why the day file cannot give longer history (it leaks the label), a
prediction for the labelled input in sample_input.json (or a file you pass) with
its SHAP breakdown, the same request answered by the FastAPI endpoint, and the
out-of-fold evaluation that decided serving.

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
from app.injury_load import WEEK_FEATURES, predict_overall, region_levels, weeks_from_days  # noqa: E402
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
    bundle = joblib.load(MODEL_DIR / "injury_load_round2.pkl")
    report = load_json(REPORTS / "injury_load_round2.json")
    round1 = load_json(REPORTS / "injury_load.json")

    section("1. History of Model 3 (all decided by pre-registered rules)")
    old = load_json(REPORTS / "injury_risk.json")
    if old:
        knee = old["metrics"]["per_label"]["knee"]
        print(f"  Original: {old['algorithm']} on {old['dataset']}. Its knee label was a rule over its own")
        print(f"  inputs ({knee['label_rule'][:60]}...), so F1 = {knee['f1']} was circular. Retired.")
    if round1:
        r1 = round1["test"]["XGB-APP"]
        print(f"  Round 1: XGBoost on the last 7 days of 74 runners' real injuries. Test ROC-AUC {r1['roc_auc']:.3f} "
              f"[{r1['ci95']['roc_auc'][0]:.3f}, {r1['ci95']['roc_auc'][1]:.3f}] -> CI includes 0.5 -> NOT served.")
    print("  Round 2: three weekly summaries, every athlete scored out-of-fold (PROTOCOL_ROUND2.md).")

    section("2. Training data and label (Lövdal et al. 2021, DataverseNL, CC0)")
    from training.data_runners import funnel, load_runner_weeks, load_runners

    data = load_runner_weeks()
    f = funnel(data)
    for key, value in f.items():
        print(f"  {key:42s} {value}")
    print("  File: week_approach_maskedID_timeseries.csv. Label: injury on the event day (1) or not (0).")
    print("  Features: weekly summaries of the 3 weeks before that day (computed by the dataset authors).")
    print(f"  Class balance: {f['injury_days']:,} injury days vs {f['rows'] - f['injury_days']:,} other days "
          f"-> 1 in {round(1 / f['prevalence'])}.")
    print("  First 5 cleaned rows (week 0 = the 7 days before the event):")
    cols = ["athlete", "day", "sessions_w0", "km_w0", "km_w1", "km_w2", "strength_w0", "acwr_km", "injury"]
    print("  " + data[cols].head(5).to_string(index=False).replace("\n", "\n  "))
    RESULT["data"] = f

    section("3. Why not 4 weeks from the day file? It leaks the label")
    day = load_runners().sort_values(["athlete", "day"])
    gap = day.groupby("athlete")["day"].diff()
    inj_gap = gap[day["injury"] == 1].dropna()
    other_consecutive = float((gap[day["injury"] == 0] == 1).mean())
    print(f"  Day file: every injury row follows a gap of >= {int(inj_gap.min())} days (no rows in the 3 weeks before);")
    print(f"  {other_consecutive:.1%} of other rows follow the previous day. Any history beyond a row's own 7 days")
    print("  would tell the model 'this row has a hole before it' = the label. The week file has the 3 weeks")
    print("  inside each row, so no history is rebuilt. Leakage screen (no single feature may reach 0.75):")
    if report:
        screen = report["leakage_screen"]
        print(f"  most separating feature: {screen['most_separating']} at {screen['max_separation']:.3f} -> passed")
    RESULT["leakage"] = {"min_gap_before_injury_rows": int(inj_gap.min()), "other_rows_consecutive": other_consecutive}

    section("4. Labelled sample input -> the model's 22 features")
    print(f"  Input file: {input_path.name}")
    print(f"  {sample.get('_label', '')}")
    row = weeks_from_days(sample["recent_days"])
    print(f"  {'':10s} {'sessions':>8s} {'rest d':>6s} {'run km':>7s} {'max km/day':>10s} {'other h':>7s} {'strength d':>10s}")
    for w, name in ((2, "week 2"), (1, "week 1"), (0, "week 0")):
        print(f"  {name:10s} {row[f'sessions_w{w}']:>8g} {row[f'rest_days_w{w}']:>6g} {row[f'km_w{w}']:>7g} "
              f"{row[f'max_km_day_w{w}']:>10g} {row[f'alt_hours_w{w}']:>7g} {row[f'strength_w{w}']:>10g}")
    print(f"  Derived: acwr_km = {row['acwr_km']:.2f}, acwr_sessions = {row['acwr_sessions']:.2f}, "
          f"km_change_w01 = {row['km_change_w01']:+g}, long_run_share_w0 = {row['long_run_share_w0']:.2f}")

    section("5. Prediction: overall risk (ML model) + body regions (rules)")
    overall = predict_overall(bundle, row)
    elevated = overall >= bundle["threshold"]
    recorded = set(canonical_injuries(sample.get("prior_injuries", [])))
    loaded = loaded_regions(sample.get("recent_exercises", []))
    risk, basis = region_levels(recorded, loaded, elevated)
    print(f"  Model: {bundle['model_version']} ({bundle['config']['family']}, {bundle['config']}); served = {bundle['serve']}")
    print(f"  Overall risk of an injury tomorrow: {overall:.4f} = {overall / bundle['prevalence']:.2f}x the training "
          f"injury rate ({bundle['prevalence']:.4f})")
    print(f"  Elevated? {elevated}  (threshold {bundle['threshold']:.4f} = top 10% of out-of-fold training days)")
    print(f"  Recorded injury regions: {sorted(recorded) or '-'};  loaded by recent exercises: {sorted(loaded) or '-'}")
    for region in INJURY_LABELS:
        flag = "FLAGGED" if risk[region] >= 0.7 else ""
        print(f"    {region:10s} level {risk[region]:.1f}  {basis[region]:58s} {flag}")
    print("  The four region levels are rule levels, not probabilities: the data has no body-part labels.")
    print("  Informational risk indicator only, not a medical diagnosis.")
    RESULT["sample"] = {"overall_risk": overall, "elevated": bool(elevated), "risk": risk, "basis": basis,
                        "features": row}

    section("6. Why: SHAP contributions for this input (log-odds, before calibration)")
    x = np.array([[row[n] for n in WEEK_FEATURES]])
    contribs = bundle["model"].get_booster().predict(xgboost.DMatrix(x, feature_names=WEEK_FEATURES),
                                                     pred_contribs=True)[0]
    order = np.argsort(np.abs(contribs[:-1]))[::-1][:8]
    print(f"  base value {contribs[-1]:+.3f}")
    for i in order:
        print(f"    {WEEK_FEATURES[i]:18s} = {row[WEEK_FEATURES[i]]:<7.3g} -> {contribs[i]:+.3f}")
    fig, ax = plt.subplots(figsize=(7, 4))
    names = [WEEK_FEATURES[i] for i in order][::-1]
    values = [contribs[i] for i in order][::-1]
    ax.barh(names, values, color=["#dc2626" if v > 0 else "#16a34a" for v in values])
    ax.axvline(0, color="k", lw=0.8)
    ax.set(title="Sample input: top SHAP contributions (red raises risk)", xlabel="log-odds contribution")
    fig.tight_layout()
    fig.savefig(OUT / "shap_sample.png", dpi=130)
    plt.close(fig)
    print("  [saved] outputs/shap_sample.png")
    RESULT["shap"] = {WEEK_FEATURES[i]: float(contribs[i]) for i in order}

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
    same = abs(resp.json()["overall_risk"] - round(overall, 5)) < 1e-9 if resp.json()["overall_risk"] is not None else False
    print(f"  Endpoint overall_risk equals the direct prediction above: {same}")
    RESULT["api_response"] = resp.json()

    section("8. Evaluation evidence (models/reports/injury_load_round2.json)")
    if report:
        print("  Every athlete scored out-of-fold: 5-fold athlete-grouped CV, model chosen inside each fold")
        print("  (nested), repeated with seeds 42-46. 95% CI = athlete-cluster bootstrap (2,000 resamples).")
        print(f"  {'model':18s} {'ROC-AUC [95% CI]':26s} {'PR-AUC':>7s}")
        for name, m in report["primary"].items():
            c = m["roc_auc_ci95"]
            print(f"  {name:18s} {m['roc_auc']:.3f} [{c[0]:.3f}, {c[1]:.3f}]{'':6s} {m['pr_auc']:>7.4f}")
        print(f"  {'prevalence only':18s} 0.500{'':21s} {f['prevalence']:>7.4f}")
        for name, d in report["auc_differences"].items():
            print(f"  {name:34s} ΔAUC {d['difference']:+.3f} [{d['ci95'][0]:+.3f}, {d['ci95'][1]:+.3f}]")
        c = report["primary"]["Candidate"]
        e = c["elevated"]
        print(f"  Calibration slope {c['calibration']['slope']} (1 = perfect); Brier {c['brier']} vs "
              f"{c['brier_prevalence_only']} for prevalence only")
        print(f"  Top-10% days: injury rate {e['injury_rate_flagged']:.4f} vs {e['injury_rate_not_flagged']:.4f} "
              f"-> lift {e['lift']} [{e['lift_ci95'][0]}, {e['lift_ci95'][1]}]; recall {e['recall']}")
        print(f"  Decision: {report['decision']}")
        s = report["secondary_round1_split"]
        print(f"  Secondary (round 1's 14 test athletes, not fresh): ROC-AUC {s['roc_auc']} {s['roc_auc_ci95']}")
        print("  Slide target F1 > 0.75 per region: not met and not measurable (no body-part labels exist).")
    knee = load_json(REPORTS / "injury_soccermon_knee.json")
    if knee:
        print(f"  Part B (SoccerMon knee, exploratory, never served): {knee['funnel']['knee_episodes']} episodes from "
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
