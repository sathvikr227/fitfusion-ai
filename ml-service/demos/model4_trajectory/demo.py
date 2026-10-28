"""Model 4 teacher demo — Transformer running-trajectory predictor.

Shows why the model was rebuilt, the real data and label, a prediction for the
labelled input in sample_input.json (or a file you pass), real held-out athletes
with the test accuracy recomputed live, the same request through the FastAPI
endpoint, and the evaluation.

Run from ml-service/ (loading the 309 MB of logs takes about 2 minutes):

    .venv\\Scripts\\python.exe demos\\model4_trajectory\\demo.py
    .venv\\Scripts\\python.exe demos\\model4_trajectory\\demo.py my_input.json

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

import numpy as np  # noqa: E402
import torch  # noqa: E402

from app.trajectory_runs import CLASSES, SESSION_FEATURES, RunTransformer, predict_probs  # noqa: E402

MODEL_DIR = ML_SERVICE / "models"
REPORTS = MODEL_DIR / "reports"
OUT = HERE / "outputs"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
RESULT: dict = {}


def section(title: str) -> None:
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def fmt_pace(minutes_per_km: float) -> str:
    m = int(minutes_per_km)
    return f"{m}:{round((minutes_per_km - m) * 60):02d}/km"


def show_window(raw: np.ndarray) -> None:
    print(f"    {'#':>2} {'km':>6} {'hours':>6} {'10k pace':>10} {'gap d':>6} {'day':>4}")
    for i, (km, h, p, gap, dow) in enumerate(raw, 1):
        print(f"    {i:>2} {km:>6.1f} {h:>6.2f} {fmt_pace(p):>10} {gap:>6.0f} {DAYS[int(dow)]:>4}")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    input_path = Path(args[0]) if args else HERE / "sample_input.json"
    sample = json.loads(input_path.read_text(encoding="utf-8"))
    meta = json.loads((MODEL_DIR / "trajectory_runs_meta.json").read_text(encoding="utf-8"))
    report = json.loads((REPORTS / "trajectory_runs.json").read_text(encoding="utf-8"))
    model = RunTransformer()
    model.load_state_dict(torch.load(MODEL_DIR / "trajectory_runs.pt", map_location="cpu", weights_only=True))
    model.eval()

    section("1. Why Model 4 was rebuilt")
    old_path = REPORTS / "transformer.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        print(f"  Old model: {old['dataset']}, accuracy {old['metrics']['accuracy']:.3f}.")
        print("  Its 'sequences' were rows regrouped from a one-off survey, with a proxy completion rate")
        print("  and a made-up weekday. It never saw a real person's sessions in order.")
    print("  FitFusion's own history is seeded/test data (owner, 2026-10-28), so it is not used.")
    print("  New model: real Strava logs, protocol fixed before training (PROTOCOL.md, commit a2de032).")

    section("2. The data and the label")
    f = report["dataset"]["funnel"]
    print(f"  {f['run_days']:,} run-days from {f['athletes']:,} runners (2019-2020), "
          f"{f['run_days_after_cleaning']:,} after cleaning.")
    print(f"  {f['windows']:,} windows of 8 consecutive sessions within 56 days.")
    lab = report["label"]
    print(f"  Label: median 10 km-equivalent pace of sessions 5-8 vs 1-4. IMPROVE if more than "
          f"{-lab['q1']:.1%} faster, REGRESS if more than {lab['q2']:.1%} slower, else PLATEAU")
    print("  (thresholds = tertiles of the training athletes only).")
    for name, s in report["split"].items():
        print(f"    {name:5s} {s['athletes']:>6,} athletes {s['windows']:>8,} windows  {s['class_counts']}")

    section("3. Labelled sample input → prediction")
    print(f"  Input file: {input_path.name}")
    print(f"  {sample.get('_label', '')}")
    from app.routers.trajectory import model_input
    from app.schemas import SessionFeatures

    sessions = [SessionFeatures(**s) for s in sample["sessions"]]
    raw, reason = model_input(sessions)
    if raw is None:
        print(f"  The model cannot read this input: {reason}")
    else:
        show_window(raw)
        probs = predict_probs(model, meta, raw)[0]
        label = CLASSES[int(np.argmax(probs))]
        print("  Probabilities: " + ", ".join(f"{c} {p:.3f}" for c, p in zip(CLASSES, probs)))
        print(f"  Prediction: {label}  (model served in the app: {meta['serve']})")
        RESULT["sample"] = {"probs": dict(zip(CLASSES, map(float, probs))), "label": label}

    section("4. Real held-out athletes (never used in training, tuning or thresholds)")
    from training.data_strava import build_windows, label as make_label, load_runs
    from training.train_trajectory_runs import split_athletes

    runs, _ = load_runs()
    w = build_windows(runs)
    del runs
    test = split_athletes(w["athlete"])["test"]
    y = make_label(w["change"][test], lab["q1"], lab["q2"])
    probs = predict_probs(model, meta, w["x"][test])
    pred = probs.argmax(1)
    acc = float((pred == y).mean())
    print(f"  Test windows: {len(y):,} from {np.unique(w['athlete'][test]).size:,} athletes")
    print(f"  Accuracy recomputed now: {acc:.4f}   (report: {report['test']['Transformer']['accuracy']})")
    ids = np.unique(w["athlete"][test])[:3]
    for athlete in ids:
        i = int(np.flatnonzero(w["athlete"][test] == athlete)[0])
        print(f"\n  Athlete {athlete}, first window — actual {CLASSES[y[i]]} "
              f"(pace change {w['change'][test][i]:+.1%}), predicted {CLASSES[pred[i]]}")
        show_window(w["x"][test][i])
        print("    probabilities: " + ", ".join(f"{c} {p:.3f}" for c, p in zip(CLASSES, probs[i])))
    RESULT["held_out_accuracy_recomputed"] = acc

    section("5. Same request through the FastAPI endpoint")
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    settings.ML_SERVICE_API_KEY = "demo-key"
    with TestClient(app) as client:
        body = {k: v for k, v in sample.items() if not k.startswith("_")}
        resp = client.post("/predict/trajectory", json=body, headers={"Authorization": "Bearer demo-key"})
    print(f"  HTTP {resp.status_code}")
    print("  " + json.dumps(resp.json(), indent=2).replace("\n", "\n  "))
    RESULT["api_response"] = resp.json()

    section("6. Evaluation evidence (models/reports/trajectory_runs.json)")
    print(f"  {'model':22s} {'accuracy [95% CI]':26s} {'macro-F1':>9s}")
    for name, m in report["test"].items():
        c = m["ci95"]["accuracy"]
        print(f"  {name:22s} {m['accuracy']:.3f} [{c[0]:.3f}, {c[1]:.3f}]       {m['macro_f1']:>9.3f}")
    for name, d in report["accuracy_differences"].items():
        print(f"  {name:40s} Δ {d['difference']:+.4f} [{d['ci95'][0]:+.4f}, {d['ci95'][1]:+.4f}]")
    print(f"  Other seeds: {report['transformer']['stability_other_seeds']}")
    print(f"  Decision: {report['decision']}")

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
