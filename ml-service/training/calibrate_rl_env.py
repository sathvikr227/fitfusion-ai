"""Model 5 — estimate the RL environment's real-data curves (PROTOCOL.md).

1. Fitness adaptation vs weekly load ratio, from the Strava logs (Model 4 data).
2. Injury relative risk vs acute:chronic load ratio, from the runners data (Model 3 data).
3. Weekly sleep distribution and persistence, from SoccerMon.

    .venv/Scripts/python.exe -u -m training.calibrate_rl_env     # ~5 min

Writes models/rl_calibration.json (read by the trainer), the same numbers to
models/reports/rl_calibration.json, and models/reports/rl_calibration.png.
These are observational associations, not causal effects, and are labelled so.
"""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from app.trajectory_runs import pace_10k  # noqa: E402
from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402
from training.data_soccermon import load_daily, verify_zip  # noqa: E402
from training.data_strava import load_runs, verify  # noqa: E402

LOAD_RATIO_EDGES = [0.0, 0.5, 0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 2.0, np.inf]
ACWR_EDGES = [0.0, 0.6, 0.8, 1.0, 1.3, 1.5, 2.0, np.inf]
REFERENCE_ACWR = (0.8, 1.3)
MIN_BIN = 200


def bin_label(lo: float, hi: float) -> str:
    return f"{lo:g}-{hi:g}" if np.isfinite(hi) else f">={lo:g}"


def adaptation_curve() -> dict:
    """Weekly km ratio vs change in median 10 km-equivalent pace (next 4 weeks vs previous 4)."""
    verify()
    runs, _ = load_runs()
    day = runs["datetime"].to_numpy().astype("datetime64[D]").astype(np.int64)
    runs = runs.assign(week=(day + 3) // 7, p10=pace_10k(runs["distance"].to_numpy(), runs["duration"].to_numpy()))
    weekly = runs.groupby(["athlete", "week"]).agg(km=("distance", "sum"), pace=("p10", "median")).reset_index()
    del runs

    # Full week grid per athlete, so weeks without a run count as 0 km.
    spans = weekly.groupby("athlete")["week"].agg(["min", "max"])
    athletes = np.repeat(spans.index.to_numpy(), (spans["max"] - spans["min"] + 1).to_numpy())
    weeks = np.concatenate([np.arange(a, b + 1) for a, b in zip(spans["min"], spans["max"])])
    grid = pd.DataFrame({"athlete": athletes, "week": weeks}).merge(weekly, on=["athlete", "week"], how="left")
    grid["km"] = grid["km"].fillna(0.0)
    g = grid.groupby("athlete", sort=False)
    prev_km = g["km"].transform(lambda s: s.shift(1).rolling(4, min_periods=4).mean())
    pace_before = g["pace"].transform(lambda s: s.shift(1).rolling(4, min_periods=2).median())
    pace_after = g["pace"].transform(lambda s: s[::-1].shift(1).rolling(4, min_periods=2).median()[::-1])
    ratio = grid["km"] / prev_km
    gain = -(pace_after / pace_before - 1.0)  # positive = faster = fitter
    ok = (prev_km > 0) & ratio.notna() & gain.notna() & np.isfinite(ratio)
    frame = pd.DataFrame({"ratio": ratio[ok], "gain": gain[ok]})
    frame["bin"] = pd.cut(frame["ratio"], LOAD_RATIO_EDGES, right=False)
    table = frame.groupby("bin", observed=True)["gain"].agg(["mean", "count", "std"])
    bins = []
    for interval, row in table.iterrows():
        bins.append({"bin": bin_label(interval.left, interval.right), "lo": float(interval.left),
                     "hi": float(interval.right) if np.isfinite(interval.right) else None,
                     "n": int(row["count"]), "mean_4wk_gain": float(row["mean"]),
                     "weekly_gain": float(row["mean"]) / 4.0,
                     "se": float(row["std"] / np.sqrt(row["count"]))})
    return {"source": "Strava logs (Afonseca et al., CC BY 4.0)", "athlete_weeks": int(len(frame)),
            "overall_mean_4wk_gain": float(frame["gain"].mean()), "bins": bins}


WEEK_CSV_SHA256 = "261ba3a481f3428611cc175eac2b67749ee3d97980d81168af13bd9f932d5a31"


def injury_curve() -> dict:
    """Runners: injury rate by acute:chronic km ratio, as relative risk vs the 0.8-1.3 band.

    Uses the dataset's week-approach file: for every event day it stores the km of
    each of the 3 preceding weeks ("total kms" = the week before, ".1" and ".2"
    earlier). ACWR = last week / mean of the 3 weeks (a 21-day chronic window).
    The day-approach file cannot be used: it omits most days before each injury.
    """
    import hashlib

    from training.data_runners import RUNNERS_DIR

    path = RUNNERS_DIR / "week_approach_maskedID_timeseries.csv"
    if hashlib.sha256(path.read_bytes()).hexdigest() != WEEK_CSV_SHA256:
        raise ValueError(f"{path.name} does not match the recorded SHA-256")
    data = pd.read_csv(path)
    weeks = data[["total kms", "total kms.1", "total kms.2"]].to_numpy(dtype=float)
    chronic = weeks.mean(axis=1)
    acwr = np.where(chronic > 0, weeks[:, 0] / np.where(chronic > 0, chronic, 1), np.nan)
    frame = pd.DataFrame({"acwr": acwr, "injury": data["injury"].to_numpy()}).dropna()
    frame["bin"] = pd.cut(frame["acwr"], ACWR_EDGES, right=False)
    table = frame.groupby("bin", observed=True)["injury"].agg(["mean", "count", "sum"])
    band = frame[(frame["acwr"] >= REFERENCE_ACWR[0]) & (frame["acwr"] < REFERENCE_ACWR[1])]["injury"]
    ref = band.mean()
    bins = [{"bin": bin_label(iv.left, iv.right), "lo": float(iv.left),
             "hi": float(iv.right) if np.isfinite(iv.right) else None,
             "n": int(r["count"]), "injuries": int(r["sum"]), "daily_rate": float(r["mean"]),
             "relative_risk": float(r["mean"] / ref) if ref > 0 else None}
            for iv, r in table.iterrows()]
    daily = float(data["injury"].mean())
    return {"source": "Lovdal et al. runners, week-approach file (CC0)",
            "acwr_definition": "last week km / mean km of the last 3 weeks (21-day chronic)",
            "days_with_acwr": int(len(frame)), "reference_band": list(REFERENCE_ACWR),
            "reference_daily_rate": float(ref), "overall_daily_rate": daily,
            "baseline_weekly_probability": float(1 - (1 - daily) ** 7), "bins": bins}


def sleep_stats() -> dict:
    verify_zip()
    daily = load_daily()[["player", "date", "sleep_duration"]].dropna()
    daily["week"] = daily["date"].dt.to_period("W")
    weekly = daily.groupby(["player", "week"])["sleep_duration"].mean().reset_index()
    weekly = weekly.sort_values(["player", "week"])
    lag = weekly.groupby("player")["sleep_duration"].shift(1)
    ok = lag.notna()
    return {"source": "SoccerMon sleep_duration (CC BY 4.0)", "player_weeks": int(len(weekly)),
            "mean": float(weekly["sleep_duration"].mean()), "sd": float(weekly["sleep_duration"].std()),
            "lag1_autocorrelation": float(np.corrcoef(weekly["sleep_duration"][ok], lag[ok])[0, 1])}


def draw(adapt: dict, injury: dict) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6))
    a = [b for b in adapt["bins"] if b["n"] >= MIN_BIN]
    axes[0].bar([b["bin"] for b in a], [100 * b["mean_4wk_gain"] for b in a],
                yerr=[196 * b["se"] for b in a], color="#0891b2", capsize=3)
    axes[0].axhline(0, color="k", lw=0.8)
    axes[0].set(title="Strava: pace improvement over the next 4 weeks\nby this week's km / previous 4-week mean",
                xlabel="weekly load ratio", ylabel="10 km-pace improvement (%)")
    axes[0].tick_params(axis="x", rotation=30)
    i = [b for b in injury["bins"] if b["relative_risk"] is not None]
    axes[1].bar([b["bin"] for b in i], [b["relative_risk"] for b in i], color="#dc2626")
    axes[1].axhline(1, color="k", lw=0.8)
    for x, b in enumerate(i):
        axes[1].text(x, b["relative_risk"], f"n={b['injuries']}", ha="center", va="bottom", fontsize=8)
    axes[1].set(title="Runners: injury relative risk by acute:chronic km ratio\n(vs the 0.8-1.3 band)",
                xlabel="ACWR", ylabel="relative risk")
    axes[1].tick_params(axis="x", rotation=30)
    fig.tight_layout()
    path = REPORT_DIR / "rl_calibration.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path.name


def main() -> None:
    banner("Model 5 — RL environment calibration from real data")
    ensure_dirs()
    adapt = adaptation_curve()
    print(json.dumps(adapt, indent=1)[:2500], flush=True)
    injury = injury_curve()
    print(json.dumps(injury, indent=1)[:2500], flush=True)
    sleep = sleep_stats()
    print(sleep, flush=True)
    figure = draw(adapt, injury)
    calibration = {"adaptation": adapt, "injury": injury, "sleep": sleep, "min_bin_n": MIN_BIN,
                   "note": "Observational associations used to calibrate a simulator; not causal estimates."}
    (MODEL_DIR / "rl_calibration.json").write_text(json.dumps(calibration, indent=2), encoding="utf-8")
    write_report("rl_calibration", {**calibration, "figure": figure})


if __name__ == "__main__":
    main()
