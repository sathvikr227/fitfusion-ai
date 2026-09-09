"""Model 1 — XGBoost + SHAP calorie burn predictor.

Follows the reference guide: encode Workout_Type, StandardScaler the numeric
features, 80/20 split, XGBRegressor(n_estimators=200, max_depth=6,
learning_rate=0.1), then a SHAP explainer over the test set.

The MET baseline is reported alongside so the improvement is measurable rather
than asserted.

    .venv/Scripts/python.exe -m training.train_calorie
"""

from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from app.features import (
    CALORIE_FEATURES,
    COL_CALORIES,
    COL_DURATION,
    COL_RESTING_BPM,
    COL_WEIGHT,
    COL_WORKOUT_TYPE,
    WORKOUT_TYPE_MAP,
)
from training.common import (
    MODEL_DIR,
    RANDOM_SEED,
    banner,
    ensure_dirs,
    load_gym_dataset,
    write_report,
)

ARTIFACT = "calorie_model.pkl"

# MET values for the four dataset workout classes, used only for the baseline
# comparison the guide asks for. The app's own richer per-exercise MET table
# stays in web/src/lib/calories.ts and is untouched.
BASELINE_MET = {"Cardio": 7.5, "Strength": 5.0, "Yoga": 2.5, "HIIT": 8.0}


def met_baseline_predictions(df: pd.DataFrame) -> np.ndarray:
    """Calories = MET × weight(kg) × duration(hours) — the rule being replaced."""
    met = df[COL_WORKOUT_TYPE].map(BASELINE_MET).astype(float)
    return (met * df[COL_WEIGHT] * df[COL_DURATION]).to_numpy()


def main() -> None:
    banner("Model 1 — XGBoost + SHAP calorie predictor")
    ensure_dirs()

    df = load_gym_dataset()

    # 1. Encode Workout_Type (Cardio=0, Strength=1, Yoga=2, HIIT=3).
    encoded = df.copy()
    encoded[COL_WORKOUT_TYPE] = encoded[COL_WORKOUT_TYPE].map(WORKOUT_TYPE_MAP)
    if encoded[COL_WORKOUT_TYPE].isna().any():
        unknown = sorted(set(df[COL_WORKOUT_TYPE]) - set(WORKOUT_TYPE_MAP))
        raise ValueError(f"Unmapped Workout_Type values in dataset: {unknown}")

    X_raw = encoded[CALORIE_FEATURES].astype(float)
    y = encoded[COL_CALORIES].astype(float)

    # 3. Split before scaling so the scaler never sees the test rows.
    X_train_raw, X_test_raw, y_train, y_test, idx_train, idx_test = train_test_split(
        X_raw, y, df.index, test_size=0.2, random_state=RANDOM_SEED
    )

    # 2. StandardScaler on the numeric feature matrix. Fit on the raw array so
    # the scaler records no column names — serving passes a plain numpy row, and
    # a name-carrying scaler warns on every request.
    scaler = StandardScaler().fit(X_train_raw.to_numpy())
    X_train = scaler.transform(X_train_raw.to_numpy())
    X_test = scaler.transform(X_test_raw.to_numpy())

    # 4-5. Fit and evaluate.
    model = XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        random_state=RANDOM_SEED,
        n_jobs=4,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = float(mean_absolute_error(y_test, preds))
    rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
    r2 = float(r2_score(y_test, preds))

    baseline = met_baseline_predictions(df.loc[idx_test])
    baseline_mae = float(mean_absolute_error(y_test, baseline))
    baseline_rmse = float(np.sqrt(mean_squared_error(y_test, baseline)))

    print(f"\n  XGBoost   MAE={mae:8.2f} kcal   RMSE={rmse:8.2f}   R²={r2:.4f}")
    print(f"  MET table MAE={baseline_mae:8.2f} kcal   RMSE={baseline_rmse:8.2f}")
    print(f"  Improvement: {baseline_mae - mae:.2f} kcal MAE "
          f"({(1 - mae / baseline_mae) * 100:.1f}% lower)")
    target_met = mae < 25
    print(f"  Target MAE < 25 kcal: {'MET' if target_met else 'NOT MET'} ({mae:.2f})")

    # 6. SHAP over the test set. TreeExplainer is exact for gradient-boosted trees.
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_test)
    mean_abs = np.abs(shap_values).mean(axis=0)
    ranked = sorted(
        zip(CALORIE_FEATURES, mean_abs.tolist()), key=lambda kv: kv[1], reverse=True
    )
    print("\n  Mean |SHAP| per feature (test set):")
    for name, val in ranked:
        print(f"    {name:32s} {val:8.2f}")

    # 7. Persist one bundle so serving loads a single file.
    bundle = {
        "model": model,
        "scaler": scaler,
        "feature_names": CALORIE_FEATURES,
        "workout_type_map": WORKOUT_TYPE_MAP,
        "expected_value": float(explainer.expected_value),
        "imputation_defaults": {
            COL_RESTING_BPM: float(df[COL_RESTING_BPM].median()),
            "Age": float(df["Age"].median()),
            "BMI": float(df["BMI"].median()),
        },
        "metrics": {
            "mae": mae,
            "rmse": rmse,
            "r2": r2,
            "baseline_met_mae": baseline_mae,
            "baseline_met_rmse": baseline_rmse,
        },
        "model_version": "calorie-xgb-v1",
    }
    path = MODEL_DIR / ARTIFACT
    joblib.dump(bundle, path)
    print(f"\n[artifact] {path}")

    write_report(
        "calorie_predictor",
        {
            "artifact": ARTIFACT,
            "algorithm": "XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.1)",
            "dataset": "valakhorasani/gym-members-exercise-dataset",
            "rows": int(len(df)),
            "features": CALORIE_FEATURES,
            "target": COL_CALORIES,
            "test_size": 0.2,
            "metrics": bundle["metrics"],
            "target_mae_under_25": target_met,
            "mean_abs_shap": dict(ranked),
        },
    )


if __name__ == "__main__":
    main()
