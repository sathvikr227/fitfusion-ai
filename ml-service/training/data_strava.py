"""Loader for the Strava running logs (Model 4).

Source: Afonseca, Watanabe & Duarte, Figshare doi:10.6084/m9.figshare.16620238
(version 5), CC BY 4.0. Download the two daily files (no login) into
data/strava_runners/:

    https://ndownloader.figshare.com/files/33801866  -> run_ww_2019_d.parquet
    https://ndownloader.figshare.com/files/33801827  -> run_ww_2020_d.parquet

data/strava_runners/SOURCE.txt records the checksums and access date.

    .venv/Scripts/python.exe -m training.data_strava     # verify + print the funnel
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from app.trajectory_runs import MAX_KM, MAX_PACE, MIN_KM, MIN_PACE, SEQ_LEN, WINDOW_SPAN_DAYS, pace_10k
from training.common import DATA_DIR, banner

STRAVA_DIR = DATA_DIR / "strava_runners"
FILES = {
    "run_ww_2019_d.parquet": "e10b8ba19ec1340b14b90049f945c259",
    "run_ww_2020_d.parquet": "35161d5a273f51aa82d05f12bf4e0a04",
}
WINDOW = 2 * SEQ_LEN  # 4 input + 4 outcome sessions


def verify() -> None:
    for name, md5 in FILES.items():
        path = STRAVA_DIR / name
        if not path.exists():
            raise FileNotFoundError(f"{path} not found. See the download step in {__file__}.")
        digest = hashlib.md5()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 22), b""):
                digest.update(chunk)
        if digest.hexdigest() != md5:
            raise ValueError(f"{name} does not match Figshare's MD5 (see data/strava_runners/SOURCE.txt)")


def load_runs() -> tuple[pd.DataFrame, dict]:
    """Run-days of both years, cleaned per PROTOCOL.md, sorted by athlete and date."""
    parts, funnel = [], {"athlete_days": 0, "run_days": 0}
    for name in FILES:
        df = pd.read_parquet(STRAVA_DIR / name, columns=["datetime", "athlete", "distance", "duration"])
        funnel["athlete_days"] += len(df)
        df = df[df["distance"] > 0]
        funnel["run_days"] += len(df)
        parts.append(df)
    runs = pd.concat(parts, ignore_index=True)
    funnel["athletes"] = int(runs["athlete"].nunique())
    pace = runs["duration"] / runs["distance"]
    keep = runs["distance"].between(MIN_KM, MAX_KM) & pace.between(MIN_PACE, MAX_PACE)
    runs = runs[keep].sort_values(["athlete", "datetime"]).reset_index(drop=True)
    funnel["run_days_after_cleaning"] = int(len(runs))
    funnel["athletes_after_cleaning"] = int(runs["athlete"].nunique())
    return runs, funnel


def build_windows(runs: pd.DataFrame) -> dict:
    """Non-overlapping 8-session windows per athlete (stride 8), all within WINDOW_SPAN_DAYS.

    Window positions start at each athlete's 2nd run, so the first input session
    has a real gap to the run before it.
    """
    athlete = runs["athlete"].to_numpy()
    day = runs["datetime"].to_numpy().astype("datetime64[D]").astype(np.int64)
    new_athlete = np.r_[True, athlete[1:] != athlete[:-1]]
    gap = np.r_[0, np.diff(day)].astype(float)
    gap[new_athlete] = np.nan
    k = runs.groupby("athlete").cumcount().to_numpy()  # run index within athlete
    usable = k >= 1
    w_index = (k - 1) // WINDOW
    pos = (k - 1) % WINDOW

    frame = pd.DataFrame({"athlete": athlete, "w": w_index, "pos": pos, "day": day, "gap": gap,
                          "km": runs["distance"].to_numpy(), "min": runs["duration"].to_numpy()})[usable]
    counts = frame.groupby(["athlete", "w"])["pos"].transform("size")
    frame = frame[counts == WINDOW]
    n = len(frame) // WINDOW
    arr = lambda col: frame[col].to_numpy().reshape(n, WINDOW)  # noqa: E731 - rows are ordered by pos
    days, km, minutes, gaps = arr("day"), arr("km"), arr("min"), arr("gap")
    span_ok = (days[:, -1] - days[:, 0]) <= WINDOW_SPAN_DAYS
    athletes = frame["athlete"].to_numpy().reshape(n, WINDOW)[:, 0]

    p10 = pace_10k(km, minutes)
    dow = ((days + 3) % 7).astype(float)  # 1970-01-01 was a Thursday; Monday = 0
    x = np.stack([km[:, :SEQ_LEN], minutes[:, :SEQ_LEN] / 60.0, p10[:, :SEQ_LEN],
                  gaps[:, :SEQ_LEN], dow[:, :SEQ_LEN]], axis=-1).astype(np.float32)
    change = np.median(p10[:, SEQ_LEN:], axis=1) / np.median(p10[:, :SEQ_LEN], axis=1) - 1.0
    last_delta = p10[:, SEQ_LEN - 1] / np.median(p10[:, : SEQ_LEN - 1], axis=1) - 1.0
    return {
        "x": x[span_ok], "change": change[span_ok], "last_delta": last_delta[span_ok],
        "athlete": athletes[span_ok], "start_day": days[span_ok, 0],
        "windows_before_span_filter": int(n), "windows": int(span_ok.sum()),
    }


def label(change: np.ndarray, q1: float, q2: float) -> np.ndarray:
    """0 REGRESS (slower), 1 PLATEAU, 2 IMPROVE (faster)."""
    return np.where(change < q1, 2, np.where(change > q2, 0, 1)).astype(np.int64)


if __name__ == "__main__":
    banner("Strava running logs — verification")
    verify()
    runs, funnel = load_runs()
    windows = build_windows(runs)
    funnel.update(windows_before_span_filter=windows["windows_before_span_filter"],
                  windows=windows["windows"],
                  athletes_with_windows=int(np.unique(windows["athlete"]).size))
    for key, value in funnel.items():
        print(f"  {key:30s} {value:,}")
