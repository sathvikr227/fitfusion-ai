"""Model 2 — hybrid meal recommender (collaborative + content + popularity).

Output: for one user, a ranked list of recipes. Every signal is computed per
user over all ~223k recommendable Food.com recipes, normalised to [0, 1] per user,
and blended:

    score = w_pop·popularity + w_cf·ALS + w_text·cos(ingredients/tags) + w_nutr·cos(nutrition)

  popularity  likes in the 365 days before the cutoff (the served baseline)
  ALS         implicit matrix factorisation (collaborative filtering), the
              configuration chosen on validation in train_meal_recommender.py
  text        cosine between the recipe's TF-IDF over ingredients + tags and the
              sum of the user's liked recipes (content-based)
  nutrition   cosine between the recipe's standardised nutrition vector
              (kcal, protein, fat, sugar, sodium, saturated fat, carbs) and the
              mean of the user's liked recipes (content-based)

Protocol, fixed before any result was seen (2026-10-28)
  1. Weights: grid over the simplex in steps of 0.25 (35 combinations), chosen
     by Recall@10 on the validation split (train < 2012, evaluate 2012-2013).
  2. Test: rolling years 2014..2017 — each year trains on all earlier likes,
     refreshes popularity and ALS, and evaluates that year's likes. These years
     come after the validation window, so tuning cannot leak into the test.
  3. Metrics per user: Recall@10 (primary), NDCG@10, Precision@5, Hit@10.
     95% CIs from a bootstrap that resamples users (a user can appear in
     several years).
  4. Serving rule (the user's choice): the hybrid is served only if its pooled
     Recall@10 beats popularity with the CI entirely above zero. Otherwise
     popularity is served and the hybrid is kept as documented evidence.

Relevance labels: a recipe is relevant for a user-year if the user rated it
>= 4 stars in that year (Food.com ratings). Already-liked recipes are excluded
from the candidates.

    .venv/Scripts/python.exe -m training.train_meal_hybrid
"""

from __future__ import annotations

import itertools
import time

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report
from training.data_foodcom import LIKES_PATH, RECIPES_PATH, make_split, validation_split
from training.evaluate_meal_rolling import ALS_CONFIG, cluster_bootstrap
from training.train_meal_recommender import ALS, BUCKETS, Content, Popularity, build_context

ARTIFACT = "meal_hybrid.pkl"
FIGURE = "meal_hybrid_rolling.png"
K = 10
BATCH = 64
POPULARITY_WINDOW_DAYS = 365
TEST_YEARS = [2014, 2015, 2016, 2017]
SIGNALS = ["popularity", "als", "text", "nutrition"]
NUTRITION = ["kcal", "protein_g", "fat_pdv", "sugar_pdv", "sodium_pdv", "satfat_pdv", "carbs_pdv"]
STEP = 0.25


def weight_grid() -> list[tuple[float, ...]]:
    steps = int(round(1 / STEP))
    combos = [c for c in itertools.product(range(steps + 1), repeat=len(SIGNALS)) if sum(c) == steps]
    return [tuple(round(x * STEP, 2) for x in c) for c in combos]


def label(w: tuple[float, ...]) -> str:
    return "hybrid(" + ",".join(f"{s[:3]}={x:g}" for s, x in zip(SIGNALS, w) if x) + ")"


class Nutrition:
    """Cosine between standardised nutrition vectors and the user's liked mean."""

    def __init__(self, ctx, recipes: pd.DataFrame):
        indexed = recipes.set_index("recipe_id")[NUTRITION].astype(float)
        values = np.log1p(indexed.clip(lower=0))
        values = (values - values.mean()) / values.std()
        catalog = values.loc[ctx.catalog_ids].to_numpy(np.float32)
        self.catalog = catalog / np.maximum(np.linalg.norm(catalog, axis=1, keepdims=True), 1e-9)
        self.train_items = values.reindex(ctx.items).fillna(0).to_numpy(np.float32)
        self.X = ctx.X

    def score(self, rows: np.ndarray) -> np.ndarray:
        liked = self.X[rows]
        counts = np.maximum(np.asarray(liked.sum(axis=1)), 1)
        profile = np.asarray(liked @ self.train_items) / counts
        profile /= np.maximum(np.linalg.norm(profile, axis=1, keepdims=True), 1e-9)
        return (profile @ self.catalog.T).astype(np.float32)


def normalise(scores: np.ndarray) -> np.ndarray:
    """Per-user min-max to [0, 1]; recipes a signal cannot score (-inf) get 0."""
    finite = np.isfinite(scores)
    filled = np.where(finite, scores, np.nan)
    low = np.nanmin(filled, axis=1, keepdims=True)
    high = np.nanmax(filled, axis=1, keepdims=True)
    out = (filled - low) / np.maximum(high - low, 1e-9)
    return np.nan_to_num(out, nan=0.0).astype(np.float32)


def build_signals(ctx, recipes):
    t0 = time.time()
    models = {
        "popularity": Popularity(ctx, POPULARITY_WINDOW_DAYS),
        "als": ALS(ctx, **ALS_CONFIG),
        "text": Content(ctx, recipes),
        "nutrition": Nutrition(ctx, recipes),
    }
    print(f"    signals built in {time.time() - t0:.0f}s")
    return models


def evaluate_blends(ctx, models: dict, blends: dict[str, tuple[float, ...]]) -> dict[str, pd.DataFrame]:
    """Score every blend in one pass over the users; per-user metrics per blend."""
    discounts = 1.0 / np.log2(np.arange(2, K + 2))
    metrics = {name: {"recall": [], "ndcg": [], "precision5": [], "hit": []} for name in blends}
    for start in range(0, len(ctx.eval_users), BATCH):
        rows = ctx.eval_users[start:start + BATCH]
        signals = {s: normalise(models[s].score(rows)) for s in SIGNALS}
        for name, weights in blends.items():
            scores = sum(w * signals[s] for s, w in zip(SIGNALS, weights) if w)
            for b in range(len(rows)):
                seen = ctx.seen_catalog[start + b]
                if len(seen):
                    scores[b, seen] = -np.inf
            top = np.argpartition(-scores, K, axis=1)[:, :K]
            order = np.argsort(-np.take_along_axis(scores, top, axis=1), axis=1, kind="stable")
            top = np.take_along_axis(top, order, axis=1)
            m = metrics[name]
            for b in range(len(rows)):
                truth = ctx.truth[start + b]
                relevant = np.isin(top[b], truth)
                n_rel = min(len(truth), K)
                m["recall"].append(relevant.sum() / n_rel)
                m["ndcg"].append((discounts * relevant).sum() / discounts[:n_rel].sum())
                m["precision5"].append(relevant[:5].sum() / 5)
                m["hit"].append(float(relevant.any()))
    return {name: pd.DataFrame({**m, "bucket": ctx.buckets}) for name, m in metrics.items()}


def summary(frame: pd.DataFrame) -> dict:
    return {
        "recall_at_10": float(frame["recall"].mean()),
        "ndcg_at_10": float(frame["ndcg"].mean()),
        "precision_at_5": float(frame["precision5"].mean()),
        "hit_rate_at_10": float(frame["hit"].mean()),
        "users": int(len(frame)),
    }


def main() -> None:
    banner("Model 2 — hybrid meal recommender (CF + content + popularity)")
    ensure_dirs()
    recipes = pd.read_pickle(RECIPES_PATH)
    likes = pd.read_pickle(LIKES_PATH)
    grid = weight_grid()
    print(f"  {len(grid)} weight combinations over {SIGNALS}, step {STEP}")

    # ── 1. tune on validation ──────────────────────────────────────────────────
    print("\n[1] validation: train < 2012, evaluate 2012-2013")
    ctx = build_context(validation_split(likes, recipes), recipes)
    print(f"    {len(ctx.eval_users)} users, {ctx.X.nnz} training likes")
    models = build_signals(ctx, recipes)
    t0 = time.time()
    frames = evaluate_blends(ctx, models, {label(w): w for w in grid})
    print(f"    {len(grid)} blends evaluated in {time.time() - t0:.0f}s")
    validation = {name: summary(f) for name, f in frames.items()}
    ranked = sorted(validation.items(), key=lambda kv: -kv[1]["recall_at_10"])
    for name, s in ranked[:8]:
        print(f"    {name:44s} Recall@10 {s['recall_at_10']:.4f}  P@5 {s['precision_at_5']:.4f}")
    pop_only = label((1.0, 0.0, 0.0, 0.0))
    print(f"    ... popularity alone {validation[pop_only]['recall_at_10']:.4f}")
    best_name = ranked[0][0]
    best = next(w for w in grid if label(w) == best_name)
    if best == (1.0, 0.0, 0.0, 0.0):
        # Popularity alone won validation: test the best blend that uses a
        # personal signal, so the test still answers "does personalisation help?"
        best_name, best = next((n, next(w for w in grid if label(w) == n)) for n, _ in ranked if n != pop_only)
        print(f"    popularity alone won validation; testing the best personalised blend instead")
    print(f"    selected: {best_name}")
    del models, frames, ctx

    # ── 2. rolling test, 2014-2017 ─────────────────────────────────────────────
    print(f"\n[2] rolling test {TEST_YEARS[0]}-{TEST_YEARS[-1]} (after the validation window)")
    blends = {"popularity": (1.0, 0.0, 0.0, 0.0), "als": (0.0, 1.0, 0.0, 0.0),
              "content_text": (0.0, 0.0, 1.0, 0.0), "content_nutrition": (0.0, 0.0, 0.0, 1.0),
              "hybrid": best}
    rows, per_year = [], {}
    for year in TEST_YEARS:
        ctx = build_context(make_split(likes, recipes, f"{year}-01-01", f"{year + 1}-01-01", str(year)), recipes)
        models = build_signals(ctx, recipes)
        frames = evaluate_blends(ctx, models, blends)
        frame = pd.DataFrame({"year": year, "user_id": ctx.users[ctx.eval_users].to_numpy(), "bucket": ctx.buckets})
        for name, f in frames.items():
            frame[name] = f["recall"].to_numpy()
            frame[f"{name}_p5"] = f["precision5"].to_numpy()
            frame[f"{name}_ndcg"] = f["ndcg"].to_numpy()
        rows.append(frame)
        per_year[year] = {"users": int(len(frame)), **{n: float(frame[n].mean()) for n in blends}}
        y = per_year[year]
        print(f"    {year}: {y['users']:5d} users  " + "  ".join(f"{n} {y[n]:.4f}" for n in blends))
        del models, frames, ctx

    pooled = pd.concat(rows, ignore_index=True)
    results = {
        n: {"recall_at_10": float(pooled[n].mean()), "precision_at_5": float(pooled[f"{n}_p5"].mean()),
            "ndcg_at_10": float(pooled[f"{n}_ndcg"].mean())}
        for n in blends
    }
    by_bucket = {
        b: {n: float(pooled.loc[pooled["bucket"] == b, n].mean()) for n in blends}
        | {"user_years": int((pooled["bucket"] == b).sum())}
        for b in BUCKETS
    }
    hybrid_vs_pop = cluster_bootstrap(pooled, "hybrid", "popularity")
    hybrid_vs_pop_p5 = cluster_bootstrap(pooled, "hybrid_p5", "popularity_p5")
    hybrid_vs_als = cluster_bootstrap(pooled, "hybrid", "als")

    print(f"\n    pooled over {len(pooled)} user-years ({pooled['user_id'].nunique()} users):")
    for n, r in results.items():
        print(f"      {n:18s} Recall@10 {r['recall_at_10']:.4f}  P@5 {r['precision_at_5']:.4f}  NDCG@10 {r['ndcg_at_10']:.4f}")
    for lab, r in (("hybrid − popularity (Recall@10)", hybrid_vs_pop), ("hybrid − popularity (P@5)", hybrid_vs_pop_p5),
                   ("hybrid − ALS (Recall@10)", hybrid_vs_als)):
        print(f"      {lab:34s} Δ {r['difference']:+.4f} [95% CI {r['ci95'][0]:+.4f}, {r['ci95'][1]:+.4f}]")

    served = hybrid_vs_pop["ci95"][0] > 0
    decision = ("SERVE HYBRID: beats popularity with CI above zero" if served else
                "SERVE POPULARITY: the hybrid does not beat popularity with CI above zero")
    print(f"\n    DECISION: {decision}")

    fig, ax = plt.subplots(figsize=(9, 4.8))
    for n, style in zip(blends, ("o-", "s-", "^:", "v:", "D--")):
        ax.plot(TEST_YEARS, [per_year[y][n] for y in TEST_YEARS], style, label=n)
    ax.set_xticks(TEST_YEARS)
    ax.set_xlabel("test year (trained on all earlier likes)")
    ax.set_ylabel("Recall@10")
    ax.set_title(f"Model 2 hybrid vs components — {'hybrid served' if served else 'popularity served'}")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(REPORT_DIR / FIGURE, dpi=140)
    plt.close(fig)

    joblib.dump({"weights": dict(zip(SIGNALS, best)), "signals": SIGNALS, "served": served,
                 "popularity_window_days": POPULARITY_WINDOW_DAYS, "als_config": ALS_CONFIG,
                 "nutrition_columns": NUTRITION, "model_version": "meal-hybrid-v1"}, MODEL_DIR / ARTIFACT)

    write_report("meal_hybrid", {
        "protocol": "weights tuned on validation (train<2012, eval 2012-13); rolling test 2014-2017; "
                    "user-resampling bootstrap; serve hybrid only if Recall@10 CI vs popularity > 0",
        "relevance": "rated >= 4 stars by the user in the evaluation year (Food.com)",
        "signals": SIGNALS,
        "weight_grid_size": len(grid),
        "validation_top10": dict(ranked[:10]),
        "validation_popularity_only": validation[pop_only],
        "selected_weights": dict(zip(SIGNALS, best)),
        "test_years": TEST_YEARS,
        "per_year_recall_at_10": per_year,
        "pooled": results,
        "pooled_by_prior_likes": by_bucket,
        "comparisons": {"hybrid_vs_popularity_recall": hybrid_vs_pop,
                        "hybrid_vs_popularity_precision5": hybrid_vs_pop_p5,
                        "hybrid_vs_als_recall": hybrid_vs_als},
        "hybrid_served": served,
        "decision": decision,
        "figure": FIGURE,
        "precision_at_5_target_70pct_met": results["hybrid"]["precision_at_5"] > 0.70,
    })


if __name__ == "__main__":
    main()
