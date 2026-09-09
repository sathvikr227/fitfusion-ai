import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { predictInjury, predictTrajectory } from "../../../lib/ml-service"
import { buildUserHistory } from "../../../lib/ml-service/history"

export const runtime = "nodejs"

/**
 * Read-only ML readout for the analytics dashboard: the Transformer's trajectory
 * call with the sparkline behind it, current injury-risk scores, and the last
 * replan decision the RL agent made.
 *
 * Runs the same history builder as /api/adaptive-replan so the dashboard and the
 * replan always describe the same week. Keeps the ML bearer token server-side.
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }
  return createClient(url, serviceRoleKey)
}

export async function GET(req: NextRequest) {
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

    const userId = user.id
    const history = await buildUserHistory(supabase, userId)

    // ── Trajectory ────────────────────────────────────────────────────────────
    let trajectory: {
      label: string
      score: number
      probs: Record<string, number>
      sessionsUsed: number
      modelVersion: string
      fromFallback: boolean
    } | null = null

    if (history.sessions.length > 0) {
      const result = await predictTrajectory({ user_id: userId, sessions: history.sessions })
      trajectory = {
        label: result.data.label,
        score: result.data.trajectory_score,
        probs: result.data.probs,
        sessionsUsed: result.data.sessions_used,
        modelVersion: result.data.model_version,
        fromFallback: result.fromFallback,
      }
      if (result.fromFallback) {
        console.warn(`[ml-insights] trajectory fallback: ${result.reason}`)
      }
    }

    // ── Injury risk ───────────────────────────────────────────────────────────
    const injuryResult = await predictInjury({ user_id: userId, ...history.injuryFeatures })
    if (injuryResult.fromFallback) {
      console.warn(`[ml-insights] injury fallback: ${injuryResult.reason}`)
    }

    // ── Last RL decision, if a replan has run and stored one ──────────────────
    let lastDecision: Record<string, any> | null = null
    const { data: planRow } = await supabase
      .from("workout_plans")
      .select("plan, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const plan =
      typeof planRow?.plan === "string" ? JSON.parse(planRow.plan) : planRow?.plan
    if (plan?.ml_meta?.rl) {
      lastDecision = {
        action: plan.ml_meta.rl.action,
        intensityDelta: plan.ml_meta.rl.intensity_delta,
        confidence: plan.ml_meta.rl.confidence,
        modelVersion: plan.ml_meta.rl.model_version,
        restDayAdded: plan.ml_meta.adjustments?.rest_day_added ?? null,
        removedExercises: plan.ml_meta.adjustments?.removed_exercises ?? [],
        generatedAt: plan.ml_meta.generated_at ?? planRow?.created_at ?? null,
      }
    }

    return NextResponse.json({
      trajectory,
      sparkline: history.sessions.map((s) => ({
        date: s.date ?? null,
        completionRate: Math.round(s.completion_rate * 100),
        durationHours: s.duration,
        workoutType: s.workout_type ?? null,
      })),
      injury: {
        risk: injuryResult.data.risk,
        threshold: injuryResult.data.threshold,
        flagged: injuryResult.data.flagged,
        disclaimer: injuryResult.data.disclaimer,
        modelVersion: injuryResult.data.model_version,
        fromFallback: injuryResult.fromFallback,
      },
      week: {
        completionRate: history.completionRate,
        completionSource: history.completionSource,
        avgSleep: history.avgSleep,
        streak: history.streak,
        activeInjuries: history.activeInjuries.length,
      },
      lastDecision,
    })
  } catch (err: any) {
    console.error("[ml-insights] error:", err?.message ?? err)
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}
