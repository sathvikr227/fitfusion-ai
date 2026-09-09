"""Model 3 — Multi-label injury risk classifier (XGBoost + MultiOutputClassifier).

Labels are PROXY INJURY-RISK LABELS derived from biomechanical thresholds, not
ground-truth clinical diagnoses. They are engineered from signal combinations
exactly as the reference guide specifies:

    knee      = Resting_BPM > 80  AND Workout_Frequency > 5
    back      = BMI > 27          AND Session_Duration > 1.5
    shoulder  = Experience_Level == beginner AND Workout_Type == Strength
    hamstring = Session_Duration > 1.2 AND Workout_Frequency > 4

One caveat is handled explicitly rather than papered over: on this dataset the
documented knee rule selects ZERO rows (Resting_BPM tops out at 74 and
Workout_Frequency at 5), so it cannot train. When a rule is degenerate the
script falls back to a quantile-calibrated form of the SAME signals and records
which rule was actually used in the artifact and the report.

    .venv/Scripts/python.exe -m training.train_injury
"""

from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.multioutput import MultiOutputClassifier
from xgboost import XGBClassifier

from app.features import (
    COL_BMI,
    COL_DURATION,
    COL_EXPERIENCE,
    COL_FREQUENCY,
    COL_RESTING_BPM,
    COL_WORKOUT_TYPE,
    INJURY_FEATURES,
    INJURY_LABELS,
)
from training.common import (
    MODEL_DIR,
    RANDOM_SEED,
    banner,
    ensure_dirs,
    load_gym_dataset,
    write_report,
)

ARTIFACT = "injury_risk_model.pkl"

# A label needs at least this many positives in both splits to be learnable.
MIN_POSITIVES = 20
BEGINNER_EXPERIENCE_LEVEL = 1


def build_labels(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
    """Engineer the four proxy labels, calibrating any degenerate rule."""
    labels = pd.DataFrame(index=df.index)
    rules: dict[str, str] = {}

    # ── knee ──────────────────────────────────────────────────────────────────
    documented = (df[COL_RESTING_BPM] > 80) & (df[COL_FREQUENCY] > 5)
    if documented.sum() >= MIN_POSITIVES:
        labels["knee"] = documented.astype(int)
        rules["knee"] = "Resting_BPM > 80 AND Workout_Frequency > 5 (as documented)"
    else:
        bpm_cut = float(df[COL_RESTING_BPM].quantile(0.75))
        freq_cut = float(df[COL_FREQUENCY].quantile(0.75))
        calibrated = (df[COL_RESTING_BPM] > bpm_cut) & (df[COL_FREQUENCY] >= freq_cut)
        labels["knee"] = calibrated.astype(int)
        rules["knee"] = (
            f"CALIBRATED: Resting_BPM > {bpm_cut:g} (75th pct) AND "
            f"Workout_Frequency >= {freq_cut:g} (75th pct). The documented rule "
            f"(BPM > 80 AND frequency > 5) matched {int(documented.sum())} rows — "
            f"this dataset's Resting_BPM maxes at {int(df[COL_RESTING_BPM].max())} "
            f"and Workout_Frequency at {int(df[COL_FREQUENCY].max())}, so the "
            f"documented thresholds are unreachable. Same two signals, same "
            f"direction, thresholds moved onto the observed distribution."
        )
        print(f"  [calibration] knee rule recalibrated — {rules['knee']}")

    # ── back ──────────────────────────────────────────────────────────────────
    labels["back"] = ((df[COL_BMI] > 27) & (df[COL_DURATION] > 1.5)).astype(int)
    rules["back"] = "BMI > 27 AND Session_Duration > 1.5 (as documented)"

    # ── shoulder ──────────────────────────────────────────────────────────────
    labels["shoulder"] = (
        (df[COL_EXPERIENCE] == BEGINNER_EXPERIENCE_LEVEL)
        & (df[COL_WORKOUT_TYPE] == "Strength")
    ).astype(int)
    rules["shoulder"] = (
        "Experience_Level == 1 (beginner) AND Workout_Type == Strength (as documented)"
    )

    # ── hamstring ─────────────────────────────────────────────────────────────
    labels["hamstring"] = (
        (df[COL_DURATION] > 1.2) & (df[COL_FREQUENCY] > 4)
    ).astype(int)
    rules["hamstring"] = "Session_Duration > 1.2 AND Workout_Frequency > 4 (as documented)"

    return labels[INJURY_LABELS], rules


def shoulder_ablation(df: pd.DataFrame, y: pd.DataFrame) -> dict:
    """Quantify why shoulder underperforms: its label needs Workout_Type.

    Diagnostic only — the shipped model uses the documented feature list.
    """
    features = INJURY_FEATURES + [COL_WORKOUT_TYPE]
    X = df[features].copy()
    X[COL_WORKOUT_TYPE] = (X[COL_WORKOUT_TYPE] == "Strength").astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y["shoulder"], test_size=0.2, random_state=RANDOM_SEED
    )
    positives = int(y_train.sum())
    clf = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        random_state=RANDOM_SEED,
        n_jobs=4,
        scale_pos_weight=(len(y_train) - positives) / positives if positives else 1.0,
        eval_metric="logloss",
    )
    clf.fit(X_train, y_train)
    return {
        "f1_with_workout_type": float(f1_score(y_test, clf.predict(X_test), zero_division=0)),
        "features": features,
        "note": (
            "Diagnostic ablation, not the shipped model. Shows the shoulder label "
            "is identifiable once Workout_Type is available."
        ),
    }


def main() -> None:
    banner("Model 3 — Multi-label injury risk classifier")
    ensure_dirs()

    df = load_gym_dataset()
    y, rules = build_labels(df)
    X = df[INJURY_FEATURES].astype(float)

    print("\n  Proxy label prevalence:")
    for label in INJURY_LABELS:
        pos = int(y[label].sum())
        print(f"    {label:10s} {pos:4d} positives ({pos / len(y) * 100:5.1f}%)")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y["hamstring"]
    )

    # Class imbalance: the guide asks for scale_pos_weight when positives < 20%.
    # MultiOutputClassifier clones one estimator across labels, so a per-label
    # weight is not expressible there — fit one XGBClassifier per label instead
    # and wrap the fitted estimators, which keeps the documented interface while
    # letting each label carry its own weight.
    estimators = []
    pos_weights: dict[str, float] = {}
    for label in INJURY_LABELS:
        positives = int(y_train[label].sum())
        negatives = int(len(y_train) - positives)
        weight = (negatives / positives) if positives > 0 else 1.0
        pos_weights[label] = float(weight)
        clf = XGBClassifier(
            n_estimators=100,
            max_depth=4,
            random_state=RANDOM_SEED,
            n_jobs=4,
            scale_pos_weight=weight,
            eval_metric="logloss",
        )
        clf.fit(X_train, y_train[label])
        estimators.append(clf)

    model = MultiOutputClassifier(
        XGBClassifier(n_estimators=100, max_depth=4, random_state=RANDOM_SEED)
    )
    # Attach the per-label fitted estimators so predict()/predict_proba() work
    # through the standard MultiOutputClassifier API.
    model.estimators_ = estimators
    model.classes_ = [est.classes_ for est in estimators]
    model.n_outputs_ = len(INJURY_LABELS)

    preds = np.column_stack([est.predict(X_test) for est in estimators])

    per_label: dict[str, dict] = {}
    print()
    for i, label in enumerate(INJURY_LABELS):
        truth = y_test[label].to_numpy()
        pred = preds[:, i]
        report = classification_report(
            truth, pred, output_dict=True, zero_division=0, labels=[0, 1]
        )
        cm = confusion_matrix(truth, pred, labels=[0, 1])
        positive = report.get("1", {})
        per_label[label] = {
            "f1": float(positive.get("f1-score", 0.0)),
            "precision": float(positive.get("precision", 0.0)),
            "recall": float(positive.get("recall", 0.0)),
            "support": int(positive.get("support", 0)),
            "confusion_matrix": cm.tolist(),
            "scale_pos_weight": pos_weights[label],
            "label_rule": rules[label],
        }
        print(
            f"  {label:10s} F1={per_label[label]['f1']:.3f}  "
            f"P={per_label[label]['precision']:.3f}  "
            f"R={per_label[label]['recall']:.3f}  "
            f"support={per_label[label]['support']:3d}  "
            f"CM={cm.tolist()}"
        )

    macro_f1 = float(np.mean([per_label[l]["f1"] for l in INJURY_LABELS]))
    print(f"\n  Macro F1 across labels: {macro_f1:.3f}  (per-label target > 0.75)")
    below = [l for l in INJURY_LABELS if per_label[l]["f1"] < 0.75]
    if below:
        print(f"  Labels below the 0.75 F1 target: {', '.join(below)}")

    ablation = shoulder_ablation(df, y)
    print(
        f"\n  [diagnostic] shoulder F1 with the documented feature set: "
        f"{per_label['shoulder']['f1']:.3f}"
    )
    print(
        f"  [diagnostic] shoulder F1 with Workout_Type added: "
        f"{ablation['f1_with_workout_type']:.3f}"
    )
    print(
        "  The shoulder rule keys on Workout_Type == Strength, but Workout_Type is "
        "not in the documented feature list, so the label is not identifiable from "
        "the given inputs. The shipped model keeps the documented features."
    )

    bundle = {
        "model": model,
        "estimators": estimators,
        "feature_names": INJURY_FEATURES,
        "labels": INJURY_LABELS,
        "label_rules": rules,
        "imputation_defaults": {
            col: float(df[col].median()) for col in INJURY_FEATURES
        },
        "metrics": {"per_label": per_label, "macro_f1": macro_f1},
        "model_version": "injury-xgb-multilabel-v1",
        "disclaimer": (
            "Proxy injury-risk scores derived from established biomechanical "
            "thresholds. Not a clinical diagnosis."
        ),
    }
    path = MODEL_DIR / ARTIFACT
    joblib.dump(bundle, path)
    print(f"\n[artifact] {path}")

    write_report(
        "injury_risk",
        {
            "artifact": ARTIFACT,
            "algorithm": "MultiOutputClassifier(XGBClassifier(n_estimators=100, max_depth=4))",
            "dataset": "valakhorasani/gym-members-exercise-dataset",
            "rows": int(len(df)),
            "features": INJURY_FEATURES,
            "labels": INJURY_LABELS,
            "label_rules": rules,
            "label_prevalence": {l: int(y[l].sum()) for l in INJURY_LABELS},
            "metrics": {"per_label": per_label, "macro_f1": macro_f1},
            "labels_below_f1_target": below,
            "shoulder_ablation": ablation,
            "disclaimer": bundle["disclaimer"],
        },
    )


if __name__ == "__main__":
    main()
