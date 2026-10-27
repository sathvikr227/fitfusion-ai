"""Model 1 — population calibration experiment (run after train_calorie_hr).

The external test showed a systematic over-estimate on WEEE: the model learned
from mostly trained athletes, who burn more oxygen per heartbeat than the WEEE
adults. WEEE has already been used as the test set, so fitting a correction on
it and re-reporting the same score would be circular. Instead:

  Leave-one-participant-out (16 folds). In each fold the correction is fitted on
  15 participants and applied to the held-out one. Every reported number is on
  a participant the correction never saw.

Rules fixed before any calibrated result was computed:
  * Keytel and the FitFusion MET table get the identical correction, so any
    remaining gap is due to the model, not to calibration.
  * Primary correction: linear, measured = a + b·predicted.
    Also reported: offset only (predicted − mean bias), ratio (predicted × k).
  * Question: does calibrated Model 1 still beat calibrated Keytel,
    paired Wilcoxon across participants p < 0.05?

Outcome (2026-09-16): calibrated Model 1 and calibrated Keytel tied (MAE 1.27 vs
1.29, Wilcoxon p = 0.16), so the trained model's advantage does not survive
calibration.

Serving (2026-10-27, the user's decision): the calibrated XGBoost model is served
because the project specifies an XGBoost + SHAP predictor; calibrated Keytel is
kept as its fallback. The tie above is reported, not hidden. Both corrections are
refitted on all 16 participants; each expected error is that method's
leave-one-participant-out estimate reported here.

    .venv/Scripts/python.exe -m training.calibrate_calorie_hr
"""

from __future__ import annotations

import json

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from app.energy import CALORIE_HR_FEATURES, keytel_kcal_per_min
from training.common import MODEL_DIR, REPORT_DIR, banner, write_report
from training.data_weee import load_weee_segments
from training.train_calorie_hr import (
    ALPHA,
    ARTIFACT,
    SESSION_MINUTES,
    app_met_kcal_per_min,
    error_summary,
    print_table,
    rounded,
)

ENERGY_ARTIFACT = "calorie_energy.json"
FIGURE = "calorie_hr_calibration.png"
PRIMARY = "linear"

METHODS = {
    "model_1": "pred_model",
    "keytel_2005": "pred_keytel",
    "fitfusion_met_table": "pred_app_met",
}


# ── corrections ───────────────────────────────────────────────────────────────
def fit_correction(kind: str, pred: np.ndarray, measured: np.ndarray) -> tuple[float, float]:
    """Return (a, b) so that corrected = a + b·pred."""
    if kind == "offset":
        return float(np.mean(measured - pred)), 1.0
    if kind == "ratio":
        return 0.0, float(measured.sum() / pred.sum())
    if kind == "linear":
        b, a = np.polyfit(pred, measured, 1)
        return float(a), float(b)
    raise ValueError(kind)


def apply_correction(coef: tuple[float, float], pred: np.ndarray) -> np.ndarray:
    a, b = coef
    return np.clip(a + b * pred, 0.0, None)


def leave_one_participant_out(ex: pd.DataFrame, column: str, kind: str) -> np.ndarray:
    out = np.zeros(len(ex))
    participants = ex["participant"].to_numpy()
    pred = ex[column].to_numpy(float)
    measured = ex["kcal_per_min"].to_numpy(float)
    for person in np.unique(participants):
        held_out = participants == person
        coef = fit_correction(kind, pred[~held_out], measured[~held_out])
        out[held_out] = apply_correction(coef, pred[held_out])
    return out


def participant_mae(ex: pd.DataFrame, column: str) -> pd.Series:
    return (ex[column] - ex["kcal_per_min"]).abs().groupby(ex["participant"]).mean()


def paired(ex: pd.DataFrame, a_col: str, b_col: str) -> dict:
    a = participant_mae(ex, a_col)
    b = participant_mae(ex, b_col)
    return {
        "participants": int(len(a)),
        "mae_a": float(a.mean()),
        "mae_b": float(b.mean()),
        "difference": float(a.mean() - b.mean()),
        "wilcoxon_p": float(wilcoxon(a, b).pvalue),
        "participants_where_a_better": int((a < b).sum()),
    }


# ── figure ────────────────────────────────────────────────────────────────────
def draw_figure(ex: pd.DataFrame, path) -> None:
    panels = [
        ("Model 1 — uncalibrated", "pred_model"),
        ("Model 1 — calibrated (held-out person)", "cal_linear_model_1"),
        ("Keytel 2005 — calibrated (held-out person)", "cal_linear_keytel_2005"),
    ]
    colours = {"Cycle1": "#3b82f6", "Cycle2": "#1d4ed8", "Run1": "#f97316", "Run2": "#c2410c"}
    lim = max(ex["kcal_per_min"].max(), *(ex[c].max() for _, c in panels)) * 1.08
    dlim = max(np.abs(ex[c] - ex["kcal_per_min"]).max() for _, c in panels) * 1.15

    fig, axes = plt.subplots(2, 3, figsize=(15, 9.5))
    for col, (title, column) in enumerate(panels):
        m = error_summary(ex["kcal_per_min"], ex[column])
        ax = axes[0, col]
        for activity, g in ex.groupby("activity"):
            ax.scatter(g["kcal_per_min"], g[column], s=38, alpha=0.85,
                       color=colours.get(activity, "grey"), label=activity)
        ax.plot([0, lim], [0, lim], color="black", lw=1, ls="--")
        ax.set_xlim(0, lim)
        ax.set_ylim(0, lim)
        ax.set_title(f"{title}\nMAE {m['mae']:.2f} kcal/min · MAPE {m['mape_pct']:.0f}%")
        ax.set_xlabel("Measured by calorimeter (kcal/min)")
        ax.set_ylabel("Predicted (kcal/min)")
        if col == 0:
            ax.legend(loc="upper left", fontsize=8)

        ax = axes[1, col]
        mean = (ex["kcal_per_min"] + ex[column]) / 2
        diff = ex[column] - ex["kcal_per_min"]
        ax.scatter(mean, diff, s=38, alpha=0.85, color=[colours.get(a, "grey") for a in ex["activity"]])
        ax.axhline(m["bias"], color="black", lw=1.2)
        ax.axhline(m["loa_low"], color="black", lw=1, ls="--")
        ax.axhline(m["loa_high"], color="black", lw=1, ls="--")
        ax.axhline(0, color="grey", lw=0.6)
        ax.set_ylim(-dlim, dlim)
        ax.set_title(f"Bland–Altman · bias {m['bias']:+.2f} · LoA [{m['loa_low']:.2f}, {m['loa_high']:.2f}]")
        ax.set_xlabel("Mean of measured and predicted (kcal/min)")
        ax.set_ylabel("Predicted − measured (kcal/min)")

    fig.suptitle(
        "Model 1 calibration — leave-one-participant-out on WEEE "
        f"({len(ex)} exercise segments, {ex['participant'].nunique()} participants)",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    banner("Model 1 — calibration experiment (leave-one-participant-out)")

    bundle = joblib.load(MODEL_DIR / ARTIFACT)
    model = bundle["model"]

    seg = load_weee_segments()
    ex = seg[seg["included"] & seg["is_exercise"]].copy().reset_index(drop=True)
    ex["pred_model"] = model.predict(ex[CALORIE_HR_FEATURES].to_numpy(float))
    ex["pred_keytel"] = keytel_kcal_per_min(ex["hr"], ex["weight_kg"], ex["age"], ex["is_female"])
    ex["pred_app_met"] = app_met_kcal_per_min(ex["activity"], ex["intensity_setting"].fillna(0), ex["weight_kg"])
    print(f"  {len(ex)} exercise segments, {ex['participant'].nunique()} participants")

    results: dict[str, dict] = {"uncalibrated": {}}
    for method, column in METHODS.items():
        results["uncalibrated"][method] = error_summary(ex["kcal_per_min"], ex[column])

    for kind in ("offset", "ratio", "linear"):
        results[kind] = {}
        for method, column in METHODS.items():
            cal_col = f"cal_{kind}_{method}"
            ex[cal_col] = leave_one_participant_out(ex, column, kind)
            results[kind][method] = error_summary(ex["kcal_per_min"], ex[cal_col])

    for kind, rows in results.items():
        print_table(f"{kind} — WEEE exercise segments, held-out participants", rows)

    per_activity = {
        activity: {
            method: error_summary(g["kcal_per_min"], g[f"cal_{PRIMARY}_{method}"])["mae"]
            for method in METHODS
        }
        | {"n": int(len(g))}
        for activity, g in ex.groupby("activity")
    }
    print(f"\n  MAE by activity after {PRIMARY} calibration:")
    for activity, row in per_activity.items():
        print(f"    {activity:7s} n={row['n']:2d}  model {row['model_1']:.2f}  "
              f"keytel {row['keytel_2005']:.2f}  app MET {row['fitfusion_met_table']:.2f}")

    comparisons = {
        "calibrated_model_vs_calibrated_keytel": paired(
            ex, f"cal_{PRIMARY}_model_1", f"cal_{PRIMARY}_keytel_2005"),
        "calibrated_model_vs_calibrated_met": paired(
            ex, f"cal_{PRIMARY}_model_1", f"cal_{PRIMARY}_fitfusion_met_table"),
        "calibrated_model_vs_uncalibrated_model": paired(
            ex, f"cal_{PRIMARY}_model_1", "pred_model"),
    }
    print("\n  Paired comparisons across participants (A vs B):")
    for name, p in comparisons.items():
        print(f"    {name:42s} MAE {p['mae_a']:.2f} vs {p['mae_b']:.2f}  "
              f"diff {p['difference']:+.2f}  Wilcoxon p={p['wilcoxon_p']:.4f}  "
              f"A better for {p['participants_where_a_better']}/{p['participants']}")

    ml_survives = (
        results[PRIMARY]["model_1"]["mae"] < results[PRIMARY]["keytel_2005"]["mae"]
        and comparisons["calibrated_model_vs_calibrated_keytel"]["wilcoxon_p"] < ALPHA
    )
    print(f"\n  Does Model 1 still beat Keytel when both are calibrated? "
          f"{'YES' if ml_survives else 'NO'}")

    session = {m: results[PRIMARY][m]["mae"] * SESSION_MINUTES for m in METHODS}
    print(f"  Typical error on a {SESSION_MINUTES}-minute session after calibration: "
          + ", ".join(f"{m} ±{v:.0f} kcal" for m, v in session.items()))

    # Served corrections, fitted on every participant: XGBoost (primary) and
    # Keytel (fallback when the model artifact is unavailable).
    measured = ex["kcal_per_min"].to_numpy(float)
    a, b = fit_correction(PRIMARY, ex["pred_keytel"].to_numpy(float), measured)
    ma, mb = fit_correction(PRIMARY, ex["pred_model"].to_numpy(float), measured)
    print(f"\n  Served:   kcal/min = {ma:.3f} + {mb:.3f} × XGBoost (fitted on all 16 participants)")
    print(f"  Fallback: kcal/min = {a:.3f} + {b:.3f} × Keytel")
    keytel_vs_model = comparisons["calibrated_model_vs_calibrated_keytel"]
    decision = (
        "Serve calibrated XGBoost (project requirement), Keytel as fallback. The model "
        "beat Keytel uncalibrated (p=0.0002) but tied once both were calibrated "
        f"(MAE {keytel_vs_model['mae_a']:.2f} vs {keytel_vs_model['mae_b']:.2f}, "
        f"p={keytel_vs_model['wilcoxon_p']:.2f}): no significant accuracy gain over Keytel."
        if not ml_survives
        else "Serve calibrated XGBoost: it beats calibrated Keytel significantly."
    )
    print(f"  Decision: {decision}")

    energy = {
        "method": "xgboost_hr_linear_calibration",
        "served_estimator": "xgboost",
        "model_artifact": ARTIFACT,
        "model_intercept": ma,
        "model_slope": mb,
        "model_expected_mae_kcal_per_min": results[PRIMARY]["model_1"]["mae"],
        "model_expected_mape_pct": results[PRIMARY]["model_1"]["mape_pct"],
        # Keytel fallback coefficients (keys kept for older readers).
        "intercept": a,
        "slope": b,
        "fitted_on": "WEEE exercise segments (cycling, treadmill walk/run), all participants",
        "segments": int(len(ex)),
        "participants": int(ex["participant"].nunique()),
        "expected_mae_kcal_per_min": results[PRIMARY]["keytel_2005"]["mae"],
        "expected_mape_pct": results[PRIMARY]["keytel_2005"]["mape_pct"],
        "validated_hr_range_bpm": [float(ex["hr"].min()), float(ex["hr"].max())],
        "validated_workout_types": ["Cardio"],
        "decision": decision,
        "model_version": "energy-xgb-cal-v2",
    }
    path = MODEL_DIR / ENERGY_ARTIFACT
    path.write_text(json.dumps(rounded(energy), indent=2), encoding="utf-8")
    print(f"[artifact] {path}")

    figure_path = REPORT_DIR / FIGURE
    draw_figure(ex, figure_path)
    print(f"[figure] {figure_path}")

    write_report(
        "calorie_hr_calibration",
        rounded(
            {
                "design": "leave-one-participant-out on WEEE exercise segments",
                "primary_correction": PRIMARY,
                "results": results,
                "per_activity_mae_primary": per_activity,
                "paired_comparisons": comparisons,
                "ml_advantage_survives_calibration": ml_survives,
                "session_error_kcal": {"minutes": SESSION_MINUTES, **session},
                "shipped_method": energy,
                "figure": FIGURE,
            }
        ),
    )


if __name__ == "__main__":
    main()
