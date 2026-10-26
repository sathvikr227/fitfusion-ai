"""Model 1 data loaders — pure-function checks plus dataset checks that skip
when the Malaga / WEEE downloads are not present."""

from __future__ import annotations

import pandas as pd
import pytest

from training import data_malaga, data_weee


def test_weir_equation_matches_published_coefficients():
    # 2 L/min O2 and 1.8 L/min CO2 → 3.941·2 + 1.106·1.8 = 9.8728 kcal/min
    kcal = data_malaga.weir_kcal_per_min(pd.Series([2000.0]), pd.Series([1800.0]))
    assert kcal.iloc[0] == pytest.approx(9.8728)


def test_comment_times_are_parsed_on_the_session_day():
    day = pd.Timestamp("2021-12-01 18:44:00")
    times = data_weee._noted_times("VO2 Stopped at 19:07:50 - restart at 19:10", day)
    assert times == [pd.Timestamp("2021-12-01 19:07:50"), pd.Timestamp("2021-12-01 19:10:00")]
    assert data_weee._noted_times("Sleepiness level 2 if 4 is very sleepy", day) == []


needs_malaga = pytest.mark.skipif(
    not data_malaga.MALAGA_DIR.exists(), reason="Malaga dataset not downloaded"
)
needs_weee = pytest.mark.skipif(
    not data_weee.WEEE_DIR.exists(), reason="WEEE dataset not downloaded"
)


@needs_malaga
def test_malaga_windows_are_submaximal_and_complete():
    windows, funnel = data_malaga.load_malaga_windows(verbose=False)
    assert len(windows) > 5000
    assert windows[["age", "is_female", "height_cm", "weight_kg", "hr", "kcal_per_min"]].notna().all().all()
    assert windows["hr"].between(data_malaga.HR_MIN_BPM, data_malaga.HR_MAX_BPM).all()
    assert (windows["n_samples"] >= data_malaga.MIN_SAMPLES_PER_WINDOW).all()
    assert windows["sample_weight"].mean() == pytest.approx(1.0, abs=1e-3)
    assert [f["rows"] for f in funnel] == sorted([f["rows"] for f in funnel], reverse=True)


@needs_weee
def test_weee_exclusions_follow_the_fixed_rules():
    seg = data_weee.load_weee_segments()
    assert not seg[seg["participant"] == "P14"]["included"].any()

    kept = seg[seg["included"]]
    assert (kept["vo2_coverage"] >= data_weee.MIN_COVERAGE).all()
    assert (kept["hr_coverage"] >= data_weee.MIN_COVERAGE).all()
    assert (kept[kept["is_exercise"]]["hr"] >= data_weee.MIN_EXERCISE_HR).all()

    # P07's running HR strap dropped out (researcher note: "Low quality HR during running").
    p07_run1 = seg[(seg["participant"] == "P07") & (seg["activity"] == "Run1")].iloc[0]
    assert not p07_run1["included"]


# ── Model 1: equations and trained artifact ───────────────────────────────────
def test_keytel_equation_matches_published_coefficients():
    from app.energy import keytel_kcal_per_min

    # Man, 150 bpm, 75 kg, 30 y: (-55.0969 + 94.635 + 14.91 + 6.051) / 4.184
    male = keytel_kcal_per_min([150], [75], [30], [0])[0]
    assert male == pytest.approx((-55.0969 + 0.6309 * 150 + 0.1988 * 75 + 0.2017 * 30) / 4.184)
    female = keytel_kcal_per_min([150], [60], [30], [1])[0]
    assert female == pytest.approx((-20.4022 + 0.4472 * 150 - 0.1263 * 60 + 0.074 * 30) / 4.184)


from training.common import MODEL_DIR  # noqa: E402

calorie_hr_artifact = MODEL_DIR / "calorie_hr_model.pkl"


@pytest.mark.skipif(not calorie_hr_artifact.exists(), reason="calorie_hr_model.pkl not trained")
def test_calorie_hr_model_rises_with_heart_rate_and_weight():
    import joblib
    import numpy as np

    bundle = joblib.load(calorie_hr_artifact)
    model = bundle["model"]
    # age, is_female, height_cm, weight_kg, hr
    hr_sweep = np.array([[30, 0, 178, 75, hr] for hr in (90, 110, 130, 150, 170)], dtype=float)
    preds = model.predict(hr_sweep)
    assert np.all(np.diff(preds) >= 0)
    assert preds[-1] > preds[0]

    weight_sweep = np.array([[30, 0, 178, w, 140] for w in (55, 75, 95)], dtype=float)
    assert np.all(np.diff(model.predict(weight_sweep)) >= 0)
