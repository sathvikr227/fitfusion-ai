"""Stage 2 — POST /recommend (meal recommendations from real recipes).

For each requested meal slot, returns Food.com recipes that pass the user's
dietary restrictions and fit the slot's calorie band, ranked by the hybrid:

    0.5·popularity + 0.25·ALS (collaborative) + 0.25·ingredient/tag TF-IDF (content)

The personal signals come from `liked_recipe_ids` (plan meals the user ate).
Without history the ranking is popularity — the cold-start strategy, and the
behaviour when the hybrid artifact is not loaded.

Why this blend: chosen on 2012-13, then tested once on 2014-2017 (9,146
user-years); it beat popularity on Recall@10, 0.0235 vs 0.0198, CI of the
difference [+0.0016, +0.0057]. Pure ALS lost to popularity in the same test.
See training/train_meal_hybrid.py and app/meal_hybrid.py.

Safety: dietary flags are ingredient-based and manually audited. A restriction
the flags cannot verify (halal, kosher, pescatarian, low sodium, ...) returns no
recipes at all rather than recipes that might violate it.
"""

from __future__ import annotations

import logging
import re

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends

from ..auth import require_bearer
from ..meal_hybrid import explain
from ..meal_hybrid import score as hybrid_score
from ..model_registry import ModelRegistry, get_registry
from ..schemas import MealRecommendation, RecommendedRecipe, RecommendRequest, RecommendResponse

log = logging.getLogger("ml-service.recommend")
router = APIRouter(tags=["recommend"])

# Restriction (as normalised from the profile) → catalog flag that must be True.
RESTRICTION_FLAGS = {
    "vegetarian": "is_vegetarian",
    "vegan": "is_vegan",
    "eggetarian": "is_eggetarian",
    "dairy_free": "is_dairy_free",
    "lactose_free": "is_dairy_free",
    "lactose_intolerant": "is_dairy_free",
    "gluten_free": "is_gluten_free",
    "celiac": "is_gluten_free",
    "nut_free": "is_nut_free",
    "nut_allergy": "is_nut_free",
}
# Profile values that mean "no restriction".
NO_RESTRICTION = {"", "none", "no", "non_vegetarian", "nonvegetarian", "non_veg", "omnivore", "anything"}

# Food.com course tags that qualify a recipe for each meal slot.
SLOT_COURSES = {
    "breakfast": ["course_breakfast"],
    "lunch": ["course_main_dish", "course_salads", "course_soups_stews"],
    "dinner": ["course_main_dish"],
    "snack": ["course_snacks", "course_appetizers"],
}
SLOTS_EXCLUDING_DESSERTS = {"lunch", "dinner"}
# Breads (pizza dough, focaccia) are fine for breakfast or a snack, not as lunch or dinner.
SLOTS_EXCLUDING_BREADS = {"lunch", "dinner"}

KCAL_BAND = 0.25          # ±25% around the slot target
KCAL_BAND_WIDENED = 0.50  # used when the tight band has too few recipes


def canonical_restrictions(raw: list[str]) -> tuple[list[str], list[str]]:
    """Split profile restrictions into (supported, unsupported) canonical keys."""
    supported, unsupported = [], []
    for entry in raw:
        key = re.sub(r"[^a-z]+", "_", str(entry or "").lower()).strip("_")
        if key in NO_RESTRICTION:
            continue
        target = supported if key in RESTRICTION_FLAGS else unsupported
        if key not in target:
            target.append(key)
    return supported, unsupported


def candidates_for(catalog: pd.DataFrame, slot: str, restrictions: list[str], min_protein: float,
                   excluded: set[int]) -> pd.DataFrame:
    mask = catalog[SLOT_COURSES[slot]].any(axis=1)
    if slot in SLOTS_EXCLUDING_DESSERTS:
        mask &= ~catalog["course_desserts"]
    if slot in SLOTS_EXCLUDING_BREADS and "course_breads" in catalog:
        mask &= ~catalog["course_breads"]
    for key in restrictions:
        mask &= catalog[RESTRICTION_FLAGS[key]]
    if min_protein > 0:
        mask &= catalog["protein_g"] >= min_protein
    if excluded:
        mask &= ~catalog["recipe_id"].isin(excluded)
    return catalog[mask]


@router.post("/recommend", response_model=RecommendResponse)
def recommend(
    req: RecommendRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> RecommendResponse:
    restrictions, unsupported = canonical_restrictions(req.dietary_restrictions)

    if reg.recommender is None:
        log.warning("meal catalog unavailable (%s) — returning no recipes",
                    reg.errors.get("recommender", "not loaded"))
        return RecommendResponse(applied_restrictions=restrictions, unsupported_restrictions=unsupported,
                                 reason="meal catalog not loaded", model_version="fallback-empty", stub=True)

    bundle = reg.recommender
    version = bundle.get("model_version", "meal-popularity-v1")
    method = bundle.get("method", "popularity_last_365d")

    if unsupported:
        return RecommendResponse(
            applied_restrictions=restrictions,
            unsupported_restrictions=unsupported,
            reason=f"cannot verify recipes against: {', '.join(unsupported)}",
            method=method,
            model_version=version,
        )

    catalog: pd.DataFrame = bundle["catalog"]  # already sorted by popularity
    used: set[int] = set(req.exclude_recipe_ids) | set(req.liked_recipe_ids)
    meals: list[MealRecommendation] = []

    hybrid, scores = reg.meal_hybrid, None
    if hybrid is not None:
        scores = hybrid_score(hybrid, req.liked_recipe_ids)
        if not scores.cold_start:
            method, version = "hybrid_popularity_als_content", f"{version}+{hybrid.get('model_version', 'hybrid')}"

    def ranked(frame: pd.DataFrame) -> pd.DataFrame:
        """Hybrid order when there is history; popularity order otherwise."""
        if scores is None or scores.cold_start or frame.empty:
            return frame
        ids = frame["recipe_id"].to_numpy()
        pos = np.clip(np.searchsorted(hybrid["ids"], ids), 0, len(hybrid["ids"]) - 1)
        value = np.where(hybrid["ids"][pos] == ids, scores.blended[pos], -1.0)
        return frame.assign(_hybrid=value).sort_values("_hybrid", ascending=False, kind="stable")

    for meal in req.meals:
        pool = candidates_for(catalog, meal.slot, restrictions, meal.min_protein_g, used)
        widened = False
        low, high = meal.kcal_target * (1 - KCAL_BAND), meal.kcal_target * (1 + KCAL_BAND)
        picks = ranked(pool[pool["kcal"].between(low, high)]).head(req.per_meal)
        if len(picks) < req.per_meal:
            widened = True
            low = meal.kcal_target * (1 - KCAL_BAND_WIDENED)
            high = meal.kcal_target * (1 + KCAL_BAND_WIDENED)
            picks = ranked(pool[pool["kcal"].between(low, high)]).head(req.per_meal)

        used.update(int(r) for r in picks["recipe_id"])
        meals.append(
            MealRecommendation(
                slot=meal.slot,
                kcal_min=round(low, 1),
                kcal_max=round(high, 1),
                widened=widened,
                recipes=[
                    RecommendedRecipe(
                        recipe_id=int(r.recipe_id),
                        name=str(r.name),
                        kcal=round(float(r.kcal), 1),
                        protein_g=round(float(r.protein_g), 1),
                        minutes=int(r.minutes),
                        likes_last_year=int(r.likes_last_year),
                        likes_all_time=int(r.likes_all_time),
                        score_breakdown=explain(hybrid, scores, int(r.recipe_id)) if scores else {},
                    )
                    for r in picks.itertuples()
                ],
            )
        )

    return RecommendResponse(
        meals=meals,
        applied_restrictions=restrictions,
        method=method,
        model_version=version,
        history_used=scores.history_used if scores else [],
        cold_start=scores.cold_start if scores else True,
    )
