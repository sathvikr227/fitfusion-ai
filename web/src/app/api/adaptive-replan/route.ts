import { NextRequest, NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

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

function sevenDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split("T")[0]
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

    const since = sevenDaysAgo()

    // ── Fetch data in parallel ────────────────────────────────────────────────
    const [planRes, executionRes, profileRes, sleepRes] = await Promise.all([
      supabase
        .from("workout_plans")
        .select("plan, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from("workout_execution")
        .select("plan_date, exercise_name, completed")
        .eq("user_id", userId)
        .gte("plan_date", since),

      supabase
        .from("profiles")
        .select("goal, weight, activity_level, injuries")
        .eq("user_id", userId)
        .maybeSingle(),

      supabase
        .from("sleep_logs")
        .select("duration_hours, date")
        .eq("user_id", userId)
        .gte("date", since),
    ])

    if (!planRes.data?.plan) {
      return NextResponse.json(
        { error: "No existing workout plan found. Generate a plan first." },
        { status: 400 }
      )
    }

    // ── Compute actual completion rate from execution data ────────────────────
    const executionRows = executionRes.data ?? []
    let actualCompletionRate = clientCompletionRate ?? 0

    if (executionRows.length > 0) {
      const totalExercises = executionRows.length
      const completedExercises = executionRows.filter((r) => r.completed).length
      actualCompletionRate = Math.round((completedExercises / totalExercises) * 100)
    }

    // ── Compute avg sleep ─────────────────────────────────────────────────────
    const sleepRows = sleepRes.data ?? []
    const avgSleep =
      sleepRows.length > 0
        ? Math.round(
            (sleepRows.reduce((s, r) => s + (r.duration_hours ?? 0), 0) / sleepRows.length) * 10
          ) / 10
        : null

    // ── Build context strings ─────────────────────────────────────────────────
    const profile = profileRes.data
    const profileContext = profile
      ? `Goal: ${profile.goal ?? "general fitness"}. Weight: ${profile.weight ?? "unknown"} kg. Activity level: ${profile.activity_level ?? "moderate"}. Injuries/limitations: ${profile.injuries ?? "none"}.`
      : "No profile data available."

    const currentPlan = planRes.data.plan
    const planJson =
      typeof currentPlan === "string"
        ? currentPlan
        : JSON.stringify(currentPlan, null, 2)

    // Determine adjustment direction
    let adjustmentDirection = "keep intensity similar"
    if (actualCompletionRate < 60 || weekRating <= 2) {
      adjustmentDirection =
        "REDUCE volume and intensity (fewer sets, lower reps, easier exercises) — user is struggling"
    } else if (actualCompletionRate > 85 && weekRating >= 4) {
      adjustmentDirection =
        "INCREASE intensity (more sets, higher reps, add progressive overload) — user is ready for more"
    }

    const prompt = `You are an expert personal trainer creating an adaptive workout plan update.

USER STATS THIS WEEK:
- Workout completion rate: ${actualCompletionRate}%
- Week satisfaction rating: ${weekRating}/5
- Energy level: ${energyLevel}
- Average sleep: ${avgSleep != null ? `${avgSleep} hours/night` : "unknown"}
- User notes: "${userNotes || "none"}"

USER PROFILE:
${profileContext}

ADJUSTMENT DIRECTIVE: ${adjustmentDirection}

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
      model: "llama-3.3-70b-versatile",
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

    // ── Save new plan to workout_plans ────────────────────────────────────────
    const { error: insertError } = await supabase.from("workout_plans").insert({
      user_id: userId,
      plan: newPlan,
    })

    if (insertError) {
      throw new Error(`Failed to save updated plan: ${insertError.message}`)
    }

    // ── Build response message ────────────────────────────────────────────────
    let message = "Your plan has been updated for next week."
    if (actualCompletionRate < 60 || weekRating <= 2) {
      message =
        "Your plan has been adjusted to a more manageable intensity for next week. Keep going — consistency beats intensity!"
    } else if (actualCompletionRate > 85 && weekRating >= 4) {
      message =
        "Awesome work this week! Your plan has been leveled up for next week to keep challenging you."
    }

    return NextResponse.json({
      success: true,
      message,
      completionRate: actualCompletionRate,
      weekRating,
      adjustmentDirection,
    })
  } catch (err: any) {
    console.error("[adaptive-replan] error:", err?.message ?? err)
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}
