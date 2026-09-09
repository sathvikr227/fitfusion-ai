// Mirrors ml-service/app/schemas.py — keep in sync when adding fields.

// ── 1. Calorie predictor ─────────────────────────────────────────────────────
export type CalorieRequest = {
  weight_kg: number
  age?: number
  bmi?: number
  height_cm?: number
  resting_bpm?: number
  /** Send one of these two. The service normalises to hours. */
  duration_min?: number
  duration_hours?: number
  /** Dataset class ("Cardio" | "Strength" | "Yoga" | "HIIT"). */
  workout_type?: string
  /** Free-text exercise or day name; the service maps it onto a dataset class. */
  exercise?: string
  intensity?: "low" | "moderate" | "high"
}

export type ShapFeature = {
  feature: string
  label: string
  /** kcal this feature pushed above (+) or below (-) the dataset average. */
  impact: number
  value: number
}

export type CalorieResponse = {
  calories: number
  baseline_met_calories: number
  model_version: string
  workout_type: string
  shap_top_features: ShapFeature[]
  shap_base_value: number | null
  imputed: string[]
  stub: boolean
}

// ── 2. Hybrid recommender ────────────────────────────────────────────────────
export type RecommendRequest = {
  age: number
  bmi: number
  goal?: string
  workout_frequency?: number
  experience_level?: number
  injuries?: string[]
  dietary_restrictions?: string[]
  top_k?: number
  diet_items?: number
  user_id?: string
}

export type RecommendedWorkout = { workout_type: string; score: number }

export type RecommendedFood = {
  name: string
  category: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type DietFocus = {
  strategy: string
  target_macro: string
  avg_calories: number
  avg_protein: number
  foods: RecommendedFood[]
}

export type RecommendResponse = {
  recommended_workouts: RecommendedWorkout[]
  recommended_diet_focus: DietFocus | null
  excluded_workouts: string[]
  applied_restrictions: string[]
  neighbours_used: number
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
