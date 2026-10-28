"""Model 1 external test data — WEEE lab protocol → steady-state segments.

Source: Gashi et al., "A multidevice and multimodal dataset for human energy
expenditure estimation using wearable devices", Scientific Data 9, 537 (2022).
Data: https://zenodo.org/records/6420886 (CC BY 4.0).

Never used for training or tuning — it only scores the finished model.

Protocol (Study_Information.csv): Sit, Stand, Cycle1, Cycle2, Run1, Run2, about
five minutes each. Ground truth is a VO2 Master calorimeter; heart rate is the
Wahoo TICKR chest strap paired to it. Both are in `P##/VO2/DataAverage.csv` at
1 s resolution, already time-aligned (split recordings are merged there too).

The VO2 Master measures oxygen only — no VCO2 — so the Weir equation cannot be
applied. Energy uses the fixed caloric equivalent of oxygen, 5.0 kcal per litre.
On the Malaga data, where VCO2 exists, that approximation differs from Weir by a
median 2.7%.

Body measurements come from Demographics.csv, not the calorimeter's Details.txt.
The analyser profile was stale for P04 (wrong sex and age), P08 (a copy of P06)
and P15; Demographics weights agree with their own BMI column for all three.
The label is unaffected: VO2 in mL/min is measured independently of the profile,
which only scales the mL/kg/min column.

Each segment is scored on its last 120 s (steady state), where the segment ends
at the next activity's start or five minutes after its own start, whichever is
first.

Exclusion rules (fixed before any model was trained):
  * participant P14 — the Cycle1..Run2 start times are placeholders
  * less than 80% of seconds in the window carry a VO2 reading, or a HR reading
  * a time mentioned in the researcher's comment falls inside the segment
    (stops, interruptions, restarts)
  * exercise HR below 50 bpm, or below that participant's own sitting HR

Extract the Zenodo zip into `ml-service/data/weee/`.

    .venv/Scripts/python.exe -m training.data_weee
"""

from __future__ import annotations

import re

import pandas as pd

from training.common import DATA_DIR, banner

WEEE_DIR = DATA_DIR / "weee" / "dataset"
PROCESSED_PATH = DATA_DIR / "processed" / "weee_segments.csv"

ACTIVITIES = ["Sit", "Stand", "Cycle1", "Cycle2", "Run1", "Run2"]
EXERCISE_ACTIVITIES = ["Cycle1", "Cycle2", "Run1", "Run2"]

KCAL_PER_LITRE_O2 = 5.0
SEGMENT_SECONDS = 300
STEADY_STATE_SECONDS = 120
MIN_COVERAGE = 0.8
MIN_EXERCISE_HR = 50

EXCLUDED_PARTICIPANTS = {
    "P14": "Cycle1-Run2 start times are identical placeholders (11:05:00, before the session began)",
}

_TIME_IN_COMMENT = re.compile(r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b")


def _noted_times(comment: str, day: pd.Timestamp) -> list[pd.Timestamp]:
    times = []
    for match in _TIME_IN_COMMENT.findall(comment or ""):
        parts = match.split(":")
        if len(parts) == 2:
            match = f"{match}:00"
        times.append(pd.Timestamp(f"{day.date()} {match}"))
    return times


def _read_recording(participant: str) -> pd.DataFrame:
    path = WEEE_DIR / participant / "VO2" / "DataAverage.csv"
    rec = pd.read_csv(path)
    rec["ts"] = pd.to_datetime(rec["Time"], errors="coerce")
    rec = rec.dropna(subset=["ts"]).drop_duplicates(subset=["ts"])
    return rec[["ts", "VO2[mL/min]", "HR[bpm]"]].rename(
        columns={"VO2[mL/min]": "vo2", "HR[bpm]": "hr"}
    )


def load_weee_segments() -> pd.DataFrame:
    """One row per participant × activity, with `included` and `exclusion_reason`."""
    if not WEEE_DIR.exists():
        raise FileNotFoundError(
            f"{WEEE_DIR} not found. Download dataset.zip from "
            "https://zenodo.org/records/6420886 and extract it into data/weee/."
        )

    study = pd.read_csv(WEEE_DIR / "Study_Information.csv")
    study.columns = study.columns.str.strip()
    demo = pd.read_csv(WEEE_DIR / "Demographics.csv")
    demo.columns = demo.columns.str.strip()
    demo["Participant"] = demo["Participant"].str.strip()
    demo = demo.set_index("Participant")

    rows: list[dict] = []
    for _, info in study.iterrows():
        participant = str(info["Participant"]).strip()
        person = demo.loc[participant]
        starts = {a: pd.Timestamp(info[f"Start_{a}"]) for a in ACTIVITIES}
        comment = str(info.get("Comments", "") or "").strip()
        noted = _noted_times(comment, starts["Sit"])
        rec = _read_recording(participant)

        for i, activity in enumerate(ACTIVITIES):
            start = starts[activity]
            end = start + pd.Timedelta(seconds=SEGMENT_SECONDS)
            if i + 1 < len(ACTIVITIES):
                end = min(end, starts[ACTIVITIES[i + 1]])
            win_start = end - pd.Timedelta(seconds=STEADY_STATE_SECONDS)
            window = rec[(rec["ts"] >= win_start) & (rec["ts"] < end)]

            vo2 = window["vo2"].where(window["vo2"] > 0)
            hr = window["hr"].where(window["hr"] > 0)
            vo2_mean = float(vo2.mean()) if vo2.notna().any() else float("nan")

            speed_col = (
                "Cycle_Speed1" if activity == "Cycle1" else
                "Cycle_Speed2" if activity == "Cycle2" else
                "Run_Speed1" if activity == "Run1" else
                "Run_Speed2" if activity == "Run2" else None
            )

            rows.append(
                {
                    "participant": participant,
                    "activity": activity,
                    "is_exercise": activity in EXERCISE_ACTIVITIES,
                    "segment_start": start,
                    "window_start": win_start,
                    "window_end": end,
                    "age": float(person["Age"]),
                    "is_female": int(str(person["Gender"]).strip().upper() == "F"),
                    "height_cm": float(person["Height"]),
                    "weight_kg": float(person["Weight"]),
                    "hr": round(float(hr.mean()), 1) if hr.notna().any() else float("nan"),
                    "vo2_ml_min": round(vo2_mean, 1),
                    "kcal_per_min": round(vo2_mean / 1000.0 * KCAL_PER_LITRE_O2, 3),
                    "vo2_coverage": round(vo2.notna().sum() / STEADY_STATE_SECONDS, 3),
                    "hr_coverage": round(hr.notna().sum() / STEADY_STATE_SECONDS, 3),
                    "researcher_met": float(info[f"MET_{activity}"]),
                    "intensity_setting": float(info[speed_col]) if speed_col else float("nan"),
                    "comment": comment,
                    "_noted_in_segment": any(start <= t < end for t in noted),
                }
            )

    seg = pd.DataFrame(rows)

    sit_hr = (
        seg[(seg["activity"] == "Sit") & (seg["hr_coverage"] >= MIN_COVERAGE)]
        .set_index("participant")["hr"]
    )

    reasons: list[str] = []
    for _, r in seg.iterrows():
        reason = ""
        if r["participant"] in EXCLUDED_PARTICIPANTS:
            reason = f"participant excluded: {EXCLUDED_PARTICIPANTS[r['participant']]}"
        elif r["vo2_coverage"] < MIN_COVERAGE:
            reason = f"VO2 coverage {r['vo2_coverage']:.0%} < {MIN_COVERAGE:.0%}"
        elif r["hr_coverage"] < MIN_COVERAGE:
            reason = f"HR coverage {r['hr_coverage']:.0%} < {MIN_COVERAGE:.0%}"
        elif r["_noted_in_segment"]:
            reason = f"researcher-noted event inside segment: \"{r['comment']}\""
        elif r["is_exercise"] and r["hr"] < MIN_EXERCISE_HR:
            reason = f"exercise HR {r['hr']:.0f} bpm < {MIN_EXERCISE_HR}"
        elif (
            r["is_exercise"]
            and r["participant"] in sit_hr.index
            and r["hr"] < sit_hr[r["participant"]]
        ):
            reason = (
                f"exercise HR {r['hr']:.0f} bpm below own sitting HR "
                f"{sit_hr[r['participant']]:.0f} bpm"
            )
        reasons.append(reason)

    seg["exclusion_reason"] = reasons
    seg["included"] = seg["exclusion_reason"] == ""
    return seg.drop(columns=["_noted_in_segment"])


def main() -> None:
    banner("Model 1 data — WEEE lab protocol (external test set)")
    seg = load_weee_segments()

    grid = seg.pivot(index="participant", columns="activity", values="included")[ACTIVITIES]
    print("\n  Segment inclusion (Y = included):")
    print(grid.replace({True: "Y", False: "."}).to_string())

    for group, label in ((True, "Exercise"), (False, "Rest (outside training range)")):
        part = seg[seg["is_exercise"] == group]
        kept = part[part["included"]]
        print(
            f"\n  {label}: {len(kept)}/{len(part)} segments kept "
            f"from {kept['participant'].nunique()} participants"
        )

    print("\n  Exclusions:")
    for _, r in seg[~seg["included"] & (seg["participant"] != "P14")].iterrows():
        print(f"    {r['participant']} {r['activity']:7s} {r['exclusion_reason']}")
    print(f"    P14 (all)   {EXCLUDED_PARTICIPANTS['P14']}")

    kept = seg[seg["included"]]
    print("\n  Included segments by activity:")
    summary = kept.groupby("activity").agg(
        n=("participant", "size"),
        hr=("hr", "mean"),
        kcal_per_min=("kcal_per_min", "mean"),
        kcal_min=("kcal_per_min", "min"),
        kcal_max=("kcal_per_min", "max"),
    )
    print(summary.reindex([a for a in ACTIVITIES if a in summary.index]).round(1).to_string())
    print(f"\n  Women among included exercise segments: "
          f"{int(kept[kept['is_exercise']]['is_female'].sum())}")

    PROCESSED_PATH.parent.mkdir(parents=True, exist_ok=True)
    seg.to_csv(PROCESSED_PATH, index=False)
    print(f"\n[data] wrote {PROCESSED_PATH}")


if __name__ == "__main__":
    main()
