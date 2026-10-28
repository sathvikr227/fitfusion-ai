"""Request/response contracts for the five model endpoints.

Where the reference guide and the FitFusion app speak different units, the
request models accept both and normalise once (the guide thinks in session
hours and dataset workout classes; the app thinks in minutes and free-text
exercise names). Keeping that translation here means routers only ever see
canonical values.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .features import INJURY_LABELS, normalize_workout_type


class MLModel(BaseModel):
    """Base for every schema here.

    Responses carry `model_version` / `model_errors`, which collide with
    pydantic's protected `model_` namespace. The field names are part of the
    published API, so opt out of the namespace instead of renaming them.
    """

    model_config = ConfigDict(protected_namespaces=())

Intensity = Literal["low", "moderate", "high"]
ActionName = Literal["REDUCE", "MAINTAIN", "INCREASE"]
TrajectoryLabel = Literal["REGRESS", "PLATEAU", "IMPROVE"]


# ── 1. Calorie predictor ──────────────────────────────────────────────────────
class CalorieRequest(MLModel):
    """One logged session. Heart rate, age and sex unlock the validated
    heart-rate method; without them the MET estimate is returned."""

    weight_kg: float = Field(..., gt=0, description="Body weight in kilograms")
    age: float | None = Field(default=None, ge=10, le=100)
    sex: Literal["male", "female"] | None = None
    avg_hr: float | None = Field(default=None, ge=30, le=230, description="Average session heart rate, bpm")
    height_cm: float | None = Field(
        default=None, ge=100, le=250, description="Height in cm; needed by the XGBoost model"
    )

    duration_hours: float | None = Field(default=None, ge=0)
    duration_min: float | None = Field(default=None, ge=0)

    workout_type: str | None = None
    exercise: str | None = None
    intensity: Intensity = "moderate"

    @model_validator(mode="after")
    def normalise(self) -> "CalorieRequest":
        if self.duration_hours is None:
            if self.duration_min is None:
                raise ValueError("one of duration_hours or duration_min is required")
            self.duration_hours = self.duration_min / 60.0
        if self.duration_min is None:
            self.duration_min = self.duration_hours * 60.0

        self.workout_type = normalize_workout_type(self.workout_type or self.exercise)
        return self

    @field_validator("sex", mode="before")
    @classmethod
    def normalise_sex(cls, value):
        """Profiles store "Male" / "Female" / "Other"; anything else is unknown."""
        text = str(value or "").strip().lower()
        if text in ("male", "m", "man"):
            return "male"
        if text in ("female", "f", "woman"):
            return "female"
        return None


class CalorieExplanation(MLModel):
    """SHAP breakdown of one XGBoost prediction, in kcal/min after calibration.

    base_kcal_per_min + sum(contributions) == kcal_per_min (up to rounding, and
    unless the estimate was clipped at zero).
    """

    base_kcal_per_min: float
    contributions: dict[str, float]
    inputs: dict[str, float]
    raw_model_kcal_per_min: float  # XGBoost output before the WEEE calibration


class CalorieResponse(MLModel):
    calories: float
    kcal_per_min: float
    method: Literal["heart_rate", "met_table"]
    # Which estimator produced the number: the trained model, the Keytel
    # fallback, or the MET table.
    estimator: Literal["xgboost", "keytel", "met"] = "met"
    validated: bool  # True only for the calorimetry-validated heart-rate method
    expected_error_kcal_per_min: float | None = None
    reason: str | None = None  # why the MET estimate was used instead
    fallback_reason: str | None = None  # why Keytel was used instead of XGBoost
    explanation: CalorieExplanation | None = None
    warnings: list[str] = Field(default_factory=list)
    baseline_met_calories: float
    model_version: str
    workout_type: str
    stub: bool = False


# ── 2. Meal recommender ───────────────────────────────────────────────────────
MealSlot = Literal["breakfast", "lunch", "dinner", "snack"]


class MealRequestSlot(MLModel):
    slot: MealSlot
    kcal_target: float = Field(..., gt=0, le=3000, description="Calories for this meal, per serving")
    min_protein_g: float = Field(default=0, ge=0, le=150)


class RecommendRequest(MLModel):
    """One meal plan day. Next.js computes the per-meal calorie targets."""

    meals: list[MealRequestSlot] = Field(..., min_length=1, max_length=6)
    dietary_restrictions: list[str] = Field(default_factory=list)
    per_meal: int = Field(default=5, ge=1, le=20)
    exclude_recipe_ids: list[int] = Field(default_factory=list)
    # Food.com recipe IDs the user has eaten (plan meals marked eaten). Drives
    # the personal part of the hybrid ranking; empty = cold start (popularity).
    liked_recipe_ids: list[int] = Field(default_factory=list, max_length=500)
    user_id: str | None = None


class RecommendedRecipe(MLModel):
    recipe_id: int
    name: str
    kcal: float
    protein_g: float
    minutes: int
    likes_last_year: int
    likes_all_time: int
    # Weighted contribution of each hybrid signal (popularity, als, text) to
    # this recipe's score; empty when the hybrid is not loaded.
    score_breakdown: dict[str, float] = Field(default_factory=dict)


class MealRecommendation(MLModel):
    slot: MealSlot
    kcal_min: float
    kcal_max: float
    widened: bool  # True when the ±25% calorie band had too few recipes
    recipes: list[RecommendedRecipe] = Field(default_factory=list)


class RecommendResponse(MLModel):
    meals: list[MealRecommendation] = Field(default_factory=list)
    applied_restrictions: list[str] = Field(default_factory=list)
    unsupported_restrictions: list[str] = Field(default_factory=list)
    reason: str | None = None  # why no recipes were returned
    method: str = "popularity_last_365d"
    # Liked recipes the hybrid could use, and whether it fell back to popularity.
    history_used: list[int] = Field(default_factory=list)
    cold_start: bool = True
    model_version: str
    stub: bool = False


# ── 2b. Exercise recommender (content-based) ──────────────────────────────────
ExerciseFocus = Literal["push", "pull", "legs", "upper", "lower", "core", "full_body"]


class ExerciseRequest(MLModel):
    """One session. Profile fields are passed as stored ("Muscle Gain", "Home Workouts")."""

    focus: ExerciseFocus
    goal: str | None = None
    training_style: str | None = None
    activity_level: str | None = None
    injuries: list[str] = Field(default_factory=list, max_length=10)
    equipment: list[str] | None = Field(default=None, max_length=20, description="Overrides the style's equipment")
    k: int = Field(default=5, ge=1, le=10)


class RecommendedExercise(MLModel):
    id: str
    name: str
    score: float  # cosine similarity between the session profile and the exercise
    primary_muscles: list[str]
    equipment: str | None = None
    level: str | None = None
    category: str | None = None
    mechanic: str | None = None
    why: str


class ExerciseResponse(MLModel):
    focus: str
    goal: str
    level: str
    allowed_equipment: list[str]
    injury_groups_excluded: list[str]
    excluded_counts: dict[str, int]
    candidates_after_filters: int
    recommendations: list[RecommendedExercise]
    note: str | None = None
    method: str = "content_cosine"
    model_version: str
    stub: bool = False


# ── 3. Injury risk ────────────────────────────────────────────────────────────
class DayLoad(MLModel):
    """One calendar day of training, in the units of the runners dataset."""

    date: str | None = None
    sessions: float = Field(default=0, ge=0, le=10, description="Trainings that day (clipped to 2)")
    total_km: float = Field(default=0, ge=0, le=300, description="Running distance, km")
    strength: float = Field(default=0, ge=0, le=5, description="1 if a strength session (clipped to 1)")
    alt_hours: float = Field(default=0, ge=0, le=24, description="Non-running cardio, hours")


class InjuryRequest(MLModel):
    """Either supply the features, or supply user_id and let the service read
    Supabase. Next.js sends features because it already owns the DB session.

    The retired Gym Members inputs (age, bmi, resting_bpm, ...) are no longer
    read; older clients that still send them are not rejected (extra fields are
    ignored)."""

    user_id: str
    recent_days: list[DayLoad] | None = Field(
        default=None, description="Exactly 7 days, oldest first, ending yesterday"
    )
    recent_exercises: list[str] = Field(default_factory=list, description="Exercise names from the last 7 days")
    prior_injuries: list[str] = Field(
        default_factory=list, description="Profile injuries, active injuries and reported pain, free text"
    )
    sleep_avg_hours: float | None = Field(default=None, ge=0, le=24, description="Accepted, not used")

    @field_validator("recent_days")
    @classmethod
    def seven_days(cls, value: list[DayLoad] | None) -> list[DayLoad] | None:
        if value is not None and len(value) != 7:
            raise ValueError("recent_days must hold exactly 7 days (oldest first, ending yesterday)")
        return value


class InjuryResponse(MLModel):
    risk: dict[str, float]
    threshold: float
    flagged: list[str] = Field(default_factory=list)
    basis: dict[str, str] = Field(default_factory=dict, description="Why each region has its rule level")
    overall_risk: float | None = Field(
        default=None, description="Calibrated probability of an injury on the next day (runners model)"
    )
    relative_risk: float | None = Field(default=None, description="overall_risk / training prevalence")
    overall_threshold: float | None = None
    overall_elevated: bool = False
    features_used: dict[str, float] = Field(default_factory=dict)
    imputed: list[str] = Field(default_factory=list)
    source: Literal["request", "supabase", "fallback"] = "request"
    model_version: str
    disclaimer: str = (
        "Informational injury-risk indicator, not a medical diagnosis. Body regions "
        "are flagged by fixed rules, not predicted."
    )
    stub: bool = False

    @model_validator(mode="after")
    def ensure_labels(self) -> "InjuryResponse":
        for label in INJURY_LABELS:
            self.risk.setdefault(label, 0.0)
        return self


# ── 4. Transformer trajectory ─────────────────────────────────────────────────
class SessionFeatures(MLModel):
    """One session. Running sessions add distance_km and gap_days, which the
    trajectory model needs; other sessions only feed the completion-slope rule."""

    duration: float = Field(..., ge=0, description="Session duration in hours")
    completion_rate: float = Field(default=1.0, ge=0, le=1)
    workout_type: str | None = None
    day_of_week: int = Field(default=0, ge=0, le=6, description="Monday = 0")
    date: str | None = None
    distance_km: float | None = Field(default=None, ge=0, le=300, description="Running distance")
    gap_days: float | None = Field(default=None, ge=0, le=365, description="Days since the previous session")


class TrajectoryRequest(MLModel):
    user_id: str
    sessions: list[SessionFeatures] = Field(..., min_length=1, max_length=16)


class TrajectoryResponse(MLModel):
    label: TrajectoryLabel
    trajectory_score: int = Field(..., ge=0, le=2)  # 0 REGRESS, 1 PLATEAU, 2 IMPROVE
    probs: dict[str, float]
    sessions_used: int
    model_version: str
    reason: str | None = Field(default=None, description="Why the rule answered instead of the model")
    stub: bool = False


# ── 5. RL action ──────────────────────────────────────────────────────────────
class RLStateRequest(MLModel):
    user_id: str
    completion_rate: float = Field(..., ge=0, le=1)
    sleep_avg: float = Field(..., ge=0, le=24, description="Average hours per night")
    injury_flag: float = Field(..., ge=0, le=1)
    trajectory_score: int = Field(default=1, ge=0, le=2)
    streak: float = Field(default=0, ge=0, description="Consecutive workout days")


class RLActionResponse(MLModel):
    action: ActionName
    intensity_delta: float  # -0.15, 0.0, or +0.15
    confidence: float
    state: list[float]
    model_version: str
    stub: bool = False


# ── health ────────────────────────────────────────────────────────────────────
class HealthResponse(MLModel):
    ok: bool
    service: str
    version: str
    models_loaded: list[str]
    models_status: dict[str, bool]
    model_errors: dict[str, str] = Field(default_factory=dict)
