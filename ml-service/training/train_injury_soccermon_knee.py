"""Model 3 Part B — exploratory knee-injury classifier on SoccerMon (never served).

Implements Part B of demos/model3_injury/PROTOCOL.md (committed before training).
Only 5 players ever report a knee episode, so whatever this shows is descriptive:
it is reported to show what real body-part labels allow, not deployed.

    .venv/Scripts/python.exe -m training.train_injury_soccermon_knee    # about 1 minute

Writes models/reports/injury_soccermon_knee.json and two figures. No artifact.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve  # noqa: E402
from sklearn.model_selection import StratifiedGroupKFold  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402

from training.common import RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402
from training.data_soccermon import (  # noqa: E402
    EPISODE_GAP_DAYS,
    LOAD,
    WELLNESS,
    ZIP_SHA256,
    episodes,
    load_daily,
    load_injury_reports,
    verify_zip,
)
from training.train_injury_load import ci, cluster_indices  # noqa: E402

HORIZON_DAYS = 7          # label: a knee episode starts on day t ... t+6
ONGOING_DAYS = 14         # drop rows with a knee report in t-14 ... t-1
BOOTSTRAP_RESAMPLES = 2000
FEATURES = (
    [f"{m}_7d_mean" for m in WELLNESS]
    + ["daily_load_7d_sum", "acwr_prev", "atl_prev", "ctl28_prev", "monotony_prev", "strain_prev",
       "wellness_reports_7d"]
)


def build_rows(daily: pd.DataFrame, knee_reports: pd.DataFrame, knee_onsets: pd.DataFrame) -> pd.DataFrame:
    frame = daily.copy()
    by_player = frame.groupby("player", sort=False)
    # Everything is shifted by one day, so row t only sees days t-7 ... t-1.
    for m in WELLNESS:
        frame[f"{m}_7d_mean"] = by_player[m].transform(lambda s: s.shift(1).rolling(7, min_periods=1).mean())
    frame["daily_load_7d_sum"] = by_player["daily_load"].transform(lambda s: s.shift(1).rolling(7, min_periods=1).sum())
    for m in ["acwr", "atl", "ctl28", "monotony", "strain"]:
        frame[f"{m}_prev"] = by_player[m].shift(1)
    reported = frame[WELLNESS].notna().any(axis=1).astype(float)
    frame["wellness_reports_7d"] = reported.groupby(frame["player"]).transform(
        lambda s: s.shift(1).rolling(7, min_periods=1).sum())

    onset_days = knee_onsets.groupby("player")["date"].apply(list).to_dict()
    report_days = knee_reports.groupby("player")["date"].apply(list).to_dict()
    label = np.zeros(len(frame), dtype=int)
    ongoing = np.zeros(len(frame), dtype=bool)
    for i, (player, date) in enumerate(zip(frame["player"], frame["date"])):
        for onset in onset_days.get(player, []):
            if 0 <= (onset - date).days < HORIZON_DAYS:
                label[i] = 1
        for report in report_days.get(player, []):
            if 1 <= (date - report).days <= ONGOING_DAYS:
                ongoing[i] = True
    frame["knee"] = label
    keep = (~ongoing) & (frame["wellness_reports_7d"] > 0)
    return frame.loc[keep, ["player", "date", "knee", *FEATURES]].reset_index(drop=True)


def main() -> None:
    banner("Model 3 Part B — SoccerMon knee injury (exploratory, not served)")
    ensure_dirs()
    verify_zip()
    reports = load_injury_reports()
    onsets = episodes(reports)
    knee_reports = reports[reports["location"].str.endswith("knee")]
    knee_onsets = onsets[onsets["region"] == "knee"]
    daily = load_daily()

    region_counts = (onsets.groupby("region").agg(episodes=("player", "size"), players=("player", "nunique"))
                     .sort_values("episodes", ascending=False))
    print(region_counts.to_string())

    rows = build_rows(daily, knee_reports, knee_onsets)
    y, groups = rows["knee"].to_numpy(), rows["player"].to_numpy()
    funnel = {
        "player_days_on_roster": int(len(daily)),
        "rows_after_exclusions": int(len(rows)),
        "players": int(rows["player"].nunique()),
        "positive_rows": int(y.sum()),
        "knee_episodes": int(len(knee_onsets)),
        "knee_players": int(knee_onsets["player"].nunique()),
        "knee_players_with_positive_rows": int(rows.loc[rows["knee"] == 1, "player"].nunique()),
        "prevalence": round(float(y.mean()), 5),
    }
    print(f"[rows] {funnel}")

    X = rows[FEATURES].to_numpy(dtype=float)
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED).split(X, y, groups))
    oof = {"XGBoost": np.zeros(len(rows)), "LogReg": np.zeros(len(rows))}
    injured_players_per_fold = []
    for train_idx, val_idx in folds:
        ytr = y[train_idx]
        xgb = XGBClassifier(max_depth=2, n_estimators=200, learning_rate=0.05,
                            scale_pos_weight=float((ytr == 0).sum() / max((ytr == 1).sum(), 1)),
                            eval_metric="logloss", random_state=RANDOM_SEED, n_jobs=2)
        oof["XGBoost"][val_idx] = xgb.fit(X[train_idx], ytr).predict_proba(X[val_idx])[:, 1]
        lr = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                           LogisticRegression(class_weight="balanced", C=1.0, max_iter=2000))
        oof["LogReg"][val_idx] = lr.fit(X[train_idx], ytr).predict_proba(X[val_idx])[:, 1]
        injured_players_per_fold.append(int(pd.Series(groups[val_idx][y[val_idx] == 1]).nunique()))
    acwr = rows["acwr_prev"].fillna(rows["acwr_prev"].median()).to_numpy()
    scores = {**oof, "ACWR rule": acwr}

    rng = np.random.default_rng(RANDOM_SEED)
    samples = cluster_indices(groups, rng, BOOTSTRAP_RESAMPLES)
    results = {}
    for name, s in scores.items():
        aucs, aps = [], []
        for idx in samples:
            if y[idx].min() == y[idx].max():
                continue
            aucs.append(roc_auc_score(y[idx], s[idx]))
            aps.append(average_precision_score(y[idx], s[idx]))
        results[name] = {
            "roc_auc": round(float(roc_auc_score(y, s)), 4), "roc_auc_ci95": ci(aucs),
            "pr_auc": round(float(average_precision_score(y, s)), 4), "pr_auc_ci95": ci(aps),
        }
        print(f"  {name:10s} ROC-AUC {results[name]['roc_auc']:.4f} {results[name]['roc_auc_ci95']}  "
              f"PR-AUC {results[name]['pr_auc']:.4f} {results[name]['pr_auc_ci95']}")
    results["Prevalence"] = {"roc_auc": 0.5, "pr_auc": round(float(y.mean()), 5)}

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    labels = [r.replace("_", " / ") for r in region_counts.index]
    axes[0].bar(labels, region_counts["episodes"], color="#7c3aed", label="episodes")
    axes[0].bar(labels, region_counts["players"], color="#0891b2", width=0.4, label="players")
    axes[0].set(title=f"SoccerMon injury episodes by body region\n(new episode after >= {EPISODE_GAP_DAYS} days)",
                ylabel="count")
    axes[0].tick_params(axis="x", rotation=30)
    axes[0].legend()
    for name, s in scores.items():
        fpr, tpr, _ = roc_curve(y, s)
        axes[1].plot(fpr, tpr, label=f"{name} (AUC {results[name]['roc_auc']:.3f})")
    axes[1].plot([0, 1], [0, 1], "k:", lw=1)
    axes[1].set(title=f"Knee onset within {HORIZON_DAYS} days — out-of-fold, {funnel['knee_players']} injured players",
                xlabel="False positive rate", ylabel="True positive rate")
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    figure = REPORT_DIR / "injury_soccermon_knee.png"
    fig.savefig(figure, dpi=130)
    plt.close(fig)

    write_report(
        "injury_soccermon_knee",
        {
            "status": "EXPLORATORY — not served under any outcome (PROTOCOL.md Part B)",
            "protocol": "demos/model3_injury/PROTOCOL.md (committed 1340716 before training)",
            "dataset": {
                "title": "SoccerMon (subjective.zip)", "doi": "10.5281/zenodo.10033832",
                "licence": "CC BY 4.0", "sha256": ZIP_SHA256,
            },
            "episode_rule": f"first left/right knee report after >= {EPISODE_GAP_DAYS} days without one",
            "label": f"knee episode starts on day t ... t+{HORIZON_DAYS - 1}",
            "exclusions": f"knee report in t-{ONGOING_DAYS} ... t-1; no wellness report in t-7 ... t-1",
            "region_episodes": region_counts.reset_index().to_dict(orient="records"),
            "funnel": funnel,
            "features": FEATURES,
            "folds": {"method": "StratifiedGroupKFold(5, shuffle, seed 42) by player",
                      "injured_players_per_fold": injured_players_per_fold},
            "out_of_fold": results,
            "figure": figure.name,
        },
    )


if __name__ == "__main__":
    main()
