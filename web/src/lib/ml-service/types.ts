// Mirrors ml-service/app/schemas.py — keep in sync when adding fields.

// ── 1. Session energy expenditure ────────────────────────────────────────────
export type CalorieRequest = {
  weight_kg: number
  age?: number
  /** "Male" / "Female" from profiles.gender; anything else counts as unknown. */
  sex?: string
  /** Average session heart rate. With age and sex it unlocks the validated method. */
  avg_hr?: number
  /** Height in cm. Needed by the XGBoost model; without it the Keytel fallback runs. */
  height_cm?: number
  /** Send one of these two. The service normalises to hours. */
  duration_min?: number
  duration_hours?: number
  /** Dataset class ("Cardio" | "Strength" | "Yoga" | "HIIT"). */
  workout_type?: string
  /** Free-text exercise or day name; the service maps it onto a dataset class. */
  exercise?: string
  intensity?: "low" | "moderate" | "high"
}

/** SHAP breakdown of an XGBoost estimate, in kcal/min. base + sum(contributions) = kcal_per_min. */
export type CalorieExplanation = {
  base_kcal_per_min: number
  contributions: Record<string, number>
  inputs: Record<string, number>
  raw_model_kcal_per_min: number
}

export type CalorieResponse = {
  calories: number
  kcal_per_min: number
  /** heart_rate = calibrated XGBoost (or Keytel fallback), validated against lab calorimetry. */
  method: "heart_rate" | "met_table"
  /** Which estimator produced the number. */
  estimator: "xgboost" | "keytel" | "met"
  validated: boolean
  expected_error_kcal_per_min: number | null
  /** Why the MET estimate was used instead of the heart-rate method. */
  reason: string | null
  /** Why Keytel was used instead of XGBoost (e.g. no height on file). */
  fallback_reason: string | null
  explanation: CalorieExplanation | null
  warnings: string[]
  baseline_met_calories: number
  model_version: string
  workout_type: string
  stub: boolean
}

// ── 2. Meal recommender ──────────────────────────────────────────────────────
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack"

export type RecommendRequest = {
  meals: Array<{ slot: MealSlot; kcal_target: number; min_protein_g?: number }>
  dietary_restrictions?: string[]
  per_meal?: number
  exclude_recipe_ids?: number[]
  user_id?: string
}

export type RecommendedRecipe = {
  recipe_id: number
  name: string
  kcal: number
  protein_g: number
  minutes: number
  likes_last_year: number
  likes_all_time: number
}

export type MealRecommendation = {
  slot: MealSlot
  kcal_min: number
  kcal_max: number
  /** True when the ±25% calorie band had too few recipes and ±50% was used. */
  widened: boolean
  recipes: RecommendedRecipe[]
}

export type RecommendResponse = {
  meals: MealRecommendation[]
  applied_restrictions: string[]
  /** Restrictions the ingredient filters cannot verify; no recipes are returned. */
  unsupported_restrictions: string[]
  reason: string | null
  method: string
  model_version: string
  stub: boolean
}

// ── 3. Injury risk ───────────────────────────────────────────────────────────
export type InjuryRequest = {
  user_id: string
  age?: number
  bmi?: number
  resting_bpm?: number
  session_duration_hours?: number
  workout_frequency?: number
  experience_level?: number
  sleep_avg_hours?: number
  prior_injuries?: string[]
}

export type InjuryRisk = {
  knee: number
  back: number
  shoulder: number
  hamstring: number
  [k: string]: number
}

export type InjuryResponse = {
  risk: InjuryRisk
  threshold: number
  flagged: string[]
  features_used: Record<string, number>
  imputed: string[]
  source: "request" | "supabase" | "fallback"
  model_version: string
  disclaimer: string
  stub: boolean
}

// ── 4. Transformer trajectory ────────────────────────────────────────────────
export type SessionFeatures = {
  /** Session duration in hours. */
  duration: number
  completion_rate: number
  workout_type?: string
  day_of_week?: number
  date?: string
}

export type TrajectoryRequest = {
  user_id: string
  sessions: SessionFeatures[]
}

export type TrajectoryLabel = "REGRESS" | "PLATEAU" | "IMPROVE"

export type TrajectoryResponse = {
  label: TrajectoryLabel
  /** 0 = REGRESS, 1 = PLATEAU, 2 = IMPROVE. */
  trajectory_score: number
  probs: Record<string, number>
  sessions_used: number
  model_version: string
  stub: boolean
}

// ── 5. RL action ─────────────────────────────────────────────────────────────
export type RLStateRequest = {
  user_id: string
  completion_rate: number
  /** Average hours per night. */
  sleep_avg: number
  injury_flag: number
  trajectory_score?: number
  streak?: number
}

export type RLAction = "REDUCE" | "MAINTAIN" | "INCREASE"

export type RLActionResponse = {
  action: RLAction
  /** -0.15, 0, or +0.15. */
  intensity_delta: number
  confidence: number
  state: number[]
  model_version: string
  stub: boolean
}
