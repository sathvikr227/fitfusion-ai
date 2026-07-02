// Mirrors ml-service/app/schemas.py — keep in sync when adding fields.

export type CalorieRequest = {
  exercise: string
  duration_min: number
  weight_kg: number
  intensity?: "low" | "moderate" | "high"
  heart_rate_avg?: number
  age?: number
  sex?: "male" | "female" | "other"
}
export type CalorieResponse = {
  calories: number
  model_version: string
  shap_top_features: Array<{ feature: string; impact: number }>
  stub: boolean
}

export type RecommendRequest = {
  user_id: string
  kind: "workout" | "diet"
  goal?: string
  top_k?: number
}
export type RecommendItem = { item_id: string; name: string; score: number }
export type RecommendResponse = {
  items: RecommendItem[]
  model_version: string
  stub: boolean
}

export type InjuryRequest = {
  user_id: string
  sleep_avg_hours?: number
  weekly_volume_sets?: number
  weekly_high_impact_sessions?: number
  prior_injuries?: string[]
}
export type InjuryResponse = {
  risk: { knee: number; back: number; shoulder: number; [k: string]: number }
  model_version: string
  stub: boolean
}

export type SessionFeatures = {
  date: string
  completed_pct: number
  total_volume: number
  avg_rpe?: number
  sleep_hours?: number
}
export type TrajectoryRequest = {
  user_id: string
  sessions: SessionFeatures[]
}
export type TrajectoryResponse = {
  label: "improve" | "plateau" | "regress"
  score: number
  probs: { improve: number; plateau: number; regress: number }
  model_version: string
  stub: boolean
}

export type RLStateRequest = {
  user_id: string
  completion_rate: number
  sleep_avg: number
  injury_flag: number
  trajectory_score: number
}
export type RLActionResponse = {
  action: "REDUCE" | "MAINTAIN" | "INCREASE"
  confidence: number
  model_version: string
  stub: boolean
}
