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
        "calorie", "calorie_xgboost", "recommender", "injury", "trajectory", "rl"
    }


def test_auth_required_on_every_model_endpoint():
    calls = [
        ("/predict/calories", {"weight_kg": 70, "duration_min": 30}),
        ("/recommend", {"meals": [{"slot": "lunch", "kcal_target": 600}]}),
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


# ── Stage 1: energy expenditure ───────────────────────────────────────────────
CARDIO_WITH_HR = {
    "weight_kg": 70,
    "age": 30,
    "sex": "Male",
    "avg_hr": 140,
    "duration_min": 30,
    "exercise": "Running",
}


def test_calorie_heart_rate_method_is_used_for_cardio_with_hr():
    needs("calorie")
    body = client.post("/predict/calories", json=CARDIO_WITH_HR, headers=AUTH).json()
    assert body["method"] == "heart_rate"
    assert body["validated"] is True
    assert body["expected_error_kcal_per_min"] > 0
    assert body["calories"] == pytest.approx(body["kcal_per_min"] * 30, abs=0.5)
    assert 2 < body["kcal_per_min"] < 20


def test_calorie_matches_calibrated_keytel_formula():
    needs("calorie")
    from app.energy import keytel_kcal_per_min

    energy = registry.calorie
    expected = energy["intercept"] + energy["slope"] * float(keytel_kcal_per_min(140, 70, 30, False))
    body = client.post("/predict/calories", json=CARDIO_WITH_HR, headers=AUTH).json()
    assert body["kcal_per_min"] == pytest.approx(expected, abs=0.01)


def test_calorie_higher_heart_rate_burns_more():
    needs("calorie")
    easy = client.post("/predict/calories", json={**CARDIO_WITH_HR, "avg_hr": 110}, headers=AUTH).json()
    hard = client.post("/predict/calories", json={**CARDIO_WITH_HR, "avg_hr": 170}, headers=AUTH).json()
    assert easy["method"] == hard["method"] == "heart_rate"
    assert hard["calories"] > easy["calories"]


@pytest.mark.parametrize(
    "change, reason_fragment",
    [
        ({"avg_hr": None}, "no average heart rate"),
        ({"exercise": "Bench Press"}, "cardio only"),
        ({"sex": "Other"}, "age and sex"),
        ({"avg_hr": 60}, "outside the validated range"),
    ],
)
def test_calorie_falls_back_to_met_outside_validated_conditions(change, reason_fragment):
    needs("calorie")
    body = client.post("/predict/calories", json={**CARDIO_WITH_HR, **change}, headers=AUTH).json()
    assert body["method"] == "met_table"
    assert body["validated"] is False
    assert reason_fragment in body["reason"]
    assert body["calories"] == body["baseline_met_calories"] > 0


def test_calorie_legacy_alias_still_works():
    response = client.post(
        "/predict/calorie",
        json={"exercise": "running", "duration_min": 30, "weight_kg": 70},
        headers=AUTH,
    )
    assert response.status_code == 200
    assert response.json()["calories"] > 0


def test_calorie_longer_session_burns_more():
    short = client.post("/predict/calories", json={**CARDIO_WITH_HR, "duration_min": 20}, headers=AUTH)
    long = client.post("/predict/calories", json={**CARDIO_WITH_HR, "duration_min": 60}, headers=AUTH)
    assert long.json()["calories"] > short.json()["calories"]


def test_calorie_rejects_missing_duration():
    response = client.post("/predict/calories", json={"weight_kg": 70}, headers=AUTH)
    assert response.status_code == 422


def test_calorie_rejects_bad_weight():
    response = client.post(
        "/predict/calories", json={"weight_kg": -5, "duration_min": 30}, headers=AUTH
    )
    assert response.status_code == 422


# ── Stage 2: meal recommender ─────────────────────────────────────────────────
DAY = [
    {"slot": "breakfast", "kcal_target": 450},
    {"slot": "lunch", "kcal_target": 650},
    {"slot": "dinner", "kcal_target": 600},
    {"slot": "snack", "kcal_target": 200},
]


def _catalog():
    return registry.recommender["catalog"].set_index("recipe_id")


def test_recommend_returns_real_recipes_for_every_slot_in_calorie_band():
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY}, headers=AUTH).json()
    assert body["stub"] is False and body["method"].startswith("popularity")
    assert [m["slot"] for m in body["meals"]] == ["breakfast", "lunch", "dinner", "snack"]
    catalog = _catalog()
    for meal in body["meals"]:
        assert len(meal["recipes"]) == 5
        for recipe in meal["recipes"]:
            assert meal["kcal_min"] <= recipe["kcal"] <= meal["kcal_max"]
            assert catalog.loc[recipe["recipe_id"], "name"] == recipe["name"]


def test_recommend_ranks_by_popularity():
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY[:1], "per_meal": 10}, headers=AUTH).json()
    likes = [(r["likes_last_year"], r["likes_all_time"]) for r in body["meals"][0]["recipes"]]
    assert likes == sorted(likes, reverse=True)


def test_recommend_never_repeats_a_recipe_across_slots():
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY}, headers=AUTH).json()
    ids = [r["recipe_id"] for m in body["meals"] for r in m["recipes"]]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "restriction, flag",
    [("Vegetarian", "is_vegetarian"), ("vegan", "is_vegan"), ("Gluten Free", "is_gluten_free"),
     ("nut-free", "is_nut_free"), ("Lactose Free", "is_dairy_free")],
)
def test_recommend_respects_supported_restrictions(restriction, flag):
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY, "dietary_restrictions": [restriction]},
                       headers=AUTH).json()
    catalog = _catalog()
    recipes = [r for m in body["meals"] for r in m["recipes"]]
    assert recipes, "expected recipes for a supported restriction"
    assert all(bool(catalog.loc[r["recipe_id"], flag]) for r in recipes)


def test_recommend_refuses_restrictions_it_cannot_verify():
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY, "dietary_restrictions": ["Vegetarian", "Halal"]},
                       headers=AUTH).json()
    assert body["meals"] == []
    assert body["unsupported_restrictions"] == ["halal"]
    assert "halal" in body["reason"]


def test_recommend_ignores_no_restriction_values():
    needs("recommender")
    body = client.post("/recommend", json={"meals": DAY[:1], "dietary_restrictions": ["Non-Vegetarian", "None"]},
                       headers=AUTH).json()
    assert body["unsupported_restrictions"] == [] and body["meals"][0]["recipes"]


def test_recommend_applies_protein_floor_and_exclusions():
    needs("recommender")
    first = client.post("/recommend", json={"meals": [{"slot": "dinner", "kcal_target": 600, "min_protein_g": 30}]},
                        headers=AUTH).json()["meals"][0]["recipes"]
    assert all(r["protein_g"] >= 30 for r in first)
    excluded = [r["recipe_id"] for r in first]
    second = client.post("/recommend", json={"meals": [{"slot": "dinner", "kcal_target": 600, "min_protein_g": 30}],
                                             "exclude_recipe_ids": excluded}, headers=AUTH).json()["meals"][0]["recipes"]
    assert not set(excluded) & {r["recipe_id"] for r in second}


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

        rec = bare.post("/recommend", json={"meals": [{"slot": "lunch", "kcal_target": 600}]},
                        headers=AUTH).json()
        assert rec["stub"] is True and rec["meals"] == []

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
