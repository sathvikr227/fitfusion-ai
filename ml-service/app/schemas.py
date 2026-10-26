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


class CalorieResponse(MLModel):
    calories: float
    kcal_per_min: float
    method: Literal["heart_rate", "met_table"]
    validated: bool  # True only for the calorimetry-validated heart-rate method
    expected_error_kcal_per_min: float | None = None
    reason: str | None = None  # why the MET estimate was used instead
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
    user_id: str | None = None


class RecommendedRecipe(MLModel):
    recipe_id: int
    name: str
    kcal: float
    protein_g: float
    minutes: int
    likes_last_year: int
    likes_all_time: int


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
    model_version: str
    stub: bool = False


# ── 3. Injury risk ────────────────────────────────────────────────────────────
class InjuryRequest(MLModel):
    """Either supply the features, or supply user_id and let the service read
    Supabase. Next.js sends features because it already owns the DB session."""

    user_id: str
    age: float | None = Field(default=None, ge=10, le=100)
    bmi: float | None = Field(default=None, gt=5, le=70)
    resting_bpm: float | None = Field(default=None, ge=30, le=140)
    session_duration_hours: float | None = Field(default=None, ge=0, le=8)
    workout_frequency: float | None = Field(default=None, ge=0, le=7)
    experience_level: int | None = Field(default=None, ge=1, le=3)
    sleep_avg_hours: float | None = Field(default=None, ge=0, le=24)
    prior_injuries: list[str] = Field(default_factory=list)


class InjuryResponse(MLModel):
    risk: dict[str, float]
    threshold: float
    flagged: list[str] = Field(default_factory=list)
    features_used: dict[str, float] = Field(default_factory=dict)
    imputed: list[str] = Field(default_factory=list)
    source: Literal["request", "supabase", "fallback"] = "request"
    model_version: str
    disclaimer: str = (
        "Proxy injury-risk scores derived from biomechanical thresholds. "
        "Not a clinical diagnosis."
    )
    stub: bool = False

    @model_validator(mode="after")
    def ensure_labels(self) -> "InjuryResponse":
        for label in INJURY_LABELS:
            self.risk.setdefault(label, 0.0)
        return self


# ── 4. Transformer trajectory ─────────────────────────────────────────────────
class SessionFeatures(MLModel):
    duration: float = Field(..., ge=0, description="Session duration in hours")
    completion_rate: float = Field(..., ge=0, le=1)
    workout_type: str | None = None
    day_of_week: int = Field(default=0, ge=0, le=6)
    date: str | None = None


class TrajectoryRequest(MLModel):
    user_id: str
    sessions: list[SessionFeatures] = Field(..., min_length=1, max_length=16)


class TrajectoryResponse(MLModel):
    label: TrajectoryLabel
    trajectory_score: int = Field(..., ge=0, le=2)  # 0 REGRESS, 1 PLATEAU, 2 IMPROVE
    probs: dict[str, float]
    sessions_used: int
    model_version: str
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
