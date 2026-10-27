"""Model 1 — calibrated XGBoost energy model: loading, inference, SHAP, validation.

Runs against the artifacts in MODEL_DIR (models/calorie_hr_model.pkl and
models/calorie_energy.json) and skips when they are missing. Every input here is
a hand-written example, not a real user.
"""

from __future__ import annotations

import json
import os
import shutil

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.calorie_model import CalorieModelError, check_bundle, predict_with_explanation  # noqa: E402
from app.config import settings  # noqa: E402
from app.energy import CALORIE_HR_FEATURES  # noqa: E402
from app.main import app  # noqa: E402
from app.model_registry import ModelRegistry, registry  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}

# Example session (labelled example input, not a real user).
SESSION = {
    "weight_kg": 72,
    "height_cm": 175,
    "age": 21,
    "sex": "Male",
    "avg_hr": 150,
    "duration_min": 30,
    "exercise": "Running",
}


@pytest.fixture(scope="module", autouse=True)
def loaded():
    registry.load_all()
    if registry.calorie_model is None or registry.calorie is None:
        pytest.skip(f"Model 1 artifacts missing: {registry.errors}")
    return registry


def predict(**overrides):
    return client.post("/predict/calories", json={**SESSION, **overrides}, headers=AUTH)


# ── loading ────────────────────────────────────────────────────────────────────
def test_artifact_loads_with_expected_feature_order():
    bundle = registry.calorie_model
    assert bundle["feature_names"] == CALORIE_HR_FEATURES
    assert type(bundle["model"]).__name__ == "XGBRegressor"
    assert registry.calorie["served_estimator"] == "xgboost"


def test_check_bundle_rejects_mismatched_feature_order():
    bad = {**registry.calorie_model, "feature_names": list(reversed(CALORIE_HR_FEATURES))}
    with pytest.raises(CalorieModelError, match="feature order"):
        check_bundle(bad)
    with pytest.raises(CalorieModelError):
        check_bundle({"not": "a bundle"})


def test_missing_model_file_falls_back_to_keytel(tmp_path):
    # Only the calibration JSON: the registry must serve Keytel, not crash.
    shutil.copy(registry.model_dir / "calorie_energy.json", tmp_path / "calorie_energy.json")
    reg = ModelRegistry(model_dir=tmp_path)
    reg.load_all()
    assert reg.calorie is not None
    assert reg.calorie_model is None
    assert "calorie_model" in reg.errors


# ── inference ──────────────────────────────────────────────────────────────────
def test_api_uses_xgboost_and_matches_the_loaded_model():
    body = predict().json()
    assert body["estimator"] == "xgboost"
    assert body["method"] == "heart_rate"
    assert body["validated"] is True

    # Recompute from the artifact directly: proves the number is model output.
    bundle, energy = registry.calorie_model, registry.calorie
    row = np.array([[21, 0, 175, 72, 150]], dtype=float)
    raw = float(bundle["model"].predict(row)[0])
    expected = energy["model_intercept"] + energy["model_slope"] * raw
    assert body["kcal_per_min"] == pytest.approx(expected, abs=0.01)
    assert body["calories"] == pytest.approx(expected * 30, abs=0.5)
    assert body["explanation"]["raw_model_kcal_per_min"] == pytest.approx(raw, abs=0.001)


def test_shap_contributions_add_up_to_the_prediction():
    body = predict().json()
    exp = body["explanation"]
    assert set(exp["contributions"]) == set(CALORIE_HR_FEATURES)
    total = exp["base_kcal_per_min"] + sum(exp["contributions"].values())
    assert total == pytest.approx(body["kcal_per_min"], abs=0.01)


def test_native_contributions_equal_shap_library():
    shap = pytest.importorskip("shap")
    bundle, energy = registry.calorie_model, registry.calorie
    pred = predict_with_explanation(
        bundle, energy, age=21, is_female=False, height_cm=175, weight_kg=72, hr=150
    )
    explainer = shap.TreeExplainer(bundle["model"])
    values = explainer.shap_values(np.array([[21, 0, 175, 72, 150]], dtype=float))[0]
    for i, name in enumerate(CALORIE_HR_FEATURES):
        assert pred.contributions[name] == pytest.approx(energy["model_slope"] * values[i], abs=1e-3)


def test_heart_rate_dominates_and_raises_the_estimate():
    easy = predict(avg_hr=110).json()
    hard = predict(avg_hr=170).json()
    assert hard["kcal_per_min"] > easy["kcal_per_min"]
    contributions = hard["explanation"]["contributions"]
    assert max(contributions, key=lambda k: abs(contributions[k])) == "hr"


def test_inputs_outside_training_range_are_flagged():
    body = predict(age=70).json()
    assert body["estimator"] == "xgboost"
    assert any("age" in w for w in body["warnings"])
    assert predict().json()["warnings"] == []


def test_missing_height_uses_keytel_and_says_why():
    payload = {k: v for k, v in SESSION.items() if k != "height_cm"}
    body = client.post("/predict/calories", json=payload, headers=AUTH).json()
    assert body["estimator"] == "keytel"
    assert body["method"] == "heart_rate"
    assert "height" in body["fallback_reason"]
    assert body["explanation"] is None


def test_strength_session_uses_met_not_the_model():
    body = predict(exercise="Bench press").json()
    assert body["estimator"] == "met"
    assert "cardio" in body["reason"]


# ── invalid input ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "change",
    [
        {"height_cm": 50},          # below 100 cm
        {"height_cm": 5000},        # the QA report's 5,000 cm
        {"age": 5},                 # below 10
        {"avg_hr": 400},            # above 230 bpm
        {"avg_hr": "fast"},         # not a number
        {"weight_kg": 0},           # must be > 0
    ],
)
def test_invalid_values_are_rejected_with_422(change):
    response = predict(**change)
    assert response.status_code == 422
    assert response.json()["detail"]


@pytest.mark.parametrize("missing", ["weight_kg", "duration_min"])
def test_missing_required_fields_are_rejected(missing):
    payload = {k: v for k, v in SESSION.items() if k != missing}
    response = client.post("/predict/calories", json=payload, headers=AUTH)
    assert response.status_code == 422


def test_non_finite_input_raises_model_error():
    with pytest.raises(CalorieModelError):
        predict_with_explanation(
            registry.calorie_model, registry.calorie,
            age=21, is_female=False, height_cm=float("nan"), weight_kg=72, hr=150,
        )


def test_calibration_without_model_coefficients_is_rejected():
    energy = {k: v for k, v in registry.calorie.items() if not k.startswith("model_")}
    with pytest.raises(CalorieModelError, match="coefficients"):
        predict_with_explanation(
            registry.calorie_model, energy,
            age=21, is_female=False, height_cm=175, weight_kg=72, hr=150,
        )
