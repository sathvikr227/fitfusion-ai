"""Model 2b — content-based exercise recommender (cosine similarity).

There is no exercise interaction data anywhere (the Gym Members dataset has one
row per person, FitFusion's own logs only record plan-assigned exercises), so
this half of Model 2 is content-based only — no collaborative filtering.

Items: free-exercise-db (876 exercises; models/exercise_index.pkl, built by
training/build_exercise_index.py). Each exercise becomes a feature vector:

    primary muscles (1.0) + secondary muscles (0.4) + equipment + level
    + category + mechanic + force                         (one-hot blocks)

Query: a vector built the same way from the user's profile and the session —
target muscles for the day, goal → preferred categories/mechanics, activity
level → difficulty. Ranking = cosine(query, exercise).

Hard constraints run BEFORE ranking and are never traded off against the score:
  * equipment must be available for the training style (or the explicit list)
  * exercises that load an injured area are removed (name keywords shared with
    the replan rules + the muscle the injury names)
  * a beginner is never given an expert-level exercise
  * the exercise's primary muscle must be one the session targets (a pull day
    never gets ab work as filler)
A short list beats a risky or off-target one: if fewer than k exercises pass,
fewer are returned and `note` says why.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np

from .features import INJURY_MUSCLE_KEYWORDS

LEVELS = ["beginner", "intermediate", "expert"]

# Session focus → primary muscles it targets.
FOCUS_MUSCLES: dict[str, list[str]] = {
    "push": ["chest", "shoulders", "triceps"],
    "pull": ["lats", "middle back", "biceps", "traps"],
    "legs": ["quadriceps", "hamstrings", "glutes", "calves"],
    "upper": ["chest", "lats", "middle back", "shoulders", "biceps", "triceps"],
    "lower": ["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"],
    "core": ["abdominals", "lower back"],
    "full_body": ["chest", "lats", "middle back", "shoulders", "quadriceps", "hamstrings", "glutes", "abdominals"],
}

# Training style → equipment the user can use.
STYLE_EQUIPMENT: dict[str, list[str]] = {
    "gym": ["barbell", "dumbbell", "cable", "machine", "kettlebells", "e-z curl bar", "body only",
            "bands", "medicine ball", "exercise ball", "foam roll", "other"],
    "strength_training": ["barbell", "dumbbell", "cable", "machine", "kettlebells", "e-z curl bar", "body only"],
    "calisthenics": ["body only"],
    "home_workouts": ["body only", "dumbbell", "bands", "kettlebells", "exercise ball", "foam roll"],
    "yoga": ["body only", "foam roll", "exercise ball"],
    "running": ["body only", "foam roll"],
}

# Goal → (preferred categories, preferred mechanic). Soft preferences: they
# shape the query vector, they never filter.
GOAL_PREFERENCES: dict[str, tuple[list[str], list[str]]] = {
    "muscle_gain": (["strength"], ["compound", "isolation"]),
    "strength": (["strength", "powerlifting"], ["compound"]),
    "weight_loss": (["strength", "plyometrics", "cardio"], ["compound"]),
    "endurance": (["cardio", "plyometrics", "strength"], ["compound"]),
    "general_fitness": (["strength", "stretching", "cardio"], ["compound"]),
}

ACTIVITY_LEVEL = {"sedentary": "beginner", "lightly_active": "beginner",
                  "moderately_active": "intermediate", "very_active": "intermediate",
                  "extremely_active": "expert"}

# Injury group → muscles to keep off the list in addition to the name keywords.
INJURY_MUSCLES = {"knee": ["quadriceps"], "back": ["lower back"], "shoulder": ["shoulders"],
                  "hamstring": ["hamstrings"]}

WEIGHTS = {"primary": 1.0, "secondary": 0.4, "equipment": 0.3, "level": 0.15,
           "category": 0.6, "mechanic": 0.3, "force": 0.2}


class ExerciseRecommenderError(ValueError):
    """Raised for an unusable request (unknown focus or style)."""


def key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


@dataclass
class Vocabulary:
    columns: list[str]

    @property
    def index(self) -> dict[str, int]:
        return {c: i for i, c in enumerate(self.columns)}


def build_vocabulary(exercises: list[dict]) -> Vocabulary:
    cols: set[str] = set()
    for ex in exercises:
        cols.update(f"muscle:{m}" for m in ex["primaryMuscles"] + ex["secondaryMuscles"])
        for field in ("equipment", "level", "category", "mechanic", "force"):
            if ex.get(field):
                cols.add(f"{field}:{ex[field]}")
    return Vocabulary(sorted(cols))


def exercise_vector(ex: dict, vocab: Vocabulary) -> np.ndarray:
    idx, v = vocab.index, np.zeros(len(vocab.columns), dtype=np.float32)
    for m in ex["secondaryMuscles"]:
        v[idx[f"muscle:{m}"]] = max(v[idx[f"muscle:{m}"]], WEIGHTS["secondary"])
    for m in ex["primaryMuscles"]:
        v[idx[f"muscle:{m}"]] = WEIGHTS["primary"]
    for field in ("equipment", "level", "category", "mechanic", "force"):
        name = f"{field}:{ex.get(field)}"
        if name in idx:
            v[idx[name]] = WEIGHTS[field]
    return v


def build_index(exercises: list[dict]) -> dict:
    vocab = build_vocabulary(exercises)
    matrix = np.stack([exercise_vector(ex, vocab) for ex in exercises])
    matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-9)
    return {"exercises": exercises, "columns": vocab.columns, "matrix": matrix.astype(np.float32)}


def query_vector(index: dict, focus: str, goal: str, level: str) -> np.ndarray:
    idx = {c: i for i, c in enumerate(index["columns"])}
    q = np.zeros(len(idx), dtype=np.float32)
    for m in FOCUS_MUSCLES[focus]:
        if f"muscle:{m}" in idx:
            q[idx[f"muscle:{m}"]] = WEIGHTS["primary"]
    categories, mechanics = GOAL_PREFERENCES.get(goal, GOAL_PREFERENCES["general_fitness"])
    for c in categories:
        if f"category:{c}" in idx:
            q[idx[f"category:{c}"]] = WEIGHTS["category"]
    for m in mechanics:
        if f"mechanic:{m}" in idx:
            q[idx[f"mechanic:{m}"]] = WEIGHTS["mechanic"]
    if f"level:{level}" in idx:
        q[idx[f"level:{level}"]] = WEIGHTS["level"]
    return q / max(float(np.linalg.norm(q)), 1e-9)


def keyword_pattern(keyword: str) -> re.Pattern:
    """Word-start match that tolerates a missing or hyphenated gap:
    "pull up" matches "Pullups" and "Pull-Up", while "run" does not match "crunch"."""
    words = re.split(r"[\s-]+", keyword.strip().lower())
    return re.compile(r"\b" + r"[\s-]?".join(map(re.escape, words)))


INJURY_PATTERNS = {g: [keyword_pattern(k) for k in kws] for g, kws in INJURY_MUSCLE_KEYWORDS.items()}


def loads_injury(ex: dict, group: str) -> bool:
    name = ex["name"].lower()
    if any(p.search(name) for p in INJURY_PATTERNS.get(group, [])):
        return True
    return any(m in ex["primaryMuscles"] for m in INJURY_MUSCLES.get(group, []))


def recommend_exercises(
    index: dict,
    *,
    focus: str,
    goal: str | None = None,
    training_style: str | None = None,
    activity_level: str | None = None,
    injuries: list[str] | None = None,
    equipment: list[str] | None = None,
    k: int = 5,
    max_per_primary_muscle: int = 2,
) -> dict:
    """Top-k exercises for one session, with why each was chosen."""
    focus_key = key(focus)
    if focus_key not in FOCUS_MUSCLES:
        raise ExerciseRecommenderError(f"unknown focus '{focus}'; use one of {sorted(FOCUS_MUSCLES)}")
    style_key = key(training_style) if training_style else "gym"
    if equipment:
        allowed = {e.strip().lower() for e in equipment}
    elif style_key in STYLE_ALIAS:
        allowed = set(STYLE_EQUIPMENT[STYLE_ALIAS[style_key]])
    else:
        raise ExerciseRecommenderError(
            f"unknown training style '{training_style}'; use one of {sorted(STYLE_EQUIPMENT)}")
    goal_key = key(goal) if key(goal) in GOAL_PREFERENCES else "general_fitness"
    level = ACTIVITY_LEVEL.get(key(activity_level), "beginner")
    groups = [g for g in (key(i) for i in (injuries or [])) if g in INJURY_MUSCLE_KEYWORDS]

    exercises, matrix = index["exercises"], index["matrix"]
    targets = set(FOCUS_MUSCLES[focus_key])
    excluded = {"equipment": 0, "injury": 0, "level": 0, "off_target": 0}
    keep = np.ones(len(exercises), dtype=bool)
    for i, ex in enumerate(exercises):
        if (ex.get("equipment") or "other") not in allowed:
            keep[i] = False
            excluded["equipment"] += 1
        elif any(loads_injury(ex, g) for g in groups):
            keep[i] = False
            excluded["injury"] += 1
        elif level == "beginner" and ex.get("level") == "expert":
            keep[i] = False
            excluded["level"] += 1
        elif not targets & set(ex["primaryMuscles"]):
            keep[i] = False
            excluded["off_target"] += 1

    q = query_vector(index, focus_key, goal_key, level)
    scores = matrix @ q
    scores[~keep] = -np.inf

    # Spread the session across its target muscles; a 2-muscle focus (core)
    # still needs room for k exercises.
    cap = max(max_per_primary_muscle, -(-k // len(targets)))
    picks, per_muscle = [], {}
    for i in np.argsort(-scores, kind="stable"):
        if not np.isfinite(scores[i]) or len(picks) >= k:
            break
        ex = exercises[i]
        main = ex["primaryMuscles"][0] if ex["primaryMuscles"] else "other"
        if per_muscle.get(main, 0) >= cap:
            continue  # spread the session across muscles
        per_muscle[main] = per_muscle.get(main, 0) + 1
        matched = [m for m in ex["primaryMuscles"] if m in targets]
        picks.append({
            "id": ex["id"], "name": ex["name"], "score": round(float(scores[i]), 4),
            "primary_muscles": ex["primaryMuscles"], "equipment": ex.get("equipment"),
            "level": ex.get("level"), "category": ex.get("category"), "mechanic": ex.get("mechanic"),
            "why": (f"targets {', '.join(matched) or 'supporting muscles'}; "
                    f"{ex.get('category')}/{ex.get('mechanic') or 'n/a'} fits goal '{goal_key}'; "
                    f"{ex.get('equipment')} is available; level {ex.get('level')}"),
        })

    return {
        "focus": focus_key, "goal": goal_key, "level": level, "allowed_equipment": sorted(allowed),
        "injury_groups_excluded": groups, "excluded_counts": excluded,
        "candidates_after_filters": int(keep.sum()), "recommendations": picks,
        "note": (None if len(picks) >= k else
                 f"only {len(picks)} exercises fit every constraint for a {focus_key} session"),
    }


# Style names as stored in profiles ("Home Workouts") → STYLE_EQUIPMENT keys.
STYLE_ALIAS = {k: k for k in STYLE_EQUIPMENT} | {"home": "home_workouts", "home_workout": "home_workouts"}
