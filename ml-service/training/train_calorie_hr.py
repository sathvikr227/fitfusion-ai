"""Model 1 — heart-rate energy expenditure model (kcal/min).

Trains on the Malaga treadmill tests, tests once on the WEEE lab protocol, and
decides whether the model is kept, using rules fixed before training:

  Rule 1  lower MAE than the Keytel (2005) HR equation on WEEE exercise segments
  Rule 2  lower MAE than FitFusion's MET table on WEEE exercise segments,
          paired Wilcoxon across participants p < 0.05

If either rule fails the model is dropped and the report says so.

Steps
  1. Malaga windows (training/data_malaga.py)
  2. 5-fold cross-validation grouped by person: Ridge and three monotone
     XGBoost configurations; the lowest CV MAE is selected
  3. Keytel and the FitFusion MET table scored on the same folds
  4. Ablation: the selected model without heart rate
  5. Selected model refit on all Malaga windows
  6. One-time external test on WEEE (training/data_weee.py)
  7. Keep / drop decision, report JSON, validation figure, artifact

    .venv/Scripts/python.exe -m training.train_calorie_hr
"""

from __future__ import annotations

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler
from xgboost import XGBRegressor

from app.energy import (
    CALORIE_HR_FEATURES,
    CALORIE_HR_MONOTONE,
    hr_design_matrix,
    keytel_kcal_per_min,
)
from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report
from training.data_malaga import load_malaga_windows
from training.data_weee import load_weee_segments

ARTIFACT = "calorie_hr_model.pkl"
FIGURE = "calorie_hr_bland_altman.png"
N_FOLDS = 5
BOOTSTRAP_RESAMPLES = 5000
ALPHA = 0.05
SESSION_MINUTES = 30  # used only to express per-minute error as a session figure

# FitFusion's MET table, web/src/lib/calories.ts. Unmatched names fall back to 5.
APP_MET = {"treadmill walk": 3.5, "jogging": 7.0, "running": 9.8, "stationary bike": 7.0}
APP_MET_DEFAULT = 5.0

XGB_CONFIGS = {
    "xgb_depth2": dict(max_depth=2, n_estimators=600),
    "xgb_depth3": dict(max_depth=3, n_estimators=400),
    "xgb_depth4": dict(max_depth=4, n_estimators=400),
}


# ── baselines ─────────────────────────────────────────────────────────────────
def app_met_name(activity: str, speed_kmh: float) -> str | None:
    """The exercise name a user would log, resolved against the app's table.

    Treadmill speed is used to pick walk / jog / run. The app never sees speed,
    so this is a generous version of the baseline, not a weaker one.
    """
    if activity.startswith("Cycle"):
        return "stationary bike"
    if activity.startswith("Run") or activity == "Treadmill":
        if speed_kmh < 6.5:
            return "treadmill walk"
        if speed_kmh < 8.5:
            return "jogging"
        return "running"
    return None  # sitting / standing: no entry, the app uses its default


def app_met_kcal_per_min(activity, speed_kmh, weight_kg) -> np.ndarray:
    mets = [
        APP_MET.get(app_met_name(a, s), APP_MET_DEFAULT)
        for a, s in zip(activity, speed_kmh)
    ]
    return np.asarray(mets) * np.asarray(weight_kg, dtype=float) / 60.0


# ── models ────────────────────────────────────────────────────────────────────
def make_ridge():
    return make_pipeline(
        FunctionTransformer(hr_design_matrix),
        StandardScaler(),
        RidgeCV(alphas=np.logspace(-3, 3, 13)),
    )


def make_xgb(max_depth: int, n_estimators: int, monotone=CALORIE_HR_MONOTONE):
    return XGBRegressor(
        max_depth=max_depth,
        n_estimators=n_estimators,
        learning_rate=0.05,
        min_child_weight=20,
        subsample=0.8,
        monotone_constraints=monotone,
        random_state=RANDOM_SEED,
        n_jobs=4,
    )


def fit(model, X, y, w):
    if hasattr(model, "steps"):
        model.fit(X, y, ridgecv__sample_weight=w)
    else:
        model.fit(X, y, sample_weight=w)
    return model


# ── metrics ───────────────────────────────────────────────────────────────────
def error_summary(y_true, y_pred, weights=None) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    err = np.asarray(y_pred, dtype=float) - y_true
    w = np.ones_like(err) if weights is None else np.asarray(weights, dtype=float)
    sd = float(np.sqrt(np.average((err - np.average(err, weights=w)) ** 2, weights=w)))
    bias = float(np.average(err, weights=w))
    ss_res = float(np.average(err**2, weights=w))
    ss_tot = float(np.average((y_true - np.average(y_true, weights=w)) ** 2, weights=w))
    return {
        "mae": float(np.average(np.abs(err), weights=w)),
        "mape_pct": float(np.average(np.abs(err) / y_true, weights=w) * 100),
        "bias": bias,
        "loa_low": bias - 1.96 * sd,
        "loa_high": bias + 1.96 * sd,
        "r2": 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan"),
        "n": int(len(err)),
    }


def rounded(d):
    if isinstance(d, dict):
        return {k: rounded(v) for k, v in d.items()}
    if isinstance(d, list):
        return [rounded(v) for v in d]
    if isinstance(d, (float, np.floating)):
        return round(float(d), 4)
    if isinstance(d, np.integer):
        return int(d)
    return d


def print_table(title: str, rows: dict[str, dict], cols=("mae", "mape_pct", "bias", "loa_low", "loa_high", "r2")):
    print(f"\n  {title}")
    print(f"    {'method':24s}" + "".join(f"{c:>10s}" for c in cols))
    for name, m in rows.items():
        print(f"    {name:24s}" + "".join(f"{m[c]:10.2f}" for c in cols))


# ── steps ─────────────────────────────────────────────────────────────────────
def cross_validate(windows: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    X = windows[CALORIE_HR_FEATURES].to_numpy(float)
    y = windows["kcal_per_min"].to_numpy(float)
    w = windows["sample_weight"].to_numpy(float)
    groups = windows["person_id"].to_numpy()

    candidates = {"ridge": make_ridge, **{k: (lambda c=c: make_xgb(**c)) for k, c in XGB_CONFIGS.items()}}
    oof = {name: np.zeros_like(y) for name in candidates}
    oof["xgb_no_hr"] = np.zeros_like(y)

    folds = GroupKFold(n_splits=N_FOLDS)
    for fold, (tr, te) in enumerate(folds.split(X, y, groups), start=1):
        for name, factory in candidates.items():
            oof[name][te] = fit(factory(), X[tr], y[tr], w[tr]).predict(X[te])
        print(f"  fold {fold}/{N_FOLDS} done ({len(te)} held-out windows, "
              f"{len(set(groups[te]))} people)")

    results = {name: error_summary(y, pred, w) for name, pred in oof.items() if name != "xgb_no_hr"}
    results["keytel_2005"] = error_summary(y, keytel_kcal_per_min(windows["hr"], windows["weight_kg"], windows["age"], windows["is_female"]), w)
    results["fitfusion_met_table"] = error_summary(
        y, app_met_kcal_per_min(["Treadmill"] * len(windows), windows["speed_kmh"], windows["weight_kg"]), w
    )
    return results, pd.DataFrame(oof)


def ablation_without_hr(windows: pd.DataFrame, config: dict) -> dict:
    features = [f for f in CALORIE_HR_FEATURES if f != "hr"]
    monotone = tuple(m for f, m in zip(CALORIE_HR_FEATURES, CALORIE_HR_MONOTONE) if f != "hr")
    X = windows[features].to_numpy(float)
    y = windows["kcal_per_min"].to_numpy(float)
    w = windows["sample_weight"].to_numpy(float)
    oof = np.zeros_like(y)
    for tr, te in GroupKFold(n_splits=N_FOLDS).split(X, y, windows["person_id"]):
        oof[te] = fit(make_xgb(monotone=monotone, **config), X[tr], y[tr], w[tr]).predict(X[te])
    return error_summary(y, oof, w)


def external_test(model, segments: pd.DataFrame) -> dict:
    seg = segments[segments["included"]].copy()
    seg["pred_model"] = model.predict(seg[CALORIE_HR_FEATURES].to_numpy(float))
    seg["pred_keytel"] = keytel_kcal_per_min(seg["hr"], seg["weight_kg"], seg["age"], seg["is_female"])
    seg["pred_app_met"] = app_met_kcal_per_min(seg["activity"], seg["intensity_setting"].fillna(0), seg["weight_kg"])
    seg["pred_researcher_met"] = seg["researcher_met"] * seg["weight_kg"] / 60.0

    methods = {
        "model_1": "pred_model",
        "keytel_2005": "pred_keytel",
        "fitfusion_met_table": "pred_app_met",
        "researcher_met": "pred_researcher_met",
    }

    exercise = seg[seg["is_exercise"]]
    rest = seg[~seg["is_exercise"]]

    overall = {m: error_summary(exercise["kcal_per_min"], exercise[c]) for m, c in methods.items()}
    rest_overall = {m: error_summary(rest["kcal_per_min"], rest[c]) for m, c in methods.items()}

    per_activity = {
        activity: {m: error_summary(g["kcal_per_min"], g[c])["mae"] for m, c in methods.items()}
        | {"n": int(len(g))}
        for activity, g in exercise.groupby("activity")
    }
    per_sex = {
        ("female" if female else "male"): {m: error_summary(g["kcal_per_min"], g[c])["mae"] for m, c in methods.items()}
        | {"n": int(len(g)), "participants": int(g["participant"].nunique())}
        for female, g in exercise.groupby("is_female")
    }

    # Participant-level errors: the unit for the paired tests.
    per_participant = exercise.assign(
        **{f"abs_{m}": (exercise[c] - exercise["kcal_per_min"]).abs() for m, c in methods.items()}
    ).groupby("participant")[[f"abs_{m}" for m in methods]].mean()

    def paired(other: str) -> dict:
        a = per_participant["abs_model_1"].to_numpy()
        b = per_participant[f"abs_{other}"].to_numpy()
        stat = wilcoxon(a, b)
        rng = np.random.default_rng(RANDOM_SEED)
        idx = rng.integers(0, len(a), size=(BOOTSTRAP_RESAMPLES, len(a)))
        diffs = a[idx].mean(axis=1) - b[idx].mean(axis=1)
        return {
            "participants": int(len(a)),
            "model_mae": float(a.mean()),
            "baseline_mae": float(b.mean()),
            "mae_difference": float(a.mean() - b.mean()),
            "bootstrap_95ci": [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))],
            "wilcoxon_p": float(stat.pvalue),
            "participants_where_model_better": int((a < b).sum()),
        }

    return {
        "frame": seg,
        "methods": methods,
        "exercise": overall,
        "rest_out_of_training_range": rest_overall,
        "per_activity_mae": per_activity,
        "per_sex_mae": per_sex,
        "paired_vs_keytel": paired("keytel_2005"),
        "paired_vs_fitfusion_met": paired("fitfusion_met_table"),
        "paired_vs_researcher_met": paired("researcher_met"),
    }


def draw_figure(ext: dict, path) -> None:
    seg = ext["frame"]
    ex = seg[seg["is_exercise"]]
    panels = [
        ("Model 1 (trained)", "pred_model"),
        ("Keytel 2005 HR equation", "pred_keytel"),
        ("FitFusion MET table (today)", "pred_app_met"),
    ]
    colours = {"Cycle1": "#3b82f6", "Cycle2": "#1d4ed8", "Run1": "#f97316", "Run2": "#c2410c"}

    fig, axes = plt.subplots(2, 3, figsize=(15, 9.5))
    lim = max(ex["kcal_per_min"].max(), *(ex[c].max() for _, c in panels)) * 1.08
    diffs_all = np.concatenate([(ex[c] - ex["kcal_per_min"]).to_numpy() for _, c in panels])
    dlim = np.abs(diffs_all).max() * 1.15

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
        "Model 1 external test — WEEE lab protocol (never used in training), "
        f"{len(ex)} exercise segments, {ex['participant'].nunique()} participants",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    banner("Model 1 — heart-rate energy expenditure model")
    ensure_dirs()

    print("\n[1] Training data")
    windows, funnel = load_malaga_windows(verbose=False)
    print(f"  Malaga: {len(windows)} windows, {windows['person_id'].nunique()} people, "
          f"{windows['test_id'].nunique()} tests")

    print(f"\n[2-3] {N_FOLDS}-fold cross-validation grouped by person")
    cv, _ = cross_validate(windows)
    print_table("Cross-validation on Malaga (held-out people)", cv)

    candidates = ["ridge", *XGB_CONFIGS]
    selected = min(candidates, key=lambda k: cv[k]["mae"])
    print(f"\n  Selected: {selected} (lowest CV MAE {cv[selected]['mae']:.3f} kcal/min)")

    print("\n[4] Ablation — does heart rate matter?")
    ablation_config = XGB_CONFIGS[selected] if selected in XGB_CONFIGS else XGB_CONFIGS["xgb_depth3"]
    no_hr = ablation_without_hr(windows, ablation_config)
    print(f"  Without HR: MAE {no_hr['mae']:.2f} kcal/min, R² {no_hr['r2']:.3f}   "
          f"With HR: MAE {cv[selected]['mae']:.2f}, R² {cv[selected]['r2']:.3f}")

    print("\n[5] Refit on all Malaga windows")
    X = windows[CALORIE_HR_FEATURES].to_numpy(float)
    y = windows["kcal_per_min"].to_numpy(float)
    w = windows["sample_weight"].to_numpy(float)
    model = make_ridge() if selected == "ridge" else make_xgb(**XGB_CONFIGS[selected])
    fit(model, X, y, w)

    print("\n[6] External test — WEEE (first and only look)")
    segments = load_weee_segments()
    ext = external_test(model, segments)
    print_table(
        f"WEEE exercise segments (n={ext['exercise']['model_1']['n']})", ext["exercise"]
    )
    print_table(
        f"WEEE sitting/standing — outside training range (n={ext['rest_out_of_training_range']['model_1']['n']})",
        ext["rest_out_of_training_range"],
        cols=("mae", "mape_pct", "bias"),
    )

    print("\n  MAE by activity (kcal/min):")
    for activity, row in ext["per_activity_mae"].items():
        print(f"    {activity:7s} n={row['n']:2d}  model {row['model_1']:.2f}  keytel {row['keytel_2005']:.2f}  "
              f"app MET {row['fitfusion_met_table']:.2f}  researcher MET {row['researcher_met']:.2f}")
    print("\n  MAE by sex (kcal/min):")
    for sex, row in ext["per_sex_mae"].items():
        print(f"    {sex:7s} n={row['n']:2d} ({row['participants']} people)  model {row['model_1']:.2f}  "
              f"keytel {row['keytel_2005']:.2f}  app MET {row['fitfusion_met_table']:.2f}")

    print("\n  Paired comparisons across participants:")
    for label, key in (("vs Keytel", "paired_vs_keytel"), ("vs FitFusion MET", "paired_vs_fitfusion_met"),
                       ("vs researcher MET", "paired_vs_researcher_met")):
        p = ext[key]
        print(f"    {label:18s} MAE {p['model_mae']:.2f} vs {p['baseline_mae']:.2f}  "
              f"diff {p['mae_difference']:+.2f} [95% CI {p['bootstrap_95ci'][0]:+.2f}, {p['bootstrap_95ci'][1]:+.2f}]  "
              f"Wilcoxon p={p['wilcoxon_p']:.4f}  better for {p['participants_where_model_better']}/{p['participants']}")

    print("\n[7] Keep / drop decision (rules fixed before training)")
    rule1 = ext["exercise"]["model_1"]["mae"] < ext["exercise"]["keytel_2005"]["mae"]
    rule2 = (
        ext["exercise"]["model_1"]["mae"] < ext["exercise"]["fitfusion_met_table"]["mae"]
        and ext["paired_vs_fitfusion_met"]["wilcoxon_p"] < ALPHA
    )
    keytel_significant = ext["paired_vs_keytel"]["wilcoxon_p"] < ALPHA
    decision = "KEEP" if (rule1 and rule2) else "DROP"
    print(f"  Rule 1 — beats Keytel on MAE:                         {'PASS' if rule1 else 'FAIL'}")
    print(f"  Rule 2 — beats FitFusion MET table, Wilcoxon p<{ALPHA}:  {'PASS' if rule2 else 'FAIL'}")
    print(f"  Improvement over Keytel statistically significant:    {'yes' if keytel_significant else 'no (n too small to show it)'}")
    print(f"  DECISION: {decision}")

    session = {
        m: ext["exercise"][m]["mae"] * SESSION_MINUTES for m in ext["methods"]
    }
    print(f"\n  Typical error on a {SESSION_MINUTES}-minute session: "
          + ", ".join(f"{m} ±{v:.0f} kcal" for m, v in session.items()))

    importance: dict[str, float]
    if selected == "ridge":
        ridge = model.named_steps["ridgecv"]
        names = CALORIE_HR_FEATURES + ["hr_x_weight", "hr_x_female"]
        importance = {n: float(c) for n, c in zip(names, ridge.coef_)}
        importance_kind = "standardised ridge coefficients (kcal/min per SD)"
    else:
        import shap

        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(ext["frame"][CALORIE_HR_FEATURES].to_numpy(float))
        importance = {n: float(v) for n, v in zip(CALORIE_HR_FEATURES, np.abs(values).mean(axis=0))}
        importance_kind = "mean |SHAP| on WEEE segments (kcal/min)"
    print(f"\n  Feature importance — {importance_kind}:")
    for name, value in sorted(importance.items(), key=lambda kv: abs(kv[1]), reverse=True):
        print(f"    {name:14s} {value:+.3f}")

    figure_path = REPORT_DIR / FIGURE
    draw_figure(ext, figure_path)
    print(f"\n[figure] {figure_path}")

    training_range = {
        col: [float(windows[col].quantile(0.01)), float(windows[col].quantile(0.99))]
        for col in ["age", "height_cm", "weight_kg", "hr", "kcal_per_min"]
    }
    bundle = {
        "model": model,
        "algorithm": selected,
        "feature_names": CALORIE_HR_FEATURES,
        "training_range_p1_p99": training_range,
        "decision": decision,
        "external_mae_kcal_per_min": ext["exercise"]["model_1"]["mae"],
        "model_version": "calorie-hr-v1",
    }
    path = MODEL_DIR / ARTIFACT
    joblib.dump(bundle, path)
    print(f"[artifact] {path}")

    seg_out = ext["frame"][
        ["participant", "activity", "is_exercise", "is_female", "age", "weight_kg", "hr", "kcal_per_min",
         "pred_model", "pred_keytel", "pred_app_met", "pred_researcher_met"]
    ]
    write_report(
        "calorie_hr",
        rounded(
            {
                "artifact": ARTIFACT,
                "figure": FIGURE,
                "output": "kcal_per_min",
                "inputs": CALORIE_HR_FEATURES,
                "training_data": {
                    "dataset": "PhysioNet treadmill-exercise-cardioresp v1.0.1 (University of Malaga)",
                    "licence": "CC BY-NC-SA 4.0",
                    "label": "Weir equation from breath-by-breath VO2 and VCO2",
                    "funnel": funnel,
                    "windows": len(windows),
                    "people": int(windows["person_id"].nunique()),
                    "range_p1_p99": training_range,
                },
                "test_data": {
                    "dataset": "WEEE, Zenodo 10.5281/zenodo.6420886",
                    "licence": "CC BY 4.0",
                    "label": "VO2 x 5.0 kcal/L (VO2 Master has no VCO2; median 2.7% from Weir on Malaga)",
                    "exercise_segments": int(ext["exercise"]["model_1"]["n"]),
                    "participants": int(ext["paired_vs_keytel"]["participants"]),
                    "excluded_segments": segments.loc[~segments["included"], ["participant", "activity", "exclusion_reason"]]
                    .to_dict(orient="records"),
                },
                "cross_validation": {"folds": N_FOLDS, "grouped_by": "person", "results": cv, "selected": selected},
                "ablation_without_hr": no_hr,
                "external_test": {
                    "exercise": ext["exercise"],
                    "rest_out_of_training_range": ext["rest_out_of_training_range"],
                    "per_activity_mae": ext["per_activity_mae"],
                    "per_sex_mae": ext["per_sex_mae"],
                    "paired_vs_keytel": ext["paired_vs_keytel"],
                    "paired_vs_fitfusion_met": ext["paired_vs_fitfusion_met"],
                    "paired_vs_researcher_met": ext["paired_vs_researcher_met"],
                    "session_error_kcal": {"minutes": SESSION_MINUTES, **session},
                    "segments": seg_out.to_dict(orient="records"),
                },
                "decision": {
                    "rule_1_beats_keytel_mae": rule1,
                    "rule_2_beats_fitfusion_met_significantly": rule2,
                    "keytel_improvement_significant": keytel_significant,
                    "result": decision,
                },
                "feature_importance": {"kind": importance_kind, "values": importance},
                "fitfusion_met_baseline_note": (
                    "MET values from web/src/lib/calories.ts; treadmill speed used to pick "
                    "walk/jog/run, which the app itself cannot do."
                ),
            }
        ),
    )


if __name__ == "__main__":
    main()
