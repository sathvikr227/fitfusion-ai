"""Model 4 — Transformer sequence progression predictor (PyTorch).

Architecture is exactly as specified in the reference guide:

    embed       = nn.Linear(4, 32)
    encoder     = nn.TransformerEncoder(
                      nn.TransformerEncoderLayer(d_model=32, nhead=4, batch_first=True),
                      num_layers=2)
    classifier  = nn.Linear(32, 3)
    forward(x)  = classifier(encoder(embed(x))[:, -1, :])

Loss CrossEntropy, Adam(lr=1e-3), 20 epochs, sequences of shape (N, 4, 4).

Sequence construction, stated plainly because it matters for interpreting the
numbers: the Gym Members dataset is cross-sectional — it has no completion rate
and no calendar. Per the guide, rows are regrouped into PSEUDO-SEQUENCES by
(Experience_Level, Workout_Type). Within a group:

  * session_duration      = Session_Duration (hours), observed
  * completion_rate       = PROXY. Session duration divided by the group's 90th
                            percentile duration, clipped to [0, 1]. This is a
                            derived stand-in, not an observed completion rate.
  * workout_type_encoded  = observed, per the shared encoding
  * day_of_week           = SYNTHETIC. Positions spaced by the user's weekly
                            workout frequency, mod 7.

A learned positional embedding is added so ordering is available to attention.

    .venv/Scripts/python.exe -m training.train_transformer
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

from app.features import (
    COL_DURATION,
    COL_EXPERIENCE,
    COL_FREQUENCY,
    COL_WORKOUT_TYPE,
    SEQUENCE_FEATURES,
    SEQUENCE_LENGTH,
    TRAJECTORY_CLASSES,
    WORKOUT_TYPE_MAP,
)
from app.trajectory_model import D_MODEL, N_HEAD, N_LAYERS, MLPBaseline, WorkoutTransformer
from training.common import (
    MODEL_DIR,
    RANDOM_SEED,
    banner,
    ensure_dirs,
    load_gym_dataset,
    load_pilot_csv,
    write_report,
)

ARTIFACT = "transformer_model.pt"
META_ARTIFACT = "transformer_meta.json"

EPOCHS = 20
LEARNING_RATE = 1e-3
BATCH_SIZE = 64
NOISE_STD = 0.05  # doc: Gaussian augmentation std
# Change in completion rate that separates PLATEAU from IMPROVE / REGRESS.
DELTA_THRESHOLD = 0.05


def label_for(window: list[float], nxt: float) -> int:
    delta = nxt - float(np.mean(window))
    if delta > DELTA_THRESHOLD:
        return TRAJECTORY_CLASSES.index("IMPROVE")
    if delta < -DELTA_THRESHOLD:
        return TRAJECTORY_CLASSES.index("REGRESS")
    return TRAJECTORY_CLASSES.index("PLATEAU")


def build_sequences(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Pseudo-sequences grouped by (Experience_Level, Workout_Type)."""
    sequences: list[np.ndarray] = []
    labels: list[int] = []

    for (_, workout_type), group in df.groupby([COL_EXPERIENCE, COL_WORKOUT_TYPE]):
        group = group.reset_index(drop=True)
        if len(group) < SEQUENCE_LENGTH + 1:
            continue

        durations = group[COL_DURATION].astype(float).to_numpy()
        ceiling = float(np.percentile(durations, 90)) or 1.0
        completion = np.clip(durations / ceiling, 0.0, 1.0)
        type_code = float(WORKOUT_TYPE_MAP[workout_type])
        frequency = group[COL_FREQUENCY].astype(float).to_numpy()

        for start in range(len(group) - SEQUENCE_LENGTH):
            window = []
            for offset in range(SEQUENCE_LENGTH):
                i = start + offset
                spacing = max(1, round(7 / max(frequency[i], 1)))
                window.append(
                    [
                        durations[i],
                        completion[i],
                        type_code,
                        float((i * spacing) % 7),
                    ]
                )
            sequences.append(np.asarray(window, dtype=np.float32))
            labels.append(
                label_for(
                    [row[1] for row in window],
                    float(completion[start + SEQUENCE_LENGTH]),
                )
            )

    return np.asarray(sequences, dtype=np.float32), np.asarray(labels, dtype=np.int64)


def augment(X: np.ndarray, y: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Gaussian noise variants (std=0.05), doubling the training set."""
    noisy = X + rng.normal(0.0, NOISE_STD, size=X.shape).astype(np.float32)
    return np.concatenate([X, noisy]), np.concatenate([y, y])


def train_model(
    model: nn.Module,
    X_train: torch.Tensor,
    y_train: torch.Tensor,
    label: str,
) -> nn.Module:
    optimiser = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    criterion = nn.CrossEntropyLoss()
    n = len(X_train)

    for epoch in range(1, EPOCHS + 1):
        model.train()
        permutation = torch.randperm(n)
        total = 0.0
        for start in range(0, n, BATCH_SIZE):
            idx = permutation[start : start + BATCH_SIZE]
            optimiser.zero_grad()
            loss = criterion(model(X_train[idx]), y_train[idx])
            loss.backward()
            optimiser.step()
            total += float(loss) * len(idx)
        if epoch % 5 == 0 or epoch == 1:
            print(f"    [{label}] epoch {epoch:2d}/{EPOCHS}  loss={total / n:.4f}")
    return model


def evaluate(model: nn.Module, X: torch.Tensor, y: torch.Tensor) -> dict:
    model.eval()
    with torch.no_grad():
        preds = model(X).argmax(dim=1).numpy()
    truth = y.numpy()
    return {
        "accuracy": float(accuracy_score(truth, preds)),
        "macro_f1": float(f1_score(truth, preds, average="macro", zero_division=0)),
        "confusion_matrix": confusion_matrix(
            truth, preds, labels=list(range(len(TRAJECTORY_CLASSES)))
        ).tolist(),
    }


def signal_ceiling(X: np.ndarray, y: np.ndarray) -> dict:
    """How much signal the pseudo-sequences actually carry.

    A gradient-boosted tree on the flattened window is a strong tabular learner.
    If it cannot beat the Transformer, the limit is the data construction rather
    than the architecture — which is the case here, and worth recording.
    """
    from sklearn.ensemble import GradientBoostingClassifier

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )
    gbm = GradientBoostingClassifier(random_state=RANDOM_SEED).fit(
        X_train.reshape(len(X_train), -1), y_train
    )
    preds = gbm.predict(X_test.reshape(len(X_test), -1))
    _, counts = np.unique(y_test, return_counts=True)
    return {
        "gbm_flattened_accuracy": float(accuracy_score(y_test, preds)),
        "majority_class_accuracy": float(counts.max() / len(y_test)),
        "random_chance_accuracy": 1.0 / len(TRAJECTORY_CLASSES),
    }


def pilot_sequence_count() -> dict:
    """Report how many real 4-session windows the live pilot data supports."""
    rates = load_pilot_csv("completion_rates.csv")
    if rates is None or rates.empty:
        return {"available": False, "reason": "pilot export not found or empty"}

    windows = 0
    for _, group in rates.sort_values("date").groupby("user_id"):
        windows += max(0, len(group) - SEQUENCE_LENGTH)
    return {
        "available": True,
        "users": int(rates["user_id"].nunique()),
        "user_days": int(len(rates)),
        "usable_4_session_windows": int(windows),
        "mean_completion_rate": float(rates["completion_rate"].mean()),
    }


def main() -> None:
    banner("Model 4 — Transformer sequence progression predictor")
    ensure_dirs()
    torch.manual_seed(RANDOM_SEED)
    rng = np.random.default_rng(RANDOM_SEED)

    df = load_gym_dataset()
    X, y = build_sequences(df)
    print(f"\n  Sequences: {X.shape} (N, sessions, features)")
    counts = {TRAJECTORY_CLASSES[i]: int((y == i).sum()) for i in range(3)}
    print(f"  Class balance: {counts}")

    X_train_raw, X_test_raw, y_train_raw, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
    )

    # Standardise per feature using train statistics only.
    mean = X_train_raw.reshape(-1, X.shape[2]).mean(axis=0)
    std = X_train_raw.reshape(-1, X.shape[2]).std(axis=0)
    std[std == 0] = 1.0

    X_train_aug, y_train_aug = augment(X_train_raw, y_train_raw, rng)
    X_train = torch.tensor((X_train_aug - mean) / std, dtype=torch.float32)
    X_test = torch.tensor((X_test_raw - mean) / std, dtype=torch.float32)
    y_train = torch.tensor(y_train_aug, dtype=torch.long)
    y_test_t = torch.tensor(y_test, dtype=torch.long)
    print(f"  Train after augmentation: {tuple(X_train.shape)}   Test: {tuple(X_test.shape)}")

    print("\n  Training Transformer:")
    transformer = train_model(WorkoutTransformer(), X_train, y_train, "transformer")
    transformer_metrics = evaluate(transformer, X_test, y_test_t)

    print("\n  Training MLP baseline (ablation):")
    baseline = train_model(MLPBaseline(), X_train, y_train, "mlp")
    baseline_metrics = evaluate(baseline, X_test, y_test_t)

    print(
        f"\n  Transformer  accuracy={transformer_metrics['accuracy']:.4f}  "
        f"macro-F1={transformer_metrics['macro_f1']:.4f}"
    )
    print(
        f"  MLP baseline accuracy={baseline_metrics['accuracy']:.4f}  "
        f"macro-F1={baseline_metrics['macro_f1']:.4f}"
    )
    target_met = transformer_metrics["accuracy"] > 0.65
    print(
        f"  Target accuracy > 65%: {'MET' if target_met else 'NOT MET'} "
        f"({transformer_metrics['accuracy'] * 100:.1f}%)"
    )
    print(f"  Confusion matrix (rows=truth {TRAJECTORY_CLASSES}):")
    for row in transformer_metrics["confusion_matrix"]:
        print(f"    {row}")

    ceiling = signal_ceiling(X, y)
    print(
        f"\n  Signal ceiling on this construction: "
        f"GBM={ceiling['gbm_flattened_accuracy']:.4f}  "
        f"majority={ceiling['majority_class_accuracy']:.4f}  "
        f"chance={ceiling['random_chance_accuracy']:.4f}"
    )

    pilot = pilot_sequence_count()
    print(f"\n  Live pilot sequence availability: {pilot}")

    torch.save(transformer.state_dict(), MODEL_DIR / ARTIFACT)
    meta = {
        "model_version": "trajectory-transformer-v1",
        "feature_names": SEQUENCE_FEATURES,
        "sequence_length": SEQUENCE_LENGTH,
        "classes": TRAJECTORY_CLASSES,
        "d_model": D_MODEL,
        "nhead": N_HEAD,
        "num_layers": N_LAYERS,
        "feature_mean": mean.tolist(),
        "feature_std": std.tolist(),
        "delta_threshold": DELTA_THRESHOLD,
        "metrics": transformer_metrics,
    }
    (MODEL_DIR / META_ARTIFACT).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"\n[artifact] {MODEL_DIR / ARTIFACT}")
    print(f"[artifact] {MODEL_DIR / META_ARTIFACT}")

    write_report(
        "transformer",
        {
            "artifacts": [ARTIFACT, META_ARTIFACT],
            "algorithm": (
                f"nn.TransformerEncoder(d_model={D_MODEL}, nhead={N_HEAD}, "
                f"num_layers={N_LAYERS}) + Linear classifier"
            ),
            "dataset": "valakhorasani/gym-members-exercise-dataset (pseudo-sequences)",
            "sequences": int(len(X)),
            "sequence_shape": list(X.shape[1:]),
            "class_balance": counts,
            "epochs": EPOCHS,
            "augmentation": f"Gaussian noise std={NOISE_STD}, training set doubled",
            "metrics": transformer_metrics,
            "ablation_mlp_baseline": baseline_metrics,
            "signal_ceiling": ceiling,
            "target_accuracy_over_65": target_met,
            "pilot_data": pilot,
            "feature_derivation": {
                "session_duration": "observed (Session_Duration hours)",
                "completion_rate": "PROXY: duration / group 90th percentile, clipped [0,1]",
                "workout_type_encoded": "observed",
                "day_of_week": "SYNTHETIC: position spaced by weekly frequency, mod 7",
            },
        },
    )


if __name__ == "__main__":
    main()
