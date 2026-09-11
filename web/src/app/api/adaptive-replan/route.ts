import { NextRequest, NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

import { predictInjury, predictTrajectory, rlAction } from "../../../lib/ml-service"
import type {
  InjuryResponse,
  RLActionResponse,
  TrajectoryResponse,
} from "../../../lib/ml-service"
import { buildUserHistory } from "../../../lib/ml-service/history"
import {
  applyInjuryAdjustments,
  applyIntensityDelta,
  type PlanDay,
} from "../../../lib/ml-service/injury-rules"
import { GROQ_MODEL } from "../../../lib/groq-model"

export const runtime = "nodejs"

/**
 * Weekly adaptive replan, orchestrating three of the five models:
 *
 *   1. Injury risk classifier  → per-muscle-group risk + rest-day / removal rules
 *   2. Transformer trajectory  → REGRESS / PLATEAU / IMPROVE over the last 4 sessions
 *   3. PPO agent               → final REDUCE / MAINTAIN / INCREASE decision
 *
 * Each call passes a fallback, so if the ML service is down the route behaves
 * exactly as it did before the models existed: the three completion-rate
 * thresholds decide the direction and no injury adjustments are applied.
 */

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")

  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain valid JSON")
  }

  return cleaned.slice(firstBrace, lastBrace + 1)
}

function parsePlan(raw: unknown) {
  if (!raw) return null
  if (typeof raw === "object") return raw as Record<string, any>
  if (typeof raw !== "string") return null
  return safeJsonParse(raw)
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

    if (!token) {
      return NextResponse.json({ error: "Unauthorized: missing token" }, { status: 401 })
    }

    const supabase = getSupabase()
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 })
    }

    const userId = user.id

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: {
      weekRating?: number
      energyLevel?: string
      completionRate?: number
      notes?: string
    } = {}

    try {
      body = await req.json()
    } catch {
      // empty body is fine, defaults apply
    }

    const weekRating = typeof body.weekRating === "number" ? body.weekRating : 3
    const energyLevel = typeof body.energyLevel === "string" ? body.energyLevel : "Moderate"
    const clientCompletionRate = typeof body.completionRate === "number" ? body.completionRate : null
    const userNotes = typeof body.notes === "string" ? body.notes : ""

    const planRes = await supabase
      .from("workout_plans")
      .select("plan, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!planRes.data?.plan) {
      return NextResponse.json(
        { error: "No existing workout plan found. Generate a plan first." },
        { status: 400 }
      )
    }

    const currentPlanParsed = parsePlan(planRes.data.plan)
    const plannedWorkoutDays = (currentPlanParsed?.workout_plan ?? []).filter(
      (d: any) => String(d?.type ?? "").toLowerCase() !== "rest"
    ).length

    // ── One read of the user's week, shared with /api/ml-insights ─────────────
    const history = await buildUserHistory(supabase, userId, { plannedWorkoutDays })

    // The check-in screen computes its own rate from the same tick list; prefer
    // the server's, and only fall back to the client's when we had nothing.
    const actualCompletionRate =
      history.completionSource === "plan_ratio" && clientCompletionRate !== null
        ? Math.max(0, Math.min(100, clientCompletionRate))
        : history.completionRate

    const { avgSleep, streak, activeInjuries, profile, sessions } = history

    // ══ STEP 1 — Injury risk classifier ═══════════════════════════════════════
    const injuryResult = await predictInjury({
      user_id: userId,
      ...history.injuryFeatures,
    })
    const injury: InjuryResponse = injuryResult.data
    if (injuryResult.fromFallback) {
      console.warn(`[adaptive-replan] injury model fallback: ${injuryResult.reason}`)
    }

    const flaggedGroups = injury.flagged ?? []
    const injuryFlag = flaggedGroups.length > 0 || activeInjuries.length > 0 ? 1 : 0

    // ══ STEP 2 — Transformer trajectory ═══════════════════════════════════════
    let trajectory: TrajectoryResponse | null = null
    let trajectoryFromFallback = false
    if (sessions.length > 0) {
      const trajectoryResult = await predictTrajectory({ user_id: userId, sessions })
      trajectory = trajectoryResult.data
      trajectoryFromFallback = trajectoryResult.fromFallback
      if (trajectoryResult.fromFallback) {
        console.warn(`[adaptive-replan] trajectory model fallback: ${trajectoryResult.reason}`)
      }
    }
    const trajectoryScore = trajectory?.trajectory_score ?? 1

    // ══ STEP 3 — PPO agent makes the final call ═══════════════════════════════
    const rlResult = await rlAction({
      user_id: userId,
      completion_rate: actualCompletionRate / 100,
      sleep_avg: avgSleep ?? 7,
      injury_flag: injuryFlag,
      trajectory_score: trajectoryScore,
      streak,
    })
    const decision: RLActionResponse = rlResult.data
    if (rlResult.fromFallback) {
      console.warn(`[adaptive-replan] RL agent fallback: ${rlResult.reason}`)
    }

    // ── Turn the action into a prompt directive ───────────────────────────────
    const adjustmentDirection =
      decision.action === "REDUCE"
        ? "REDUCE volume and intensity by about 15% (fewer sets, lower reps, easier exercises)"
        : decision.action === "INCREASE"
          ? "INCREASE intensity by about 15% (more sets, higher reps, add progressive overload)"
          : "keep intensity similar"

    const currentPlan = planRes.data.plan
    const planJson =
      typeof currentPlan === "string" ? currentPlan : JSON.stringify(currentPlan, null, 2)

    const injuryDirective =
      flaggedGroups.length > 0
        ? `\nINJURY RISK ALERT: elevated predicted risk for ${flaggedGroups.join(", ")}. ` +
          `Avoid exercises that load ${flaggedGroups.join(" or ")}. Include an extra rest day. ` +
          `These are predicted risk scores, not diagnosed injuries.`
        : ""

    const prompt = `You are an expert personal trainer creating an adaptive workout plan update.

USER STATS THIS WEEK:
- Workout completion rate: ${actualCompletionRate}%
- Week satisfaction rating: ${weekRating}/5
- Energy level: ${energyLevel}
- Average sleep: ${avgSleep != null ? `${avgSleep} hours/night` : "unknown"}
- Current workout streak: ${streak} day(s)
- Predicted trajectory: ${trajectory?.label ?? "unknown"}
- User notes: "${userNotes || "none"}"

USER PROFILE:
${profile
  ? `Goal: ${profile.goal ?? "general fitness"}. Weight: ${profile.weight ?? "unknown"} kg. Activity level: ${profile.activity_level ?? "moderate"}. Injuries/limitations: ${profile.injuries ?? "none"}.`
  : "No profile data available."}

ADJUSTMENT DIRECTIVE: ${adjustmentDirection}${injuryDirective}

CURRENT PLAN (JSON):
${planJson}

TASK: Modify the workout_plan section for next week based on the directive above.
- If reducing: decrease sets by 1-2, decrease reps by 2-4, swap high-impact exercises for lower-impact alternatives
- If increasing: increase sets by 1, increase reps by 2-4, add more challenging exercise variations
- Keep the same overall structure (same number of days, same day names)
- Keep diet_plan UNCHANGED
- Return ONLY a single valid JSON object in the exact same format as the current plan
- Do NOT include any explanation, markdown, or text outside the JSON`

    // ── Call Groq ─────────────────────────────────────────────────────────────
    const groq = getGroqClient()
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert fitness coach. You output ONLY valid JSON workout plans. No markdown, no explanations — only the JSON object.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
      max_tokens: 4096,
    })

    const rawContent = completion.choices[0]?.message?.content ?? ""
    if (!rawContent.trim()) {
      throw new Error("Groq returned an empty response")
    }

    const jsonStr = extractJson(rawContent)
    const newPlan = safeJsonParse(jsonStr)

    if (!newPlan || typeof newPlan !== "object") {
      throw new Error("Could not parse AI-generated plan as valid JSON")
    }

    // ── Deterministic post-processing ─────────────────────────────────────────
    // The LLM is asked to honour the directives; these steps guarantee it.
    let workoutPlan: PlanDay[] = Array.isArray(newPlan.workout_plan) ? newPlan.workout_plan : []

    workoutPlan = applyIntensityDelta(workoutPlan, decision.intensity_delta)

    const adjustment = applyInjuryAdjustments(workoutPlan, flaggedGroups)
    workoutPlan = adjustment.workoutPlan

    const mlMeta = {
      version: 1,
      generated_at: new Date().toISOString(),
      completion_rate: actualCompletionRate,
      sleep_avg: avgSleep,
      streak,
      injury: {
        risk: injury.risk,
        threshold: injury.threshold,
        flagged: flaggedGroups,
        model_version: injury.model_version,
        from_fallback: injuryResult.fromFallback,
        disclaimer: injury.disclaimer,
      },
      trajectory: trajectory
        ? {
            label: trajectory.label,
            score: trajectory.trajectory_score,
            probs: trajectory.probs,
            sessions_used: trajectory.sessions_used,
            model_version: trajectory.model_version,
            from_fallback: trajectoryFromFallback,
          }
        : null,
      rl: {
        action: decision.action,
        intensity_delta: decision.intensity_delta,
        confidence: decision.confidence,
        state: decision.state,
        model_version: decision.model_version,
        from_fallback: rlResult.fromFallback,
      },
      adjustments: {
        removed_exercises: adjustment.removedExercises,
        rest_day_added: adjustment.restDayAdded,
      },
    }

    const planToSave = {
      ...newPlan,
      workout_plan: workoutPlan,
      ml_meta: mlMeta,
    }

    // ── Save, with the audit columns when the migration has been applied ──────
    // Falls back to a plain insert so the route keeps working on databases that
    // have not run supabase/migrations/20260909_ml_audit_columns.sql yet.
    let insertError: { message: string } | null = null
    const withAudit = await supabase.from("workout_plans").insert({
      user_id: userId,
      plan: planToSave,
      injury_risk: injury.risk,
      ml_meta: mlMeta,
    })

    if (withAudit.error) {
      const plain = await supabase.from("workout_plans").insert({
        user_id: userId,
        plan: planToSave,
      })
      insertError = plain.error
      if (!plain.error) {
        console.warn(
          "[adaptive-replan] workout_plans.injury_risk / ml_meta columns missing — " +
            "risk scores stored inside plan.ml_meta only. Apply " +
            "supabase/migrations/20260909_ml_audit_columns.sql to enable the audit columns."
        )
      }
    }

    if (insertError) {
      throw new Error(`Failed to save updated plan: ${insertError.message}`)
    }

    // ── Response ──────────────────────────────────────────────────────────────
    let message: string
    if (decision.action === "REDUCE") {
      message =
        "Your plan has been adjusted to a more manageable intensity for next week. Keep going — consistency beats intensity!"
    } else if (decision.action === "INCREASE") {
      message =
        "Awesome work this week! Your plan has been leveled up for next week to keep challenging you."
    } else {
      message = "Your plan has been updated for next week."
    }

    if (flaggedGroups.length > 0) {
      message +=
        ` We also eased off ${flaggedGroups.join(" and ")} work and added a rest day` +
        " — your recent training load and recovery suggest a higher strain risk there."
    }

    return NextResponse.json({
      success: true,
      message,
      completionRate: actualCompletionRate,
      weekRating,
      adjustmentDirection,
      ml: {
        action: decision.action,
        intensityDelta: decision.intensity_delta,
        confidence: decision.confidence,
        trajectory: trajectory?.label ?? null,
        trajectoryScore,
        injuryRisk: injury.risk,
        flaggedGroups,
        removedExercises: adjustment.removedExercises,
        restDayAdded: adjustment.restDayAdded,
        streak,
        avgSleep,
        usedFallback: {
          injury: injuryResult.fromFallback,
          trajectory: sessions.length === 0 ? null : trajectoryFromFallback,
          rl: rlResult.fromFallback,
        },
      },
    })
  } catch (err: any) {
    console.error("[adaptive-replan] error:", err?.message ?? err)
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}
