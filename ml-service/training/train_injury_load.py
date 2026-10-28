"""Model 3 Part A — training-load injury risk on the competitive-runners data.

Implements demos/model3_injury/PROTOCOL.md exactly (committed before training):

  * test set = fold 0 of StratifiedGroupKFold(5, shuffle, seed 42) over athletes,
    scored once at the end;
  * XGBoost grid chosen by mean ROC-AUC on athlete-grouped 5-fold CV of the rest;
  * Platt calibration + F1-maximising threshold from out-of-fold predictions;
  * baselines: prevalence, workload rule, logistic regression;
  * athlete-cluster bootstrap CIs; serve XGB-APP only if its ROC-AUC CI > 0.5.

    .venv/Scripts/python.exe -m training.train_injury_load      # about 2 minutes

Writes models/injury_load_model.pkl, models/reports/injury_load.json and figures.
"""

from __future__ import annotations

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import StratifiedGroupKFold  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402

from app.injury_load import APP_FEATURES, FULL_FEATURES, platt  # noqa: E402
from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402
from training.data_runners import DAY_CSV_SHA256, funnel, load_runners  # noqa: E402

ARTIFACT = "injury_load_model.pkl"
MODEL_VERSION = "injury-load-xgb-v1"
GRID = [{"max_depth": d, "n_estimators": n} for d in (2, 3, 4) for n in (200, 400)]
BOOTSTRAP_RESAMPLES = 2000
FEATURE_SETS = {"APP": APP_FEATURES, "FULL": FULL_FEATURES}
RULE_FEATURE = {"APP": "sessions_7d", "FULL": "total_km_7d"}
DISCLAIMER = (
    "Informational injury-risk indicator from training load, learned from 74 competitive "
    "runners. Body regions are flagged by fixed rules, not predicted. Not a medical diagnosis."
)


def make_xgb(config: dict, y: np.ndarray) -> XGBClassifier:
    return XGBClassifier(
        max_depth=config["max_depth"],
        n_estimators=config["n_estimators"],
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        scale_pos_weight=float((y == 0).sum() / max((y == 1).sum(), 1)),
        eval_metric="logloss",
        random_state=RANDOM_SEED,
        n_jobs=2,
    )


def make_logreg():
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(class_weight="balanced", C=1.0, max_iter=2000),
    )


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(y, p)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    return float(thresholds[int(np.argmax(f1[:-1]))])


def fit_platt(y: np.ndarray, raw: np.ndarray) -> tuple[float, float]:
    p = np.clip(raw, 1e-6, 1 - 1e-6)
    logit = np.log(p / (1 - p)).reshape(-1, 1)
    lr = LogisticRegression(C=1e6, max_iter=1000).fit(logit, y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def threshold_metrics(y: np.ndarray, p: np.ndarray, t: float) -> dict:
    pred = (p >= t).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(t), 5),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "flag_rate": round(float(pred.mean()), 4),
        "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]],
    }


def cluster_indices(groups: np.ndarray, rng: np.random.Generator, n: int) -> list[np.ndarray]:
    """Row indices for n athlete-cluster bootstrap resamples."""
    unique = np.unique(groups)
    rows_by_group = {g: np.flatnonzero(groups == g) for g in unique}
    samples = []
    for _ in range(n):
        picked = rng.choice(unique, size=len(unique), replace=True)
        samples.append(np.concatenate([rows_by_group[g] for g in picked]))
    return samples


def ci(values: list[float]) -> list[float]:
    return [round(float(np.percentile(values, 2.5)), 4), round(float(np.percentile(values, 97.5)), 4)]


def bootstrap(y, scores: dict[str, np.ndarray], thresholds: dict[str, float], samples) -> dict:
    """CIs for each score's ROC-AUC, PR-AUC (and F1 where a threshold exists)."""
    out = {name: {"roc_auc": [], "pr_auc": [], "f1": []} for name in scores}
    for idx in samples:
        yy = y[idx]
        if yy.min() == yy.max():
            continue
        for name, s in scores.items():
            out[name]["roc_auc"].append(roc_auc_score(yy, s[idx]))
            out[name]["pr_auc"].append(average_precision_score(yy, s[idx]))
            if name in thresholds:
                out[name]["f1"].append(f1_score(yy, (s[idx] >= thresholds[name]).astype(int), zero_division=0))
    return {
        name: {k: ci(v) for k, v in metrics.items() if v}
        for name, metrics in out.items()
    }


def paired_auc_difference(y, a: np.ndarray, b: np.ndarray, samples) -> dict:
    diffs = []
    for idx in samples:
        yy = y[idx]
        if yy.min() == yy.max():
            continue
        diffs.append(roc_auc_score(yy, a[idx]) - roc_auc_score(yy, b[idx]))
    return {"difference": round(float(roc_auc_score(y, a) - roc_auc_score(y, b)), 4), "ci95": ci(diffs)}


def select_xgb(dev: pd.DataFrame, features: list[str], folds) -> tuple[dict, list[dict], np.ndarray]:
    X, y = dev[features].to_numpy(), dev["injury"].to_numpy()
    results, oof_by_config = [], {}
    for config in GRID:
        oof = np.zeros(len(dev))
        aucs = []
        for train_idx, val_idx in folds:
            model = make_xgb(config, y[train_idx]).fit(X[train_idx], y[train_idx])
            oof[val_idx] = model.predict_proba(X[val_idx])[:, 1]
            aucs.append(roc_auc_score(y[val_idx], oof[val_idx]))
        key = (config["max_depth"], config["n_estimators"])
        oof_by_config[key] = oof
        results.append({**config, "mean_auc": round(float(np.mean(aucs)), 4),
                        "fold_aucs": [round(float(a), 4) for a in aucs]})
        print(f"    depth {config['max_depth']} trees {config['n_estimators']}: "
              f"mean fold AUC {np.mean(aucs):.4f}")
    # Highest mean AUC; ties (to 4 decimals) go to the smaller model.
    best = max(results, key=lambda r: (r["mean_auc"], -r["max_depth"], -r["n_estimators"]))
    chosen = {"max_depth": best["max_depth"], "n_estimators": best["n_estimators"]}
    return chosen, results, oof_by_config[(chosen["max_depth"], chosen["n_estimators"])]


def logreg_oof(dev: pd.DataFrame, features: list[str], folds) -> np.ndarray:
    X, y = dev[features].to_numpy(), dev["injury"].to_numpy()
    oof = np.zeros(len(dev))
    for train_idx, val_idx in folds:
        oof[val_idx] = make_logreg().fit(X[train_idx], y[train_idx]).predict_proba(X[val_idx])[:, 1]
    return oof


def shap_importance(model: XGBClassifier, X: np.ndarray, features: list[str]) -> dict:
    contribs = model.get_booster().predict(
        __import__("xgboost").DMatrix(X, feature_names=features), pred_contribs=True
    )[:, :-1]
    mean_abs = np.abs(contribs).mean(axis=0)
    order = np.argsort(mean_abs)[::-1]
    return {features[i]: round(float(mean_abs[i]), 5) for i in order}


def draw_figures(y, scores: dict[str, np.ndarray], served: np.ndarray, threshold: float,
                 importance: dict, calib: tuple[np.ndarray, np.ndarray]) -> dict:
    paths = {}
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for name, s in scores.items():
        fpr, tpr, _ = roc_curve(y, s)
        axes[0].plot(fpr, tpr, label=f"{name} (AUC {roc_auc_score(y, s):.3f})")
        precision, recall, _ = precision_recall_curve(y, s)
        axes[1].plot(recall, precision, label=f"{name} (AP {average_precision_score(y, s):.3f})")
    axes[0].plot([0, 1], [0, 1], "k:", lw=1)
    axes[0].set(title="ROC — held-out test athletes", xlabel="False positive rate", ylabel="True positive rate")
    axes[1].axhline(y.mean(), color="k", ls=":", lw=1, label=f"prevalence {y.mean():.3f}")
    axes[1].set(title="Precision-recall — held-out test athletes", xlabel="Recall", ylabel="Precision")
    for ax in axes:
        ax.legend(fontsize=8)
    fig.tight_layout()
    paths["curves"] = REPORT_DIR / "injury_load_roc_pr.png"
    fig.savefig(paths["curves"], dpi=130)
    plt.close(fig)

    cm = confusion_matrix(y, (served >= threshold).astype(int), labels=[0, 1])
    fig, ax = plt.subplots(figsize=(4.8, 4.2))
    ax.imshow(cm, cmap="Blues")
    for (i, j), value in np.ndenumerate(cm):
        ax.text(j, i, f"{value:,}", ha="center", va="center", fontsize=12,
                color="white" if value > cm.max() / 2 else "black")
    ax.set(xticks=[0, 1], yticks=[0, 1], xticklabels=["no injury", "injury"],
           yticklabels=["no injury", "injury"], xlabel="Predicted", ylabel="Actual",
           title=f"XGB-APP at threshold {threshold:.4f}")
    fig.tight_layout()
    paths["confusion"] = REPORT_DIR / "injury_load_confusion.png"
    fig.savefig(paths["confusion"], dpi=130)
    plt.close(fig)

    top = list(importance.items())[:15][::-1]
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh([k for k, _ in top], [v for _, v in top], color="#0891b2")
    ax.set(title="XGB-APP: mean |SHAP| on test athletes (log-odds)", xlabel="mean |SHAP value|")
    fig.tight_layout()
    paths["shap"] = REPORT_DIR / "injury_load_shap.png"
    fig.savefig(paths["shap"], dpi=130)
    plt.close(fig)

    predicted, observed = calib
    fig, ax = plt.subplots(figsize=(5, 4.5))
    ax.plot(predicted, observed, "o-", label="XGB-APP (Platt)")
    lim = max(predicted.max(), observed.max()) * 1.1
    ax.plot([0, lim], [0, lim], "k:", lw=1, label="perfect calibration")
    ax.set(title="Calibration on test athletes (deciles)", xlabel="Mean predicted probability",
           ylabel="Observed injury rate")
    ax.legend(fontsize=8)
    fig.tight_layout()
    paths["calibration"] = REPORT_DIR / "injury_load_calibration.png"
    fig.savefig(paths["calibration"], dpi=130)
    plt.close(fig)
    return {k: v.name for k, v in paths.items()}


def calibration_deciles(y: np.ndarray, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    bins = pd.qcut(p, 10, labels=False, duplicates="drop")
    frame = pd.DataFrame({"p": p, "y": y, "bin": bins}).groupby("bin").mean()
    return frame["p"].to_numpy(), frame["y"].to_numpy()


def main() -> None:
    banner("Model 3 Part A — training-load injury risk (competitive runners)")
    ensure_dirs()
    data = load_runners()
    data_funnel = funnel(data)
    print(f"[data] {data_funnel}")

    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    dev_idx, test_idx = next(outer.split(data, data["injury"], data["athlete"]))
    dev, test = data.iloc[dev_idx].reset_index(drop=True), data.iloc[test_idx].reset_index(drop=True)
    assert not set(dev["athlete"]) & set(test["athlete"]), "athlete leakage between dev and test"
    split = {
        "development": {"rows": len(dev), "athletes": int(dev["athlete"].nunique()),
                        "injuries": int(dev["injury"].sum())},
        "test": {"rows": len(test), "athletes": int(test["athlete"].nunique()),
                 "injuries": int(test["injury"].sum()),
                 "athlete_ids": sorted(int(a) for a in test["athlete"].unique())},
    }
    print(f"[split] {split['development']} | test {({k: v for k, v in split['test'].items() if k != 'athlete_ids'})}")

    inner = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    folds = list(inner.split(dev, dev["injury"], dev["athlete"]))
    y_dev, y_test = dev["injury"].to_numpy(), test["injury"].to_numpy()

    selection, served_parts = {}, {}
    test_scores: dict[str, np.ndarray] = {}
    thresholds: dict[str, float] = {}
    dev_oof_metrics = {}

    for set_name, features in FEATURE_SETS.items():
        banner(f"Feature set {set_name} ({len(features)} features) — model selection on development athletes")
        chosen, grid_results, oof = select_xgb(dev, features, folds)
        a, b = fit_platt(y_dev, oof)
        oof_cal = platt(oof, a, b)
        t_xgb = best_f1_threshold(y_dev, oof_cal)
        print(f"  chosen {chosen}; Platt a={a:.4f} b={b:.4f}; OOF-F1 threshold {t_xgb:.5f}")

        lr_oof = logreg_oof(dev, features, folds)
        t_lr = best_f1_threshold(y_dev, lr_oof)

        final = make_xgb(chosen, y_dev).fit(dev[features].to_numpy(), y_dev)
        test_scores[f"XGB-{set_name}"] = platt(final.predict_proba(test[features].to_numpy())[:, 1], a, b)
        thresholds[f"XGB-{set_name}"] = t_xgb
        lr_final = make_logreg().fit(dev[features].to_numpy(), y_dev)
        test_scores[f"LogReg-{set_name}"] = lr_final.predict_proba(test[features].to_numpy())[:, 1]
        thresholds[f"LogReg-{set_name}"] = t_lr
        test_scores[f"Rule-{set_name}"] = test[RULE_FEATURE[set_name]].to_numpy().astype(float)

        selection[set_name] = {"chosen": chosen, "grid": grid_results, "platt": {"a": a, "b": b}}
        dev_oof_metrics[set_name] = {
            "xgb_oof_roc_auc": round(float(roc_auc_score(y_dev, oof)), 4),
            "xgb_oof_at_threshold": threshold_metrics(y_dev, oof_cal, t_xgb),
            "logreg_oof_roc_auc": round(float(roc_auc_score(y_dev, lr_oof)), 4),
            "logreg_oof_at_threshold": threshold_metrics(y_dev, lr_oof, t_lr),
        }
        served_parts[set_name] = (final, a, b, t_xgb, features)

    prevalence_dev = float(y_dev.mean())
    test_scores["Prevalence"] = np.full(len(test), prevalence_dev)

    banner("Held-out test athletes — scored once")
    test_metrics = {}
    for name, s in test_scores.items():
        entry = {"roc_auc": round(float(roc_auc_score(y_test, s)), 4),
                 "pr_auc": round(float(average_precision_score(y_test, s)), 4)}
        if name in thresholds:
            entry["at_threshold"] = threshold_metrics(y_test, s, thresholds[name])
        test_metrics[name] = entry
    test_metrics["Prevalence"]["always_positive_f1"] = round(
        float(f1_score(y_test, np.ones_like(y_test))), 4)
    test_metrics["XGB-APP"]["brier"] = round(float(brier_score_loss(y_test, test_scores["XGB-APP"])), 5)
    test_metrics["XGB-FULL"]["brier"] = round(float(brier_score_loss(y_test, test_scores["XGB-FULL"])), 5)

    rng = np.random.default_rng(RANDOM_SEED)
    samples = cluster_indices(test["athlete"].to_numpy(), rng, BOOTSTRAP_RESAMPLES)
    cis = bootstrap(y_test, {k: v for k, v in test_scores.items() if k != "Prevalence"}, thresholds, samples)
    for name, bounds in cis.items():
        test_metrics[name]["ci95"] = bounds
    differences = {
        "XGB-APP minus LogReg-APP": paired_auc_difference(y_test, test_scores["XGB-APP"], test_scores["LogReg-APP"], samples),
        "XGB-APP minus Rule-APP": paired_auc_difference(y_test, test_scores["XGB-APP"], test_scores["Rule-APP"], samples),
        "XGB-FULL minus XGB-APP": paired_auc_difference(y_test, test_scores["XGB-FULL"], test_scores["XGB-APP"], samples),
        "XGB-FULL minus LogReg-FULL": paired_auc_difference(y_test, test_scores["XGB-FULL"], test_scores["LogReg-FULL"], samples),
    }

    for name, m in test_metrics.items():
        line = f"  {name:12s} ROC-AUC {m['roc_auc']:.4f}"
        if "ci95" in m:
            line += f" [{m['ci95']['roc_auc'][0]:.3f}, {m['ci95']['roc_auc'][1]:.3f}]"
        line += f"  PR-AUC {m['pr_auc']:.4f}"
        if "at_threshold" in m:
            t = m["at_threshold"]
            line += f"  P {t['precision']:.3f} R {t['recall']:.3f} F1 {t['f1']:.3f} flag {t['flag_rate']:.3f}"
        print(line)
    for name, d in differences.items():
        print(f"  {name:28s} ΔAUC {d['difference']:+.4f} [95% CI {d['ci95'][0]:+.4f}, {d['ci95'][1]:+.4f}]")

    # ── Pre-registered serving rule ───────────────────────────────────────────
    app_ci_low = test_metrics["XGB-APP"]["ci95"]["roc_auc"][0]
    serve = app_ci_low > 0.5
    lr_better = differences["XGB-APP minus LogReg-APP"]["ci95"][1] < 0
    decision = {
        "rule": "serve XGB-APP iff the lower bound of its test ROC-AUC 95% CI > 0.50",
        "xgb_app_roc_auc_ci_low": app_ci_low,
        "serve": bool(serve),
        "logreg_significantly_better": bool(lr_better),
        "slide_target_f1_over_0_75_met": bool(test_metrics["XGB-APP"]["at_threshold"]["f1"] > 0.75),
    }
    print(f"\n[decision] {decision}")

    final, a, b, t_xgb, features = served_parts["APP"]
    importance = shap_importance(final, test[features].to_numpy(), features)
    figures = draw_figures(
        y_test,
        {k: test_scores[k] for k in ("XGB-APP", "XGB-FULL", "LogReg-APP", "Rule-APP")},
        test_scores["XGB-APP"], t_xgb, importance,
        calibration_deciles(y_test, test_scores["XGB-APP"]),
    )

    bundle = {
        "model": final,
        "features": features,
        "platt_a": a,
        "platt_b": b,
        "threshold": t_xgb,
        "prevalence": prevalence_dev,
        "serve": bool(serve),
        "model_version": MODEL_VERSION,
        "config": selection["APP"]["chosen"],
        "test_roc_auc": test_metrics["XGB-APP"]["roc_auc"],
        "test_roc_auc_ci95": test_metrics["XGB-APP"]["ci95"]["roc_auc"],
        "data_sha256": DAY_CSV_SHA256,
        "disclaimer": DISCLAIMER,
    }
    joblib.dump(bundle, MODEL_DIR / ARTIFACT)
    print(f"[artifact] wrote {MODEL_DIR / ARTIFACT}")

    write_report(
        "injury_load",
        {
            "artifact": ARTIFACT,
            "model_version": MODEL_VERSION,
            "protocol": "demos/model3_injury/PROTOCOL.md (committed 1340716 before training)",
            "dataset": {
                "title": "Replication Data for: Injury Prediction In Competitive Runners With Machine Learning",
                "doi": "10.34894/UWU9PV", "version": 2, "licence": "CC0-1.0",
                "file": "day_approach_maskedID_timeseries.csv", "sha256": DAY_CSV_SHA256,
                "funnel": data_funnel,
            },
            "label": "injury on the event day (binary, no body part); features = the 7 preceding days",
            "feature_sets": {k: v for k, v in FEATURE_SETS.items()},
            "split": split,
            "selection": selection,
            "development_oof": dev_oof_metrics,
            "test": test_metrics,
            "auc_differences": differences,
            "decision": decision,
            "shap_mean_abs_test": importance,
            "figures": figures,
            "published_reference": "Lövdal et al. 2021 report AUC 0.724 (day approach) with their own "
                                   "protocol (bagged XGBoost, all 10 variables); not directly comparable.",
        },
    )


if __name__ == "__main__":
    main()
