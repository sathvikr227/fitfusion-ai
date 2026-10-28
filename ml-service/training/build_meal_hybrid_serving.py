"""Model 2 — build the artifact that serves the hybrid meal recommender.

The rolling test (training/train_meal_hybrid.py, reports/meal_hybrid.json)
selected  0.5·popularity + 0.25·ALS + 0.25·ingredient/tag TF-IDF  and it beat
popularity on held-out years 2014-2017 with the CI above zero, so it is served.

This script refits the three signals on every like before --cutoff and saves
what inference needs (app/meal_hybrid.py):

  ids          recipe IDs scored (recommendable recipes + every liked recipe)
  recommendable  mask — normalisation and ranking use recommendable recipes only
  factors      ALS item factors (zero rows for recipes nobody liked) + has_factor
  gram         YᵀY + reg·I, so a new user is folded in with one 64×64 solve:
               (YᵀY + reg·I + α Σ y_i y_iᵀ) x = (1 + α) Σ y_i   (the ALS user step)
  tfidf        L2-normalised TF-IDF rows over ingredients + tags
  popularity   likes in the 365 days before the cutoff

    .venv/Scripts/python.exe -m training.build_meal_hybrid_serving                       # serving: all likes
    .venv/Scripts/python.exe -m training.build_meal_hybrid_serving --cutoff 2018-01-01 \\
        --out meal_hybrid_demo.pkl                                                        # demo: hides 2018
"""

from __future__ import annotations

import argparse
import json
import time
from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer

from training.common import MODEL_DIR, REPORT_DIR, banner, ensure_dirs
from training.data_foodcom import LIKES_PATH, RECIPES_PATH
from training.evaluate_meal_rolling import ALS_CONFIG
from training.train_meal_recommender import ALS, recipe_tokens
from training.train_meal_hybrid import POPULARITY_WINDOW_DAYS

SERVING_ARTIFACT = "meal_hybrid_serving.pkl"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff", default=None, help="use likes before this date (default: all)")
    parser.add_argument("--out", default=SERVING_ARTIFACT)
    args = parser.parse_args()

    banner(f"Model 2 — hybrid serving artifact ({args.out})")
    ensure_dirs()
    report = json.loads((REPORT_DIR / "meal_hybrid.json").read_text(encoding="utf-8"))
    if not report.get("hybrid_served"):
        raise SystemExit("meal_hybrid.json says the hybrid is not served; nothing to build")
    weights = report["selected_weights"]
    print(f"  weights (from the evaluation): {weights}")

    recipes = pd.read_pickle(RECIPES_PATH)
    likes = pd.read_pickle(LIKES_PATH)
    cutoff = pd.Timestamp(args.cutoff) if args.cutoff else likes["date"].max() + pd.Timedelta(days=1)
    train = likes[likes["date"] < cutoff]
    print(f"  likes before {cutoff.date()}: {len(train):,} from {train['user_id'].nunique():,} users")

    users = pd.Index(train["user_id"].unique())
    items = pd.Index(train["recipe_id"].unique())
    X = sp.csr_matrix((np.ones(len(train), dtype=np.float32),
                       (users.get_indexer(train["user_id"]), items.get_indexer(train["recipe_id"]))),
                      shape=(len(users), len(items)))

    t0 = time.time()
    als = ALS(SimpleNamespace(X=X), **ALS_CONFIG)
    print(f"  ALS fitted in {time.time() - t0:.0f}s ({X.shape[1]:,} items, {ALS_CONFIG})")

    recommendable_ids = recipes.loc[recipes["recommendable"], "recipe_id"].to_numpy()
    ids = np.union1d(recommendable_ids, items.to_numpy())
    position = items.get_indexer(ids)
    factors = np.zeros((len(ids), als.item_factors.shape[1]), dtype=np.float32)
    has_factor = position >= 0
    factors[has_factor] = als.item_factors[position[has_factor]]
    gram = (als.item_factors.T @ als.item_factors
            + ALS_CONFIG["reg"] * np.eye(als.item_factors.shape[1], dtype=np.float32)).astype(np.float32)

    indexed = recipes.set_index("recipe_id")
    vectorizer = TfidfVectorizer(analyzer=lambda tokens: tokens, min_df=5, sublinear_tf=True)
    tfidf = vectorizer.fit_transform([recipe_tokens(r) for r in indexed.loc[ids].itertuples()])
    tfidf = tfidf.astype(np.float32).tocsr()

    recent = train[train["date"] >= cutoff - pd.Timedelta(days=POPULARITY_WINDOW_DAYS)]
    counts = recent["recipe_id"].value_counts()
    popularity = pd.Series(0.0, index=ids)
    popularity.loc[popularity.index.intersection(counts.index)] = counts
    print(f"  {len(ids):,} recipes scored ({int(np.isin(ids, recommendable_ids).sum()):,} recommendable), "
          f"{tfidf.shape[1]:,} TF-IDF terms")

    bundle = {
        "weights": weights,
        "ids": ids,
        "recommendable": np.isin(ids, recommendable_ids),
        "factors": factors,
        "has_factor": has_factor,
        "gram": gram,
        "alpha": float(ALS_CONFIG["alpha"]),
        "tfidf": tfidf,
        "popularity": popularity.to_numpy(np.float32),
        "cutoff": str(cutoff.date()),
        "popularity_window": [str((cutoff - pd.Timedelta(days=POPULARITY_WINDOW_DAYS)).date()), str(cutoff.date())],
        "model_version": "meal-hybrid-v1",
        "evaluation": {"report": "meal_hybrid.json", "pooled": report["pooled"],
                       "hybrid_vs_popularity": report["comparisons"]["hybrid_vs_popularity_recall"]},
    }
    joblib.dump(bundle, MODEL_DIR / args.out, compress=3)
    print(f"[artifact] {MODEL_DIR / args.out}")


if __name__ == "__main__":
    main()
