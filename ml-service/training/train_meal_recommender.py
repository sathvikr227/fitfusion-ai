"""Model 2 — personalised meal recommender (top-10 recipes).

Output: for one user, a ranked list of 10 recipe IDs they are likely to like.

Methods compared on the same Food.com splits (training/data_foodcom.py):

  random        10 random recommendable recipes
  popularity    most-liked recipes; window (all time / last 1 or 2 years) tuned
  content       TF-IDF over ingredients + tags; user profile = liked recipes
  item_knn      cosine item-item collaborative filtering, optional inverse user
                frequency weighting (heavy raters count less)
  als           implicit-feedback matrix factorisation (Hu, Koren & Volinsky 2008),
                written directly in NumPy

Protocol, fixed before training
  * tune every method on the validation split (train < 2012, evaluate 2012-13)
  * pick the collaborative model (item_knn or als) by validation Recall@10
  * retrain the chosen configurations on train < 2014 and evaluate ONCE on 2014+
  * candidates are all 223k recommendable recipes minus what the user already liked
  * dietary filters are not part of this ranking test: Food.com users declared no
    restrictions. The filters were validated separately by manual audit.

Keep / drop rule
  KEEP only if the chosen collaborative model beats BOTH popularity and content
  on test Recall@10, with the paired bootstrap 95% CI of the per-user difference
  entirely above zero. Otherwise the model is dropped.

    .venv/Scripts/python.exe -m training.train_meal_recommender
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer

from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report
from training.data_foodcom import (
    LIKES_PATH,
    RECIPES_PATH,
    Split,
    history_bucket,
    load_likes,
    load_recipes,
    test_split,
    validation_split,
)

ARTIFACT = "meal_recommender.pkl"
FIGURE = "meal_recommender_recall.png"
K = 10
BATCH = 256
BOOTSTRAP_RESAMPLES = 2000
BUCKETS = ["1", "2-4", "5-19", "20+"]

POPULARITY_GRID = [None, 730, 365]  # window in days before the cutoff; None = all time
ITEM_KNN_GRID = [False, True]  # inverse user frequency weighting
ALS_GRID = [
    {"factors": 32, "alpha": 10.0, "reg": 1.0},
    {"factors": 64, "alpha": 10.0, "reg": 1.0},
    {"factors": 64, "alpha": 2.0, "reg": 1.0},
    {"factors": 64, "alpha": 40.0, "reg": 1.0},
    {"factors": 64, "alpha": 10.0, "reg": 10.0},
]
ALS_ITERATIONS = 15
ALS_CG_STEPS = 3
ALS_CHUNK_NNZ = 20_000


# ── shared context ────────────────────────────────────────────────────────────
@dataclass
class Context:
    """User-item matrix for one split, plus the catalog it is ranked against."""

    split: Split
    catalog_ids: np.ndarray            # recommendable recipe IDs
    users: pd.Index                    # training users (row order of X)
    items: pd.Index                    # training recipes (column order of X)
    X: sp.csr_matrix                   # users × items, 1 = liked
    item_to_catalog: np.ndarray        # column of each training item in the catalog, -1 if absent
    eval_users: np.ndarray             # row indices into X
    truth: list[np.ndarray]            # catalog columns liked in the evaluation window
    buckets: np.ndarray
    seen_catalog: list[np.ndarray] = field(default_factory=list)


def build_context(split: Split, recipes: pd.DataFrame) -> Context:
    catalog_ids = np.sort(recipes.loc[recipes["recommendable"], "recipe_id"].to_numpy())
    catalog_pos = pd.Index(catalog_ids)

    users = pd.Index(split.train["user_id"].unique())
    items = pd.Index(split.train["recipe_id"].unique())
    rows = users.get_indexer(split.train["user_id"])
    cols = items.get_indexer(split.train["recipe_id"])
    X = sp.csr_matrix((np.ones(len(rows), dtype=np.float32), (rows, cols)), shape=(len(users), len(items)))
    item_to_catalog = catalog_pos.get_indexer(items)

    grouped = split.evaluation.groupby("user_id")["recipe_id"].apply(np.asarray)
    eval_rows = users.get_indexer(grouped.index)
    truth = [catalog_pos.get_indexer(ids) for ids in grouped.to_numpy()]
    history = np.diff(X.indptr)[eval_rows]
    buckets = np.array([history_bucket(int(h)) for h in history])

    seen = []
    for r in eval_rows:
        liked_cols = X.indices[X.indptr[r]:X.indptr[r + 1]]
        mapped = item_to_catalog[liked_cols]
        seen.append(mapped[mapped >= 0])

    return Context(split, catalog_ids, users, items, X, item_to_catalog, eval_rows, truth, buckets, seen)


def to_catalog(ctx: Context, item_scores: np.ndarray) -> np.ndarray:
    """Map (B, n_train_items) scores onto (B, n_catalog); unseen recipes get -inf."""
    out = np.full((item_scores.shape[0], len(ctx.catalog_ids)), -np.inf, dtype=np.float32)
    mask = ctx.item_to_catalog >= 0
    out[:, ctx.item_to_catalog[mask]] = item_scores[:, mask]
    return out


# ── recommenders ──────────────────────────────────────────────────────────────
class Random:
    name = "random"

    def __init__(self, ctx: Context):
        self.rng = np.random.default_rng(RANDOM_SEED)
        self.n = len(ctx.catalog_ids)

    def score(self, rows: np.ndarray) -> np.ndarray:
        return self.rng.random((len(rows), self.n), dtype=np.float32)


class Popularity:
    def __init__(self, ctx: Context, window_days: int | None):
        self.name = f"popularity_{'all' if window_days is None else f'{window_days}d'}"
        train = ctx.split.train
        if window_days is not None:
            train = train[train["date"] >= ctx.split.cutoff - pd.Timedelta(days=window_days)]
        counts = train["recipe_id"].value_counts()
        catalog = pd.Series(0.0, index=ctx.catalog_ids)
        catalog.loc[catalog.index.intersection(counts.index)] = counts
        self.vector = catalog.to_numpy(np.float32)

    def score(self, rows: np.ndarray) -> np.ndarray:
        return np.broadcast_to(self.vector, (len(rows), len(self.vector))).copy()


def recipe_tokens(row) -> list[str]:
    return [f"ing:{i.strip().lower()}" for i in row.ingredients] + [f"tag:{t}" for t in row.tags]


class Content:
    name = "content"

    def __init__(self, ctx: Context, recipes: pd.DataFrame):
        indexed = recipes.set_index("recipe_id")
        vectorizer = TfidfVectorizer(analyzer=lambda tokens: tokens, min_df=5, sublinear_tf=True)
        all_ids = np.union1d(ctx.catalog_ids, ctx.items.to_numpy())
        docs = [recipe_tokens(r) for r in indexed.loc[all_ids].itertuples()]
        T = vectorizer.fit_transform(docs).astype(np.float32).tocsr()
        position = pd.Index(all_ids)
        self.catalog = T[position.get_indexer(ctx.catalog_ids)]
        self.train_items = T[position.get_indexer(ctx.items)]
        self.X = ctx.X

    def score(self, rows: np.ndarray) -> np.ndarray:
        profile = (self.X[rows] @ self.train_items).toarray()
        norms = np.linalg.norm(profile, axis=1, keepdims=True)
        profile /= np.maximum(norms, 1e-9)
        return np.asarray(self.catalog @ profile.T, dtype=np.float32).T


class ItemKNN:
    """score(u, j) = Σ_{i liked by u} cos(i, j), computed without materialising
    the item-item matrix: (X_u D^-½) Xᵀ W X D^-½, W = optional 1/log(1+|user|)."""

    def __init__(self, ctx: Context, iuf: bool):
        self.name = f"item_knn{'_iuf' if iuf else ''}"
        self.ctx = ctx
        self.X = ctx.X
        popularity = np.asarray(self.X.sum(axis=0)).ravel()
        self.inv_sqrt = sp.diags((1.0 / np.sqrt(np.maximum(popularity, 1))).astype(np.float32))
        activity = np.diff(self.X.indptr)
        weights = 1.0 / np.log1p(activity) if iuf else np.ones_like(activity, dtype=float)
        self.XtW = (self.X.T @ sp.diags(weights.astype(np.float32))).tocsr()

    def score(self, rows: np.ndarray) -> np.ndarray:
        left = self.X[rows] @ self.inv_sqrt
        item_scores = ((left @ self.XtW) @ self.X) @ self.inv_sqrt
        return to_catalog(self.ctx, item_scores.toarray())


def als_half_cg(R: sp.csr_matrix, fixed: np.ndarray, current: np.ndarray, alpha: float, reg: float,
                steps: int = ALS_CG_STEPS) -> np.ndarray:
    """Implicit ALS half-step by conjugate gradient (Takács, Pilászy & Tikk 2011).

    Solves the same system as `als_half` for every row at once,
        (YᵀY + reg·I + α Σ_{i∈u} y_i y_iᵀ) x_u = (1 + α) Σ_{i∈u} y_i,
    without building any f×f matrix: A·p needs only one gather per rating.
    Warm-started from the previous factors, a few steps per sweep suffice.
    """
    f = fixed.shape[1]
    gram = fixed.T @ fixed + reg * np.eye(f, dtype=np.float32)
    owner = np.repeat(np.arange(R.shape[0]), np.diff(R.indptr))
    items = R.indices

    def apply_A(P: np.ndarray) -> np.ndarray:
        weights = np.empty(len(items), dtype=np.float32)
        for lo in range(0, len(items), ALS_CHUNK_NNZ * 10):
            hi = lo + ALS_CHUNK_NNZ * 10
            weights[lo:hi] = np.einsum("nf,nf->n", fixed[items[lo:hi]], P[owner[lo:hi]])
        weighted = sp.csr_matrix((weights, items, R.indptr), shape=R.shape)
        return P @ gram + alpha * (weighted @ fixed)

    b = (1.0 + alpha) * (R @ fixed)
    x = current.copy()
    r = b - apply_A(x)
    p = r.copy()
    rr = np.einsum("uf,uf->u", r, r)
    for _ in range(steps):
        Ap = apply_A(p)
        denom = np.einsum("uf,uf->u", p, Ap)
        step = np.where(denom > 0, rr / np.maximum(denom, 1e-12), 0.0).astype(np.float32)
        x += step[:, None] * p
        r -= step[:, None] * Ap
        rr_new = np.einsum("uf,uf->u", r, r)
        beta = np.where(rr > 0, rr_new / np.maximum(rr, 1e-12), 0.0).astype(np.float32)
        p = r + beta[:, None] * p
        rr = rr_new
    return x.astype(np.float32)


def als_half(R: sp.csr_matrix, fixed: np.ndarray, alpha: float, reg: float) -> np.ndarray:
    """Exact solve of every row of R against the fixed factors (reference for the CG version)."""
    f = fixed.shape[1]
    gram = fixed.T @ fixed + reg * np.eye(f, dtype=np.float32)
    out = np.zeros((R.shape[0], f), dtype=np.float32)
    indptr, indices = R.indptr, R.indices
    counts = np.diff(indptr)
    start = 0
    n = R.shape[0]
    while start < n:
        stop = start
        while stop < n and (indptr[stop + 1] - indptr[start] <= ALS_CHUNK_NNZ or stop == start):
            stop += 1
        rows = np.arange(start, stop)
        rows = rows[counts[start:stop] > 0]
        if len(rows):
            lo, hi = indptr[start], indptr[stop]
            E = fixed[indices[lo:hi]]
            offsets = (indptr[rows] - lo).astype(np.int64)
            outer = np.add.reduceat(np.einsum("ni,nj->nij", E, E), offsets, axis=0)
            rhs = np.add.reduceat(E, offsets, axis=0) * (1.0 + alpha)
            A = gram[None, :, :] + alpha * outer
            out[rows] = np.linalg.solve(A, rhs[:, :, None])[:, :, 0]
        start = stop
    return out


class ALS:
    def __init__(self, ctx: Context, factors: int, alpha: float, reg: float, verbose: bool = False):
        self.name = f"als_f{factors}_a{alpha:g}_r{reg:g}"
        self.ctx = ctx
        rng = np.random.default_rng(RANDOM_SEED)
        X = ctx.X
        Xt = X.T.tocsr()
        self.user_factors = (rng.standard_normal((X.shape[0], factors)) * 0.01).astype(np.float32)
        self.item_factors = (rng.standard_normal((X.shape[1], factors)) * 0.01).astype(np.float32)
        for it in range(ALS_ITERATIONS):
            self.user_factors = als_half_cg(X, self.item_factors, self.user_factors, alpha, reg)
            self.item_factors = als_half_cg(Xt, self.user_factors, self.item_factors, alpha, reg)
            if verbose:
                print(f"      iteration {it + 1}/{ALS_ITERATIONS}")
        self.alpha, self.reg = alpha, reg

    def score(self, rows: np.ndarray) -> np.ndarray:
        return to_catalog(self.ctx, self.user_factors[rows] @ self.item_factors.T)


# ── evaluation ────────────────────────────────────────────────────────────────
def evaluate(model, ctx: Context) -> pd.DataFrame:
    discounts = 1.0 / np.log2(np.arange(2, K + 2))
    recall, ndcg, hit, recommended = [], [], [], set()
    for start in range(0, len(ctx.eval_users), BATCH):
        rows = ctx.eval_users[start:start + BATCH]
        scores = model.score(rows)
        for b in range(len(rows)):
            seen = ctx.seen_catalog[start + b]
            if len(seen):
                scores[b, seen] = -np.inf
        top = np.argpartition(-scores, K, axis=1)[:, :K]
        order = np.argsort(-np.take_along_axis(scores, top, axis=1), axis=1)
        top = np.take_along_axis(top, order, axis=1)
        for b in range(len(rows)):
            truth = ctx.truth[start + b]
            picks = top[b]
            recommended.update(picks.tolist())
            relevant = np.isin(picks, truth)
            n_rel = min(len(truth), K)
            recall.append(relevant.sum() / n_rel)
            ideal = discounts[:n_rel].sum()
            ndcg.append((discounts * relevant).sum() / ideal)
            hit.append(float(relevant.any()))
    frame = pd.DataFrame({"recall": recall, "ndcg": ndcg, "hit": hit, "bucket": ctx.buckets})
    frame.attrs["coverage"] = len(recommended) / len(ctx.catalog_ids)
    return frame


def summarise(frame: pd.DataFrame) -> dict:
    out = {
        "recall_at_10": float(frame["recall"].mean()),
        "ndcg_at_10": float(frame["ndcg"].mean()),
        "hit_rate_at_10": float(frame["hit"].mean()),
        "catalog_coverage": float(frame.attrs.get("coverage", 0.0)),
        "users": int(len(frame)),
        "recall_by_history": {},
    }
    for bucket in BUCKETS:
        part = frame[frame["bucket"] == bucket]
        out["recall_by_history"][bucket] = float(part["recall"].mean()) if len(part) else None
    return out


def paired_bootstrap(a: np.ndarray, b: np.ndarray) -> dict:
    diff = a - b
    rng = np.random.default_rng(RANDOM_SEED)
    idx = rng.integers(0, len(diff), size=(BOOTSTRAP_RESAMPLES, len(diff)))
    means = diff[idx].mean(axis=1)
    return {
        "difference": float(diff.mean()),
        "ci95": [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))],
        "relative_improvement_pct": float(diff.mean() / b.mean() * 100) if b.mean() > 0 else None,
    }


def run(model_factory, ctx: Context, label: str) -> tuple[dict, pd.DataFrame, object]:
    t0 = time.time()
    model = model_factory()
    fit_s = time.time() - t0
    frame = evaluate(model, ctx)
    summary = summarise(frame)
    summary["fit_seconds"] = round(fit_s, 1)
    summary["eval_seconds"] = round(time.time() - t0 - fit_s, 1)
    print(f"    {label:28s} Recall@10 {summary['recall_at_10']:.4f}  NDCG@10 {summary['ndcg_at_10']:.4f}  "
          f"Hit@10 {summary['hit_rate_at_10']:.3f}  coverage {summary['catalog_coverage']:.3f}  "
          f"({summary['fit_seconds']:.0f}s fit, {summary['eval_seconds']:.0f}s eval)")
    return summary, frame, model


def draw_figure(test_results: dict, path) -> None:
    methods = list(test_results)
    x = np.arange(len(BUCKETS) + 1)
    width = 0.8 / len(methods)
    fig, ax = plt.subplots(figsize=(12, 5.5))
    for m, name in enumerate(methods):
        s = test_results[name]
        values = [s["recall_by_history"][b] or 0 for b in BUCKETS] + [s["recall_at_10"]]
        ax.bar(x + (m - (len(methods) - 1) / 2) * width, values, width, label=name)
    ax.set_xticks(x, [f"{b} prior likes" for b in BUCKETS] + ["all users"])
    ax.set_ylabel("Recall@10")
    ax.set_title("Model 2 test (2014–2018 likes, trained on < 2014) — Recall@10 by user history")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def main() -> None:
    banner("Model 2 — personalised meal recommender")
    ensure_dirs()

    recipes = pd.read_pickle(RECIPES_PATH) if RECIPES_PATH.exists() else load_recipes()
    likes = pd.read_pickle(LIKES_PATH) if LIKES_PATH.exists() else load_likes()[0]

    # ── 1. validation: tune every family ─────────────────────────────────────
    print("\n[1] Validation (train < 2012, evaluate 2012-13)")
    vctx = build_context(validation_split(likes, recipes), recipes)
    print(f"    {vctx.X.shape[0]} users × {vctx.X.shape[1]} recipes, {vctx.X.nnz} likes; "
          f"{len(vctx.eval_users)} evaluation users")
    validation: dict[str, dict] = {}

    validation["random"], _, _ = run(lambda: Random(vctx), vctx, "random")
    for window in POPULARITY_GRID:
        name = f"popularity_{'all' if window is None else f'{window}d'}"
        validation[name], _, _ = run(lambda w=window: Popularity(vctx, w), vctx, name)
    validation["content"], _, _ = run(lambda: Content(vctx, recipes), vctx, "content")
    for iuf in ITEM_KNN_GRID:
        name = f"item_knn{'_iuf' if iuf else ''}"
        validation[name], _, _ = run(lambda i=iuf: ItemKNN(vctx, i), vctx, name)
    for cfg in ALS_GRID:
        name = f"als_f{cfg['factors']}_a{cfg['alpha']:g}_r{cfg['reg']:g}"
        validation[name], _, _ = run(lambda c=cfg: ALS(vctx, **c), vctx, name)

    def best(prefix: str) -> str:
        return max((k for k in validation if k.startswith(prefix)), key=lambda k: validation[k]["recall_at_10"])

    chosen = {
        "popularity": best("popularity"),
        "item_knn": best("item_knn"),
        "als": best("als"),
    }
    cf_name = max((chosen["item_knn"], chosen["als"]), key=lambda k: validation[k]["recall_at_10"])
    print(f"\n    Chosen on validation — popularity: {chosen['popularity']}, item-kNN: {chosen['item_knn']}, "
          f"ALS: {chosen['als']}")
    print(f"    Collaborative model for the keep/drop test: {cf_name}")

    # ── 2. test: retrain chosen configurations, evaluate once ────────────────
    print("\n[2] Test (train < 2014, evaluate 2014+) — first and only look")
    tctx = build_context(test_split(likes, recipes), recipes)
    print(f"    {tctx.X.shape[0]} users × {tctx.X.shape[1]} recipes, {tctx.X.nnz} likes; "
          f"{len(tctx.eval_users)} evaluation users")

    def factory(name: str, ctx: Context):
        if name == "random":
            return lambda: Random(ctx)
        if name.startswith("popularity"):
            window = None if name.endswith("all") else int(name.split("_")[1][:-1])
            return lambda: Popularity(ctx, window)
        if name == "content":
            return lambda: Content(ctx, recipes)
        if name.startswith("item_knn"):
            return lambda: ItemKNN(ctx, name.endswith("iuf"))
        cfg = next(c for c in ALS_GRID if f"als_f{c['factors']}_a{c['alpha']:g}_r{c['reg']:g}" == name)
        return lambda: ALS(ctx, **cfg)

    test_names = ["random", chosen["popularity"], "content", chosen["item_knn"], chosen["als"]]
    test_results, frames = {}, {}
    for name in test_names:
        test_results[name], frames[name], _ = run(factory(name, tctx), tctx, name)

    # ── 3. keep / drop ───────────────────────────────────────────────────────
    print("\n[3] Keep / drop (rule fixed before training)")
    vs_pop = paired_bootstrap(frames[cf_name]["recall"].to_numpy(), frames[chosen["popularity"]]["recall"].to_numpy())
    vs_content = paired_bootstrap(frames[cf_name]["recall"].to_numpy(), frames["content"]["recall"].to_numpy())
    beats_pop = vs_pop["ci95"][0] > 0
    beats_content = vs_content["ci95"][0] > 0
    decision = "KEEP" if beats_pop and beats_content else "DROP"
    for label, result, ok in (("popularity", vs_pop, beats_pop), ("content", vs_content, beats_content)):
        rel = result["relative_improvement_pct"]
        print(f"    {cf_name} vs {label:10s} ΔRecall@10 {result['difference']:+.4f} "
              f"[95% CI {result['ci95'][0]:+.4f}, {result['ci95'][1]:+.4f}]"
              f"{f' ({rel:+.0f}%)' if rel is not None else ''}  {'PASS' if ok else 'FAIL'}")
    print(f"    DECISION: {decision}")

    print("\n    Recall@10 by prior likes (1 / 2-4 / 5-19 / 20+):")
    for name, s in test_results.items():
        vals = " / ".join(f"{s['recall_by_history'][b]:.4f}" for b in BUCKETS)
        print(f"      {name:28s} {vals}")

    figure_path = REPORT_DIR / FIGURE
    draw_figure(test_results, figure_path)
    print(f"\n[figure] {figure_path}")

    # ── 4. serving artifact: refit the winner on every like ──────────────────
    artifact = None
    if decision == "KEEP":
        print("\n[4] Refit on all likes for serving")
        full = Split("full", likes, likes.iloc[0:0], likes["date"].max() + pd.Timedelta(days=1), None)
        fctx = build_context(full, recipes)
        model = factory(cf_name, fctx)()
        keep_cols = ["recipe_id", "name", "minutes", "kcal", "protein_g", "is_vegetarian", "is_vegan",
                     "is_eggetarian", "is_dairy_free", "is_gluten_free", "is_nut_free"] + \
                    [c for c in recipes.columns if c.startswith("course_")]
        bundle = {
            "algorithm": cf_name,
            "catalog": recipes.loc[recipes["recommendable"], keep_cols].sort_values("recipe_id").reset_index(drop=True),
            "items": fctx.items.to_numpy(),
            "item_to_catalog": fctx.item_to_catalog,
            "popularity": Popularity(fctx, int(chosen["popularity"].split("_")[1][:-1])
                                     if not chosen["popularity"].endswith("all") else None).vector,
            "model_version": "meal-rec-v1",
        }
        if isinstance(model, ALS):
            bundle.update(item_factors=model.item_factors, alpha=model.alpha, reg=model.reg)
        else:
            bundle.update(X=fctx.X, iuf=cf_name.endswith("iuf"))
        path = MODEL_DIR / ARTIFACT
        joblib.dump(bundle, path)
        artifact = ARTIFACT
        print(f"[artifact] {path}")

    write_report(
        "meal_recommender",
        {
            "output": "top-10 recipe IDs for one user",
            "dataset": "Food.com Recipes and Interactions (Majumder et al., EMNLP 2019)",
            "like_definition": "rating >= 4",
            "k": K,
            "validation": {"split": "train < 2012-01-01, evaluate 2012-01-01..2013-12-31",
                           "users": int(len(vctx.eval_users)), "results": validation},
            "chosen_on_validation": chosen,
            "collaborative_model": cf_name,
            "test": {"split": "train < 2014-01-01, evaluate 2014-01-01..", "users": int(len(tctx.eval_users)),
                     "results": test_results},
            "keep_drop": {
                "rule": "collaborative model beats popularity AND content on test Recall@10, "
                        "paired bootstrap 95% CI above zero",
                "vs_popularity": vs_pop,
                "vs_content": vs_content,
                "decision": decision,
            },
            "artifact": artifact,
            "figure": FIGURE,
        },
    )


if __name__ == "__main__":
    main()
