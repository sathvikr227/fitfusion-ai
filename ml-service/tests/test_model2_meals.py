"""Model 2 — hybrid meal recommender: loading, ranking, cold start, safety.

Runs against models/meal_catalog.pkl and models/meal_hybrid_serving.pkl and
skips when they are missing. Liked-recipe histories here are picked from the
catalog for the test, not taken from a real user.
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

import numpy as np  # noqa: E402
import pytest  # noqa: E402
import scipy.sparse as sp  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.meal_hybrid import fold_in, score  # noqa: E402
from app.model_registry import registry  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}

DAY = {"meals": [{"slot": "breakfast", "kcal_target": 730, "min_protein_g": 15},
                 {"slot": "lunch", "kcal_target": 1023, "min_protein_g": 25},
                 {"slot": "dinner", "kcal_target": 877, "min_protein_g": 25},
                 {"slot": "snack", "kcal_target": 292}],
       "per_meal": 5}


@pytest.fixture(scope="module", autouse=True)
def loaded():
    registry.load_all()
    if registry.recommender is None or registry.meal_hybrid is None:
        pytest.skip(f"Model 2 artifacts missing: {registry.errors}")


def catalog():
    return registry.recommender["catalog"]


def history(n=5, **flags):
    """n catalog recipes (most popular first) matching the given dietary flags."""
    frame = catalog()
    for flag, value in flags.items():
        frame = frame[frame[flag] == value]
    return [int(x) for x in frame["recipe_id"].head(n)]


def post(**overrides):
    response = client.post("/recommend", json={**DAY, **overrides}, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def ids(body):
    return [r["recipe_id"] for m in body["meals"] for r in m["recipes"]]


# ── artifact ───────────────────────────────────────────────────────────────────
def test_artifact_is_consistent_with_the_evaluation():
    b = registry.meal_hybrid
    n = len(b["ids"])
    assert np.all(np.diff(b["ids"]) > 0)  # sorted, unique: searchsorted relies on it
    assert b["factors"].shape[0] == b["tfidf"].shape[0] == len(b["popularity"]) == n
    report = json.loads((registry.model_dir / "reports" / "meal_hybrid.json").read_text(encoding="utf-8"))
    assert report["hybrid_served"] is True
    assert b["weights"] == report["selected_weights"]


def test_fold_in_equals_the_training_als_user_step():
    from training.train_meal_recommender import als_half

    b = registry.meal_hybrid
    rows = np.flatnonzero(b["has_factor"])[:7]
    reg = float((b["gram"] - b["factors"][b["has_factor"]].T @ b["factors"][b["has_factor"]])[0, 0])
    R = sp.csr_matrix((np.ones(len(rows), dtype=np.float32), (np.zeros(len(rows), int), rows)),
                      shape=(1, len(b["ids"])))
    expected = als_half(R, b["factors"], b["alpha"], reg)[0]
    np.testing.assert_allclose(fold_in(b, rows), expected, rtol=2e-3, atol=2e-4)


# ── cold start ─────────────────────────────────────────────────────────────────
def test_no_history_is_cold_start_popularity():
    body = post()
    assert body["cold_start"] is True
    assert body["method"].startswith("popularity")
    for meal in body["meals"]:
        likes = [r["likes_last_year"] for r in meal["recipes"]]
        assert likes == sorted(likes, reverse=True)


def test_unknown_history_ids_still_cold_start():
    body = post(liked_recipe_ids=[-1, 999_999_999])
    assert body["cold_start"] is True and body["history_used"] == []


# ── hybrid ranking ─────────────────────────────────────────────────────────────
def test_history_switches_to_the_hybrid_with_a_breakdown():
    liked = history(5)
    body = post(liked_recipe_ids=liked)
    assert body["cold_start"] is False
    assert body["method"] == "hybrid_popularity_als_content"
    assert set(body["history_used"]) == set(liked)
    for meal in body["meals"]:
        for r in meal["recipes"]:
            assert set(r["score_breakdown"]) == {"popularity", "als", "text"}
            assert all(0 <= v <= 1 for v in r["score_breakdown"].values())


def test_breakdown_adds_up_and_ranking_follows_it():
    body = post(liked_recipe_ids=history(5))
    for meal in body["meals"]:
        totals = [sum(r["score_breakdown"].values()) for r in meal["recipes"]]
        assert totals == sorted(totals, reverse=True)


def test_scores_match_the_inference_module():
    liked = history(5)
    s = score(registry.meal_hybrid, liked)
    b = registry.meal_hybrid
    w = b["weights"]
    expected = w["popularity"] * s.signals["popularity"] + w["als"] * s.signals["als"] + w["text"] * s.signals["text"]
    np.testing.assert_allclose(s.blended, expected, atol=1e-6)


def test_eaten_recipes_are_not_recommended_again():
    liked = history(20)
    assert not set(ids(post(liked_recipe_ids=liked))) & set(liked)


def test_different_histories_give_different_recommendations():
    sweet = history(8, course_desserts=True)
    savoury = history(8, course_main_dish=True, course_desserts=False)
    assert ids(post(liked_recipe_ids=sweet)) != ids(post(liked_recipe_ids=savoury))


# ── safety: the hybrid never overrides the filters ─────────────────────────────
@pytest.mark.parametrize("restriction,flag", [("vegetarian", "is_vegetarian"), ("vegan", "is_vegan"),
                                              ("gluten_free", "is_gluten_free")])
def test_dietary_filters_hold_with_a_meat_heavy_history(restriction, flag):
    meaty = history(10, is_vegetarian=False)
    body = post(liked_recipe_ids=meaty, dietary_restrictions=[restriction])
    allowed = set(catalog().loc[catalog()[flag], "recipe_id"].astype(int))
    got = ids(body)
    assert got and set(got) <= allowed


def test_calorie_bands_hold_with_history():
    body = post(liked_recipe_ids=history(5))
    for meal in body["meals"]:
        for r in meal["recipes"]:
            assert meal["kcal_min"] <= r["kcal"] <= meal["kcal_max"]


def test_unverifiable_restriction_still_returns_nothing():
    body = post(liked_recipe_ids=history(5), dietary_restrictions=["halal"])
    assert ids(body) == [] and body["unsupported_restrictions"] == ["halal"]


# ── invalid input ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bad", [list(range(501)), ["abc"], "123"])
def test_invalid_history_is_rejected(bad):
    response = client.post("/recommend", json={**DAY, "liked_recipe_ids": bad}, headers=AUTH)
    assert response.status_code == 422
