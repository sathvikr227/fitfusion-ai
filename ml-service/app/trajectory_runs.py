"""Model 4 — running-performance trajectory, shared by the trainer and the endpoint.

Trained on the Strava running logs of Afonseca, Watanabe & Duarte (Figshare
doi:10.6084/m9.figshare.16620238, CC BY 4.0). Input: the last 4 running sessions.
Output: whether the next 4 sessions' Riegel-equivalent 10 km pace will be faster
(IMPROVE), similar (PLATEAU) or slower (REGRESS). Protocol:
demos/model4_trajectory/PROTOCOL.md.
"""

from __future__ import annotations

from datetime import date
from typing import Mapping, Sequence

import numpy as np
import torch
import torch.nn as nn

SEQ_LEN = 4
WINDOW_SPAN_DAYS = 56          # the 8 sessions of a training window fall within this
RIEGEL_EXPONENT = 1.06
MIN_KM, MAX_KM = 1.0, 60.0
MIN_PACE, MAX_PACE = 3.0, 15.0  # min/km
SESSION_FEATURES = ["distance_km", "duration_h", "pace_10k", "gap_days", "day_of_week"]
CLASSES = ["REGRESS", "PLATEAU", "IMPROVE"]  # 0, 1, 2 — same order as features.TRAJECTORY_CLASSES


def pace_10k(distance_km: np.ndarray | float, duration_min: np.ndarray | float) -> np.ndarray | float:
    """Riegel-equivalent 10 km pace in min/km: T10 = T x (10 / D) ^ 1.06, divided by 10."""
    distance = np.asarray(distance_km, dtype=float)
    duration = np.asarray(duration_min, dtype=float)
    out = duration * (10.0 / distance) ** RIEGEL_EXPONENT / 10.0
    return float(out) if np.ndim(out) == 0 else out


def valid_run(distance_km: float, duration_min: float) -> bool:
    if not distance_km or not duration_min or distance_km <= 0 or duration_min <= 0:
        return False
    pace = duration_min / distance_km
    return MIN_KM <= distance_km <= MAX_KM and MIN_PACE <= pace <= MAX_PACE


def session_matrix(runs: Sequence[Mapping]) -> np.ndarray:
    """4 runs (oldest first) with distance_km, duration_min, gap_days, date -> (4, 5) raw features."""
    if len(runs) != SEQ_LEN:
        raise ValueError(f"need exactly {SEQ_LEN} runs, got {len(runs)}")
    rows = []
    for run in runs:
        d, t = float(run["distance_km"]), float(run["duration_min"])
        dow = run.get("day_of_week")
        if dow is None:
            dow = date.fromisoformat(str(run["date"])[:10]).weekday()
        rows.append([d, t / 60.0, pace_10k(d, t), float(run["gap_days"]), float(dow)])
    return np.array(rows, dtype=np.float32)


class RunTransformer(nn.Module):
    """Linear embed + learned positions -> TransformerEncoder (2 x 4 heads) -> mean pool -> 3 classes."""

    def __init__(self, n_features: int = len(SESSION_FEATURES), d_model: int = 32, n_head: int = 4,
                 n_layers: int = 2, ff: int = 128, dropout: float = 0.1, n_classes: int = 3):
        super().__init__()
        self.embed = nn.Linear(n_features, d_model)
        self.positional = nn.Parameter(torch.zeros(1, SEQ_LEN, d_model))
        layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=n_head, dim_feedforward=ff,
                                           dropout=dropout, batch_first=True)
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.head = nn.Linear(d_model, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.encoder(self.embed(x) + self.positional)
        return self.head(h.mean(dim=1))


def predict_probs(model: RunTransformer, meta: Mapping, raw: np.ndarray) -> np.ndarray:
    """Raw (4, 5) or (N, 4, 5) features -> class probabilities in CLASSES order."""
    x = np.asarray(raw, dtype=np.float32)
    if x.ndim == 2:
        x = x[None]
    mean = np.asarray(meta["feature_mean"], dtype=np.float32)
    std = np.asarray(meta["feature_std"], dtype=np.float32)
    x = (x - mean) / np.where(std == 0, 1.0, std)
    model.eval()
    with torch.no_grad():
        return torch.softmax(model(torch.from_numpy(x)), dim=-1).numpy()
