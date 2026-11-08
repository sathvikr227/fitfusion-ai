"""Model 3 round 2 — three weeks of training load, nested repeated CV.

Implements demos/model3_injury/PROTOCOL_ROUND2.md with Amendment 1 (committed
d2ef8ec and fb9dbb0 before any round-2 result existed):

  * data = the week-approach file (weekly summaries of the 3 weeks before each day);
  * features = app.injury_load WEEK_FEATURES (derived by the same code the endpoint runs);
  * leakage screen: no single feature may reach ROC-AUC 0.75;
  * 9 candidate configurations, chosen by nested athlete-grouped CV;
  * outer 5-fold athlete-grouped CV repeated with seeds 42..46;
  * serve iff the lower bound of the primary ROC-AUC 95% CI > 0.55.

    .venv/Scripts/python.exe -m training.train_injury_load_round2      # ~10-20 minutes

Writes models/injury_load_round2.pkl, models/reports/injury_load_round2.json and figures.
"""

from __future__ import annotations

import time

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score, roc_curve  # noqa: E402
from sklearn.model_selection import StratifiedGroupKFold  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402

from app.injury_load import WEEK0_FEATURES, WEEK_FEATURES, platt  # noqa: E402
from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402
import json  # noqa: E402
from training.data_runners import WEEK_CSV_SHA256, funnel, load_runner_weeks  # noqa: E402
from training.train_injury_load import cluster_indices, fit_platt  # noqa: E402

ARTIFACT = "injury_load_round2.pkl"
MODEL_VERSION = "injury-load-r2-v1"
OUTER_SEEDS = [42, 43, 44, 45, 46]
BOOTSTRAP_RESAMPLES = 2000
SERVE_AUC_LOWER_BOUND = 0.55
ELEVATED_PERCENTILE = 90
FEATURE_SETS = {"WEEK": WEEK_FEATURES}
LEAKAGE_AUC = 0.75

# Order = tie-break preference (earlier wins a tie to 4 decimals).
CONFIGS: list[dict] = (
    [{"family": "LR", "features": "WEEK", "C": c} for c in (0.01, 0.1, 1.0)]
    + [{"family": "XGB", "features": "WEEK", "max_depth": d, "n_estimators": n}
       for d in (1, 2, 3) for n in (100, 300)]
)
DISCLAIMER = (
    "Informational injury-risk indicator from your last 3 weeks of training load, "
    "learned from 74 competitive runners. Body regions are flagged by "
    "fixed rules, not predicted. Not a medical diagnosis."
)


def config_name(c: dict) -> str:
    if c["family"] == "LR":
        return f"LR-{c['features']}-C{c['C']}"
    return f"XGB-{c['features']}-d{c['max_depth']}-n{c['n_estimators']}"


# ── models ────────────────────────────────────────────────────────────────────
def make_lr(C: float):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000))


def make_xgb(depth: int, trees: int, y: np.ndarray, min_child_weight: int = 20) -> XGBClassifier:
    return XGBClassifier(
        max_depth=depth, n_estimators=trees, learning_rate=0.03, subsample=0.8,
        colsample_bytree=0.8, min_child_weight=min_child_weight,
        scale_pos_weight=float((y == 0).sum() / max((y == 1).sum(), 1)),
        eval_metric="logloss", random_state=RANDOM_SEED, n_jobs=4,
    )


def fit_predict_all(X: dict[str, np.ndarray], y: np.ndarray, tr: np.ndarray, te: np.ndarray) -> dict[str, np.ndarray]:
    """Raw scores on `te` for every configuration, trained on `tr`.

    XGBoost is fitted once per depth with the larger tree count; the smaller count
    is read from the same booster (iteration_range), which is the same model.
    """
    scores: dict[str, np.ndarray] = {}
    for c in CONFIGS:
        if c["family"] == "LR":
            Xs = X[c["features"]]
            scores[config_name(c)] = make_lr(c["C"]).fit(Xs[tr], y[tr]).predict_proba(Xs[te])[:, 1]
    Xw = X["WEEK"]
    for depth in (1, 2, 3):
        model = make_xgb(depth, 300, y[tr]).fit(Xw[tr], y[tr])
        for trees in (100, 300):
            scores[f"XGB-WEEK-d{depth}-n{trees}"] = model.predict_proba(Xw[te], iteration_range=(0, trees))[:, 1]
    return scores


def fit_one(c: dict, X: dict[str, np.ndarray], y: np.ndarray, tr: np.ndarray):
    Xs = X[c["features"]]
    if c["family"] == "LR":
        return make_lr(c["C"]).fit(Xs[tr], y[tr])
    return make_xgb(c["max_depth"], c["n_estimators"], y[tr]).fit(Xs[tr], y[tr])


def nested_select(X: dict[str, np.ndarray], y: np.ndarray, groups: np.ndarray, train_idx: np.ndarray) -> dict:
    """Inner athlete-grouped CV on `train_idx`: winner, its Platt params and its OOF scores."""
    inner = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    oof = {config_name(c): np.zeros(len(train_idx)) for c in CONFIGS}
    for itr, iva in inner.split(train_idx, y[train_idx], groups[train_idx]):
        part = fit_predict_all(X, y, train_idx[itr], train_idx[iva])
        for name, s in part.items():
            oof[name][iva] = s
    y_tr = y[train_idx]
    aucs = {name: round(float(roc_auc_score(y_tr, s)), 4) for name, s in oof.items()}
    order = [config_name(c) for c in CONFIGS]
    best = max(order, key=lambda n: (aucs[n], -order.index(n)))
    a, b = fit_platt(y_tr, oof[best])
    calibrated = platt(oof[best], a, b)
    return {
        "winner": best,
        "config": CONFIGS[order.index(best)],
        "inner_aucs": aucs,
        "platt": (a, b),
        "threshold": float(np.percentile(calibrated, ELEVATED_PERCENTILE)),
        "oof_calibrated": calibrated,
    }


def week0_logreg(X0: np.ndarray, y: np.ndarray, tr: np.ndarray, te: np.ndarray) -> np.ndarray:
    """Week-0 only (the 7-day analogue of round 1): logistic regression, C = 1, balanced."""
    m = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", C=1.0, max_iter=5000))
    return m.fit(X0[tr], y[tr]).predict_proba(X0[te])[:, 1]


def leakage_screen(frame: pd.DataFrame, y: np.ndarray) -> dict:
    """Univariate ROC-AUC per feature; max(AUC, 1 - AUC) >= 0.75 stops the run."""
    out = {name: round(float(roc_auc_score(y, frame[name].to_numpy())), 4) for name in WEEK_FEATURES}
    worst = max(out, key=lambda n: abs(out[n] - 0.5))
    return {"univariate_auc": out, "most_separating": worst,
            "max_separation": round(max(out[worst], 1 - out[worst]), 4)}


# ── statistics ────────────────────────────────────────────────────────────────
def ci(values) -> list[float]:
    return [round(float(np.percentile(values, 2.5)), 4), round(float(np.percentile(values, 97.5)), 4)]


def lift(y: np.ndarray, flags: np.ndarray) -> float:
    if flags.all() or not flags.any():
        return float("nan")
    rest = y[~flags].mean()
    return float(y[flags].mean() / rest) if rest > 0 else float("nan")


def calibration_line(y: np.ndarray, p: np.ndarray) -> dict:
    q = np.clip(p, 1e-6, 1 - 1e-6)
    logit = np.log(q / (1 - q)).reshape(-1, 1)
    m = LogisticRegression(C=1e6, max_iter=1000).fit(logit, y)
    return {"slope": round(float(m.coef_[0, 0]), 3), "intercept": round(float(m.intercept_[0]), 3)}


def deciles(y: np.ndarray, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    bins = pd.qcut(p, 10, labels=False, duplicates="drop")
    frame = pd.DataFrame({"p": p, "y": y, "bin": bins}).groupby("bin").mean()
    return frame["p"].to_numpy(), frame["y"].to_numpy()


def explain(c: dict, model, features: list[str], X: np.ndarray) -> dict:
    if c["family"] == "LR":
        coef = model[-1].coef_[0]
        order = np.argsort(np.abs(coef))[::-1]
        return {"kind": "standardised logistic coefficients (log-odds per SD)",
                "values": {features[i]: round(float(coef[i]), 4) for i in order}}
    import xgboost

    contribs = model.get_booster().predict(xgboost.DMatrix(X, feature_names=features), pred_contribs=True)[:, :-1]
    mean_abs = np.abs(contribs).mean(axis=0)
    order = np.argsort(mean_abs)[::-1]
    return {"kind": "mean |SHAP| (log-odds)", "values": {features[i]: round(float(mean_abs[i]), 5) for i in order}}


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    started = time.time()
    banner("Model 3 round 2 — three weeks of training load (PROTOCOL_ROUND2.md, Amendment 1)")
    ensure_dirs()
    data = load_runner_weeks()
    data_funnel = funnel(data)
    print(f"[data] {data_funnel}")

    y = data["injury"].to_numpy()
    groups = data["athlete"].to_numpy()
    X = {name: data[cols].to_numpy(dtype=float) for name, cols in FEATURE_SETS.items()}
    X0 = data[WEEK0_FEATURES].to_numpy(dtype=float)
    X_app = X0  # only used for its row count when splitting
    rules = {"Rule-ACWR-km": data["acwr_km"].to_numpy(), "Rule-sessions-w0": data["sessions_w0"].to_numpy()}

    banner("Leakage screen (univariate ROC-AUC of every feature)")
    screen = leakage_screen(data, y)
    for name, auc in sorted(screen["univariate_auc"].items(), key=lambda kv: -abs(kv[1] - 0.5))[:8]:
        print(f"  {name:20s} {auc:.4f}")
    if screen["max_separation"] >= LEAKAGE_AUC:
        raise SystemExit(f"leakage screen failed: {screen['most_separating']} separates at "
                         f"{screen['max_separation']} (>= {LEAKAGE_AUC}); investigate before training")

    # ── primary: outer repeated grouped CV with nested selection ──────────────
    names = ["Candidate", "Week0-LogReg"]
    per_repeat = {n: [] for n in names}
    flags_by_repeat = []
    winners = []
    per_repeat_auc = {n: [] for n in names}
    for seed in OUTER_SEEDS:
        outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
        preds = {n: np.zeros(len(y)) for n in names}
        flags = np.zeros(len(y), dtype=bool)
        for fold, (tr, te) in enumerate(outer.split(X_app, y, groups)):
            sel = nested_select(X, y, groups, tr)
            model = fit_one(sel["config"], X, y, tr)
            raw = model.predict_proba(X[sel["config"]["features"]][te])[:, 1]
            preds["Candidate"][te] = platt(raw, *sel["platt"])
            flags[te] = preds["Candidate"][te] >= sel["threshold"]
            preds["Week0-LogReg"][te] = week0_logreg(X0, y, tr, te)
            winners.append({"seed": seed, "fold": fold, "winner": sel["winner"],
                            "inner_auc": sel["inner_aucs"][sel["winner"]],
                            "outer_auc": round(float(roc_auc_score(y[te], preds["Candidate"][te])), 4)})
            print(f"  seed {seed} fold {fold}: winner {sel['winner']:22s} inner {sel['inner_aucs'][sel['winner']]:.4f} "
                  f"outer {winners[-1]['outer_auc']:.4f}  ({time.time() - started:.0f}s)")
        for n in names:
            per_repeat[n].append(preds[n])
            per_repeat_auc[n].append(round(float(roc_auc_score(y, preds[n])), 4))
        flags_by_repeat.append(flags)
        print(f"  seed {seed} pooled AUC: " + ", ".join(f"{n} {per_repeat_auc[n][-1]:.4f}" for n in names))

    mean_scores = {n: np.mean(per_repeat[n], axis=0) for n in names}
    mean_scores.update(rules)
    flags_major = np.mean(flags_by_repeat, axis=0) >= 0.5

    banner("Athlete-cluster bootstrap (2,000 resamples)")
    rng = np.random.default_rng(RANDOM_SEED)
    samples = cluster_indices(groups, rng, BOOTSTRAP_RESAMPLES)
    boot = {n: [] for n in mean_scores}
    diffs = {f"Candidate minus {n}": [] for n in ("Week0-LogReg", "Rule-sessions-w0", "Rule-ACWR-km")}
    lifts = []
    for idx in samples:
        yy = y[idx]
        if yy.min() == yy.max():
            continue
        aucs = {n: roc_auc_score(yy, s[idx]) for n, s in mean_scores.items()}
        for n, v in aucs.items():
            boot[n].append(v)
        for key in diffs:
            diffs[key].append(aucs["Candidate"] - aucs[key.removeprefix("Candidate minus ")])
        lv = lift(yy, flags_major[idx])
        if np.isfinite(lv):
            lifts.append(lv)

    primary = {}
    for n, s in mean_scores.items():
        primary[n] = {"roc_auc": round(float(roc_auc_score(y, s)), 4), "roc_auc_ci95": ci(boot[n]),
                      "pr_auc": round(float(average_precision_score(y, s)), 4)}
        if n in per_repeat_auc:
            primary[n]["per_repeat_pooled_auc"] = per_repeat_auc[n]
    p_cand = mean_scores["Candidate"]
    primary["Candidate"]["brier"] = round(float(brier_score_loss(y, p_cand)), 5)
    primary["Candidate"]["brier_prevalence_only"] = round(float(brier_score_loss(y, np.full(len(y), y.mean()))), 5)
    primary["Candidate"]["calibration"] = calibration_line(y, p_cand)
    primary["Candidate"]["elevated"] = {
        "flag_rate": round(float(flags_major.mean()), 4),
        "injury_rate_flagged": round(float(y[flags_major].mean()), 5),
        "injury_rate_not_flagged": round(float(y[~flags_major].mean()), 5),
        "recall": round(float(flags_major[y == 1].mean()), 4),
        "lift": round(lift(y, flags_major), 3),
        "lift_ci95": ci(lifts),
    }
    differences = {k: {"difference": round(float(np.mean(v)), 4), "ci95": ci(v)} for k, v in diffs.items()}
    for n, m in primary.items():
        print(f"  {n:18s} ROC-AUC {m['roc_auc']:.4f} [{m['roc_auc_ci95'][0]:.3f}, {m['roc_auc_ci95'][1]:.3f}]  "
              f"PR-AUC {m['pr_auc']:.4f}")
    for k, d in differences.items():
        print(f"  {k:32s} Δ {d['difference']:+.4f} [{d['ci95'][0]:+.4f}, {d['ci95'][1]:+.4f}]")
    print(f"  elevated: {primary['Candidate']['elevated']}")

    ci_low = primary["Candidate"]["roc_auc_ci95"][0]
    serve = ci_low > SERVE_AUC_LOWER_BOUND
    decision = {
        "rule": f"serve iff the lower bound of the primary ROC-AUC 95% CI > {SERVE_AUC_LOWER_BOUND}",
        "candidate_roc_auc": primary["Candidate"]["roc_auc"],
        "candidate_roc_auc_ci_low": ci_low,
        "serve": bool(serve),
    }
    print(f"\n[decision] {decision}")

    # ── secondary: round 1's split (not fresh) ─────────────────────────────────
    banner("Secondary — round 1's 14 test athletes (already seen in round 1, not fresh)")
    r1 = json.loads((REPORT_DIR / "injury_load.json").read_text(encoding="utf-8"))
    r1_test = set(r1["split"]["test"]["athlete_ids"])
    is_test = np.isin(groups, sorted(r1_test))
    dev_idx, test_idx = np.flatnonzero(~is_test), np.flatnonzero(is_test)
    sel = nested_select(X, y, groups, dev_idx)
    model = fit_one(sel["config"], X, y, dev_idx)
    p_test = platt(model.predict_proba(X[sel["config"]["features"]][test_idx])[:, 1], *sel["platt"])
    sec_samples = cluster_indices(groups[test_idx], np.random.default_rng(RANDOM_SEED), BOOTSTRAP_RESAMPLES)
    y_test = y[test_idx]
    sec_boot = [roc_auc_score(y_test[i], p_test[i]) for i in sec_samples if y_test[i].min() != y_test[i].max()]
    secondary = {"winner": sel["winner"], "test_athletes": int(len(np.unique(groups[test_idx]))),
                 "test_injuries": int(y_test.sum()),
                 "roc_auc": round(float(roc_auc_score(y_test, p_test)), 4), "roc_auc_ci95": ci(sec_boot),
                 "round1_reference_day_file": {"XGB-APP": 0.589, "LogReg-APP": 0.669}}
    print(f"  {secondary}")

    # ── final model on all 74 athletes ─────────────────────────────────────────
    banner("Final model — nested selection on all 74 athletes")
    all_idx = np.arange(len(y))
    sel = nested_select(X, y, groups, all_idx)
    final = fit_one(sel["config"], X, y, all_idx)
    features = FEATURE_SETS[sel["config"]["features"]]
    importance = explain(sel["config"], final, features, X[sel["config"]["features"]])
    print(f"  winner {sel['winner']}; threshold (p{ELEVATED_PERCENTILE}) {sel['threshold']:.5f}; "
          f"prevalence {y.mean():.5f}")
    print(f"  top features: {list(importance['values'].items())[:6]}")

    # ── figures ────────────────────────────────────────────────────────────────
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for n, s in mean_scores.items():
        fpr, tpr, _ = roc_curve(y, s)
        axes[0].plot(fpr, tpr, lw=2 if n == "Candidate" else 1, label=f"{n} (AUC {roc_auc_score(y, s):.3f})")
    axes[0].plot([0, 1], [0, 1], "k:", lw=1)
    axes[0].set(title="ROC — all 74 athletes, out-of-fold (5 repeats)", xlabel="False positive rate",
                ylabel="True positive rate")
    axes[0].legend(fontsize=8)
    pred_d, obs_d = deciles(y, p_cand)
    axes[1].plot(pred_d, obs_d, "o-", label="Candidate (Platt, OOF)")
    lim = max(pred_d.max(), obs_d.max()) * 1.1
    axes[1].plot([0, lim], [0, lim], "k:", lw=1, label="perfect calibration")
    axes[1].set(title="Calibration by decile", xlabel="Mean predicted probability", ylabel="Observed injury rate")
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    curves = REPORT_DIR / "injury_load_round2_roc_calibration.png"
    fig.savefig(curves, dpi=130)
    plt.close(fig)

    top = list(importance["values"].items())[:15][::-1]
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh([k for k, _ in top], [v for _, v in top], color="#0891b2")
    ax.axvline(0, color="k", lw=0.8)
    ax.set(title=f"Final model ({sel['winner']}): {importance['kind']}", xlabel="value")
    fig.tight_layout()
    imp_path = REPORT_DIR / "injury_load_round2_features.png"
    fig.savefig(imp_path, dpi=130)
    plt.close(fig)

    bundle = {
        "model": final,
        "family": sel["config"]["family"],
        "features": features,
        "feature_kind": "week3",
        "window_days": 21,
        "platt_a": sel["platt"][0],
        "platt_b": sel["platt"][1],
        "threshold": sel["threshold"],
        "prevalence": float(y.mean()),
        "serve": bool(serve),
        "model_version": MODEL_VERSION,
        "config": sel["config"],
        "cv_roc_auc": primary["Candidate"]["roc_auc"],
        "cv_roc_auc_ci95": primary["Candidate"]["roc_auc_ci95"],
        "lift": primary["Candidate"]["elevated"]["lift"],
        "data_sha256": WEEK_CSV_SHA256,
        "disclaimer": DISCLAIMER,
    }
    joblib.dump(bundle, MODEL_DIR / ARTIFACT)
    print(f"[artifact] wrote {MODEL_DIR / ARTIFACT} (serve={serve})")

    write_report("injury_load_round2", {
        "artifact": ARTIFACT,
        "model_version": MODEL_VERSION,
        "protocol": "demos/model3_injury/PROTOCOL_ROUND2.md + Amendment 1 (d2ef8ec, fb9dbb0; before any result)",
        "dataset": {"doi": "10.34894/UWU9PV", "version": 2, "licence": "CC0-1.0",
                    "file": "week_approach_maskedID_timeseries.csv", "sha256": WEEK_CSV_SHA256,
                    "funnel": data_funnel},
        "leakage_screen": screen,
        "features": FEATURE_SETS,
        "configs": [config_name(c) for c in CONFIGS],
        "outer_seeds": OUTER_SEEDS,
        "outer_fold_winners": winners,
        "primary": primary,
        "auc_differences": differences,
        "decision": decision,
        "secondary_round1_split": secondary,
        "final": {"winner": sel["winner"], "inner_aucs": sel["inner_aucs"],
                  "platt": {"a": sel["platt"][0], "b": sel["platt"][1]},
                  "threshold_p90": round(sel["threshold"], 6), "prevalence": round(float(y.mean()), 6),
                  "explanation": importance},
        "figures": {"curves": curves.name, "features": imp_path.name},
        "runtime_seconds": round(time.time() - started),
    })


if __name__ == "__main__":
    main()
