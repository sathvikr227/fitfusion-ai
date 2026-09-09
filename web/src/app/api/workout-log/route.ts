import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import {
  calculateTotalWorkoutCalories,
  estimateSessionDurationMinutes,
  type LoggedExercise,
} from "../../../lib/calories"
import { normalizeWorkoutType, predictCalorie } from "../../../lib/ml-service"

export const runtime = "nodejs"

/**
 * Model 1 integration point.
 *
 * Given the exercises in a logged session, returns the XGBoost calorie estimate
 * plus the SHAP breakdown behind it. The client stores the returned number as
 * `workout_logs.total_calories`.
 *
 * If the ML service is unreachable the existing MET calculation runs instead and
 * `source` comes back as "fallback" — the caller always gets a usable number.
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }
  return createClient(url, serviceRoleKey)
}

function parseHeightCm(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 3 ? n : n * 100
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) {
      return NextResponse.json({ error: "Unauthorized: missing token" }, { status: 401 })
    }

    const supabase = getSupabase()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const exercises: LoggedExercise[] = Array.isArray(body?.exercises) ? body.exercises : []

    if (exercises.length === 0) {
      return NextResponse.json({ error: "At least one exercise is required" }, { status: 400 })
    }

    // ── Profile context the calorie model needs ───────────────────────────────
    const [profileRes, weightRes, vitalsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("age, height, weight")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("weight_logs")
        .select("weight")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("vitals_logs")
        .select("resting_heart_rate")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const profile = profileRes.data
    const bodyWeightKg =
      Number(body?.weightKg) ||
      Number(weightRes.data?.weight) ||
      Number(profile?.weight) ||
      0

    if (!bodyWeightKg || bodyWeightKg <= 0) {
      return NextResponse.json(
        { error: "No body weight on file. Add a weight log or set it in your profile." },
        { status: 400 }
      )
    }

    const heightCm = parseHeightCm(profile?.height)
    const age = Number(profile?.age) || undefined
    const restingBpm = Number(vitalsRes.data?.resting_heart_rate) || undefined

    const durationMin = estimateSessionDurationMinutes(exercises)
    const workoutType = normalizeWorkoutType(
      body?.workoutType ?? exercises.map((ex) => ex.name ?? "").join(" ")
    )

    // ── MET total, always computed so the response can compare the two ────────
    const metCalories = calculateTotalWorkoutCalories(
      bodyWeightKg,
      exercises.map((ex) => ({
        name: String(ex.name ?? "Exercise"),
        duration: Number(ex.duration) || 0,
      }))
    )

    const result = await predictCalorie({
      weight_kg: bodyWeightKg,
      age,
      height_cm: heightCm ?? undefined,
      resting_bpm: restingBpm,
      duration_min: durationMin,
      workout_type: workoutType,
      intensity: body?.intensity ?? "moderate",
    })

    if (result.fromFallback) {
      console.warn(`[workout-log] calorie model fallback: ${result.reason}`)
    }

    return NextResponse.json({
      calories: Math.round(result.data.calories),
      source: result.fromFallback ? "fallback" : "ml",
      fallbackReason: result.reason ?? null,
      modelVersion: result.data.model_version,
      workoutType: result.data.workout_type,
      durationMinutes: durationMin,
      metCalories,
      baselineMetCalories: result.data.baseline_met_calories,
      shap: result.data.shap_top_features,
      shapBaseValue: result.data.shap_base_value,
      imputed: result.data.imputed,
    })
  } catch (err: any) {
    console.error("[workout-log] error:", err?.message ?? err)
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}
