import { callMLService, type MLCallResult } from "./client"
import type {
  CalorieRequest,
  CalorieResponse,
  InjuryRequest,
  InjuryResponse,
  RLActionResponse,
  RLStateRequest,
  RecommendRequest,
  RecommendResponse,
  TrajectoryRequest,
  TrajectoryResponse,
} from "./types"

// MET fallback mirrors what the app used to inline. Kept here so the service can disappear and behavior holds.
const MET: Record<string, number> = {
  running: 9.8,
  cycling: 7.5,
  walking: 3.8,
  swimming: 7.0,
  weights: 5.0,
  weightlifting: 5.0,
  strength: 5.0,
  yoga: 2.5,
  hiit: 8.0,
  rowing: 7.0,
}

export function predictCalorie(req: CalorieRequest): Promise<MLCallResult<CalorieResponse>> {
  return callMLService<CalorieRequest, CalorieResponse>("/predict/calorie", req, () => {
    const met = MET[req.exercise.toLowerCase()] ?? 5.0
    const mult = req.intensity === "high" ? 1.15 : req.intensity === "low" ? 0.85 : 1.0
    const kcal = met * req.weight_kg * (req.duration_min / 60) * mult
    return {
      calories: Math.round(kcal * 10) / 10,
      model_version: "fallback-met",
      shap_top_features: [],
      stub: true,
    }
  })
}

export function recommend(req: RecommendRequest): Promise<MLCallResult<RecommendResponse>> {
  return callMLService<RecommendRequest, RecommendResponse>("/recommend", req, () => ({
    items: [],
    model_version: "fallback-empty",
    stub: true,
  }))
}

export function predictInjury(req: InjuryRequest): Promise<MLCallResult<InjuryResponse>> {
  return callMLService<InjuryRequest, InjuryResponse>("/predict/injury", req, () => ({
    risk: { knee: 0.1, back: 0.1, shoulder: 0.1 },
    model_version: "fallback-neutral",
    stub: true,
  }))
}

export function predictTrajectory(
  req: TrajectoryRequest
): Promise<MLCallResult<TrajectoryResponse>> {
  return callMLService<TrajectoryRequest, TrajectoryResponse>("/predict/trajectory", req, () => ({
    label: "plateau",
    score: 0,
    probs: { improve: 0.33, plateau: 0.34, regress: 0.33 },
    model_version: "fallback-neutral",
    stub: true,
  }))
}

export function rlAction(req: RLStateRequest): Promise<MLCallResult<RLActionResponse>> {
  return callMLService<RLStateRequest, RLActionResponse>("/rl/action", req, () => {
    // Mirror the current rule in /api/adaptive-replan so behavior is unchanged if the service is down.
    if (req.injury_flag >= 0.5 || req.sleep_avg < 5.5) {
      return { action: "REDUCE", confidence: 0.7, model_version: "fallback-rules", stub: true }
    }
    if (req.completion_rate < 0.6 || req.trajectory_score < -0.2) {
      return { action: "REDUCE", confidence: 0.65, model_version: "fallback-rules", stub: true }
    }
    if (req.completion_rate > 0.85 && req.trajectory_score > 0.2) {
      return { action: "INCREASE", confidence: 0.7, model_version: "fallback-rules", stub: true }
    }
    return { action: "MAINTAIN", confidence: 0.6, model_version: "fallback-rules", stub: true }
  })
}

export { pingMLService } from "./client"
export type * from "./types"
