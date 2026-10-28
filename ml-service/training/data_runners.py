"""Loader for the Lövdal, den Hartigh & Azzopardi (2021) competitive-runners data.

Source: DataverseNL, doi:10.34894/UWU9PV (dataset version 2), CC0-1.0.
Download the day-approach CSV (no login) into data/runners/:

    https://dataverse.nl/api/access/datafile/47972  -> day_approach_maskedID_timeseries.csv

data/runners/SOURCE.txt records the checksums and access date.

    .venv/Scripts/python.exe -m training.data_runners     # verify + print the funnel
"""

from __future__ import annotations

import hashlib

import pandas as pd

from app.injury_load import FULL_VARIABLES, RUNNER_VARIABLES, WINDOW_DAYS, add_derived, day_column
from training.common import DATA_DIR, banner

RUNNERS_DIR = DATA_DIR / "runners"
DAY_CSV = RUNNERS_DIR / "day_approach_maskedID_timeseries.csv"
DAY_CSV_SHA256 = "9c06ecefae9caa4ca831c08c7ebe4d25b0b01e8aa285df526a4e6791c673b6e8"
EXPECTED = {"rows": 42766, "athletes": 74, "injuries": 583}

ATHLETE, LABEL, DATE = "Athlete ID", "injury", "Date"


def sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_column(dataset_name: str, days_before: int) -> str:
    """Dataset column for a variable `days_before` days before the event (1 = the day before)."""
    suffix = WINDOW_DAYS - days_before  # ".6" is the day before; no suffix is 7 days before
    return dataset_name if suffix == 0 else f"{dataset_name}.{suffix}"


def load_runners(verify: bool = True) -> pd.DataFrame:
    """One row per athlete-day: our feature names, `athlete`, `injury`, `day`."""
    if not DAY_CSV.exists():
        raise FileNotFoundError(f"{DAY_CSV} not found. See the download step in {__file__}.")
    if verify and sha256(DAY_CSV) != DAY_CSV_SHA256:
        raise ValueError(f"{DAY_CSV.name} does not match the recorded SHA-256 (see data/runners/SOURCE.txt)")

    raw = pd.read_csv(DAY_CSV)
    frame = pd.DataFrame(
        {
            day_column(short, d): raw[source_column(name, d)].astype(float)
            for name, short in RUNNER_VARIABLES.items()
            for d in range(WINDOW_DAYS, 0, -1)
        }
    )
    add_derived(frame, FULL_VARIABLES)
    frame["athlete"] = raw[ATHLETE].astype(int)
    frame["injury"] = raw[LABEL].astype(int)
    frame["day"] = raw[DATE].astype(int)

    found = {"rows": len(frame), "athletes": frame["athlete"].nunique(), "injuries": int(frame["injury"].sum())}
    if verify and found != EXPECTED:
        raise ValueError(f"unexpected runners data: {found}, expected {EXPECTED}")
    return frame


def funnel(frame: pd.DataFrame) -> dict:
    injured_athletes = frame.loc[frame["injury"] == 1, "athlete"].nunique()
    gaps = frame[frame["injury"] == 1].sort_values(["athlete", "day"]).groupby("athlete")["day"].diff().dropna()
    return {
        "rows": int(len(frame)),
        "athletes": int(frame["athlete"].nunique()),
        "injury_days": int(frame["injury"].sum()),
        "prevalence": round(float(frame["injury"].mean()), 5),
        "athletes_with_injury": int(injured_athletes),
        "min_days_between_injuries_same_athlete": int(gaps.min()),
        "missing_values": int(frame.isna().sum().sum()),
    }


if __name__ == "__main__":
    banner("Runners injury data — verification")
    data = load_runners()
    for key, value in funnel(data).items():
        print(f"  {key:42s} {value}")
