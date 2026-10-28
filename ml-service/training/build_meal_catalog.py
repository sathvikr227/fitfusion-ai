"""Stage 2 serving artifact — popularity-ranked recipe catalog.

Why popularity and not a trained model: in the rolling yearly evaluation
(training/evaluate_meal_rolling.py, 2012-2017, 20,031 user-years) recipes liked
most in the preceding 365 days beat implicit ALS on Recall@10 (0.0197 vs 0.0164,
CI of the difference entirely below zero). The simpler method ships.

The catalog holds every recommendable recipe (20-2000 kcal/serving) that
  * fits at least one meal slot by its Food.com course tag, and
  * was liked (4-5 stars) at least once,
ranked by likes in the final 365 days of the data, ties broken by all-time likes.
Dietary flags come from ingredients (training/data_foodcom.py), manually audited:
vegetarian precision >= 92.9% at 95% confidence.

    .venv/Scripts/python.exe -m training.build_meal_catalog
"""

from __future__ import annotations

import json
import re

import joblib
import pandas as pd

from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs, write_report
from training.data_foodcom import AUDIT_2_TRUE_VEGETARIAN, AUDIT_SIZE, LIKES_PATH, RECIPES_PATH, load_likes, load_recipes

ARTIFACT = "meal_catalog.pkl"
POPULARITY_WINDOW_DAYS = 365

# Food.com course tags are noisy ("quick and easy pizza dough" is tagged main-dish,
# "chimichurri" appetizer). Components and condiments are never offered as a meal.
NON_MEAL_TAGS = {"condiments-etc", "sauces", "salad-dressings", "marinades-and-rubs", "spreads", "dips",
                 "jams-and-preserves", "canning", "cocktails", "beverages", "herb-and-spice-mixes"}
# Whole words only: "jambalaya", "crusted" and "butter chicken" are meals.
NON_MEAL_NAME = re.compile(
    r"\b(?:jam|jelly|preserves|marmalade|sauce|dressing|dip|salsa|seasoning|rub|marinade|glaze|dough|"
    r"crust|gravy|syrup|frosting|icing|chutney|relish|pesto|vinaigrette|chimichurri|aioli|mayonnaise|"
    r"spice|stock|broth|brine|batter|coating|topping)s?\b"
)

FLAG_COLUMNS = ["is_vegetarian", "is_vegan", "is_eggetarian", "is_dairy_free", "is_gluten_free", "is_nut_free"]
SLOT_COLUMNS = ["course_breakfast", "course_main_dish", "course_salads", "course_soups_stews",
                "course_snacks", "course_appetizers", "course_desserts", "course_beverages"]


def main() -> None:
    banner("Stage 2 — popularity-ranked meal catalog")
    ensure_dirs()

    recipes = pd.read_pickle(RECIPES_PATH) if RECIPES_PATH.exists() else load_recipes()
    likes = pd.read_pickle(LIKES_PATH) if LIKES_PATH.exists() else load_likes()[0]

    end = likes["date"].max()
    start = end - pd.Timedelta(days=POPULARITY_WINDOW_DAYS)
    recent = likes.loc[likes["date"] > start, "recipe_id"].value_counts()
    all_time = likes["recipe_id"].value_counts()

    catalog = recipes.loc[recipes["recommendable"],
                          ["recipe_id", "name", "minutes", "kcal", "protein_g", "tags",
                           *FLAG_COLUMNS, *SLOT_COLUMNS]].copy()
    catalog["course_breads"] = catalog["tags"].map(lambda t: "breads" in t)
    non_meal_tag = catalog["tags"].map(lambda t: bool(NON_MEAL_TAGS.intersection(t)))
    non_meal = non_meal_tag | catalog["name"].str.contains(NON_MEAL_NAME)
    print(f"  Excluded as components/condiments: {int(non_meal.sum())} recipes")
    catalog = catalog[~non_meal].drop(columns=["tags"])
    catalog["likes_last_year"] = catalog["recipe_id"].map(recent).fillna(0).astype(int)
    catalog["likes_all_time"] = catalog["recipe_id"].map(all_time).fillna(0).astype(int)

    in_a_slot = catalog[["course_breakfast", "course_main_dish", "course_salads", "course_soups_stews",
                         "course_snacks", "course_appetizers"]].any(axis=1)
    catalog = catalog[in_a_slot & (catalog["likes_all_time"] > 0) & ~catalog["course_beverages"]]
    catalog = catalog.sort_values(["likes_last_year", "likes_all_time", "recipe_id"],
                                  ascending=[False, False, True]).reset_index(drop=True)

    print(f"\n  Popularity window: {start.date()} → {end.date()}")
    print(f"  Catalog: {len(catalog)} recipes ({int((catalog['likes_last_year'] > 0).sum())} liked in the window)")
    for column in ["course_breakfast", "course_main_dish", "course_snacks", "course_appetizers"]:
        print(f"    {column:20s} {int(catalog[column].sum())}")
    for flag in FLAG_COLUMNS:
        print(f"    {flag:20s} {int(catalog[flag].sum())}")
    print("\n  Top 5 overall:")
    for row in catalog.head(5).itertuples():
        print(f"    {row.name[:50]:50s} {row.kcal:6.0f} kcal  {row.likes_last_year} likes last year")

    rolling = json.loads((REPORT_DIR / "meal_recommender_rolling.json").read_text(encoding="utf-8"))
    bundle = {
        "catalog": catalog,
        "method": f"popularity_last_{POPULARITY_WINDOW_DAYS}d",
        "window": [str(start.date()), str(end.date())],
        "evaluation": {
            "pooled_recall_at_10": rolling["pooled"],
            "als_vs_popularity": rolling["comparisons"]["als_vs_popularity"],
            "decision": rolling["decision"],
        },
        "vegetarian_audit": f"{AUDIT_2_TRUE_VEGETARIAN}/{AUDIT_SIZE} correct on a fresh random sample",
        "model_version": "meal-popularity-v1",
    }
    path = MODEL_DIR / ARTIFACT
    joblib.dump(bundle, path)
    print(f"\n[artifact] {path}  ({path.stat().st_size / 1e6:.1f} MB)")

    write_report(
        "meal_catalog",
        {
            "artifact": ARTIFACT,
            "method": bundle["method"],
            "window": bundle["window"],
            "recipes": int(len(catalog)),
            "why_not_ml": "rolling yearly evaluation: ALS significantly worse than popularity "
                          f"(ΔRecall@10 {rolling['comparisons']['als_vs_popularity']['difference']:+.4f})",
            "vegetarian_audit": bundle["vegetarian_audit"],
        },
    )


if __name__ == "__main__":
    main()
