from typing import Literal

from pydantic import BaseModel, Field


# ── 1. Calorie predictor ──────────────────────────────────────────────────────
class CalorieRequest(BaseModel):
    exercise: str = Field(..., description="Exercise name, e.g. 'running'")
    duration_min: float = Field(..., ge=0)
    weight_kg: float = Field(..., gt=0)
    intensity: Literal["low", "moderate", "high"] = "moderate"
    heart_rate_avg: float | None = None
    age: int | None = None
    sex: Literal["male", "female", "other"] | None = None


class CalorieResponse(BaseModel):
    calories: float
    model_version: str
    shap_top_features: list[dict] = Field(default_factory=list)
    stub: bool = False


# ── 2. Hybrid recommender ─────────────────────────────────────────────────────
class RecommendRequest(BaseModel):
    user_id: str
    kind: Literal["workout", "diet"]
    goal: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class RecommendItem(BaseModel):
    item_id: str
    name: str
    score: float


class RecommendResponse(BaseModel):
    items: list[RecommendItem]
    model_version: str
    stub: bool = False


# ── 3. Injury risk ────────────────────────────────────────────────────────────
class InjuryRequest(BaseModel):
    user_id: str
    sleep_avg_hours: float | None = None
    weekly_volume_sets: int | None = None
    weekly_high_impact_sessions: int | None = None
    prior_injuries: list[str] = Field(default_factory=list)


class InjuryResponse(BaseModel):
    risk: dict[str, float]  # {"knee": 0.12, "back": 0.08, "shoulder": 0.04}
    model_version: str
    stub: bool = False


# ── 4. Transformer trajectory ─────────────────────────────────────────────────
class SessionFeatures(BaseModel):
    date: str
    completed_pct: float
    total_volume: float
    avg_rpe: float | None = None
    sleep_hours: float | None = None


class TrajectoryRequest(BaseModel):
    user_id: str
    sessions: list[SessionFeatures] = Field(..., min_length=1, max_length=8)


class TrajectoryResponse(BaseModel):
    label: Literal["improve", "plateau", "regress"]
    score: float  # signed: +1 strong improve, -1 strong regress
    probs: dict[str, float]
    model_version: str
    stub: bool = False


# ── 5. RL action ──────────────────────────────────────────────────────────────
class RLStateRequest(BaseModel):
    user_id: str
    completion_rate: float = Field(..., ge=0, le=1)
    sleep_avg: float = Field(..., ge=0)
    injury_flag: float = Field(..., ge=0, le=1)
    trajectory_score: float = Field(..., ge=-1, le=1)


class RLActionResponse(BaseModel):
    action: Literal["REDUCE", "MAINTAIN", "INCREASE"]
    confidence: float
    model_version: str
    stub: bool = False
