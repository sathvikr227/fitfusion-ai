"""Model 1 — comparison model: XGBoost + SHAP on the Kaggle Gym Members dataset.

This is the design in the Phase II slides, trained and evaluated as specified so
the result can be shown. It is NOT the served Model 1 (that is the Malaga
calorimetry model, training/train_calorie_hr.py), because the dataset's
`Calories_Burned` labels fail a physiological sanity check:

  * kcal per hour is ~720 for Yoga, HIIT, Cardio and Strength alike; measured
    energy cost differs ~3x between yoga and HIIT (MET 2.5 vs 8.0)
  * Avg_BPM is ~144 for every workout type, yoga included
  * a linear model of the Keytel (2005) form — (HR, weight, age, sex) x
    duration — explains ~99% of the label variance, consistent with labels
    computed from a formula rather than measured with calorimetry

Protocol (fixed before looking at test results):
  1. Data checks: missing values, duplicates, ranges, BMI vs weight/height.
  2. One held-out 20% test split (random_state 42); 5-fold CV on the 80% only.
  3. Models: XGBoost on the slide features (Age, Weight, BMI, Resting_BPM,
     Session_Duration, Workout_Type), XGBoost on the slide features plus
     Avg_BPM and Gender, and baselines (training mean, FitFusion MET table,
     linear regression on duration only).
  4. MAE, RMSE, R^2 on the test split; target MAE < 25 kcal.
  5. SHAP (TreeExplainer) on the test split.

    .venv/Scripts/python.exe -m training.train_calorie_gym_comparison
"""

from __future__ import annotations

import joblib
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, cross_val_score, train_test_split
from xgboost import XGBRegressor

from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report

DATA_FILE = "gym_members_exercise_tracking.csv"
ARTIFACT = "calorie_gym_comparison.pkl"
FIG_LABELS = "calorie_gym_label_check.png"
FIG_SHAP = "calorie_gym_shap.png"
TARGET = "Calories_Burned"
TARGET_MAE = 25.0

# Slide feature set, in this order. Workout_Type is one-hot encoded.
SLIDE_NUMERIC = ["Age", "Weight (kg)", "BMI", "Resting_BPM", "Session_Duration (hours)"]
WORKOUT_TYPES = ["Cardio", "HIIT", "Strength", "Yoga"]
EXTRA = ["Avg_BPM", "is_female"]

# FitFusion's MET table for the four dataset classes (app/routers/calorie.py).
MET = {"Cardio": 7.5, "Strength": 5.0, "Yoga": 2.5, "HIIT": 8.0}


def load() -> pd.DataFrame:
    from training.common import DATA_DIR

    df = pd.read_csv(DATA_DIR / DATA_FILE)
    df["is_female"] = (df["Gender"] == "Female").astype(float)
    for t in WORKOUT_TYPES:
        df[f"type_{t}"] = (df["Workout_Type"] == t).astype(float)
    return df


def data_checks(df: pd.DataFrame) -> dict:
    bmi = df["Weight (kg)"] / df["Height (m)"] ** 2
    numeric = df.select_dtypes("number")
    q1, q3 = numeric.quantile(0.25), numeric.quantile(0.75)
    iqr_outliers = ((numeric < q1 - 3 * (q3 - q1)) | (numeric > q3 + 3 * (q3 - q1))).sum()
    return {
        "rows": int(len(df)),
        "columns": int(df.shape[1] - 1 - len(WORKOUT_TYPES)),  # exclude derived columns
        "missing_values": int(df.isna().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
        "bmi_matches_weight_height_max_abs_diff": round(float((bmi - df["BMI"]).abs().max()), 4),
        "ranges": {
            c: [float(df[c].min()), float(df[c].max())]
            for c in ["Age", "Weight (kg)", "Height (m)", "Resting_BPM", "Avg_BPM",
                      "Session_Duration (hours)", TARGET]
        },
        "extreme_outliers_3iqr": {k: int(v) for k, v in iqr_outliers.items() if v > 0},
        "workout_type_counts": df["Workout_Type"].value_counts().to_dict(),
    }


def label_checks(df: pd.DataFrame) -> dict:
    per_hour = df[TARGET] / df["Session_Duration (hours)"]
    by_type = df.assign(kcal_per_hour=per_hour).groupby("Workout_Type").agg(
        kcal_per_hour=("kcal_per_hour", "mean"), avg_bpm=("Avg_BPM", "mean"),
        weight=("Weight (kg)", "mean"),
    )
    by_type["met_expected_kcal_per_hour"] = [MET[t] * w for t, w in zip(by_type.index, by_type["weight"])]

    mins = df["Session_Duration (hours)"] * 60
    keytel_form = np.column_stack([
        df["Avg_BPM"] * mins, df["Weight (kg)"] * mins, df["Age"] * mins, mins, df["is_female"] * mins,
    ])
    r2_keytel_form = LinearRegression().fit(keytel_form, df[TARGET]).score(keytel_form, df[TARGET])
    dur = df[["Session_Duration (hours)"]].to_numpy()
    r2_duration = LinearRegression().fit(dur, df[TARGET]).score(dur, df[TARGET])
    return {
        "by_workout_type": by_type.round(1).to_dict(orient="index"),
        "yoga_to_hiit_kcal_ratio": round(float(by_type.loc["Yoga", "kcal_per_hour"] / by_type.loc["HIIT", "kcal_per_hour"]), 3),
        "expected_yoga_to_hiit_ratio_from_met": round(MET["Yoga"] / MET["HIIT"], 3),
        "r2_keytel_form_linear_model_all_rows": round(float(r2_keytel_form), 4),
        "r2_duration_only_all_rows": round(float(r2_duration), 4),
        "corr_label_resting_bpm": round(float(df[TARGET].corr(df["Resting_BPM"])), 4),
    }


def scores(y, pred) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y, pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y, pred))), 2),
        "r2": round(float(r2_score(y, pred)), 4),
    }


def make_xgb() -> XGBRegressor:
    return XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.1,
                        random_state=RANDOM_SEED, n_jobs=4)


def main() -> None:
    banner("Model 1 comparison — XGBoost + SHAP on Gym Members (slide design)")
    ensure_dirs()
    df = load()

    checks = data_checks(df)
    labels = label_checks(df)
    print(f"[1] {checks['rows']} rows, {checks['missing_values']} missing, "
          f"{checks['duplicate_rows']} duplicates, BMI consistent (max diff "
          f"{checks['bmi_matches_weight_height_max_abs_diff']})")
    print("    kcal/hour by workout type (label) vs MET-expected:")
    for t, row in labels["by_workout_type"].items():
        print(f"      {t:9s} label {row['kcal_per_hour']:6.1f}  MET-expected {row['met_expected_kcal_per_hour']:6.1f}"
              f"  Avg_BPM {row['avg_bpm']:.1f}")
    print(f"    Keytel-form linear model explains R^2 = {labels['r2_keytel_form_linear_model_all_rows']} of the labels")

    slide_cols = SLIDE_NUMERIC + [f"type_{t}" for t in WORKOUT_TYPES]
    extended_cols = slide_cols + EXTRA
    train, test = train_test_split(df, test_size=0.2, random_state=RANDOM_SEED)
    y_train, y_test = train[TARGET].to_numpy(float), test[TARGET].to_numpy(float)
    print(f"[2] split: {len(train)} train / {len(test)} test (held out, random_state={RANDOM_SEED})")

    results, cv, fitted = {}, {}, {}
    kfold = KFold(5, shuffle=True, random_state=RANDOM_SEED)
    for name, cols in (("xgb_slide_features", slide_cols), ("xgb_plus_avg_bpm_and_sex", extended_cols)):
        model = make_xgb()
        cv_mae = -cross_val_score(make_xgb(), train[cols], y_train, cv=kfold,
                                  scoring="neg_mean_absolute_error")
        model.fit(train[cols], y_train)
        results[name] = scores(y_test, model.predict(test[cols]))
        cv[name] = {"mae_mean": round(float(cv_mae.mean()), 2), "mae_std": round(float(cv_mae.std()), 2)}
        fitted[name] = (model, cols)

    results["baseline_training_mean"] = scores(y_test, np.full(len(test), y_train.mean()))
    met_pred = test["Workout_Type"].map(MET) * test["Weight (kg)"] * test["Session_Duration (hours)"]
    results["baseline_met_table"] = scores(y_test, met_pred)
    dur = LinearRegression().fit(train[["Session_Duration (hours)"]], y_train)
    results["baseline_duration_only_linear"] = scores(y_test, dur.predict(test[["Session_Duration (hours)"]]))

    print("[3] held-out test set (n=%d)" % len(test))
    for name, r in results.items():
        cv_note = f"   (train 5-fold CV MAE {cv[name]['mae_mean']} ± {cv[name]['mae_std']})" if name in cv else ""
        print(f"      {name:32s} MAE {r['mae']:7.2f}  RMSE {r['rmse']:7.2f}  R^2 {r['r2']:.4f}{cv_note}")
    target_met = results["xgb_slide_features"]["mae"] < TARGET_MAE
    print(f"    target MAE < {TARGET_MAE:g} kcal with the slide features: {'MET' if target_met else 'NOT MET'}")

    # SHAP on the test split for both XGBoost variants.
    shap_summary = {}
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8))
    for ax, (name, (model, cols)) in zip(axes, fitted.items()):
        values = shap.TreeExplainer(model).shap_values(test[cols])
        mean_abs = pd.Series(np.abs(values).mean(axis=0), index=cols).sort_values()
        shap_summary[name] = {k: round(float(v), 2) for k, v in mean_abs.sort_values(ascending=False).items()}
        ax.barh(mean_abs.index, mean_abs.values, color="#7c3aed")
        ax.set_title(f"{name}\nmean |SHAP| on test set (kcal)")
    fig.tight_layout()
    fig.savefig(REPORT_DIR / FIG_SHAP, dpi=130)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.5))
    by = pd.DataFrame(labels["by_workout_type"]).T.loc[WORKOUT_TYPES]
    x = np.arange(len(by))
    ax.bar(x - 0.2, by["kcal_per_hour"], 0.4, label="dataset label", color="#7c3aed")
    ax.bar(x + 0.2, by["met_expected_kcal_per_hour"], 0.4, label="MET x weight (expected)", color="#0891b2")
    ax.set_xticks(x, by.index)
    ax.set_ylabel("kcal per hour")
    ax.set_ylim(0, 950)
    ax.set_title("Gym Members labels ignore workout type")
    ax.legend()
    fig.tight_layout()
    fig.savefig(REPORT_DIR / FIG_LABELS, dpi=130)
    plt.close(fig)

    model, cols = fitted["xgb_slide_features"]
    joblib.dump({"model": model, "feature_names": cols, "workout_types": WORKOUT_TYPES,
                 "served": False, "model_version": "calorie-gym-comparison-v1"}, MODEL_DIR / ARTIFACT)
    print(f"[artifact] {MODEL_DIR / ARTIFACT} (comparison only, not served)")

    write_report("calorie_gym_comparison", {
        "artifact": ARTIFACT,
        "served": False,
        "dataset": "Gym Members Exercise Dataset (Kaggle: valakhorasani/gym-members-exercise-dataset)",
        "file": DATA_FILE,
        "algorithm": "XGBRegressor(n_estimators=200, max_depth=6, learning_rate=0.1)",
        "split": {"test_size": 0.2, "random_state": RANDOM_SEED, "train": len(train), "test": len(test)},
        "features": {"xgb_slide_features": slide_cols, "xgb_plus_avg_bpm_and_sex": extended_cols},
        "data_checks": checks,
        "label_checks": labels,
        "test_results": results,
        "train_cv_mae": cv,
        "target_mae_kcal": TARGET_MAE,
        "target_met_with_slide_features": target_met,
        "mean_abs_shap_test": shap_summary,
        "figures": [FIG_LABELS, FIG_SHAP],
        "conclusion": (
            "Labels are consistent with a Keytel-style formula on Avg_BPM, sex, weight, age and "
            "duration rather than calorimetry. The slide features omit Avg_BPM and sex, so they "
            "cannot reach the 25 kcal target; adding them mostly re-learns the formula. Not served."
        ),
    })


if __name__ == "__main__":
    main()
