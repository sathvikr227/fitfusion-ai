"""Shared feature contract for training and serving.

Both `training/*.py` and the FastAPI routers import from here, so a feature
order or encoding can never drift between the artifact and the request path.

Column names match the Kaggle Gym Members Exercise Dataset
(valakhorasani/gym-members-exercise-dataset) exactly — do not rename.
"""

from __future__ import annotations

import re

# ── Dataset column names (verbatim from the Kaggle CSV) ───────────────────────
COL_AGE = "Age"
COL_WEIGHT = "Weight (kg)"
COL_HEIGHT = "Height (m)"
COL_BMI = "BMI"
COL_RESTING_BPM = "Resting_BPM"
COL_DURATION = "Session_Duration (hours)"
COL_CALORIES = "Calories_Burned"
COL_WORKOUT_TYPE = "Workout_Type"
COL_FREQUENCY = "Workout_Frequency (days/week)"
COL_EXPERIENCE = "Experience_Level"

# ── Workout type encoding (doc: Cardio=0, Strength=1, Yoga=2, HIIT=3) ─────────
WORKOUT_TYPE_MAP: dict[str, int] = {"Cardio": 0, "Strength": 1, "Yoga": 2, "HIIT": 3}
WORKOUT_TYPE_NAMES: list[str] = ["Cardio", "Strength", "Yoga", "HIIT"]

# Keyword routing from FitFusion's free-text exercise / day-type strings onto the
# four dataset classes. Longest-match wins, so "strength training" beats "training".
_TYPE_KEYWORDS: list[tuple[str, str]] = [
    # HIIT
    ("hiit", "HIIT"),
    ("interval", "HIIT"),
    ("circuit", "HIIT"),
    ("burpee", "HIIT"),
    ("mountain climber", "HIIT"),
    ("jump rope", "HIIT"),
    ("tabata", "HIIT"),
    ("conditioning", "HIIT"),
    # Yoga / mobility
    ("yoga", "Yoga"),
    ("stretch", "Yoga"),
    ("mobility", "Yoga"),
    ("pilates", "Yoga"),
    ("flexibility", "Yoga"),
    ("plank", "Yoga"),
    # Cardio
    ("cardio", "Cardio"),
    ("run", "Cardio"),
    ("jog", "Cardio"),
    ("treadmill", "Cardio"),
    ("cycl", "Cardio"),
    ("bike", "Cardio"),
    ("row", "Cardio"),
    ("swim", "Cardio"),
    ("walk", "Cardio"),
    ("elliptical", "Cardio"),
    ("stair", "Cardio"),
    # Strength
    ("strength", "Strength"),
    ("push", "Strength"),
    ("pull", "Strength"),
    ("leg", "Strength"),
    ("upper body", "Strength"),
    ("lower body", "Strength"),
    ("full body", "Strength"),
    ("chest", "Strength"),
    ("back", "Strength"),
    ("shoulder", "Strength"),
    ("arm", "Strength"),
    ("core", "Strength"),
    ("abs", "Strength"),
    ("press", "Strength"),
    ("squat", "Strength"),
    ("deadlift", "Strength"),
    ("curl", "Strength"),
    ("bench", "Strength"),
    ("weight", "Strength"),
    ("dumbbell", "Strength"),
    ("barbell", "Strength"),
    ("lunge", "Strength"),
    ("raise", "Strength"),
    ("fly", "Strength"),
    ("dip", "Strength"),
    ("crunch", "Strength"),
]


def normalize_workout_type(raw: str | None) -> str:
    """Map any FitFusion workout label onto one of the four dataset classes.

    Unrecognised input resolves to "Strength" — the modal class in the dataset
    and the safest assumption for a logged gym session.
    """
    if not raw:
        return "Strength"

    text = str(raw).strip().lower()
    if not text:
        return "Strength"

    for name in WORKOUT_TYPE_NAMES:
        if text == name.lower():
            return name

    matches = [(kw, cls) for kw, cls in _TYPE_KEYWORDS if kw in text]
    if matches:
        return max(matches, key=lambda pair: len(pair[0]))[1]

    return "Strength"


def encode_workout_type(raw: str | None) -> int:
    return WORKOUT_TYPE_MAP[normalize_workout_type(raw)]


# ── Model 1: calorie predictor ────────────────────────────────────────────────
# Doc: Age, Weight (kg), BMI, Resting BPM, Session Duration (hours), Workout Type.
CALORIE_FEATURES: list[str] = [
    COL_AGE,
    COL_WEIGHT,
    COL_BMI,
    COL_RESTING_BPM,
    COL_DURATION,
    COL_WORKOUT_TYPE,
]

# Human-readable labels for SHAP output shown in the UI.
CALORIE_FEATURE_LABELS: dict[str, str] = {
    COL_AGE: "Age",
    COL_WEIGHT: "Body weight",
    COL_BMI: "BMI",
    COL_RESTING_BPM: "Resting heart rate",
    COL_DURATION: "Session duration",
    COL_WORKOUT_TYPE: "Workout type",
}

# ── Model 2: hybrid recommender ───────────────────────────────────────────────
# Doc: user feature vector = [Age, BMI, Workout_Frequency, Experience_Level].
RECOMMENDER_FEATURES: list[str] = [COL_AGE, COL_BMI, COL_FREQUENCY, COL_EXPERIENCE]

# Food dataset columns (shrutisaxena/food-nutrition-dataset).
FOOD_COL_CATEGORY = "Category"
FOOD_COL_DESCRIPTION = "Description"
FOOD_COL_KCAL = "Data.Kilocalories"
FOOD_COL_PROTEIN = "Data.Protein"
FOOD_COL_CARBS = "Data.Carbohydrate"
FOOD_COL_FAT = "Data.Fat.Total Lipid"

# ── Model 3: injury risk ──────────────────────────────────────────────────────
# Doc: [Age, BMI, Resting_BPM, Session_Duration, Workout_Frequency, Experience_Level].
INJURY_FEATURES: list[str] = [
    COL_AGE,
    COL_BMI,
    COL_RESTING_BPM,
    COL_DURATION,
    COL_FREQUENCY,
    COL_EXPERIENCE,
]
INJURY_LABELS: list[str] = ["knee", "back", "shoulder", "hamstring"]

# Muscle groups each risk label maps onto, used to strip exercises from a plan.
INJURY_MUSCLE_KEYWORDS: dict[str, list[str]] = {
    "knee": [
        "squat", "lunge", "leg press", "leg extension", "step up", "jump",
        "box jump", "burpee", "running", "run", "jog", "sprint", "plyo",
        "wall sit", "pistol", "skater",
    ],
    "back": [
        "deadlift", "good morning", "barbell row", "bent over row", "back extension",
        "hyperextension", "clean", "snatch", "sit up", "sit-up", "russian twist",
        "toe touch", "superman",
    ],
    "shoulder": [
        "overhead press", "shoulder press", "military press", "lateral raise",
        "front raise", "upright row", "pull up", "pull-up", "chin up", "dip",
        "bench press", "push up", "push-up", "arnold press", "handstand",
    ],
    "hamstring": [
        "deadlift", "romanian deadlift", "rdl", "leg curl", "hamstring curl",
        "good morning", "sprint", "kettlebell swing", "nordic", "hip thrust",
        "glute ham",
    ],
}

# Doc: "If any score exceeds 0.7 … insert a rest day and remove exercises".
INJURY_RISK_THRESHOLD = 0.7


def exercise_targets_muscle_group(exercise_name: str, group: str) -> bool:
    """True when an exercise loads the muscle group flagged as at-risk."""
    text = re.sub(r"[^a-z0-9 ]+", " ", str(exercise_name or "").lower())
    return any(kw in text for kw in INJURY_MUSCLE_KEYWORDS.get(group, []))


# ── Model 4: transformer trajectory ───────────────────────────────────────────
# Doc: each session vector = [session_duration, completion_rate, workout_type_encoded, day_of_week].
SEQUENCE_LENGTH = 4
SEQUENCE_FEATURES: list[str] = [
    "session_duration",
    "completion_rate",
    "workout_type_encoded",
    "day_of_week",
]
TRAJECTORY_CLASSES: list[str] = ["REGRESS", "PLATEAU", "IMPROVE"]  # 0, 1, 2

# ── Model 5: RL agent ─────────────────────────────────────────────────────────
# Doc: [completion_rate, sleep_avg/10, injury_flag, trajectory_score/2, min(streak,14)/14].
RL_STATE_FEATURES: list[str] = [
    "completion_rate",
    "sleep_avg_norm",
    "injury_flag",
    "trajectory_norm",
    "streak_norm",
]
RL_ACTIONS: list[str] = ["REDUCE", "MAINTAIN", "INCREASE"]
# Doc: 0 → reduce intensity by 15%; 1 → unchanged; 2 → increase by 15%.
RL_ACTION_INTENSITY_DELTA: dict[str, float] = {
    "REDUCE": -0.15,
    "MAINTAIN": 0.0,
    "INCREASE": 0.15,
}

# ── Imputation defaults ───────────────────────────────────────────────────────
# FitFusion has no resting-BPM capture today (vitals_logs is empty), so the
# calorie and injury models impute it. The value is the dataset median, written
# into the artifact at training time; this constant is only the last resort when
# no artifact is loaded. Every response reports which fields were imputed.
FALLBACK_RESTING_BPM = 62.0
FALLBACK_AGE = 30.0
FALLBACK_BMI = 24.0
