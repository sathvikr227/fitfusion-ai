"""Model 2 — rolling yearly evaluation (supersedes the single 2014-2018 test).

Why this exists: the first test froze the popularity list at 2014-01-01 and used
it to predict five years of likes. A real app refreshes popularity, so that
design handicapped the baseline. Sensitivity checks on 1- and 2-year windows
showed ALS's advantage was not significant. The protocol is corrected here and
its verdict is final.

Protocol (fixed before running)
  * for Y in 2012..2017: train on likes before Y-01-01, evaluate likes in year Y
  * popularity recomputed each round from the preceding 365 days
  * ALS retrained each round with the configuration chosen on validation
    (factors 64, alpha 2, reg 1) — no re-tuning
  * all user-year results pooled; 95% CI from a bootstrap that resamples USERS,
    since a user can appear in several years

Decision rules
  1. KEEP only if ALS beats popularity on pooled Recall@10 with CI above zero.
  2. The hybrid (popularity for users with 1 prior like, ALS otherwise) replaces
     pure ALS only if rule 1 passed AND the hybrid beats ALS with CI above zero.
  3. If rule 1 fails the model is dropped; the hybrid is reported as exploratory
     only, because its threshold was chosen after seeing earlier results.

    .venv/Scripts/python.exe -m training.evaluate_meal_rolling
"""

from __future__ import annotations

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, write_report
from training.data_foodcom import LIKES_PATH, RECIPES_PATH, make_split
from training.train_meal_recommender import ALS, ARTIFACT, BUCKETS, Popularity, build_context, evaluate

YEARS = list(range(2012, 2018))
ALS_CONFIG = {"factors": 64, "alpha": 2.0, "reg": 1.0}
POPULARITY_WINDOW_DAYS = 365
HYBRID_MAX_PRIOR_LIKES = 1
BOOTSTRAP_RESAMPLES = 2000
FIGURE = "meal_recommender_rolling.png"


class Hybrid:
    """Popularity for users with at most HYBRID_MAX_PRIOR_LIKES likes, ALS otherwise."""

    def __init__(self, ctx, popularity: Popularity, als: ALS):
        self.history = np.diff(ctx.X.indptr)
        self.popularity, self.als = popularity, als

    def score(self, rows: np.ndarray) -> np.ndarray:
        scores = self.als.score(rows)
        cold = self.history[rows] <= HYBRID_MAX_PRIOR_LIKES
        if cold.any():
            scores[cold] = self.popularity.vector
        return scores


def cluster_bootstrap(frame: pd.DataFrame, a: str, b: str) -> dict:
    """Pooled mean difference a − b over user-year rows; CI resamples users."""
    diff = frame[a] - frame[b]
    per_user = pd.DataFrame({"sum": diff, "n": 1}).groupby(frame["user_id"]).sum()
    sums, counts = per_user["sum"].to_numpy(), per_user["n"].to_numpy()
    rng = np.random.default_rng(RANDOM_SEED)
    idx = rng.integers(0, len(sums), size=(BOOTSTRAP_RESAMPLES, len(sums)))
    means = sums[idx].sum(axis=1) / counts[idx].sum(axis=1)
    base = frame[b].mean()
    return {
        "difference": float(diff.mean()),
        "ci95": [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))],
        "relative_pct": float(diff.mean() / base * 100) if base > 0 else None,
        "user_years": int(len(frame)),
        "users": int(len(sums)),
    }


def main() -> None:
    banner("Model 2 — rolling yearly evaluation")
    recipes = pd.read_pickle(RECIPES_PATH)
    likes = pd.read_pickle(LIKES_PATH)

    rows, per_year = [], {}
    for year in YEARS:
        split = make_split(likes, recipes, f"{year}-01-01", f"{year + 1}-01-01", str(year))
        ctx = build_context(split, recipes)
        popularity = Popularity(ctx, POPULARITY_WINDOW_DAYS)
        als = ALS(ctx, **ALS_CONFIG)
        hybrid = Hybrid(ctx, popularity, als)

        frames = {name: evaluate(model, ctx) for name, model in
                  (("popularity", popularity), ("als", als), ("hybrid", hybrid))}
        frame = pd.DataFrame(
            {
                "year": year,
                "user_id": ctx.users[ctx.eval_users].to_numpy(),
                "bucket": ctx.buckets,
                **{name: f["recall"].to_numpy() for name, f in frames.items()},
            }
        )
        rows.append(frame)
        per_year[year] = {
            "users": int(len(frame)),
            "train_likes": int(ctx.X.nnz),
            **{name: float(frame[name].mean()) for name in frames},
        }
        y = per_year[year]
        print(f"  {year}: {y['users']:5d} users  popularity {y['popularity']:.4f}  ALS {y['als']:.4f}  "
              f"hybrid {y['hybrid']:.4f}  {'ALS ahead' if y['als'] > y['popularity'] else 'popularity ahead'}")

    pooled = pd.concat(rows, ignore_index=True)
    print(f"\n  Pooled over {len(pooled)} user-years ({pooled['user_id'].nunique()} users):")
    for name in ("popularity", "als", "hybrid"):
        print(f"    {name:10s} Recall@10 {pooled[name].mean():.4f}")

    by_bucket = {
        bucket: {name: float(pooled.loc[pooled["bucket"] == bucket, name].mean())
                 for name in ("popularity", "als", "hybrid")} | {"user_years": int((pooled["bucket"] == bucket).sum())}
        for bucket in BUCKETS
    }
    print("\n  Pooled Recall@10 by prior likes:")
    for bucket, v in by_bucket.items():
        print(f"    {bucket:5s} ({v['user_years']:5d})  popularity {v['popularity']:.4f}  ALS {v['als']:.4f}  hybrid {v['hybrid']:.4f}")

    als_vs_pop = cluster_bootstrap(pooled, "als", "popularity")
    hybrid_vs_als = cluster_bootstrap(pooled, "hybrid", "als")
    hybrid_vs_pop = cluster_bootstrap(pooled, "hybrid", "popularity")

    def show(label, r):
        rel = f" ({r['relative_pct']:+.0f}%)" if r["relative_pct"] is not None else ""
        print(f"    {label:22s} Δ {r['difference']:+.4f} [95% CI {r['ci95'][0]:+.4f}, {r['ci95'][1]:+.4f}]{rel}")

    print("\n  Paired comparisons (user-resampling bootstrap):")
    show("ALS − popularity", als_vs_pop)
    show("hybrid − ALS", hybrid_vs_als)
    show("hybrid − popularity", hybrid_vs_pop)

    rule1 = als_vs_pop["ci95"][0] > 0
    rule2 = rule1 and hybrid_vs_als["ci95"][0] > 0
    if not rule1:
        decision, policy = "DROP", "popularity (non-ML) within dietary filters"
    elif rule2:
        decision, policy = "KEEP", f"hybrid: popularity for users with <= {HYBRID_MAX_PRIOR_LIKES} likes, ALS otherwise"
    else:
        decision, policy = "KEEP", "ALS for every user"
    years_als_ahead = sum(v["als"] > v["popularity"] for v in per_year.values())

    print(f"\n  Rule 1 — ALS beats popularity (CI above zero): {'PASS' if rule1 else 'FAIL'}")
    print(f"  Rule 2 — hybrid beats ALS (CI above zero):      "
          f"{'PASS' if rule2 else ('FAIL' if rule1 else 'not applicable (rule 1 failed) — exploratory only')}")
    print(f"  ALS ahead of popularity in {years_als_ahead} of {len(YEARS)} years")
    print(f"  DECISION: {decision} — shipped policy: {policy}")

    fig, ax = plt.subplots(figsize=(10, 5))
    for name, style in (("popularity", "o-"), ("als", "s-"), ("hybrid", "^--")):
        ax.plot(YEARS, [per_year[y][name] for y in YEARS], style, label=name)
    ax.set_xlabel("Evaluation year (trained on all earlier likes)")
    ax.set_ylabel("Recall@10")
    ax.set_title(f"Model 2 rolling evaluation — decision: {decision}")
    ax.set_xticks(YEARS)
    ax.legend()
    fig.tight_layout()
    fig.savefig(REPORT_DIR / FIGURE, dpi=150)
    plt.close(fig)
    print(f"\n[figure] {REPORT_DIR / FIGURE}")

    artifact_path = MODEL_DIR / ARTIFACT
    if artifact_path.exists():
        bundle = joblib.load(artifact_path)
        bundle.update(decision=decision, policy=policy, hybrid_max_prior_likes=HYBRID_MAX_PRIOR_LIKES)
        joblib.dump(bundle, artifact_path)
        print(f"[artifact] recorded decision in {artifact_path}")

    write_report(
        "meal_recommender_rolling",
        {
            "supersedes": "meal_recommender.json test section (frozen popularity over a 5-year window)",
            "years": YEARS,
            "als_config": ALS_CONFIG,
            "popularity_window_days": POPULARITY_WINDOW_DAYS,
            "hybrid_max_prior_likes": HYBRID_MAX_PRIOR_LIKES,
            "per_year": per_year,
            "pooled": {name: float(pooled[name].mean()) for name in ("popularity", "als", "hybrid")},
            "pooled_by_prior_likes": by_bucket,
            "comparisons": {"als_vs_popularity": als_vs_pop, "hybrid_vs_als": hybrid_vs_als,
                            "hybrid_vs_popularity_exploratory": hybrid_vs_pop},
            "rules": {"rule1_als_beats_popularity": rule1, "rule2_hybrid_beats_als": rule2},
            "years_als_ahead": years_als_ahead,
            "decision": decision,
            "policy": policy,
            "figure": FIGURE,
        },
    )


if __name__ == "__main__":
    main()
