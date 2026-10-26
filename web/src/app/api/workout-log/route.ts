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
 * Stage 1 integration point — session energy expenditure.
 *
 * For a cardio session with an average heart rate (plus the profile's age and
 * sex) the ML service returns the calibrated Keytel estimate, validated against
 * lab calorimetry. Otherwise it returns a MET estimate and says why in
 * `methodReason`.
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
    const [profileRes, weightRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("age, gender, weight")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("weight_logs")
        .select("weight")
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

    const age = Number(profile?.age) || undefined
    const sex = typeof profile?.gender === "string" ? profile.gender : undefined
    const avgHeartRate = Number(body?.avgHeartRate) || undefined

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
      sex,
      avg_hr: avgHeartRate,
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
      method: result.data.method,
      validated: result.data.validated,
      kcalPerMin: result.data.kcal_per_min,
      expectedErrorKcalPerMin: result.data.expected_error_kcal_per_min,
      methodReason: result.data.reason,
      modelVersion: result.data.model_version,
      workoutType: result.data.workout_type,
      durationMinutes: durationMin,
      metCalories,
      baselineMetCalories: result.data.baseline_met_calories,
    })
  } catch (err: any) {
    console.error("[workout-log] error:", err?.message ?? err)
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}
