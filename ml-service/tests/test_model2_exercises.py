"""Model 2b — content-based exercise recommender: filters, ranking, validation.

Runs against models/exercise_index.pkl and skips when it is missing. All
profiles here are hand-written examples, not real users.
"""

from __future__ import annotations

import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.exercise_recommender import FOCUS_MUSCLES, keyword_pattern, loads_injury  # noqa: E402
from app.main import app  # noqa: E402
from app.model_registry import registry  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}

PROFILE = {"focus": "legs", "goal": "Muscle Gain", "training_style": "Gym",
           "activity_level": "Moderately Active", "injuries": [], "k": 5}


@pytest.fixture(scope="module", autouse=True)
def loaded():
    registry.load_all()
    if registry.exercise_index is None:
        pytest.skip(f"exercise index missing: {registry.errors.get('exercise_recommender')}")


def recommend(**overrides):
    response = client.post("/recommend/exercises", json={**PROFILE, **overrides}, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def by_id():
    return {ex["id"]: ex for ex in registry.exercise_index["exercises"]}


# ── output format and ranking ──────────────────────────────────────────────────
def test_returns_k_ranked_exercises_with_reasons():
    body = recommend()
    recs = body["recommendations"]
    assert len(recs) == 5
    assert [r["score"] for r in recs] == sorted((r["score"] for r in recs), reverse=True)
    for r in recs:
        assert r["why"] and r["name"] and 0 < r["score"] <= 1
    assert body["method"] == "content_cosine" and body["stub"] is False


def test_every_pick_targets_the_session_muscles():
    for focus, muscles in FOCUS_MUSCLES.items():
        for r in recommend(focus=focus)["recommendations"]:
            assert set(r["primary_muscles"]) & set(muscles), (focus, r["name"])


def test_no_more_than_cap_per_primary_muscle():
    recs = recommend(k=6)["recommendations"]
    mains = [r["primary_muscles"][0] for r in recs]
    assert max(mains.count(m) for m in set(mains)) <= 2


# ── hard constraints ───────────────────────────────────────────────────────────
def test_home_style_only_uses_home_equipment():
    body = recommend(training_style="Home Workouts", focus="push")
    allowed = set(body["allowed_equipment"])
    assert "barbell" not in allowed and "machine" not in allowed
    assert all(r["equipment"] in allowed for r in body["recommendations"])


def test_explicit_equipment_overrides_style():
    body = recommend(equipment=["dumbbell"], focus="upper")
    assert body["allowed_equipment"] == ["dumbbell"]
    assert all(r["equipment"] == "dumbbell" for r in body["recommendations"])


@pytest.mark.parametrize("injury", ["knee", "back", "shoulder", "hamstring"])
def test_injury_removes_every_exercise_that_loads_it(injury):
    exercises = by_id()
    for focus in FOCUS_MUSCLES:
        body = recommend(focus=focus, injuries=[injury])
        assert injury in body["injury_groups_excluded"]
        for r in body["recommendations"]:
            assert not loads_injury(exercises[r["id"]], injury), (injury, r["name"])


def test_knee_injury_changes_a_leg_session():
    plain = {r["id"] for r in recommend()["recommendations"]}
    knee = {r["id"] for r in recommend(injuries=["knee"])["recommendations"]}
    assert plain != knee


def test_beginner_never_gets_expert_exercises():
    for focus in FOCUS_MUSCLES:
        body = recommend(focus=focus, activity_level="Sedentary")
        assert body["level"] == "beginner"
        assert all(r["level"] != "expert" for r in body["recommendations"])


def test_impossible_constraints_return_a_short_list_with_a_note():
    body = recommend(focus="pull", training_style="Calisthenics", injuries=["shoulder"], k=10)
    assert len(body["recommendations"]) < 10
    assert body["note"]


# ── keyword matching (the "Pullups" bug) ───────────────────────────────────────
@pytest.mark.parametrize("name,keyword,expected", [
    ("pullups", "pull up", True), ("v-bar pullup", "pull up", True), ("chin-up", "chin up", True),
    ("crunches", "run", False), ("cable crunch", "run", False), ("barbell squat", "squat", True),
])
def test_keyword_pattern(name, keyword, expected):
    assert bool(keyword_pattern(keyword).search(name)) is expected


# ── profile changes change the result ──────────────────────────────────────────
@pytest.mark.parametrize("change", [
    {"goal": "Endurance"}, {"training_style": "Home Workouts"}, {"focus": "push"},
])
def test_changing_the_profile_changes_the_recommendations(change):
    base = [r["id"] for r in recommend()["recommendations"]]
    assert [r["id"] for r in recommend(**change)["recommendations"]] != base


# ── invalid input ──────────────────────────────────────────────────────────────
def test_unknown_training_style_is_rejected():
    response = client.post("/recommend/exercises", json={**PROFILE, "training_style": "Underwater"}, headers=AUTH)
    assert response.status_code == 422
    assert "training style" in response.json()["detail"]


@pytest.mark.parametrize("change", [{"focus": "arms_day"}, {"k": 0}, {"k": 50}, {"injuries": "knee"}])
def test_invalid_fields_are_rejected(change):
    response = client.post("/recommend/exercises", json={**PROFILE, **change}, headers=AUTH)
    assert response.status_code == 422


def test_missing_focus_is_rejected():
    payload = {k: v for k, v in PROFILE.items() if k != "focus"}
    assert client.post("/recommend/exercises", json=payload, headers=AUTH).status_code == 422


def test_requires_bearer_token():
    assert client.post("/recommend/exercises", json=PROFILE).status_code == 401


def test_unknown_goal_falls_back_to_general_fitness():
    assert recommend(goal="Become a pirate")["goal"] == "general_fitness"
