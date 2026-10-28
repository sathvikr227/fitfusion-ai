"""Model 4 — running trajectory: features, labels, windows, endpoint contract,
artifact, and dataset checks that skip when the downloads are not present."""

from __future__ import annotations

import json
import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.model_registry import ModelRegistry, get_registry, registry  # noqa: E402
from app.trajectory_runs import RunTransformer, pace_10k, predict_probs, session_matrix, valid_run  # noqa: E402
from training import data_strava  # noqa: E402
from training.common import MODEL_DIR, REPORT_DIR  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
AUTH = {"Authorization": "Bearer test-key"}
client = TestClient(app)
META = MODEL_DIR / "trajectory_runs_meta.json"
needs_artifact = pytest.mark.skipif(not META.exists(), reason="trajectory_runs artifacts not trained")
needs_strava = pytest.mark.skipif(not (data_strava.STRAVA_DIR / "run_ww_2019_d.parquet").exists(),
                                  reason="Strava data not downloaded")

RUN = {"duration": 0.5, "distance_km": 5.0, "gap_days": 2, "day_of_week": 1}


# ── features and labels ───────────────────────────────────────────────────────
def test_riegel_pace_is_identity_at_10k_and_slows_longer_runs():
    assert pace_10k(10, 50) == pytest.approx(5.0)
    # a 5 km run in 25 min (5:00/km) predicts a slower 10 km pace
    assert pace_10k(5, 25) > 5.0
    # a 21.1 km run at 5:00/km predicts a faster 10 km pace
    assert pace_10k(21.1, 105.5) < 5.0


@pytest.mark.parametrize("km, minutes, ok", [(5, 25, True), (0.5, 3, False), (61, 300, False),
                                              (5, 10, False), (5, 80, False), (0, 30, False)])
def test_valid_run_limits(km, minutes, ok):
    assert valid_run(km, minutes) is ok


def test_label_direction_faster_is_improve():
    labels = data_strava.label(np.array([-0.05, 0.0, 0.05]), -0.02, 0.02)
    assert labels.tolist() == [2, 1, 0]  # IMPROVE, PLATEAU, REGRESS


def test_session_matrix_shape_and_values():
    m = session_matrix([{"distance_km": 10, "duration_min": 50, "gap_days": 2, "day_of_week": 0}] * 4)
    assert m.shape == (4, 5)
    assert m[0].tolist() == pytest.approx([10, 50 / 60, 5.0, 2, 0])
    with pytest.raises(ValueError):
        session_matrix([{"distance_km": 10, "duration_min": 50, "gap_days": 2}] * 3)


def test_build_windows_on_a_toy_athlete():
    days = pd.date_range("2019-01-01", periods=17, freq="2D")
    # 10 km runs: 50 min (5:00/km) except runs 5-8, which take 45 min (4:30/km)
    runs = pd.DataFrame({"athlete": 7, "datetime": days, "distance": 10.0,
                         "duration": [50.0] * 5 + [45.0] * 4 + [50.0] * 8})
    w = data_strava.build_windows(runs)
    # 17 runs: run 0 only provides a gap; runs 1-8 and 9-16 make two windows
    assert w["windows"] == 2
    assert w["x"].shape == (2, 4, 5)
    assert w["x"][0, 0, 3] == 2                      # first input session has a real gap
    assert np.isclose(w["x"][0, :, 2], 5.0).all()   # inputs (runs 1-4) at 5:00/km
    assert w["change"][0] == pytest.approx(-0.1)     # outcome 10% faster -> IMPROVE side
    assert w["change"][1] == pytest.approx(0.0)


def test_build_windows_drops_windows_spanning_too_long():
    days = pd.to_datetime(["2019-01-01"] + [f"2019-01-{d:02d}" for d in range(2, 9)] + ["2019-04-01"])
    runs = pd.DataFrame({"athlete": 1, "datetime": days, "distance": 10.0, "duration": 50.0})
    assert data_strava.build_windows(runs)["windows"] == 0


# ── endpoint contract ─────────────────────────────────────────────────────────
def test_trajectory_needs_runs_or_says_why():
    body = {"user_id": "u1", "sessions": [{"duration": 1.0, "completion_rate": 0.8}] * 4}
    r = client.post("/predict/trajectory", json=body, headers=AUTH).json()
    assert r["stub"] is True and r["reason"]


def test_trajectory_rejects_invalid_values():
    bad = {"user_id": "u1", "sessions": [{**RUN, "distance_km": -1}] * 4}
    assert client.post("/predict/trajectory", json=bad, headers=AUTH).status_code == 422


def test_trajectory_falls_back_without_artifacts(tmp_path):
    empty = ModelRegistry(model_dir=tmp_path)
    empty.load_all()
    app.dependency_overrides[get_registry] = lambda: empty
    try:
        r = TestClient(app).post("/predict/trajectory", json={"user_id": "u1", "sessions": [RUN] * 4},
                                 headers=AUTH).json()
        assert r["stub"] is True and "unavailable" in r["reason"]
    finally:
        app.dependency_overrides.clear()


@needs_artifact
def test_trajectory_with_four_runs_uses_the_model_when_served():
    registry.load_all()
    meta = json.loads(META.read_text(encoding="utf-8"))
    r = client.post("/predict/trajectory", json={"user_id": "u1", "sessions": [RUN] * 4}, headers=AUTH).json()
    if meta["serve"]:
        assert r["stub"] is False and r["sessions_used"] == 4
        assert sum(r["probs"].values()) == pytest.approx(1.0, abs=1e-3)
        assert r["label"] == max(r["probs"], key=r["probs"].get)
    else:
        assert r["stub"] is True and "serving rule" in r["reason"]


@needs_artifact
def test_artifact_matches_report_and_is_deterministic():
    import torch

    meta = json.loads(META.read_text(encoding="utf-8"))
    report = json.loads((REPORT_DIR / "trajectory_runs.json").read_text(encoding="utf-8"))
    assert meta["serve"] == report["decision"]["serve"]
    assert meta["test_accuracy"] == report["test"]["Transformer"]["accuracy"]
    model = RunTransformer()
    model.load_state_dict(torch.load(MODEL_DIR / "trajectory_runs.pt", map_location="cpu", weights_only=True))
    raw = session_matrix([{"distance_km": 8, "duration_min": 42, "gap_days": 2, "day_of_week": d} for d in range(4)])
    a, b = predict_probs(model, meta, raw), predict_probs(model, meta, raw)
    assert np.allclose(a, b) and a.shape == (1, 3)


# ── dataset ───────────────────────────────────────────────────────────────────
@needs_strava
def test_strava_files_match_figshare_md5():
    data_strava.verify()
