"""Model 1 training data — Malaga treadmill tests → 60-second windows.

Source: "Treadmill Maximal Exercise Tests from the Exercise Physiology and Human
Performance Lab of the University of Malaga", PhysioNet v1.0.1,
https://physionet.org/content/treadmill-exercise-cardioresp/1.0.1/
Licence: CC BY-NC-SA 4.0 (non-commercial, attribution, share-alike).

The raw data is breath-by-breath (~2 s) during ramp tests to exhaustion. A
FitFusion session is sub-maximal and only stores an *average* heart rate, so
the tests are cut down to look like that:

  1. drop rows with missing / implausible HR, VO2, VCO2
  2. drop the first 60 s of each test (mask and analyser settling)
  3. drop the recovery walk after peak speed — HR stays high while VO2 falls,
     which would teach the model a false HR → energy relationship
  4. keep only RER <= 1.0 — above it bicarbonate buffering inflates VCO2 and
     the Weir equation no longer reflects energy expenditure
  5. average into 60-second windows with at least 10 samples

Label: Weir (1949) energy expenditure, kcal/min = 3.941·VO2 + 1.106·VCO2 (L/min).

Download the zip from PhysioNet and extract it into `ml-service/data/malaga/`.

    .venv/Scripts/python.exe -m training.data_malaga
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from training.common import DATA_DIR, banner

MALAGA_DIR = DATA_DIR / "malaga"
PROCESSED_PATH = DATA_DIR / "processed" / "malaga_windows.csv"

SETTLE_SECONDS = 60
MAX_RER = 1.0
WINDOW_SECONDS = 60
MIN_SAMPLES_PER_WINDOW = 10
HR_MIN_BPM, HR_MAX_BPM = 40, 220

# PhysioNet's description reports 149 of 992 tests (15.0%) from female
# participants; code 1 is the one with that count.
MALAGA_FEMALE_CODE = 1
EXPECTED_FEMALE_TESTS = 149


def weir_kcal_per_min(vo2_ml_min: pd.Series, vco2_ml_min: pd.Series) -> pd.Series:
    return (3.941 * vo2_ml_min + 1.106 * vco2_ml_min) / 1000.0


def _find(name: str) -> Path:
    matches = sorted(MALAGA_DIR.rglob(name))
    if not matches:
        raise FileNotFoundError(
            f"{name} not found under {MALAGA_DIR}. Download the Malaga treadmill "
            "dataset from PhysioNet and extract the zip there."
        )
    return matches[0]


def _counts(df: pd.DataFrame) -> tuple[int, int, int]:
    return len(df), df["ID_test"].nunique(), df["ID"].nunique()


def load_malaga_windows(verbose: bool = True) -> tuple[pd.DataFrame, list[dict]]:
    """Return (windows, funnel). One row per 60-second sub-maximal window."""
    subjects = pd.read_csv(_find("subject-info.csv"))
    measures = pd.read_csv(_find("test_measure.csv"))

    female_tests = int((subjects["Sex"] == MALAGA_FEMALE_CODE).sum())
    if female_tests != EXPECTED_FEMALE_TESTS and verbose:
        print(
            f"  [warn] {female_tests} tests coded female, PhysioNet documents "
            f"{EXPECTED_FEMALE_TESTS} — check the sex coding for this version"
        )

    funnel: list[dict] = []

    def step(label: str, df: pd.DataFrame) -> None:
        rows, tests, people = _counts(df)
        funnel.append({"step": label, "rows": rows, "tests": tests, "people": people})

    df = measures
    step("raw breath-by-breath rows", df)

    df = df.dropna(subset=["HR", "VO2", "VCO2"])
    df = df[df["HR"].between(HR_MIN_BPM, HR_MAX_BPM) & (df["VO2"] > 0) & (df["VCO2"] > 0)]
    step(f"HR {HR_MIN_BPM}-{HR_MAX_BPM} bpm, VO2 and VCO2 present", df)

    df = df[df["time"] >= SETTLE_SECONDS]
    step(f"after first {SETTLE_SECONDS} s (analyser settling)", df)

    peak_time = df.loc[df.groupby("ID_test")["Speed"].idxmax(), ["ID_test", "time"]]
    peak_time = peak_time.rename(columns={"time": "peak_time"})
    df = df.merge(peak_time, on="ID_test")
    df = df[df["time"] <= df["peak_time"]]
    step("exercise phase only (recovery walk removed)", df)

    df = df[(df["VCO2"] / df["VO2"]) <= MAX_RER]
    step(f"sub-maximal, RER <= {MAX_RER}", df)

    df = df.assign(
        kcal_per_min=weir_kcal_per_min(df["VO2"], df["VCO2"]),
        window=(df["time"] // WINDOW_SECONDS).astype(int),
    )
    windows = (
        df.groupby(["ID", "ID_test", "window"])
        .agg(
            hr=("HR", "mean"),
            kcal_per_min=("kcal_per_min", "mean"),
            speed_kmh=("Speed", "mean"),
            n_samples=("HR", "size"),
        )
        .reset_index()
    )
    windows = windows[windows["n_samples"] >= MIN_SAMPLES_PER_WINDOW]

    windows = windows.merge(
        subjects[["ID_test", "Age", "Sex", "Height", "Weight"]], on="ID_test", how="inner"
    )
    funnel.append(
        {
            "step": f"{WINDOW_SECONDS}-s windows with >= {MIN_SAMPLES_PER_WINDOW} samples",
            "rows": len(windows),
            "tests": windows["ID_test"].nunique(),
            "people": windows["ID"].nunique(),
        }
    )

    # Every test counts equally, so a long test cannot dominate the fit.
    per_test = windows.groupby("ID_test")["window"].transform("size")
    sample_weight = 1.0 / per_test
    sample_weight = sample_weight / sample_weight.mean()

    out = pd.DataFrame(
        {
            "person_id": "malaga-" + windows["ID"].astype(str),
            "test_id": windows["ID_test"].astype(str),
            "age": windows["Age"].astype(float),
            "is_female": (windows["Sex"] == MALAGA_FEMALE_CODE).astype(int),
            "height_cm": windows["Height"].astype(float),
            "weight_kg": windows["Weight"].astype(float),
            "hr": windows["hr"].round(1),
            "kcal_per_min": windows["kcal_per_min"].round(3),
            "speed_kmh": windows["speed_kmh"].round(2),
            "n_samples": windows["n_samples"].astype(int),
            "sample_weight": sample_weight.round(5),
        }
    ).reset_index(drop=True)

    return out, funnel


def main() -> None:
    banner("Model 1 data — Malaga treadmill tests (training set)")
    windows, funnel = load_malaga_windows()

    print("\n  Filter funnel:")
    print(f"    {'step':52s} {'rows':>9s} {'tests':>6s} {'people':>7s}")
    for f in funnel:
        print(f"    {f['step']:52s} {f['rows']:9d} {f['tests']:6d} {f['people']:7d}")

    print("\n  Final windows:")
    desc = windows[["age", "height_cm", "weight_kg", "hr", "kcal_per_min"]].describe(
        percentiles=[0.05, 0.5, 0.95]
    )
    print(desc.loc[["min", "5%", "50%", "95%", "max"]].round(1).to_string())
    by_sex = windows.groupby("is_female").agg(
        windows=("test_id", "size"), people=("person_id", "nunique")
    )
    print("\n  By sex (is_female):")
    print(by_sex.to_string())
    multi = windows.groupby("person_id")["test_id"].nunique()
    print(f"\n  People with more than one test: {int((multi > 1).sum())} "
          "(cross-validation must group by person)")
    print(f"  HR ~ kcal/min correlation: {windows['hr'].corr(windows['kcal_per_min']):.3f}")

    PROCESSED_PATH.parent.mkdir(parents=True, exist_ok=True)
    windows.to_csv(PROCESSED_PATH, index=False)
    print(f"\n[data] wrote {PROCESSED_PATH}")


if __name__ == "__main__":
    main()
