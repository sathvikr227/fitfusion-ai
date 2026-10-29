import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"
import { GROQ_MODEL } from "../../../lib/groq-model"
import { calculateWorkoutCalories, estimateExerciseDurationMinutes, type LoggedExercise } from "../../../lib/calories"
import { applyInjuryAdjustments, painGroupsFromText, type PlanDay } from "../../../lib/ml-service/injury-rules"
import { injuryListFromProfile } from "../../../lib/ml-service/profile"
import { isRestDay } from "../../../lib/plan-structure"

/**
 * The LLM edits exercises but copies the old burn figures, so "Modify with AI"
 * left the plan's calories stale. Recompute each day from its exercises (MET x
 * body weight x estimated minutes), and strip anything that loads an area the
 * profile lists as injured: the edit request must not bypass that constraint.
 */
type ChatPlan = {
  workout_plan?: PlanDay[]
  diet_plan?: { meals?: Array<{ total_calories?: unknown }>; [key: string]: unknown }
  [key: string]: unknown
}

function enforcePlanRules(plan: ChatPlan, profile: { weight?: unknown; injuries?: string | null } | null) {
  if (!plan || !Array.isArray(plan.workout_plan)) return plan
  const bodyWeight = Number(profile?.weight)
  const weightKg = bodyWeight > 0 ? bodyWeight : 70
  const groups = painGroupsFromText("", injuryListFromProfile(profile ?? {}))
  const stripped = applyInjuryAdjustments(plan.workout_plan, groups, { addRestDay: false }).workoutPlan
  const workout_plan = stripped.map((day) => {
    const exercises = Array.isArray(day?.exercises) ? day.exercises : []
    const burn = isRestDay(day)
      ? 0
      : exercises.reduce(
          (sum, ex) =>
            sum + calculateWorkoutCalories(weightKg, estimateExerciseDurationMinutes(ex as LoggedExercise), String(ex?.name ?? "")),
          0
        )
    return { ...day, estimated_calories_burned: Math.round(burn) }
  })

  const meals = Array.isArray(plan?.diet_plan?.meals) ? plan.diet_plan.meals : null
  const diet_plan = meals
    ? {
        ...plan.diet_plan,
        daily_total_calories: meals.reduce((sum, m) => sum + (Number(m?.total_calories) || 0), 0),
      }
    : plan.diet_plan
  return { ...plan, workout_plan, diet_plan }
}

export const runtime = "nodejs"

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase environment variables are missing")
  return createClient(url, key)
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

  const jsonText = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    return JSON.parse(jsonText)
  } catch {
    throw new Error("AI response JSON could not be parsed")
  }
}

export async function POST(req: Request) {
  try {
    const groq = getGroqClient()
    const supabase = getSupabase()

    const { message, currentPlan, sessionId } = await req.json()

    if (!message || !currentPlan) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.replace("Bearer ", "")
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const validSessionId = sessionId || null

    let history: Array<{ role: "user" | "assistant" | "system"; content: string }> =
      []
    let userId: string | null = null

    if (validSessionId) {
      const { data: session, error: sessionError } = await supabase
        .from("chat_sessions")
        .select("id, user_id")
        .eq("id", validSessionId)
        .maybeSingle()

      // A session id alone must not expose another user's chat history.
      if (sessionError || !session || session.user_id !== authUser.id) {
        return NextResponse.json(
          { error: "Chat session not found" },
          { status: 404 }
        )
      }

      userId = session.user_id

      const { data: historyData, error: historyError } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", validSessionId)
        .order("created_at", { ascending: true })

      if (historyError) {
        console.warn("Chat history fetch warning:", historyError)
      }

      history = (historyData || []).map((msg: any) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content as string,
      }))
    }

    const messages: Array<{
      role: "user" | "assistant" | "system"
      content: string
    }> = [
      {
        role: "system",
        content: `
You are a professional AI fitness coach.
You must modify the existing plan based on the user's request.
Return STRICT JSON ONLY, no markdown, no explanation, no extra text.
Use exactly this structure:
{
  "diet_plan": {
    "meals": [
      {
        "name": "Breakfast",
        "items": [
          { "food": "Eggs", "calories": 200, "protein": 20 }
        ],
        "total_calories": 300
      }
    ],
    "daily_total_calories": 1800
  },
  "workout_plan": [
    {
      "day": "Monday",
      "type": "Chest",
      "exercises": [
        { "name": "Bench Press", "sets": 3, "reps": 10 }
      ],
      "estimated_calories_burned": 350
    }
  ]
}
        `.trim(),
      },
      {
        role: "user",
        content: `CURRENT PLAN:\n${JSON.stringify(currentPlan)}`,
      },
      ...history,
      {
        role: "user",
        content: message,
      },
    ]

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: messages as any,
      temperature: 0.5,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    })

    const raw = completion.choices[0]?.message?.content?.trim()

    if (!raw) {
      throw new Error("No response from AI")
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("weight, injuries")
      .eq("id", authUser.id)
      .maybeSingle()
    const plan = enforcePlanRules(extractJson(raw), profile)

    // Note: plan persistence to workout_plans is handled by the client (dashboard)
    // to avoid double writes. We only persist the chat messages here.

    if (validSessionId) {
      const { error: saveChatError } = await supabase
        .from("chat_messages")
        .insert([
          {
            session_id: validSessionId,
            role: "user",
            content: message,
          },
          {
            session_id: validSessionId,
            role: "assistant",
            content: JSON.stringify(plan),
          },
        ])

      if (saveChatError) {
        console.warn("Chat save warning:", saveChatError)
      }
    }

    return NextResponse.json({ plan, sessionId: validSessionId })
  } catch (error: any) {
    console.error("CHAT ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process chat" },
      { status: 500 }
    )
  }
}