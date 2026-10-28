"""Model 2 inference — hybrid meal ranking (popularity + ALS + ingredient content).

Used by POST /recommend, the teacher demo and the tests, so all three run the
same code. Mirrors the evaluation in training/train_meal_hybrid.py exactly:
each signal is scored over every recommendable recipe, min-max normalised per
user (recipes a signal cannot score get 0), then blended with the weights the
validation split selected. Dietary and calorie filters are applied afterwards
by the router and are never traded off against the score.

Personal history: the Food.com recipe IDs a user has eaten (FitFusion plan
meals marked eaten). A new user is folded into the ALS model with the same
equation as the ALS user step. With no usable history the ranking is
popularity alone — the cold-start strategy.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SIGNALS = ("popularity", "als", "text")


@dataclass
class HybridScores:
    blended: np.ndarray                 # per artifact id
    signals: dict[str, np.ndarray]      # normalised [0, 1] per artifact id
    history_used: list[int]             # liked IDs that exist in the model
    cold_start: bool


def normalise(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Min-max to [0, 1] over `valid` recipes; everything else 0."""
    out = np.zeros(len(values), dtype=np.float32)
    if not valid.any():
        return out
    v = values[valid]
    low, high = float(v.min()), float(v.max())
    out[valid] = (v - low) / max(high - low, 1e-9)
    return out


def fold_in(bundle: dict, rows: np.ndarray) -> np.ndarray:
    """ALS user vector for liked item rows: (YᵀY + reg·I + α Σ y yᵀ) x = (1+α) Σ y."""
    Y = bundle["factors"][rows]
    alpha = bundle["alpha"]
    A = bundle["gram"] + alpha * (Y.T @ Y)
    b = (1.0 + alpha) * Y.sum(axis=0)
    return np.linalg.solve(A, b).astype(np.float32)


def score(bundle: dict, liked_recipe_ids: list[int] | None) -> HybridScores:
    ids, rec = bundle["ids"], bundle["recommendable"]
    pop = normalise(bundle["popularity"], rec)

    position = {int(i): n for n, i in enumerate(ids)}
    rows = np.array(sorted({position[int(r)] for r in (liked_recipe_ids or []) if int(r) in position}), dtype=int)
    if len(rows) == 0:
        return HybridScores(blended=pop, signals={"popularity": pop}, history_used=[], cold_start=True)

    # ALS: only recipes with learned factors can be scored (others were never liked).
    factor_rows = rows[bundle["has_factor"][rows]]
    if len(factor_rows):
        user = fold_in(bundle, factor_rows)
        als = normalise(bundle["factors"] @ user, rec & bundle["has_factor"])
    else:
        als = np.zeros(len(ids), dtype=np.float32)

    profile = np.asarray(bundle["tfidf"][rows].sum(axis=0)).ravel()
    norm = float(np.linalg.norm(profile))
    text_raw = bundle["tfidf"] @ (profile / norm) if norm > 0 else np.zeros(len(ids), dtype=np.float32)
    text = normalise(np.asarray(text_raw, dtype=np.float32).ravel(), rec)

    signals = {"popularity": pop, "als": als, "text": text}
    w = bundle["weights"]
    blended = sum(float(w.get(s, 0.0)) * signals[s] for s in SIGNALS)
    return HybridScores(blended=blended.astype(np.float32), signals=signals,
                        history_used=[int(ids[r]) for r in rows], cold_start=False)


def explain(bundle: dict, scores: HybridScores, recipe_id: int) -> dict[str, float]:
    """Each signal's weighted contribution to one recipe's blended score."""
    n = int(np.searchsorted(bundle["ids"], recipe_id))
    if n >= len(bundle["ids"]) or bundle["ids"][n] != recipe_id:
        return {}
    w = bundle["weights"] if not scores.cold_start else {"popularity": 1.0}
    return {s: round(float(w.get(s, 0.0)) * float(v[n]), 4) for s, v in scores.signals.items()}
