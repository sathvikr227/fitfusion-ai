"""Model 2 teacher demo — hybrid meal recommender + content-based exercise recommender.

Run from ml-service/:

    .venv\\Scripts\\python.exe demos\\model2_recommender\\demo.py
    .venv\\Scripts\\python.exe demos\\model2_recommender\\demo.py my_profile.json

Prints, for the profile in sample_profile.json:
  1. the trained artifacts it loaded
  2. the profile and its calorie targets (same formula as web/src/lib/meal-targets.ts)
  3. top-5 meals per slot for a NEW user (cold start → popularity)
  4. top-5 meals per slot WITH eating history (hybrid), with each signal's share
  5. top-5 exercises per session type, with the reason for each
  6. what changes when one profile field changes
  7. the hybrid on a REAL held-out Food.com user: past likes, picks, hits
  8. the evaluation numbers

Everything is computed now by the same code the API serves; nothing is
hardcoded. Output is also saved to outputs/demo_output.txt and
outputs/sample_recommendations.json.
"""

from __future__ import annotations

import io
import json
import math
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML_SERVICE = HERE.parent.parent
sys.path.insert(0, str(ML_SERVICE))
os.chdir(ML_SERVICE)
os.environ.setdefault("ML_SERVICE_API_KEY", "demo-key")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.meal_hybrid import score as hybrid_score  # noqa: E402

MODEL_DIR = ML_SERVICE / "models"
OUT = HERE / "outputs"
AUTH = {"Authorization": "Bearer demo-key"}
SLOTS = ["breakfast", "lunch", "dinner", "snack"]
FOCUSES = ["push", "pull", "legs", "core"]

# web/src/lib/meal-targets.ts, ported line for line.
ACTIVITY = {"sedentary": 1.2, "lightly_active": 1.375, "moderately_active": 1.55,
            "very_active": 1.725, "extremely_active": 1.9}
SPLIT = {"breakfast": 0.25, "lunch": 0.35, "dinner": 0.30, "snack": 0.10}
MUSCLE_GAIN_PROTEIN = {"breakfast": 15, "lunch": 25, "dinner": 25, "snack": 0}


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


def key(v) -> str:
    return str(v or "").strip().lower().replace("-", "_").replace(" ", "_")


def calorie_targets(p: dict) -> dict:
    sex = 5 if key(p["gender"]) == "male" else -161 if key(p["gender"]) == "female" else -78
    bmr = 10 * p["weight_kg"] + 6.25 * p["height_cm"] - 5 * p["age"] + sex
    tdee = bmr * ACTIVITY.get(key(p["activity_level"]), 1.375)
    g = key(p["goal"])
    adj = -0.2 if any(w in g for w in ("loss", "lose", "fat", "cut")) else 0.1 if any(w in g for w in ("gain", "muscle", "bulk")) else 0.0
    daily = js_round(tdee * (1 + adj))
    return {"bmr": js_round(bmr), "tdee": js_round(tdee), "daily": daily,
            "meals": [{"slot": s, "kcal_target": js_round(daily * SPLIT[s]),
                       "min_protein_g": MUSCLE_GAIN_PROTEIN[s] if adj > 0 else 0} for s in SLOTS]}


def section(title: str) -> None:
    print(f"\n{'─' * 76}\n  {title}\n{'─' * 76}")


def show_meals(body: dict, with_breakdown: bool) -> None:
    for meal in body["meals"]:
        print(f"  {meal['slot'].upper():9s} band {meal['kcal_min']:.0f}-{meal['kcal_max']:.0f} kcal")
        for i, r in enumerate(meal["recipes"], 1):
            extra = ""
            if with_breakdown and r.get("score_breakdown"):
                b = r["score_breakdown"]
                extra = f"  [pop {b['popularity']:.2f} + CF {b['als']:.2f} + content {b['text']:.2f} = {sum(b.values()):.2f}]"
            print(f"    {i}. {r['name'].title()[:46]:46s} {r['kcal']:5.0f} kcal {r['protein_g']:4.0f} g protein"
                  f"  {r['likes_last_year']:3d} likes/yr{extra}")


def real_user_section(recipes: pd.DataFrame | None) -> dict | None:
    demo_path = MODEL_DIR / "meal_hybrid_demo.pkl"
    likes_path = ML_SERVICE / "data" / "processed" / "foodcom_likes.pkl"
    if recipes is None or not demo_path.exists() or not likes_path.exists():
        print("  (skipped: needs models/meal_hybrid_demo.pkl and data/processed/ — see README)")
        return None
    bundle = joblib.load(demo_path)
    likes = pd.read_pickle(likes_path)
    cutoff = pd.Timestamp(bundle["cutoff"])
    before, after = likes[likes["date"] < cutoff], likes[likes["date"] >= cutoff]
    rec_ids = set(bundle["ids"][bundle["recommendable"]].tolist())
    after = after[after["recipe_id"].isin(rec_ids)]
    n_before = before.groupby("user_id").size()
    future = after.groupby("user_id")["recipe_id"].apply(set)
    # Fixed rule, not cherry-picked: >= 10 likes before the cutoff and >= 3
    # recommendable likes after it; the example is the lowest user ID.
    eligible = sorted(u for u in future.index if n_before.get(u, 0) >= 10 and len(future[u]) >= 3)
    if not eligible:
        print("  no eligible held-out user")
        return None

    names = recipes.set_index("recipe_id")["name"]
    ids = bundle["ids"]
    rec_mask = bundle["recommendable"]
    pop_order = np.argsort(-np.where(rec_mask, bundle["popularity"], -np.inf), kind="stable")

    def top10(scores: np.ndarray, seen: set[int]) -> list[int]:
        s = np.where(rec_mask, scores, -np.inf)
        s[np.isin(ids, list(seen))] = -np.inf
        return [int(ids[i]) for i in np.argsort(-s, kind="stable")[:10]]

    recall = {"hybrid": [], "popularity": []}
    example = None
    for u in eligible:
        seen = set(before.loc[before["user_id"] == u, "recipe_id"].astype(int))
        h = top10(hybrid_score(bundle, sorted(seen)).blended, seen)
        p = [int(ids[i]) for i in pop_order if int(ids[i]) not in seen][:10]
        truth = future[u]
        denom = min(len(truth), 10)
        recall["hybrid"].append(len(set(h) & truth) / denom)
        recall["popularity"].append(len(set(p) & truth) / denom)
        if example is None:
            example = (u, seen, h, p, truth)

    u, seen, h, p, truth = example
    past = before[before["user_id"] == u].sort_values("date").tail(5)
    print(f"  Food.com user {u} (real, public data; first eligible user by ID): "
          f"{len(seen)} likes before {cutoff.date()}, {len(truth)} recommendable likes after it")
    print("  last 5 recipes they liked before the cutoff:")
    for rid in past["recipe_id"]:
        print(f"    - {str(names.get(rid, rid)).title()}")
    print(f"\n  {'hybrid top-10':52s} {'popularity top-10'}")
    for a, b in zip(h, p):
        ma = " ✓" if a in truth else "  "
        mb = " ✓" if b in truth else "  "
        print(f"  {ma} {str(names.get(a, a)).title()[:47]:48s} {mb} {str(names.get(b, b)).title()[:47]}")
    print(f"  ✓ = the user actually liked it after {cutoff.date()} (held out from training)")
    print(f"\n  All {len(eligible)} eligible users, Recall@10 on their held-out likes: "
          f"hybrid {np.mean(recall['hybrid']):.4f}  vs popularity {np.mean(recall['popularity']):.4f}")
    print("  (one year, small sample: the pre-registered test over 2014-2017 is in section 8)")
    return {"user": int(u), "hybrid_top10": h, "popularity_top10": p, "held_out_likes": sorted(truth),
            "eligible_users": len(eligible), "recall_at_10": {k: float(np.mean(v)) for k, v in recall.items()}}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    profile_path = Path(args[0]) if args else HERE / "sample_profile.json"
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    settings.ML_SERVICE_API_KEY = "demo-key"
    saved: dict = {}

    print("=" * 76)
    print("  FitFusion Model 2 — hybrid meal recommender + content-based exercise recommender")
    print("=" * 76)

    with TestClient(app) as client:
        from app.model_registry import registry

        section("1. Trained artifacts loaded from disk")
        h, cat, ex = registry.meal_hybrid, registry.recommender, registry.exercise_index
        print(f"  meal_catalog.pkl         {len(cat['catalog']):,} Food.com recipes (popularity window "
              f"{cat.get('window', ['?', '?'])[0]}..{cat.get('window', ['?', '?'])[1]})")
        print(f"  meal_hybrid_serving.pkl  {len(h['ids']):,} recipes, ALS factors {h['factors'].shape}, "
              f"TF-IDF {h['tfidf'].shape}, weights {h['weights']}")
        print(f"  exercise_index.pkl       {len(ex['exercises'])} exercises x {len(ex['columns'])} features "
              f"(free-exercise-db {str(ex.get('source_commit', ''))[:10]})")

        section(f"2. Profile ({profile_path.name}) — {profile.get('_label', 'user-supplied')}")
        for k in ("age", "gender", "height_cm", "weight_kg", "activity_level", "goal", "diet",
                  "training_style", "injuries"):
            print(f"  {k:15s} {profile[k]}")
        t = calorie_targets(profile)
        print(f"  targets         BMR {t['bmr']}  TDEE {t['tdee']}  daily {t['daily']} kcal  →  "
              + ", ".join(f"{m['slot']} {m['kcal_target']}" for m in t["meals"]))
        diet = [] if key(profile["diet"]) in ("non_vegetarian", "none", "") else [profile["diet"]]
        base = {"meals": t["meals"], "dietary_restrictions": diet, "per_meal": 5}

        section("3. Meals for a NEW user (no history → cold start = popularity within the filters)")
        cold = client.post("/recommend", json=base, headers=AUTH).json()
        print(f"  method: {cold['method']}   restrictions applied: {cold['applied_restrictions']}")
        show_meals(cold, with_breakdown=False)
        saved["meals_cold_start"] = cold

        section("4. Meals WITH history — the hybrid (0.5 popularity + 0.25 ALS + 0.25 content)")
        catalog = cat["catalog"]
        history_ids = []
        for term in profile["example_history_search"]:
            hit = catalog[catalog["name"].str.contains(term, case=False) & catalog["is_vegetarian"]].head(1)
            history_ids += [int(x) for x in hit["recipe_id"]]
        print("  example history (recipes this profile 'ate' — chosen by name for the demo, not a real user):")
        for rid in history_ids:
            print(f"    - {catalog.loc[catalog['recipe_id'] == rid, 'name'].iloc[0].title()}")
        warm = client.post("/recommend", json={**base, "liked_recipe_ids": history_ids}, headers=AUTH).json()
        print(f"  method: {warm['method']}   history used: {len(warm['history_used'])} recipes")
        show_meals(warm, with_breakdown=True)
        changed = sum(1 for a, b in zip(cold["meals"], warm["meals"])
                      for r in b["recipes"] if r["recipe_id"] not in {x["recipe_id"] for x in a["recipes"]})
        print(f"  {changed} of {sum(len(m['recipes']) for m in warm['meals'])} picks differ from the cold-start list")
        saved["meals_with_history"] = warm

        section("5. Exercises per session type (content-based cosine, after hard filters)")
        injuries = [i for i in profile["injuries"] if i]
        ex_req = {"goal": profile["goal"], "training_style": profile["training_style"],
                  "activity_level": profile["activity_level"], "injuries": injuries, "k": 5}
        saved["exercises"] = {}
        for focus in FOCUSES:
            body = client.post("/recommend/exercises", json={**ex_req, "focus": focus}, headers=AUTH).json()
            saved["exercises"][focus] = body
            print(f"  {focus.upper():5s} candidates after filters {body['candidates_after_filters']} "
                  f"(removed: {body['excluded_counts']})")
            for i, r in enumerate(body["recommendations"], 1):
                print(f"    {i}. {r['name'][:38]:38s} cos {r['score']:.3f}  {r['why']}")
            if body["note"]:
                print(f"    note: {body['note']}")

        section("6. Change one profile field → the recommendations change")
        vegan = client.post("/recommend", json={**base, "dietary_restrictions": ["vegan"]}, headers=AUTH).json()
        a, b = (sum([[r["name"] for r in m["recipes"]] for m in x["meals"]], []) for x in (cold, vegan))
        print(f"  diet {profile['diet']} → vegan: {len(set(b) - set(a))} of {len(b)} meals change; "
              f"e.g. breakfast #1 '{a[0].title()}' → '{b[0].title()}'")
        legs = client.post("/recommend/exercises", json={**ex_req, "focus": "legs"}, headers=AUTH).json()
        legs_ok = client.post("/recommend/exercises", json={**ex_req, "focus": "legs", "injuries": []}, headers=AUTH).json()
        x, y = ([r["name"] for r in z["recommendations"]] for z in (legs, legs_ok))
        print(f"  legs with knee injury → without: removed by the filter {legs['excluded_counts'].get('injury', 0)} vs "
              f"{legs_ok['excluded_counts'].get('injury', 0)}; list becomes {y}")
        home = client.post("/recommend/exercises", json={**ex_req, "focus": "push", "training_style": "Home Workouts"},
                           headers=AUTH).json()
        print(f"  push day, Gym → Home Workouts: {[r['name'] for r in home['recommendations']]}")

    section("7. The hybrid on a REAL held-out Food.com user (demo model trained only on likes before 2018)")
    recipes_path = ML_SERVICE / "data" / "processed" / "foodcom_recipes.pkl"
    recipes = pd.read_pickle(recipes_path) if recipes_path.exists() else None
    saved["real_user"] = real_user_section(recipes)

    section("8. Evaluation (from models/reports, produced by the training scripts)")
    r = json.loads((MODEL_DIR / "reports" / "meal_hybrid.json").read_text(encoding="utf-8"))
    pooled, c = r["pooled"], r["comparisons"]["hybrid_vs_popularity_recall"]
    print(f"  Meals — pre-registered rolling test 2014-2017, {c['user_years']:,} user-years, relevance = rated >= 4 stars:")
    for name in ("hybrid", "popularity", "als", "content_text"):
        print(f"    {name:14s} Recall@10 {pooled[name]['recall_at_10']:.4f}  Precision@5 {pooled[name]['precision_at_5']:.4f}"
              f"  NDCG@10 {pooled[name]['ndcg_at_10']:.4f}")
    print(f"    hybrid − popularity: {c['difference']:+.4f} [95% CI {c['ci95'][0]:+.4f}, {c['ci95'][1]:+.4f}] "
          f"→ {r['decision']}")
    e = json.loads((MODEL_DIR / "reports" / "exercise_recommender.json").read_text(encoding="utf-8"))["results"]
    print(f"  Exercises — {e['queries']:,} profile/session combinations, rule-defined relevance:")
    print(f"    constraint satisfaction {e['constraint_satisfaction_at_5']:.3f}; goal alignment@5 "
          f"{e['goal_alignment_at_5']:.3f} vs {e['goal_alignment_at_5_random_within_filters']:.3f} random-within-filters")

    (OUT / "sample_recommendations.json").write_text(json.dumps(saved, indent=2, default=str), encoding="utf-8")
    print(f"\n[saved] {OUT / 'sample_recommendations.json'}")


if __name__ == "__main__":
    buffer = io.StringIO()

    class Tee(io.TextIOBase):
        def write(self, s):
            sys.__stdout__.write(s)
            buffer.write(s)
            return len(s)

    with redirect_stdout(Tee()):
        main()
    (OUT / "demo_output.txt").write_text(buffer.getvalue(), encoding="utf-8")
    print(f"[saved] {OUT / 'demo_output.txt'}")
