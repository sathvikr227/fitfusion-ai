"""Loader for the SoccerMon subjective data (exploratory knee analysis, Model 3 Part B).

Source: Midoglu et al. (2024), Zenodo doi:10.5281/zenodo.10033832, CC BY 4.0.
Download only subjective.zip (706 kB, no login) into data/soccermon/ and unzip it
to data/soccermon/extracted/:

    https://zenodo.org/records/10033832/files/subjective.zip?download=1

The four GPS archives (about 99 GB) are not needed.

    .venv/Scripts/python.exe -m training.data_soccermon    # verify + print episodes
"""

from __future__ import annotations

import hashlib
import json

import pandas as pd

from training.common import DATA_DIR, banner

SOCCER_DIR = DATA_DIR / "soccermon"
ZIP_PATH = SOCCER_DIR / "subjective.zip"
ZIP_SHA256 = "338e9878fbed1f941cfc37b3f012cb356f97cc0f726e80a79aa5c8e67cc2a87c"
SUBJECTIVE = SOCCER_DIR / "extracted" / "subjective"

# A new episode starts after this many days without a report of that location.
EPISODE_GAP_DAYS = 14

WELLNESS = ["soreness", "fatigue", "sleep_duration", "sleep_quality", "readiness", "stress", "mood"]
LOAD = ["daily_load", "acwr", "atl", "ctl28", "monotony", "strain"]


def verify_zip() -> None:
    if not ZIP_PATH.exists():
        raise FileNotFoundError(f"{ZIP_PATH} not found. See the download step in {__file__}.")
    if hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest() != ZIP_SHA256:
        raise ValueError("subjective.zip does not match the recorded SHA-256 (see data/soccermon/SOURCE.txt)")


def read_wide(name: str) -> pd.DataFrame:
    """A per-day x per-player CSV -> long frame (date, player, value)."""
    folder = "wellness" if name in WELLNESS else "training-load"
    wide = pd.read_csv(SUBJECTIVE / folder / f"{name}.csv")
    wide = wide.rename(columns={wide.columns[0]: "date"})
    wide["date"] = pd.to_datetime(wide["date"], format="%d.%m.%Y")
    long = wide.melt(id_vars="date", var_name="player", value_name=name)
    return long


def load_daily() -> pd.DataFrame:
    """Every metric as a column, one row per (player, date)."""
    frame = None
    for name in WELLNESS + LOAD:
        part = read_wide(name)
        frame = part if frame is None else frame.merge(part, on=["date", "player"], how="outer")
    return frame.sort_values(["player", "date"]).reset_index(drop=True)


def load_injury_reports() -> pd.DataFrame:
    """One row per (player, date, location, severity)."""
    raw = pd.read_csv(SUBJECTIVE / "injury" / "injury.csv")
    rows = []
    for record in raw.dropna(subset=["type"]).itertuples():
        for location, severity in json.loads(record.type).items():
            rows.append((record.player_name, pd.to_datetime(record.timestamp, format="%d.%m.%Y"), location, severity))
    return pd.DataFrame(rows, columns=["player", "date", "location", "severity"])


def episodes(reports: pd.DataFrame) -> pd.DataFrame:
    """Episode onsets: first report of a (player, region) after EPISODE_GAP_DAYS without one.

    Left and right are merged into one region (left_knee + right_knee = knee).
    """
    frame = reports.assign(region=reports["location"].str.replace(r"^(left|right)_", "", regex=True))
    frame = frame.sort_values(["player", "region", "date"]).drop_duplicates(["player", "region", "date"])
    gap = frame.groupby(["player", "region"])["date"].diff().dt.days
    return frame[gap.isna() | (gap >= EPISODE_GAP_DAYS)].reset_index(drop=True)


if __name__ == "__main__":
    banner("SoccerMon subjective data — verification")
    verify_zip()
    reports = load_injury_reports()
    onsets = episodes(reports)
    daily = load_daily()
    print(f"  report entries {len(reports)}, players reporting {reports['player'].nunique()}")
    print(f"  players on roster {daily['player'].nunique()}, days {daily['date'].nunique()}")
    print("  episodes by region:")
    summary = onsets.groupby("region").agg(episodes=("player", "size"), players=("player", "nunique"))
    print(summary.sort_values("episodes", ascending=False).to_string())
