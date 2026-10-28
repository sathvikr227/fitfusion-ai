"""Model 2b — build and evaluate the content-based exercise recommender.

Data: free-exercise-db (https://github.com/yuhonas/free-exercise-db), Unlicense
(public domain), dist/exercises.json pinned to the commit in
data/exercises/SOURCE_COMMIT.txt. Download:

    curl -L https://raw.githubusercontent.com/yuhonas/free-exercise-db/<commit>/dist/exercises.json \
         -o data/exercises/exercises.json

Evaluation. No dataset records which exercises people preferred, so nothing
here measures user satisfaction. What is measured, over every combination of
profile and session (6 styles x 5 goals x 4 activity levels x 7 focuses x
5 injury states = 4,200 queries):

  constraint satisfaction@5  every recommendation respects equipment, injury,
                             level and target-muscle rules (verifies the filters)
  target precision@5         share of the top 5 whose PRIMARY muscle is one the
                             session targets. Since 2026-10-28 this is a hard
                             filter, so it is 1.0 by construction; it is kept to
                             prove the filter holds
  goal alignment@5           share of the top 5 in a category the goal prefers
  baselines                  goal alignment of 5 random exercises that pass the
                             same filters (mean of 20 draws) — the fair test of
                             whether the cosine ranking adds anything
  coverage, short lists, sensitivity (does changing one profile field change
                             the list?)

    .venv/Scripts/python.exe -m training.build_exercise_index
"""

from __future__ import annotations

import itertools
import json

import joblib
import numpy as np

from app.exercise_recommender import (
    ACTIVITY_LEVEL,
    FOCUS_MUSCLES,
    GOAL_PREFERENCES,
    STYLE_EQUIPMENT,
    build_index,
    loads_injury,
    recommend_exercises,
)
from training.common import DATA_DIR, MODEL_DIR, RANDOM_SEED, banner, ensure_dirs, write_report

DATA_FILE = DATA_DIR / "exercises" / "exercises.json"
COMMIT_FILE = DATA_DIR / "exercises" / "SOURCE_COMMIT.txt"
ARTIFACT = "exercise_index.pkl"
K = 5
STYLES = list(STYLE_EQUIPMENT)
GOALS = list(GOAL_PREFERENCES)
ACTIVITIES = ["sedentary", "lightly_active", "moderately_active", "very_active"]
FOCUSES = list(FOCUS_MUSCLES)
INJURIES = [[], ["knee"], ["back"], ["shoulder"], ["hamstring"]]
RANDOM_DRAWS = 20


def satisfies(ex: dict, style: str, activity: str, injuries: list[str], focus: str) -> bool:
    if not set(FOCUS_MUSCLES[focus]) & set(ex["primaryMuscles"]):
        return False
    if (ex.get("equipment") or "other") not in STYLE_EQUIPMENT[style]:
        return False
    if any(loads_injury(ex, g) for g in injuries):
        return False
    return not (ACTIVITY_LEVEL[activity] == "beginner" and ex.get("level") == "expert")


def metrics(picks: list[dict], focus: str, goal: str) -> tuple[float, float]:
    targets = set(FOCUS_MUSCLES[focus])
    cats = set(GOAL_PREFERENCES[goal][0])
    target = np.mean([bool(set(p["primaryMuscles"]) & targets) for p in picks]) if picks else np.nan
    aligned = np.mean([p.get("category") in cats for p in picks]) if picks else np.nan
    return float(target), float(aligned)


def main() -> None:
    banner("Model 2b — content-based exercise recommender")
    ensure_dirs()
    exercises = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    commit = COMMIT_FILE.read_text(encoding="utf-8").strip() if COMMIT_FILE.exists() else "unknown"
    index = build_index(exercises)
    by_id = {ex["id"]: ex for ex in exercises}
    print(f"  {len(exercises)} exercises, {len(index['columns'])} features, source commit {commit.split()[0][:10]}")

    rng = np.random.default_rng(RANDOM_SEED)
    rows, recommended, lists = [], set(), {}
    for style, goal, activity, focus, injuries in itertools.product(STYLES, GOALS, ACTIVITIES, FOCUSES, INJURIES):
        out = recommend_exercises(index, focus=focus, goal=goal, training_style=style,
                                  activity_level=activity, injuries=injuries, k=K)
        picks = [by_id[r["id"]] for r in out["recommendations"]]
        recommended.update(p["id"] for p in picks)
        lists[(style, goal, activity, focus, tuple(injuries))] = tuple(p["id"] for p in picks)
        target, aligned = metrics(picks, focus, goal)

        pool = [ex for ex in exercises if satisfies(ex, style, activity, injuries, focus)]
        rand_t, rand_a = [], []
        for _ in range(RANDOM_DRAWS):
            draw = [pool[i] for i in rng.choice(len(pool), size=min(K, len(pool)), replace=False)] if pool else []
            t, a = metrics(draw, focus, goal)
            rand_t.append(t)
            rand_a.append(a)
        rows.append({
            "style": style, "focus": focus, "returned": len(picks),
            "constraints_ok": all(satisfies(p, style, activity, injuries, focus) for p in picks),
            "target_p5": target, "goal_p5": aligned,
            "random_target_p5": float(np.nanmean(rand_t)) if pool else np.nan,
            "random_goal_p5": float(np.nanmean(rand_a)) if pool else np.nan,
        })

    def mean(key, subset=None):
        vals = [r[key] for r in (subset or rows) if not np.isnan(r[key])]
        return round(float(np.mean(vals)), 4) if vals else None

    full = [r for r in rows if r["returned"] == K]
    # Sensitivity: queries that differ in exactly one field.
    fields = ["style", "goal", "activity", "focus", "injuries"]
    sensitivity = {}
    keys = list(lists)
    for f, field in enumerate(fields):
        changed = total = 0
        for a in keys:
            for b in keys:
                if a < b and all((a[i] == b[i]) == (i != f) for i in range(5)):
                    total += 1
                    changed += lists[a] != lists[b]
        sensitivity[field] = round(changed / total, 4) if total else None

    by_style_focus_short = {}
    for r in rows:
        if r["returned"] < K:
            by_style_focus_short.setdefault(f"{r['style']}/{r['focus']}", 0)
            by_style_focus_short[f"{r['style']}/{r['focus']}"] += 1

    results = {
        "queries": len(rows),
        "constraint_satisfaction_at_5": round(float(np.mean([r["constraints_ok"] for r in rows])), 4),
        "target_precision_at_5": mean("target_p5"),
        "target_precision_at_5_random_within_filters": mean("random_target_p5"),
        "goal_alignment_at_5": mean("goal_p5"),
        "goal_alignment_at_5_random_within_filters": mean("random_goal_p5"),
        "queries_with_full_5": len(full),
        "short_list_queries": len(rows) - len(full),
        "short_lists_by_style_focus": dict(sorted(by_style_focus_short.items(), key=lambda kv: -kv[1])[:10]),
        "catalog_coverage": round(len(recommended) / len(exercises), 4),
        "sensitivity_one_field_changed": sensitivity,
    }
    print(f"  queries {results['queries']}  constraint satisfaction {results['constraint_satisfaction_at_5']:.3f}")
    print(f"  target precision@5 {results['target_precision_at_5']:.3f}  vs random-within-filters "
          f"{results['target_precision_at_5_random_within_filters']:.3f}")
    print(f"  goal alignment@5   {results['goal_alignment_at_5']:.3f}  vs random-within-filters "
          f"{results['goal_alignment_at_5_random_within_filters']:.3f}")
    print(f"  full 5 returned for {len(full)}/{len(rows)}; coverage {results['catalog_coverage']:.3f}")
    print(f"  sensitivity (list changes when one field changes): {sensitivity}")
    print(f"  most short lists: {results['short_lists_by_style_focus']}")

    joblib.dump(index | {"source_commit": commit, "model_version": "exercise-content-v1"}, MODEL_DIR / ARTIFACT)
    print(f"[artifact] {MODEL_DIR / ARTIFACT}")
    write_report("exercise_recommender", {
        "dataset": "free-exercise-db (yuhonas), Unlicense / public domain",
        "source_commit": commit,
        "exercises": len(exercises),
        "method": "content-based cosine similarity over one-hot muscle/equipment/level/category/mechanic/force "
                  "features; hard filters first; max 2 per primary muscle",
        "relevance": "rule-defined from the dataset's own labels (primary muscle in the session's targets; "
                     "category preferred by the goal). Not user preference: no interaction data exists.",
        "results": results,
    })


if __name__ == "__main__":
    main()
