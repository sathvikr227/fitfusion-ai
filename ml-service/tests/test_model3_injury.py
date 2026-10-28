"""Model 3 — training-load injury risk: feature mapping, region rules, matcher,
artifact, and dataset checks that skip when the downloads are not present."""

from __future__ import annotations

import json
from datetime import date

import pandas as pd
import pytest

from app.features import INJURY_LABELS, exercise_targets_muscle_group
from app.injury_load import (
    APP_FEATURES,
    FULL_FEATURES,
    build_recent_days,
    features_from_days,
    platt,
    region_levels,
)
from training import data_runners, data_soccermon
from training.common import MODEL_DIR, REPORT_DIR

needs_runners = pytest.mark.skipif(not data_runners.DAY_CSV.exists(), reason="runners data not downloaded")
needs_soccermon = pytest.mark.skipif(not data_soccermon.ZIP_PATH.exists(), reason="SoccerMon not downloaded")
ARTIFACT = MODEL_DIR / "injury_load_model.pkl"
needs_artifact = pytest.mark.skipif(not ARTIFACT.exists(), reason="injury_load_model.pkl not trained")


# ── exercise matcher (the substring bug) ──────────────────────────────────────
@pytest.mark.parametrize("name", ["Pullups", "Pull-Up", "pull up", "Wide Grip Pull-ups", "Pushups"])
def test_shoulder_matcher_handles_joined_and_hyphenated_names(name):
    assert exercise_targets_muscle_group(name, "shoulder")


@pytest.mark.parametrize("name, group, expected", [
    ("Crunch", "knee", False),             # "run" inside "crunch" used to match
    ("Bicycle Crunches", "knee", False),
    ("Running", "knee", True),
    ("Situps", "back", True),
    ("Romanian Deadlift", "hamstring", True),
    ("Barbell Curl", "shoulder", False),
])
def test_matcher_matches_word_starts_only(name, group, expected):
    assert exercise_targets_muscle_group(name, group) is expected


# ── feature mapping ───────────────────────────────────────────────────────────
def test_app_features_are_a_subset_of_full_features():
    assert set(APP_FEATURES) < set(FULL_FEATURES)
    assert len(APP_FEATURES) == 4 * 7 + 4 + 1


def test_features_from_days_orders_yesterday_as_d1_and_clips():
    days = [{"sessions": 0, "total_km": 0, "strength": 0, "alt_hours": 0} for _ in range(7)]
    days[6] = {"sessions": 5, "total_km": 10, "strength": 3, "alt_hours": 0.5}   # yesterday
    days[0] = {"sessions": 1, "total_km": 4, "strength": 0, "alt_hours": 0}      # 7 days ago
    row = features_from_days(days)
    assert list(row) == APP_FEATURES
    assert row["sessions_d1"] == 2          # clipped to the training maximum
    assert row["strength_d1"] == 1          # clipped
    assert row["total_km_d1"] == 10 and row["total_km_d7"] == 4
    assert row["total_km_7d"] == 14 and row["sessions_7d"] == 3
    assert row["rest_days_7d"] == 5


def test_features_from_days_needs_seven_days():
    with pytest.raises(ValueError):
        features_from_days([{}] * 6)


def test_build_recent_days_matches_the_typescript_mapping():
    """Same scenario as web/src/lib/ml-service/injury-rules.test.mjs."""
    workout_logs = [
        {"id": "a", "date": "2026-10-21"},
        {"id": "b", "date": "2026-10-21"},
        {"id": "c", "date": "2026-10-27"},
        {"id": "z", "date": "2026-10-28"},
    ]
    exercises = {"a": ["Back Squat"], "c": ["Yoga Flow"]}
    cardio = [
        {"date": "2026-10-22", "activity": "Running", "distance_km": 5, "duration_minutes": 30},
        {"date": "2026-10-22", "activity": "Cycling", "distance_km": 20, "duration_minutes": 45},
        {"date": "2026-10-27", "activity": "Treadmill jog", "distance_km": "3.5", "duration_minutes": 25},
    ]
    days = build_recent_days(workout_logs, exercises, cardio, date(2026, 10, 28))
    assert [d["date"] for d in days] == [f"2026-10-{n}" for n in range(21, 28)]
    assert days[0] == {"date": "2026-10-21", "sessions": 1.0, "total_km": 0.0, "strength": 1.0, "alt_hours": 0.0}
    assert days[1] == {"date": "2026-10-22", "sessions": 2.0, "total_km": 5.0, "strength": 0.0, "alt_hours": 0.75}
    assert days[2]["sessions"] == 0
    assert days[6] == {"date": "2026-10-27", "sessions": 2.0, "total_km": 3.5, "strength": 0.0, "alt_hours": 0.0}


def test_platt_is_monotone():
    assert platt(0.2, 0.5, -4.0) < platt(0.6, 0.5, -4.0) < platt(0.9, 0.5, -4.0)


# ── region rules (PROTOCOL.md table) ──────────────────────────────────────────
def test_region_levels_follow_the_protocol_table():
    quiet, _ = region_levels({"knee"}, {"shoulder"}, elevated=False)
    assert quiet == {"knee": 0.6, "back": 0.1, "shoulder": 0.2, "hamstring": 0.1}
    high, basis = region_levels({"knee"}, {"shoulder"}, elevated=True)
    assert high == {"knee": 0.9, "back": 0.1, "shoulder": 0.5, "hamstring": 0.1}
    assert [r for r in INJURY_LABELS if high[r] >= 0.7] == ["knee"]
    assert "recorded" in basis["knee"] and "loaded" in basis["shoulder"]


# ── trained artifact ──────────────────────────────────────────────────────────
@needs_artifact
def test_artifact_matches_its_report():
    import joblib

    bundle = joblib.load(ARTIFACT)
    report = json.loads((REPORT_DIR / "injury_load.json").read_text(encoding="utf-8"))
    assert bundle["features"] == APP_FEATURES
    assert bundle["serve"] == report["decision"]["serve"]
    assert bundle["test_roc_auc"] == report["test"]["XGB-APP"]["roc_auc"]
    assert 0 < bundle["threshold"] < 1 and 0 < bundle["prevalence"] < 0.05


@needs_artifact
def test_artifact_predicts_a_probability():
    import joblib

    from app.injury_load import predict_overall

    bundle = joblib.load(ARTIFACT)
    rest = features_from_days([{"sessions": 0, "total_km": 0, "strength": 0, "alt_hours": 0}] * 7)
    p = predict_overall(bundle, rest)
    assert 0.0 < p < 1.0
    assert predict_overall(bundle, rest) == p  # deterministic


# ── datasets ──────────────────────────────────────────────────────────────────
def test_runner_suffixes_map_day_before_to_dot_six():
    assert data_runners.source_column("total km", 1) == "total km.6"
    assert data_runners.source_column("total km", 7) == "total km"


@needs_runners
def test_runners_data_matches_recorded_counts():
    frame = data_runners.load_runners()
    funnel = data_runners.funnel(frame)
    assert funnel["rows"] == 42766 and funnel["athletes"] == 74 and funnel["injury_days"] == 583
    assert funnel["min_days_between_injuries_same_athlete"] >= 22
    assert funnel["missing_values"] == 0
    raw = pd.read_csv(data_runners.DAY_CSV, nrows=50)
    assert (frame["total_km_d1"].iloc[:50].to_numpy() == raw["total km.6"].to_numpy()).all()


@needs_runners
def test_test_split_shares_no_athlete_with_development():
    from sklearn.model_selection import StratifiedGroupKFold

    frame = data_runners.load_runners()
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)
    dev_idx, test_idx = next(outer.split(frame, frame["injury"], frame["athlete"]))
    assert not set(frame["athlete"].iloc[dev_idx]) & set(frame["athlete"].iloc[test_idx])
    report = REPORT_DIR / "injury_load.json"
    if report.exists():
        recorded = json.loads(report.read_text(encoding="utf-8"))["split"]["test"]["athlete_ids"]
        assert sorted(int(a) for a in frame["athlete"].iloc[test_idx].unique()) == recorded


@needs_soccermon
def test_soccermon_knee_episodes():
    data_soccermon.verify_zip()
    onsets = data_soccermon.episodes(data_soccermon.load_injury_reports())
    knee = onsets[onsets["region"] == "knee"]
    assert len(knee) == 10 and knee["player"].nunique() == 5
    assert "shoulder" not in set(onsets["region"])
