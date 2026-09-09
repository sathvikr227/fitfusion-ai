"""Transformer architecture for Model 4, shared by training and serving.

Kept under `app/` so the deployed image (which ships only `app/` and `models/`)
can rebuild the module and load its state dict without the training package.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .features import SEQUENCE_LENGTH

D_MODEL = 32
N_HEAD = 4
N_LAYERS = 2


class WorkoutTransformer(nn.Module):
    """embed → TransformerEncoder → classifier on the final position."""

    def __init__(self, n_features: int = 4, d_model: int = D_MODEL, n_classes: int = 3):
        super().__init__()
        self.embed = nn.Linear(n_features, d_model)
        self.positional = nn.Parameter(torch.zeros(1, SEQUENCE_LENGTH, d_model))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=N_HEAD, batch_first=True, dim_feedforward=d_model * 4
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=N_LAYERS)
        self.classifier = nn.Linear(d_model, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.embed(x) + self.positional[:, : x.size(1), :]
        return self.classifier(self.transformer(h)[:, -1, :])


class MLPBaseline(nn.Module):
    """Ablation baseline: same features, sequence structure flattened away."""

    def __init__(self, n_features: int = 4, n_classes: int = 3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features * SEQUENCE_LENGTH, 64),
            nn.ReLU(),
            nn.Linear(64, n_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x.flatten(1))
