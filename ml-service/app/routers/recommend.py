"""Model 2 — POST /recommend (collaborative filtering + content-based filters)."""

from __future__ import annotations

import logging
import re

import numpy as np
from fastapi import APIRouter, Depends
from sklearn.metrics.pairwise import cosine_similarity

from ..auth import require_bearer
from ..model_registry import ModelRegistry, get_registry
from ..schemas import (
    DietFocus,
    RecommendedFood,
    RecommendedWorkout,
    RecommendRequest,
    RecommendResponse,
)

log = logging.getLogger("ml-service.recommend")
router = APIRouter(tags=["recommend"])

# Maps free-text profile injury notes onto the muscle groups the recommender
# filters on. FitFusion stores these as prose ("lower back pain") plus a
# structured body_part from the injuries table.
INJURY_ALIASES = {
    "knee": ["knee", "patell", "acl", "mcl", "meniscus"],
    "back": ["back", "spine", "lumbar", "disc", "sciatic"],
    "shoulder": ["shoulder", "rotator", "deltoid", "clavicle", "ac joint"],
    "hamstring": ["hamstring", "thigh", "quad", "groin"],
}

GOAL_MUSCLE = ("muscle", "gain", "bulk", "strength", "mass")
GOAL_LOSS = ("loss", "lose", "cut", "fat", "slim", "weight_loss")


def canonical_injuries(raw: list[str]) -> list[str]:
    found: list[str] = []
    for entry in raw:
        text = str(entry or "").lower()
        for group, keywords in INJURY_ALIASES.items():
            if group not in found and any(kw in text for kw in keywords):
                found.append(group)
    return found


def canonical_restrictions(raw: list[str]) -> list[str]:
    """Normalise "Gluten Free", "gluten-free", "GLUTEN_FREE" to one key."""
    return [re.sub(r"[^a-z]+", "_", str(entry or "").lower()).strip("_") for entry in raw if entry]


def diet_strategy(goal: str | None) -> tuple[str, str]:
    text = str(goal or "").lower()
    if any(word in text for word in GOAL_MUSCLE):
        return "high_protein", "protein"
    if any(word in text for word in GOAL_LOSS):
        return "calorie_deficit", "calories"
    return "balanced", "protein"


@router.post("/recommend", response_model=RecommendResponse)
def recommend(
    req: RecommendRequest,
    _: None = Depends(require_bearer),
    reg: ModelRegistry = Depends(get_registry),
) -> RecommendResponse:
    injuries = canonical_injuries(req.injuries)
    restrictions = canonical_restrictions(req.dietary_restrictions)

    if reg.recommender is None:
        log.warning("recommender unavailable (%s) — returning empty seed",
                    reg.errors.get("recommender", "not loaded"))
        return RecommendResponse(
            recommended_workouts=[],
            recommended_diet_focus=None,
            applied_restrictions=restrictions,
            model_version="fallback-empty",
            stub=True,
        )

    bundle = reg.recommender

    # ── Collaborative half: cosine similarity over the scaled user matrix ─────
    vector = bundle["scaler"].transform(
        np.array([[req.age, req.bmi, req.workout_frequency, req.experience_level]], dtype=float)
    )
    similarities = cosine_similarity(vector, bundle["matrix"])[0]
    neighbours = int(bundle.get("top_k_neighbours", 10))
    top_idx = np.argsort(similarities)[::-1][:neighbours]

    workout_types = bundle["workout_types"]
    tally: dict[str, float] = {}
    for i in top_idx:
        name = workout_types[i]
        tally[name] = tally.get(name, 0.0) + 1.0

    total = sum(tally.values()) or 1.0
    ranked = sorted(
        ((name, count / total) for name, count in tally.items()),
        key=lambda kv: kv[1],
        reverse=True,
    )

    # ── Content half: drop workout types that conflict with active injuries ───
    blocklist = bundle["injury_workout_blocklist"]
    blocked: set[str] = set()
    for group in injuries:
        blocked.update(blocklist.get(group, []))

    kept = [(name, score) for name, score in ranked if name not in blocked]
    excluded = sorted({name for name, _ in ranked if name in blocked})

    # Never hand back an empty plan seed: if injuries rule out everything the
    # neighbours did, fall back to the lowest-impact class.
    if not kept:
        kept = [("Yoga", 1.0)]
        log.info("all neighbour workout types blocked by injuries %s; seeding Yoga", injuries)

    recommended = [
        RecommendedWorkout(workout_type=name, score=round(score, 3))
        for name, score in kept[: req.top_k]
    ]

    # ── Diet side ────────────────────────────────────────────────────────────
    strategy, target_macro = diet_strategy(req.goal)
    index = bundle["food_index"]
    restriction_map = bundle["restriction_blocklist"]

    allow_map = bundle.get("restriction_allowlist", {})

    banned: list[str] = []
    allowed: list[list[str]] = []
    for key in restrictions:
        banned.extend(restriction_map.get(key, []))
        if key in allow_map:
            allowed.append(allow_map[key])

    filtered = index
    if banned:
        pattern = "|".join(re.escape(word) for word in sorted(set(banned)))
        filtered = filtered[~filtered["searchable"].str.contains(pattern, regex=True, na=False)]

    # Vegetarian and vegan invert the filter: keep only recognisably plant-based
    # (and, where allowed, dairy/egg) foods. Anything unrecognised is dropped,
    # because a leak here puts meat in front of someone who does not eat it.
    #
    # Matched against primary_name — the identity before the first comma — so a
    # qualifier cannot smuggle a food in ("Roughy,Orange,Raw" is a fish).
    match_column = "primary_name" if "primary_name" in filtered.columns else "searchable"
    for allow_list in allowed:
        pattern = "|".join(re.escape(word) for word in sorted(set(allow_list)))
        filtered = filtered[filtered[match_column].str.contains(pattern, regex=True, na=False)]

    if filtered.empty:
        log.warning("dietary restrictions %s filtered out every food; using unfiltered index",
                    restrictions)
        filtered = index

    # Rank among foods that are actually worth eating. Without these floors the
    # "lowest calorie" sort returns diet soda, black coffee and tea — technically
    # correct, useless as a meal seed.
    def with_floors(frame, min_protein: float, min_kcal: float, max_kcal: float | None = None):
        candidates = frame[(frame["protein"] >= min_protein) & (frame["calories"] >= min_kcal)]
        if max_kcal is not None:
            candidates = candidates[candidates["calories"] <= max_kcal]
        return candidates

    if strategy == "calorie_deficit":
        # Lean, filling foods: real protein, moderate energy density.
        candidates = with_floors(filtered, min_protein=8.0, min_kcal=40.0, max_kcal=250.0)
        if candidates.empty:
            candidates = with_floors(filtered, min_protein=4.0, min_kcal=20.0, max_kcal=400.0)
        ordered = candidates.nlargest(req.diet_items * 3, "protein_density")
    else:
        # Muscle gain and balanced both want protein density, but exclude
        # near-zero-calorie items that only look dense because they are water.
        candidates = with_floors(filtered, min_protein=10.0, min_kcal=50.0)
        if candidates.empty:
            candidates = with_floors(filtered, min_protein=5.0, min_kcal=25.0)
        ordered = candidates.nlargest(req.diet_items * 3, "protein_density")

    if ordered.empty:
        log.warning("no foods cleared the nutrition floors; falling back to protein density")
        ordered = filtered.nlargest(req.diet_items * 3, "protein_density")

    picked = ordered.head(req.diet_items)
    foods = [
        RecommendedFood(
            name=str(row.description).title(),
            category=str(row.category).title(),
            calories=round(float(row.calories), 1),
            protein=round(float(row.protein), 1),
            carbs=round(float(row.carbs), 1),
            fat=round(float(row.fat), 1),
        )
        for row in picked.itertuples()
    ]

    diet_focus = DietFocus(
        strategy=strategy,
        target_macro=target_macro,
        avg_calories=round(float(picked["calories"].mean()), 1) if not picked.empty else 0.0,
        avg_protein=round(float(picked["protein"].mean()), 1) if not picked.empty else 0.0,
        foods=foods,
    )

    return RecommendResponse(
        recommended_workouts=recommended,
        recommended_diet_focus=diet_focus,
        excluded_workouts=excluded,
        applied_restrictions=restrictions,
        neighbours_used=len(top_idx),
        model_version=bundle.get("model_version", "recommender-hybrid-v1"),
        stub=False,
    )
