"""Model 3 — training-load injury risk, shared by the trainer and the endpoint.

The model is trained on the Lövdal, den Hartigh & Azzopardi (2021) runners data
(DataverseNL doi:10.34894/UWU9PV, CC0): each row is a day, the features are the
seven days before it, and the label is whether the athlete got injured that
day. The label has no body part, so the endpoint attributes risk to regions
with the fixed rules in `region_levels` (see demos/model3_injury/PROTOCOL.md).

Feature names use `d1` for the day before the event and `d7` for seven days
before. The dataset's own suffixes run the other way: ".6" is the day before
and no suffix is seven days before (README v2, 2024).
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Iterable, Mapping

import numpy as np

from .features import INJURY_LABELS, normalize_workout_type

WINDOW_DAYS = 7

# Dataset column -> our short name, in the dataset's column order.
RUNNER_VARIABLES: dict[str, str] = {
    "nr. sessions": "sessions",
    "total km": "total_km",
    "km Z3-4": "km_z34",
    "km Z5-T1-T2": "km_z5",
    "km sprinting": "km_sprint",
    "strength training": "strength",
    "hours alternative": "alt_hours",
    "perceived exertion": "exertion",
    "perceived trainingSuccess": "success",
    "perceived recovery": "recovery",
}

# The four variables FitFusion records with the same meaning.
APP_VARIABLES = ["sessions", "total_km", "strength", "alt_hours"]
FULL_VARIABLES = list(RUNNER_VARIABLES.values())
# Volume variables get a 7-day sum; the perceived ratings do not, because rest
# days carry a -0.01 sentinel that a sum would mix into the signal.
SUMMED = {"sessions", "total_km", "km_z34", "km_z5", "km_sprint", "strength", "alt_hours"}

# Upper bounds seen in training; serving clips to them so a logging glitch
# cannot push the model far outside the data it learned from.
SESSIONS_MAX = 2
STRENGTH_MAX = 1


def day_column(variable: str, days_before: int) -> str:
    return f"{variable}_d{days_before}"


def feature_names(variables: Iterable[str]) -> list[str]:
    variables = list(variables)
    names = [day_column(v, d) for v in variables for d in range(WINDOW_DAYS, 0, -1)]
    names += [f"{v}_7d" for v in variables if v in SUMMED]
    names.append("rest_days_7d")
    return names


APP_FEATURES = feature_names(APP_VARIABLES)
FULL_FEATURES = feature_names(FULL_VARIABLES)


def add_derived(frame, variables: Iterable[str]) -> None:
    """Append the 7-day sums and rest-day count to a frame of day columns, in place."""
    for variable in variables:
        if variable in SUMMED:
            frame[f"{variable}_7d"] = sum(frame[day_column(variable, d)] for d in range(1, WINDOW_DAYS + 1))
    frame["rest_days_7d"] = sum(
        (frame[day_column("sessions", d)] == 0).astype(float) for d in range(1, WINDOW_DAYS + 1)
    )


def features_from_days(days: list[Mapping[str, float]]) -> dict[str, float]:
    """FitFusion's last 7 days (oldest first, yesterday last) -> APP feature row."""
    if len(days) != WINDOW_DAYS:
        raise ValueError(f"need exactly {WINDOW_DAYS} days, got {len(days)}")
    row: dict[str, float] = {}
    for index, day in enumerate(days):
        days_before = WINDOW_DAYS - index
        row[day_column("sessions", days_before)] = float(min(max(day.get("sessions", 0), 0), SESSIONS_MAX))
        row[day_column("total_km", days_before)] = float(max(day.get("total_km", 0), 0))
        row[day_column("strength", days_before)] = float(min(max(day.get("strength", 0), 0), STRENGTH_MAX))
        row[day_column("alt_hours", days_before)] = float(max(day.get("alt_hours", 0), 0))
    for variable in APP_VARIABLES:
        row[f"{variable}_7d"] = sum(row[day_column(variable, d)] for d in range(1, WINDOW_DAYS + 1))
    row["rest_days_7d"] = float(sum(row[day_column("sessions", d)] == 0 for d in range(1, WINDOW_DAYS + 1)))
    return {name: row[name] for name in APP_FEATURES}


RUNNING = re.compile(r"\b(run|jog|treadmill)")


def build_recent_days(
    workout_logs: list[Mapping],
    exercises_by_log: Mapping[str, list[str]],
    cardio_logs: list[Mapping],
    today: date,
    window: int = WINDOW_DAYS,
) -> list[dict]:
    """FitFusion rows -> the `window` days before `today` in runners units (PROTOCOL.md mapping).

    sessions  = 1 if any workout log that day (duplicate rows collapsed) + cardio sessions
    total_km  = running/jogging/treadmill distance
    strength  = 1 if that day's logged exercises include one classed as Strength
    alt_hours = duration of non-running cardio
    """
    days = [(today - timedelta(days=offset)).isoformat() for offset in range(window, 0, -1)]
    out = {d: {"date": d, "sessions": 0.0, "total_km": 0.0, "strength": 0.0, "alt_hours": 0.0} for d in days}
    for log in workout_logs:
        day = out.get(str(log.get("date"))[:10])
        if day is None:
            continue
        day["sessions"] = max(day["sessions"], 1.0)
        names = exercises_by_log.get(str(log.get("id")), [])
        if any(normalize_workout_type(name) == "Strength" for name in names):
            day["strength"] = 1.0
    for row in cardio_logs:
        day = out.get(str(row.get("date"))[:10])
        if day is None:
            continue
        day["sessions"] += 1.0
        if RUNNING.search(str(row.get("activity") or "").lower()):
            day["total_km"] += float(row.get("distance_km") or 0)
        else:
            day["alt_hours"] += float(row.get("duration_minutes") or 0) / 60.0
    return [out[d] for d in days]


# ── Round 2: three weeks of load (week-approach file) ─────────────────────────
# demos/model3_injury/PROTOCOL_ROUND2.md, Amendment 1. Training (the dataset's
# weekly summaries) and serving (FitFusion's last 21 days) both go through
# `derive_week_features`, so the derived features cannot drift apart.
WEEKS = 3
WEEK_WINDOW_DAYS = WEEKS * WINDOW_DAYS  # 21
ACWR_MAX = 3.0

# Week-approach column (week 0 has no suffix, then ".1", ".2") -> our name.
WEEK_SOURCE: dict[str, str] = {
    "nr. sessions": "sessions",
    "nr. rest days": "rest_days",
    "total kms": "km",
    "max km one day": "max_km_day",
    "total hours alternative training": "alt_hours",
    "nr. strength trainings": "strength",
}
WEEK_VARIABLES = list(WEEK_SOURCE.values())
WEEK_BASE_FEATURES = [f"{v}_w{w}" for w in range(WEEKS) for v in WEEK_VARIABLES]
WEEK_DERIVED_FEATURES = ["acwr_km", "acwr_sessions", "km_change_w01", "long_run_share_w0"]
WEEK_FEATURES = WEEK_BASE_FEATURES + WEEK_DERIVED_FEATURES
WEEK0_FEATURES = [f"{v}_w0" for v in WEEK_VARIABLES]


def _acwr(acute, chronic):
    """acute / chronic, clipped to [0, 3]; chronic 0 -> 1 if acute is 0, else 3. Works on arrays."""
    acute = np.asarray(acute, dtype=float)
    chronic = np.asarray(chronic, dtype=float)
    safe = np.where(chronic > 0, chronic, 1.0)
    ratio = np.clip(acute / safe, 0.0, ACWR_MAX)
    return np.where(chronic > 0, ratio, np.where(acute > 0, ACWR_MAX, 1.0))


def derive_week_features(base: Mapping) -> dict:
    """The four derived features from the 18 weekly values (scalars or arrays)."""
    km = [np.asarray(base[f"km_w{w}"], dtype=float) for w in range(WEEKS)]
    sessions = [np.asarray(base[f"sessions_w{w}"], dtype=float) for w in range(WEEKS)]
    max_day = np.asarray(base["max_km_day_w0"], dtype=float)
    return {
        "acwr_km": _acwr(km[0], sum(km) / WEEKS),
        "acwr_sessions": _acwr(sessions[0], sum(sessions) / WEEKS),
        "km_change_w01": km[0] - km[1],
        "long_run_share_w0": np.where(km[0] > 0, np.clip(max_day / np.where(km[0] > 0, km[0], 1.0), 0, 1), 0.0),
    }


def weeks_from_days(days: list[Mapping[str, float]]) -> dict[str, float]:
    """FitFusion's last 21 days (oldest first, ending yesterday) -> the 22 round-2 features.

    Week 0 = days -7...-1, week 1 = -14...-8, week 2 = -21...-15, as in the dataset.
    Each day uses the round-1 mapping (sessions clipped to 2, running km, strength
    day 0/1, alternative hours); rest days = days with no session.
    """
    if len(days) != WEEK_WINDOW_DAYS:
        raise ValueError(f"need exactly {WEEK_WINDOW_DAYS} days, got {len(days)}")
    base: dict[str, float] = {}
    for w in range(WEEKS):
        block = days[WEEK_WINDOW_DAYS - WINDOW_DAYS * (w + 1): WEEK_WINDOW_DAYS - WINDOW_DAYS * w]
        sessions = [min(max(float(d.get("sessions", 0) or 0), 0.0), SESSIONS_MAX) for d in block]
        km = [max(float(d.get("total_km", 0) or 0), 0.0) for d in block]
        base[f"sessions_w{w}"] = float(sum(sessions))
        base[f"rest_days_w{w}"] = float(sum(s == 0 for s in sessions))
        base[f"km_w{w}"] = float(sum(km))
        base[f"max_km_day_w{w}"] = float(max(km))
        base[f"alt_hours_w{w}"] = float(sum(max(float(d.get("alt_hours", 0) or 0), 0.0) for d in block))
        base[f"strength_w{w}"] = float(sum(float(d.get("strength", 0) or 0) > 0 for d in block))
    row = {**base, **{k: float(v) for k, v in derive_week_features(base).items()}}
    return {name: row[name] for name in WEEK_FEATURES}


def platt(score: np.ndarray | float, a: float, b: float) -> np.ndarray | float:
    """Calibrated probability from a raw XGBoost probability (Platt scaling on its logit)."""
    p = np.clip(np.asarray(score, dtype=float), 1e-6, 1 - 1e-6)
    logit = np.log(p / (1 - p))
    out = 1.0 / (1.0 + np.exp(-(a * logit + b)))
    return float(out) if np.ndim(out) == 0 else out


def predict_overall(bundle: dict, row: Mapping[str, float]) -> float:
    x = np.array([[row[name] for name in bundle["features"]]], dtype=float)
    raw = float(bundle["model"].predict_proba(x)[0, 1])
    return float(platt(raw, bundle["platt_a"], bundle["platt_b"]))


# ── Region rules (fixed in PROTOCOL.md before any result was seen) ───────────
RECORDED_ELEVATED = 0.9
RECORDED = 0.6
LOADED_ELEVATED = 0.5
LOADED = 0.2
NEITHER = 0.1


def region_levels(recorded: set[str], loaded: set[str], elevated: bool) -> tuple[dict[str, float], dict[str, str]]:
    """Rule level and its reason for every region. Levels are ordinal, not probabilities."""
    risk: dict[str, float] = {}
    basis: dict[str, str] = {}
    for region in INJURY_LABELS:
        if region in recorded:
            risk[region] = RECORDED_ELEVATED if elevated else RECORDED
            basis[region] = "recorded injury or pain" + (" + elevated training-load risk" if elevated else "")
        elif region in loaded:
            risk[region] = LOADED_ELEVATED if elevated else LOADED
            basis[region] = "loaded by recent exercises" + (" + elevated training-load risk" if elevated else "")
        else:
            risk[region] = NEITHER
            basis[region] = "not recorded, not loaded recently"
    return risk, basis
