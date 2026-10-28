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
  limitProgression,
  painGroupsFromText,
  type PlanDay,
} from "../../../lib/ml-service/injury-rules"
import { injuryListFromProfile } from "../../../lib/ml-service/profile"
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
    // Pain the user told us about. Check-in notes are this week's pain; the
    // profile and injury tracker hold ongoing injuries. Both count for the RL
    // state and both strip exercises that load the area.
    const notePainGroups = painGroupsFromText(userNotes)
    const ongoingPainGroups = painGroupsFromText("", injuryListFromProfile(profile, activeInjuries))
    const reportedPainGroups = Array.from(new Set([...notePainGroups, ...ongoingPainGroups]))

    // Overall risk comes from the training-load model; this week's pain joins
    // the recorded injuries so the region rules can flag it.
    const injuryResult = await predictInjury({
      user_id: userId,
      ...history.injuryFeatures,
      prior_injuries: [...history.injuryFeatures.prior_injuries, ...notePainGroups],
    })
    const injury: InjuryResponse = injuryResult.data
    if (injuryResult.fromFallback) {
      console.warn(`[adaptive-replan] injury model fallback: ${injuryResult.reason}`)
    }

    const flaggedGroups = injury.flagged ?? []

    const injuryFlag =
      flaggedGroups.length > 0 ||
      injury.overall_elevated === true ||
      activeInjuries.length > 0 ||
      reportedPainGroups.length > 0
        ? 1
        : 0

    // ══ STEP 2 — Transformer trajectory ═══════════════════════════════════════
    let trajectory: TrajectoryResponse | null = null
    let trajectoryFromFallback = false
    if (history.trajectorySessions.length > 0) {
      const trajectoryResult = await predictTrajectory({ user_id: userId, sessions: history.trajectorySessions })
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
    let decision: RLActionResponse = rlResult.data
    if (rlResult.fromFallback) {
      console.warn(`[adaptive-replan] RL agent fallback: ${rlResult.reason}`)
    }

    // Never add volume in the week the user reports pain.
    const heldForPain = notePainGroups.length > 0 && decision.action === "INCREASE"
    if (heldForPain) {
      decision = { ...decision, action: "MAINTAIN", intensity_delta: 0 }
    }

    // ── Turn the action into a prompt directive ───────────────────────────────
    const adjustmentDirection =
      decision.action === "REDUCE"
        ? "REDUCE volume and intensity by about 15% (fewer sets, lower reps, easier exercises)"
        : decision.action === "INCREASE"
          ? "INCREASE intensity modestly (harder exercise variations; the app adds the extra sets and reps)"
          : "keep intensity similar"

    const currentPlan = planRes.data.plan
    const planJson =
      typeof currentPlan === "string" ? currentPlan : JSON.stringify(currentPlan, null, 2)

    const injuryDirective =
      flaggedGroups.length > 0
        ? `\nINJURY RISK ALERT: recent training load is high and ${flaggedGroups.join(", ")} ` +
          `${flaggedGroups.length === 1 ? "is a" : "are"} recorded injury area${flaggedGroups.length === 1 ? "" : "s"}. ` +
          `Avoid exercises that load ${flaggedGroups.join(" or ")}. Include an extra rest day. ` +
          `This is a risk indicator, not a diagnosed injury.`
        : injury.overall_elevated
          ? `\nTRAINING LOAD: the last 7 days are in the high-risk range for injury. Prefer ` +
            `recovery-friendly sessions. This is a risk indicator, not a diagnosed injury.`
          : ""

    const painDirective =
      reportedPainGroups.length > 0
        ? `\nREPORTED PAIN: ${reportedPainGroups.join(", ")}. Replace every exercise that loads ` +
          `${reportedPainGroups.join(" or ")} with a pain-free alternative for the same day. ` +
          `Do not add volume for that area.`
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

ADJUSTMENT DIRECTIVE: ${adjustmentDirection}${injuryDirective}${painDirective}

CURRENT PLAN (JSON):
${planJson}

TASK: Modify the workout_plan section for next week based on the directive above.
- Keep each exercise's sets and reps as they are; the app applies the volume change itself
- If reducing: swap high-impact exercises for lower-impact alternatives
- If increasing: you may swap in more challenging variations of the same movement
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

    const previousWorkoutPlan: PlanDay[] = Array.isArray(currentPlanParsed?.workout_plan)
      ? currentPlanParsed.workout_plan
      : []

    workoutPlan = applyIntensityDelta(workoutPlan, decision.intensity_delta)
    // Backstop for the LLM ignoring "keep sets and reps": at most +1 set and
    // +2 reps per exercise, and +10% sets across the week.
    workoutPlan = limitProgression(previousWorkoutPlan, workoutPlan)

    const adjustment = applyInjuryAdjustments(workoutPlan, flaggedGroups)
    workoutPlan = adjustment.workoutPlan

    // Reported pain strips the exercises that load it, without a rest day: an
    // ongoing injury would otherwise cost one more training day every week.
    const painOnlyGroups = reportedPainGroups.filter((g) => !flaggedGroups.includes(g))
    const painAdjustment = applyInjuryAdjustments(workoutPlan, painOnlyGroups, { addRestDay: false })
    workoutPlan = painAdjustment.workoutPlan

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
        basis: injury.basis,
        overall_risk: injury.overall_risk,
        relative_risk: injury.relative_risk,
        overall_elevated: injury.overall_elevated,
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
            reason: trajectory.reason ?? null,
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
      reported_pain: {
        from_notes: notePainGroups,
        ongoing: ongoingPainGroups,
        held_increase: heldForPain,
      },
      adjustments: {
        removed_exercises: [...adjustment.removedExercises, ...painAdjustment.removedExercises],
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
    } else if (heldForPain) {
      message =
        `Your volume is held steady this week because you mentioned ${notePainGroups.join(" and ")} pain. ` +
        "Exercises that load it have been swapped out. If it persists, rest it or see a professional."
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
        removedExercises: [...adjustment.removedExercises, ...painAdjustment.removedExercises],
        reportedPainGroups,
        heldForPain,
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
