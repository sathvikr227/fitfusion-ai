"""Energy-expenditure equations shared by Model 1 training and serving.

Kept in `app/` so a pickled model that references `hr_design_matrix` loads in
the FastAPI process without importing anything from `training/`.
"""

from __future__ import annotations

import numpy as np

KJ_PER_KCAL = 4.184

# Input order for the heart-rate calorie model. Training and serving both build
# rows in exactly this order.
CALORIE_HR_FEATURES: list[str] = ["age", "is_female", "height_cm", "weight_kg", "hr"]

# XGBoost monotone constraints in CALORIE_HR_FEATURES order: energy may only
# rise with body weight and with heart rate; age, sex and height are free.
CALORIE_HR_MONOTONE = (0, 0, 0, 1, 1)


def keytel_kcal_per_min(hr, weight_kg, age, is_female) -> np.ndarray:
    """Keytel et al. (2005), J Sports Sci 23(3):289-297, equation without VO2max.

    Men:   EE (kJ/min) = -55.0969 + 0.6309·HR + 0.1988·weight + 0.2017·age
    Women: EE (kJ/min) = -20.4022 + 0.4472·HR - 0.1263·weight + 0.0740·age
    """
    hr = np.asarray(hr, dtype=float)
    weight_kg = np.asarray(weight_kg, dtype=float)
    age = np.asarray(age, dtype=float)
    female = np.asarray(is_female, dtype=float) >= 0.5

    male_kj = -55.0969 + 0.6309 * hr + 0.1988 * weight_kg + 0.2017 * age
    female_kj = -20.4022 + 0.4472 * hr - 0.1263 * weight_kg + 0.0740 * age
    return np.where(female, female_kj, male_kj) / KJ_PER_KCAL


def hr_design_matrix(X) -> np.ndarray:
    """Ridge inputs: the raw features plus the interactions physiology predicts.

    Energy per heartbeat scales with body size (HR × weight) and differs by sex
    (HR × sex), so a linear model needs those terms to be competitive.
    """
    X = np.asarray(X, dtype=float)
    age, is_female, height, weight, hr = (X[:, i] for i in range(5))
    return np.column_stack([age, is_female, height, weight, hr, hr * weight, hr * is_female])
