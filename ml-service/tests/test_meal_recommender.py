"""Model 2 — correctness of the ALS solvers and the ranking metrics."""

from __future__ import annotations

import numpy as np
import pandas as pd
import scipy.sparse as sp

import training.train_meal_recommender as m
from training.data_foodcom import Split


def _tiny_problem():
    rng = np.random.default_rng(0)
    R = sp.random(40, 30, density=0.15, format="csr", random_state=1, dtype=np.float32)
    R.data[:] = 1
    F = rng.standard_normal((30, 8)).astype(np.float32)
    return R, F


def _textbook_solve(R, F, alpha, reg):
    """Hu, Koren & Volinsky (2008) per-user normal equations, written out directly."""
    out = np.zeros((R.shape[0], F.shape[1]), dtype=np.float64)
    for u in range(R.shape[0]):
        idx = R.indices[R.indptr[u]:R.indptr[u + 1]]
        if len(idx) == 0:
            continue
        c = np.ones(F.shape[0])
        p = np.zeros(F.shape[0])
        c[idx], p[idx] = 1 + alpha, 1
        out[u] = np.linalg.solve((F.T * c) @ F + reg * np.eye(F.shape[1]), (F.T * c) @ p)
    return out


def test_exact_als_half_matches_textbook(monkeypatch):
    R, F = _tiny_problem()
    monkeypatch.setattr(m, "ALS_CHUNK_NNZ", 7)  # force many chunks
    assert np.abs(m.als_half(R, F, 5.0, 0.5) - _textbook_solve(R, F, 5.0, 0.5)).max() < 1e-4


def test_conjugate_gradient_als_converges_to_exact():
    R, F = _tiny_problem()
    cg = m.als_half_cg(R, F, np.zeros((40, 8), np.float32), 5.0, 0.5, steps=8)
    assert np.abs(cg - _textbook_solve(R, F, 5.0, 0.5)).max() < 1e-3


def _context_with_known_answers():
    likes = pd.DataFrame(
        {
            "user_id": [1, 1, 2, 2, 1, 2],
            "recipe_id": [10, 11, 11, 12, 13, 10],
            "date": pd.to_datetime(["2010-01-01"] * 4 + ["2015-01-01"] * 2),
        }
    )
    recipes = pd.DataFrame(
        {"recipe_id": [10, 11, 12, 13, 14], "recommendable": [True] * 5,
         "ingredients": [["a"]] * 5, "tags": [["t"]] * 5}
    )
    split = Split("t", likes[likes.date < "2014"], likes[likes.date >= "2014"],
                  pd.Timestamp("2014-01-01"), None)
    return m.build_context(split, recipes)


def test_evaluation_scores_a_perfect_ranker_as_one(monkeypatch):
    monkeypatch.setattr(m, "K", 2)
    ctx = _context_with_known_answers()

    class Oracle:
        def score(self, rows):
            s = np.zeros((len(rows), len(ctx.catalog_ids)), np.float32)
            for b, r in enumerate(rows):
                s[b, ctx.truth[list(ctx.eval_users).index(r)]] = 1.0
            return s

    frame = m.evaluate(Oracle(), ctx)
    assert frame["recall"].eq(1.0).all() and frame["ndcg"].eq(1.0).all()


def test_evaluation_never_recommends_already_liked_recipes(monkeypatch):
    monkeypatch.setattr(m, "K", 2)
    ctx = _context_with_known_answers()

    class LovesHistory:
        """Already-liked recipes score highest, the true answer second. Only if
        history is masked does the true answer reach the top of the list."""

        def score(self, rows):
            s = np.zeros((len(rows), len(ctx.catalog_ids)), np.float32)
            for b, r in enumerate(rows):
                j = list(ctx.eval_users).index(r)
                s[b, ctx.seen_catalog[j]] = 100.0
                s[b, ctx.truth[j]] = 50.0
            return s

    monkeypatch.setattr(m, "K", 1)
    frame = m.evaluate(LovesHistory(), ctx)
    assert frame["recall"].eq(1.0).all()
