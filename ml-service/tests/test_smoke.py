"""End-to-end tests for the five model endpoints.

Runs against whatever artifacts are present in MODEL_DIR. Tests that need a
trained model skip themselves when it is missing, so the suite is meaningful
both before and after training.
"""

from __future__ import annotations

import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.features import INJURY_LABELS, TRAJECTORY_CLASSES  # noqa: E402
from app.main import app  # noqa: E402
from app.model_registry import registry  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}


@pytest.fixture(scope="module", autouse=True)
def loaded_registry():
    registry.load_all()
    return registry


def needs(model: str) -> None:
    if not registry.status().get(model):
        pytest.skip(f"{model} artifact not present ({registry.errors.get(model)})")


# ── health & auth ─────────────────────────────────────────────────────────────
def test_healthz_is_open():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert set(body["models_status"]) == {
        "calorie", "recommender", "injury", "trajectory", "rl"
    }


def test_auth_required_on_every_model_endpoint():
    calls = [
        ("/predict/calories", {"weight_kg": 70, "duration_min": 30}),
        ("/recommend", {"age": 25, "bmi": 24}),
        ("/predict/injury-risk", {"user_id": "u1"}),
        ("/predict/trajectory", {"user_id": "u1", "sessions": [
            {"duration": 1.0, "completion_rate": 0.8}
        ]}),
        ("/rl/action", {
            "user_id": "u1", "completion_rate": 0.7, "sleep_avg": 7, "injury_flag": 0
        }),
    ]
    for path, payload in calls:
        assert client.post(path, json=payload).status_code == 401, path


def test_bad_token_rejected():
    response = client.post(
        "/predict/calories",
        json={"weight_kg": 70, "duration_min": 30},
        headers={"Authorization": "Bearer wrong"},
    )
    assert response.status_code == 401


# ── Model 1: calorie ──────────────────────────────────────────────────────────
def test_calorie_prediction_with_shap():
    needs("calorie")
    response = client.post(
        "/predict/calories",
        json={
            "weight_kg": 74.9,
            "age": 46,
            "bmi": 32.0,
            "resting_bpm": 66,
            "duration_hours": 1.3,
            "workout_type": "HIIT",
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is False
    assert body["calories"] > 0
    assert body["workout_type"] == "HIIT"
    assert len(body["shap_top_features"]) > 0
    assert body["baseline_met_calories"] > 0
    for feature in body["shap_top_features"]:
        assert {"feature", "label", "impact", "value"} <= set(feature)


def test_calorie_accepts_app_native_body_and_imputes():
    """The app sends minutes and an exercise name and often has no resting BPM."""
    needs("calorie")
    response = client.post(
        "/predict/calories",
        json={"weight_kg": 70, "duration_min": 45, "exercise": "Bench Press"},
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["workout_type"] == "Strength"
    assert body["calories"] > 0
    # Age, BMI and resting BPM were absent, so the model reports imputing them.
    assert "Resting_BPM" in body["imputed"]


def test_calorie_legacy_alias_still_works():
    needs("calorie")
    response = client.post(
        "/predict/calorie",
        json={"exercise": "running", "duration_min": 30, "weight_kg": 70},
        headers=AUTH,
    )
    assert response.status_code == 200
    assert response.json()["calories"] > 0


def test_calorie_longer_session_burns_more():
    needs("calorie")
    base = {"weight_kg": 80, "age": 30, "bmi": 25, "resting_bpm": 62, "workout_type": "Cardio"}
    short = client.post("/predict/calories", json={**base, "duration_hours": 0.5}, headers=AUTH)
    long = client.post("/predict/calories", json={**base, "duration_hours": 1.8}, headers=AUTH)
    assert long.json()["calories"] > short.json()["calories"]


def test_calorie_rejects_missing_duration():
    response = client.post("/predict/calories", json={"weight_kg": 70}, headers=AUTH)
    assert response.status_code == 422


def test_calorie_rejects_bad_weight():
    response = client.post(
        "/predict/calories", json={"weight_kg": -5, "duration_min": 30}, headers=AUTH
    )
    assert response.status_code == 422


# ── Model 2: recommender ──────────────────────────────────────────────────────
def test_recommend_returns_workouts_and_diet():
    needs("recommender")
    response = client.post(
        "/recommend",
        json={
            "age": 25,
            "bmi": 24.5,
            "goal": "Muscle Gain",
            "workout_frequency": 5,
            "experience_level": 2,
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is False
    assert len(body["recommended_workouts"]) > 0
    assert body["neighbours_used"] > 0
    assert body["recommended_diet_focus"]["strategy"] == "high_protein"
    assert len(body["recommended_diet_focus"]["foods"]) > 0


def test_recommend_respects_vegetarian_restriction():
    needs("recommender")
    response = client.post(
        "/recommend",
        json={
            "age": 30,
            "bmi": 22,
            "goal": "Muscle Gain",
            "dietary_restrictions": ["Vegetarian"],
            "diet_items": 15,
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert "vegetarian" in body["applied_restrictions"]
    banned = ("beef", "pork", "chicken", "fish", "bacon", "turkey")
    for food in body["recommended_diet_focus"]["foods"]:
        text = f"{food['name']} {food['category']}".lower()
        assert not any(word in text for word in banned), food["name"]


def test_recommend_vegan_excludes_all_animal_foods():
    """Regression: a blocklist alone leaked "Ling" and "Orange Roughy" (both
    fish) into vegan results. Vegan/vegetarian now run an allow-list against the
    food's leading identity."""
    needs("recommender")
    response = client.post(
        "/recommend",
        json={
            "age": 28,
            "bmi": 23,
            "goal": "Muscle Gain",
            "dietary_restrictions": ["vegan"],
            "diet_items": 20,
        },
        headers=AUTH,
    )
    body = response.json()
    assert "vegan" in body["applied_restrictions"]
    animal = (
        "seal", "whale", "meat", "fish", "chicken", "beef", "pork", "duck",
        "roughy", "ling,", "sea cucumber", "gelatin", "egg", "cheese", "milk",
        "butter", "yogurt", "whey", "crab", "shrimp", "tuna", "salmon",
    )
    for food in body["recommended_diet_focus"]["foods"]:
        name = food["name"].lower()
        assert not any(word in name for word in animal), food["name"]


def test_recommend_vegetarian_allows_dairy_and_egg_but_no_flesh():
    needs("recommender")
    response = client.post(
        "/recommend",
        json={
            "age": 28,
            "bmi": 23,
            "goal": "Muscle Gain",
            "dietary_restrictions": ["Vegetarian"],
            "diet_items": 20,
        },
        headers=AUTH,
    )
    flesh = ("seal", "whale", "fish", "chicken", "beef", "pork", "roughy", "shrimp")
    for food in response.json()["recommended_diet_focus"]["foods"]:
        assert not any(word in food["name"].lower() for word in flesh), food["name"]


def test_recommend_diet_picks_are_actual_foods_not_beverages():
    """Regression: ranking weight-loss purely by lowest calories returned diet
    soda, black coffee and tea. Nutrition floors now apply."""
    needs("recommender")
    response = client.post(
        "/recommend",
        json={"age": 35, "bmi": 30, "goal": "Weight Loss", "diet_items": 10},
        headers=AUTH,
    )
    focus = response.json()["recommended_diet_focus"]
    assert focus["avg_protein"] >= 5.0
    for food in focus["foods"]:
        assert food["protein"] >= 4.0, food["name"]
        assert food["calories"] >= 20.0, food["name"]


def test_recommend_excludes_workouts_conflicting_with_injuries():
    needs("recommender")
    response = client.post(
        "/recommend",
        json={"age": 30, "bmi": 26, "goal": "Weight Loss", "injuries": ["lower back pain"]},
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    returned = {w["workout_type"] for w in body["recommended_workouts"]}
    # A back injury withholds Strength and HIIT.
    assert not ({"Strength", "HIIT"} & returned) or body["excluded_workouts"]


def test_recommend_weight_loss_targets_calories():
    needs("recommender")
    response = client.post(
        "/recommend",
        json={"age": 40, "bmi": 31, "goal": "Weight Loss"},
        headers=AUTH,
    )
    assert response.json()["recommended_diet_focus"]["strategy"] == "calorie_deficit"


# ── Model 3: injury risk ──────────────────────────────────────────────────────
def test_injury_risk_returns_all_four_labels():
    needs("injury")
    response = client.post(
        "/predict/injury-risk",
        json={
            "user_id": "u1",
            "age": 28,
            "bmi": 29.0,
            "resting_bpm": 72,
            "session_duration_hours": 1.8,
            "workout_frequency": 5,
            "experience_level": 1,
            "sleep_avg_hours": 7.5,
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is False
    assert set(body["risk"]) == set(INJURY_LABELS)
    for score in body["risk"].values():
        assert 0.0 <= score <= 1.0
    assert body["threshold"] == 0.7
    assert "clinical" in body["disclaimer"].lower()


def test_injury_risk_rises_with_sleep_debt():
    needs("injury")
    base = {
        "user_id": "u1",
        "age": 28,
        "bmi": 26.0,
        "resting_bpm": 65,
        "session_duration_hours": 1.0,
        "workout_frequency": 4,
        "experience_level": 2,
    }
    rested = client.post(
        "/predict/injury-risk", json={**base, "sleep_avg_hours": 8.0}, headers=AUTH
    ).json()
    deprived = client.post(
        "/predict/injury-risk", json={**base, "sleep_avg_hours": 4.5}, headers=AUTH
    ).json()
    assert sum(deprived["risk"].values()) > sum(rested["risk"].values())


def test_injury_risk_boosts_previously_injured_group():
    needs("injury")
    base = {
        "user_id": "u1", "age": 30, "bmi": 24.0, "resting_bpm": 60,
        "session_duration_hours": 1.0, "workout_frequency": 3, "experience_level": 2,
    }
    plain = client.post("/predict/injury-risk", json=base, headers=AUTH).json()
    injured = client.post(
        "/predict/injury-risk",
        json={**base, "prior_injuries": ["Knee (Left)"]},
        headers=AUTH,
    ).json()
    assert injured["risk"]["knee"] > plain["risk"]["knee"]


def test_injury_risk_imputes_when_only_user_id_supplied():
    """Documented {user_id}-only contract. Without Supabase configured the
    endpoint must still answer, using training-set medians."""
    needs("injury")
    response = client.post("/predict/injury-risk", json={"user_id": "u1"}, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert set(body["risk"]) == set(INJURY_LABELS)
    assert len(body["imputed"]) > 0


# ── Model 4: trajectory ───────────────────────────────────────────────────────
def test_trajectory_returns_valid_class():
    needs("trajectory")
    response = client.post(
        "/predict/trajectory",
        json={
            "user_id": "u1",
            "sessions": [
                {"duration": 1.0, "completion_rate": 0.5, "workout_type": "Strength", "day_of_week": 1},
                {"duration": 1.1, "completion_rate": 0.7, "workout_type": "Strength", "day_of_week": 3},
                {"duration": 1.2, "completion_rate": 0.85, "workout_type": "Cardio", "day_of_week": 5},
                {"duration": 1.3, "completion_rate": 1.0, "workout_type": "Strength", "day_of_week": 6},
            ],
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is False
    assert body["label"] in TRAJECTORY_CLASSES
    assert body["trajectory_score"] == TRAJECTORY_CLASSES.index(body["label"])
    assert abs(sum(body["probs"].values()) - 1.0) < 0.01


def test_trajectory_pads_short_history():
    """A user with one logged session must still get a prediction."""
    needs("trajectory")
    response = client.post(
        "/predict/trajectory",
        json={"user_id": "u1", "sessions": [{"duration": 1.0, "completion_rate": 0.6}]},
        headers=AUTH,
    )
    assert response.status_code == 200
    assert response.json()["sessions_used"] == 1


def test_trajectory_rejects_empty_sessions():
    response = client.post(
        "/predict/trajectory", json={"user_id": "u1", "sessions": []}, headers=AUTH
    )
    assert response.status_code == 422


def test_trajectory_rejects_out_of_range_completion():
    response = client.post(
        "/predict/trajectory",
        json={"user_id": "u1", "sessions": [{"duration": 1.0, "completion_rate": 5}]},
        headers=AUTH,
    )
    assert response.status_code == 422


# ── Model 5: RL agent ─────────────────────────────────────────────────────────
def test_rl_action_returns_valid_action():
    needs("rl")
    response = client.post(
        "/rl/action",
        json={
            "user_id": "u1",
            "completion_rate": 0.9,
            "sleep_avg": 8.0,
            "injury_flag": 0,
            "trajectory_score": 2,
            "streak": 10,
        },
        headers=AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is False
    assert body["action"] in {"REDUCE", "MAINTAIN", "INCREASE"}
    assert body["intensity_delta"] in {-0.15, 0.0, 0.15}
    assert len(body["state"]) == 5
    for value in body["state"]:
        assert 0.0 <= value <= 1.0


def test_rl_state_construction_matches_documented_formula():
    needs("rl")
    response = client.post(
        "/rl/action",
        json={
            "user_id": "u1",
            "completion_rate": 0.8,
            "sleep_avg": 7.0,
            "injury_flag": 1,
            "trajectory_score": 2,
            "streak": 7,
        },
        headers=AUTH,
    )
    state = response.json()["state"]
    assert state[0] == pytest.approx(0.8, abs=1e-3)   # completion_rate
    assert state[1] == pytest.approx(0.7, abs=1e-3)   # sleep_avg / 10
    assert state[2] == pytest.approx(1.0, abs=1e-3)   # injury_flag
    assert state[3] == pytest.approx(1.0, abs=1e-3)   # trajectory_score / 2
    assert state[4] == pytest.approx(0.5, abs=1e-3)   # min(streak, 14) / 14


def test_rl_rejects_out_of_range_completion():
    response = client.post(
        "/rl/action",
        json={"user_id": "u1", "completion_rate": 1.5, "sleep_avg": 7, "injury_flag": 0},
        headers=AUTH,
    )
    assert response.status_code == 422


# ── Fallback behaviour when artifacts are missing ─────────────────────────────
def test_endpoints_fall_back_when_models_absent(tmp_path, monkeypatch):
    """With an empty MODEL_DIR every endpoint must still answer, flagged stub."""
    from app.model_registry import ModelRegistry
    from app.main import app as fastapi_app
    from app.model_registry import get_registry

    empty = ModelRegistry(model_dir=tmp_path)
    empty.load_all()
    assert empty.loaded_names() == []

    fastapi_app.dependency_overrides[get_registry] = lambda: empty
    try:
        bare = TestClient(fastapi_app)
        calorie = bare.post(
            "/predict/calories",
            json={"weight_kg": 70, "duration_min": 60, "exercise": "running"},
            headers=AUTH,
        ).json()
        assert calorie["stub"] is True
        # MET: 7.5 * 70 * 1.0 = 525 kcal
        assert calorie["calories"] == pytest.approx(525.0, abs=1.0)

        rec = bare.post("/recommend", json={"age": 25, "bmi": 24}, headers=AUTH).json()
        assert rec["stub"] is True and rec["recommended_workouts"] == []

        injury = bare.post(
            "/predict/injury-risk",
            json={"user_id": "u1", "sleep_avg_hours": 5.0},
            headers=AUTH,
        ).json()
        assert injury["stub"] is True and set(injury["risk"]) == set(INJURY_LABELS)

        trajectory = bare.post(
            "/predict/trajectory",
            json={"user_id": "u1", "sessions": [
                {"duration": 1.0, "completion_rate": 0.4},
                {"duration": 1.0, "completion_rate": 0.5},
                {"duration": 1.0, "completion_rate": 0.9},
            ]},
            headers=AUTH,
        ).json()
        assert trajectory["stub"] is True and trajectory["label"] == "IMPROVE"

        rl = bare.post(
            "/rl/action",
            json={"user_id": "u1", "completion_rate": 0.4, "sleep_avg": 7, "injury_flag": 0},
            headers=AUTH,
        ).json()
        assert rl["stub"] is True and rl["action"] == "REDUCE"
    finally:
        fastapi_app.dependency_overrides.clear()
