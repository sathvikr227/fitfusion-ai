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

// Every wrapper passes a fallback. If the ML service is down, slow, misconfigured,
// or returns something unusable, the rule-based path runs and the user sees no error.

// ── 1. Calorie predictor ─────────────────────────────────────────────────────

// MET per dataset workout class, mirroring ml-service/app/routers/calorie.py.
// The app's richer per-exercise table stays in lib/calories.ts and is unchanged.
const MET_BY_TYPE: Record<string, number> = {
  cardio: 7.5,
  strength: 5.0,
  yoga: 2.5,
  hiit: 8.0,
}

const TYPE_KEYWORDS: Array<[string, string]> = [
  ["hiit", "HIIT"],
  ["interval", "HIIT"],
  ["circuit", "HIIT"],
  ["burpee", "HIIT"],
  ["yoga", "Yoga"],
  ["stretch", "Yoga"],
  ["mobility", "Yoga"],
  ["plank", "Yoga"],
  ["cardio", "Cardio"],
  ["run", "Cardio"],
  ["jog", "Cardio"],
  ["treadmill", "Cardio"],
  ["cycl", "Cardio"],
  ["bike", "Cardio"],
  ["row", "Cardio"],
  ["swim", "Cardio"],
  ["walk", "Cardio"],
]

/** Mirrors normalize_workout_type() in ml-service/app/features.py. */
export function normalizeWorkoutType(raw?: string | null): string {
  const text = String(raw ?? "").trim().toLowerCase()
  if (!text) return "Strength"
  for (const name of ["Cardio", "Strength", "Yoga", "HIIT"]) {
    if (text === name.toLowerCase()) return name
  }
  const matches = TYPE_KEYWORDS.filter(([kw]) => text.includes(kw))
  if (matches.length > 0) {
    return matches.reduce((a, b) => (a[0].length >= b[0].length ? a : b))[1]
  }
  return "Strength"
}

export function predictCalorie(req: CalorieRequest): Promise<MLCallResult<CalorieResponse>> {
  return callMLService<CalorieRequest, CalorieResponse>("/predict/calories", req, () => {
    const workoutType = normalizeWorkoutType(req.workout_type ?? req.exercise)
    const met = MET_BY_TYPE[workoutType.toLowerCase()] ?? 5.0
    const hours = req.duration_hours ?? (req.duration_min ?? 0) / 60
    const multiplier =
      req.intensity === "high" ? 1.15 : req.intensity === "low" ? 0.85 : 1.0
    const kcal = Math.round(met * req.weight_kg * hours * multiplier * 10) / 10
    return {
      calories: kcal,
      baseline_met_calories: kcal,
      model_version: "fallback-met",
      workout_type: workoutType,
      shap_top_features: [],
      shap_base_value: null,
      imputed: [],
      stub: true,
    }
  })
}

// ── 2. Hybrid recommender ────────────────────────────────────────────────────

export function recommend(req: RecommendRequest): Promise<MLCallResult<RecommendResponse>> {
  return callMLService<RecommendRequest, RecommendResponse>("/recommend", req, () => ({
    recommended_workouts: [],
    recommended_diet_focus: null,
    excluded_workouts: [],
    applied_restrictions: [],
    neighbours_used: 0,
    model_version: "fallback-empty",
    stub: true,
  }))
}

// ── 3. Injury risk ───────────────────────────────────────────────────────────

export function predictInjury(req: InjuryRequest): Promise<MLCallResult<InjuryResponse>> {
  return callMLService<InjuryRequest, InjuryResponse>("/predict/injury-risk", req, () => {
    // Neutral, sub-threshold scores: with no model we must not invent risk, and
    // must not silently clear a user who might have some.
    const risk = { knee: 0.1, back: 0.1, shoulder: 0.1, hamstring: 0.1 }
    return {
      risk,
      threshold: 0.7,
      flagged: [],
      features_used: {},
      imputed: [],
      source: "fallback",
      model_version: "fallback-neutral",
      disclaimer:
        "Proxy injury-risk scores derived from biomechanical thresholds. Not a clinical diagnosis.",
      stub: true,
    }
  })
}

// ── 4. Transformer trajectory ────────────────────────────────────────────────

export function predictTrajectory(
  req: TrajectoryRequest
): Promise<MLCallResult<TrajectoryResponse>> {
  return callMLService<TrajectoryRequest, TrajectoryResponse>("/predict/trajectory", req, () => {
    // Completion-rate slope — what the app used before the model existed.
    const rates = req.sessions.map((s) => s.completion_rate)
    let label: TrajectoryResponse["label"] = "PLATEAU"
    if (rates.length >= 2) {
      const prior = rates.slice(0, -1)
      const mean = prior.reduce((a, b) => a + b, 0) / prior.length
      const delta = rates[rates.length - 1] - mean
      if (delta > 0.05) label = "IMPROVE"
      else if (delta < -0.05) label = "REGRESS"
    }
    const score = label === "REGRESS" ? 0 : label === "PLATEAU" ? 1 : 2
    return {
      label,
      trajectory_score: score,
      probs: { REGRESS: 0.2, PLATEAU: 0.2, IMPROVE: 0.2, [label]: 0.6 },
      sessions_used: req.sessions.length,
      model_version: "fallback-slope",
      stub: true,
    }
  })
}

// ── 5. RL action ─────────────────────────────────────────────────────────────

export function rlAction(req: RLStateRequest): Promise<MLCallResult<RLActionResponse>> {
  return callMLService<RLStateRequest, RLActionResponse>("/rl/action", req, () => {
    // The three thresholds /api/adaptive-replan shipped before the agent existed,
    // so a missing model changes nothing the user can see.
    let action: RLActionResponse["action"] = "MAINTAIN"
    if (req.completion_rate < 0.6) action = "REDUCE"
    else if (req.completion_rate > 0.85) action = "INCREASE"

    // Safety overrides the thresholds never had.
    if (req.injury_flag >= 0.5 || req.sleep_avg < 5.5) action = "REDUCE"

    const delta = action === "REDUCE" ? -0.15 : action === "INCREASE" ? 0.15 : 0
    return {
      action,
      intensity_delta: delta,
      confidence: 0.5,
      state: [
        req.completion_rate,
        Math.min(req.sleep_avg / 10, 1),
        req.injury_flag,
        (req.trajectory_score ?? 1) / 2,
        Math.min(req.streak ?? 0, 14) / 14,
      ],
      model_version: "fallback-thresholds",
      stub: true,
    }
  })
}

export { pingMLService } from "./client"
export type * from "./types"
