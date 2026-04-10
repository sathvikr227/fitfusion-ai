import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

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

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing")
  return new OpenAI({ apiKey })
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const groq = getGroqClient()

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(token)
    if (authError || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const userId = authUser.id

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))
    const message: string = (body?.message ?? "").toString().trim()
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const today = todayStr()
    const thirtyDaysAgo = daysAgoStr(30)
    const sevenDaysAgo = daysAgoStr(7)

    // ── Fetch user data in parallel ───────────────────────────────────────────
    const [
      profileRes,
      workoutLogsRes,
      mealLogsRes,
      weightLogsRes,
      workoutPlansRes,
      injuriesRes,
      sleepLogsRes,
      assistantMsgsRes,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("name, goal, weight, height, age, gender, activity_level")
        .eq("id", userId)
        .maybeSingle(),

      supabase
        .from("workout_logs")
        .select("date, exercise_name, sets, reps, weight_kg, duration_minutes, calories_burned")
        .eq("user_id", userId)
        .gte("date", thirtyDaysAgo)
        .order("date", { ascending: false }),

      supabase
        .from("meal_logs")
        .select("date, meal_name, total_calories, protein_g, carbs_g, fat_g")
        .eq("user_id", userId)
        .gte("date", sevenDaysAgo)
        .order("date", { ascending: false }),

      supabase
        .from("weight_logs")
        .select("date, weight")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(14),

      supabase
        .from("workout_plans")
        .select("plan, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1),

      supabase
        .from("injuries")
        .select("name, body_part, severity, status")
        .eq("user_id", userId)
        .neq("status", "healed"),

      supabase
        .from("sleep_logs")
        .select("date, hours, quality")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(7),

      supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ])

    const profile = (profileRes.data ?? {}) as Record<string, any>
    const workoutLogs = workoutLogsRes.data ?? []
    const mealLogs = mealLogsRes.data ?? []
    const weightLogs = weightLogsRes.data ?? []
    const workoutPlan = workoutPlansRes.data?.[0] ?? null
    const injuries = injuriesRes.data ?? []
    const sleepLogs = sleepLogsRes.data ?? []
    const pastMessages = assistantMsgsRes.data ?? []

    // ── Compute stats ─────────────────────────────────────────────────────────
    const workoutCount = workoutLogs.length

    // Current streak: consecutive days ending today or yesterday that have a workout
    const workoutDatesSet = new Set(workoutLogs.map((w: any) => w.date))
    let streak = 0
    {
      const checkDate = new Date()
      // start from today; if today has no workout, check if yesterday starts the streak
      let i = 0
      if (!workoutDatesSet.has(today)) {
        // start from yesterday
        checkDate.setDate(checkDate.getDate() - 1)
        i = 1
      }
      while (true) {
        const d = checkDate.toISOString().split("T")[0]
        if (workoutDatesSet.has(d)) {
          streak++
          checkDate.setDate(checkDate.getDate() - 1)
        } else {
          break
        }
        if (i++ > 365) break
      }
    }

    // Avg daily calories over last 7 days
    let avgDailyCalories: number | null = null
    if (mealLogs.length > 0) {
      const calByDay: Record<string, number> = {}
      for (const m of mealLogs) {
        if (!m.date) continue
        calByDay[m.date] = (calByDay[m.date] ?? 0) + (Number(m.total_calories) || 0)
      }
      const vals = Object.values(calByDay)
      if (vals.length > 0) {
        avgDailyCalories = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      }
    }

    // Weight change (newest − oldest from the 14-row window)
    let weightChange: number | null = null
    if (weightLogs.length >= 2) {
      const newest = Number(weightLogs[0].weight)
      const oldest = Number(weightLogs[weightLogs.length - 1].weight)
      if (Number.isFinite(newest) && Number.isFinite(oldest)) {
        weightChange = Math.round((newest - oldest) * 10) / 10
      }
    }

    // Avg sleep
    let avgSleep: number | null = null
    if (sleepLogs.length > 0) {
      const total = sleepLogs.reduce((s: number, l: any) => s + (Number(l.hours) || 0), 0)
      avgSleep = Math.round((total / sleepLogs.length) * 10) / 10
    }

    // ── RAG: embed message + retrieve knowledge ───────────────────────────────
    let ragContext = ""
    try {
      const openai = getOpenAIClient()
      const embedRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: message,
      })
      const queryEmbedding = embedRes.data[0].embedding

      const { data: ragRows } = await supabase.rpc("match_fitness_knowledge", {
        query_embedding: queryEmbedding,
        match_threshold: 0.4,
        match_count: 4,
      })

      if (ragRows && ragRows.length > 0) {
        ragContext = ragRows
          .map((r: any, i: number) => `[Knowledge ${i + 1}] ${r.content}`)
          .join("\n\n")
      }
    } catch (ragErr) {
      // RAG is optional — continue without it
      console.warn("RAG step failed (non-fatal):", ragErr)
    }

    // ── Build system prompt ───────────────────────────────────────────────────
    const profileLines = [
      profile.name ? `Name: ${profile.name}` : null,
      profile.goal ? `Goal: ${profile.goal}` : null,
      profile.age ? `Age: ${profile.age}` : null,
      profile.gender ? `Gender: ${profile.gender}` : null,
      profile.weight ? `Weight: ${profile.weight} kg` : null,
      profile.height ? `Height: ${profile.height} cm` : null,
      profile.activity_level ? `Activity Level: ${profile.activity_level}` : null,
    ]
      .filter(Boolean)
      .join("\n")

    const workoutSummary =
      workoutLogs.length > 0
        ? workoutLogs
            .slice(0, 10)
            .map(
              (w: any) =>
                `  • ${w.date}: ${w.exercise_name ?? "Workout"}` +
                (w.sets ? ` ${w.sets}×${w.reps}` : "") +
                (w.weight_kg ? ` @${w.weight_kg}kg` : "") +
                (w.calories_burned ? ` (${w.calories_burned} kcal)` : "")
            )
            .join("\n")
        : "  No workouts logged in last 30 days."

    const mealSummary =
      mealLogs.length > 0
        ? mealLogs
            .slice(0, 7)
            .map(
              (m: any) =>
                `  • ${m.date}: ${m.meal_name ?? "Meal"} — ${m.total_calories ?? 0} kcal` +
                (m.protein_g ? ` | P:${m.protein_g}g` : "") +
                (m.carbs_g ? ` C:${m.carbs_g}g` : "") +
                (m.fat_g ? ` F:${m.fat_g}g` : "")
            )
            .join("\n")
        : "  No meal logs in last 7 days."

    const weightSummary =
      weightLogs.length > 0
        ? weightLogs
            .slice(0, 5)
            .map((w: any) => `  • ${w.date}: ${w.weight} kg`)
            .join("\n")
        : "  No weight logs."

    const injurySummary =
      injuries.length > 0
        ? injuries
            .map(
              (inj: any) =>
                `  • ${inj.name} (${inj.body_part}) — severity: ${inj.severity}, status: ${inj.status}`
            )
            .join("\n")
        : "  None"

    const sleepSummary =
      sleepLogs.length > 0
        ? sleepLogs
            .map(
              (sl: any) =>
                `  • ${sl.date}: ${sl.hours}h` + (sl.quality ? ` (quality: ${sl.quality})` : "")
            )
            .join("\n")
        : "  No sleep logs."

    const planSummary = workoutPlan
      ? `Latest plan created ${workoutPlan.created_at?.split("T")[0] ?? "recently"}.`
      : "No workout plan generated yet."

    const systemPrompt = `You are a highly personalized AI fitness coach for FitFusion. You have full access to the user's health and fitness data. Be warm, motivating, specific, and data-driven. Give concise but actionable advice. Reference the user's actual numbers when relevant. Never make up data.

═══ USER PROFILE ═══
${profileLines || "  (no profile data yet)"}

═══ FITNESS STATS (computed) ═══
• Workouts in last 30 days: ${workoutCount}
• Current streak: ${streak} day${streak !== 1 ? "s" : ""}
• Avg daily calories (7 days): ${avgDailyCalories !== null ? `${avgDailyCalories} kcal` : "N/A"}
• Weight change (last 14 logs): ${weightChange !== null ? `${weightChange > 0 ? "+" : ""}${weightChange} kg` : "N/A"}
• Avg sleep (last 7 logs): ${avgSleep !== null ? `${avgSleep}h` : "N/A"}

═══ WORKOUT PLAN ═══
${planSummary}

═══ RECENT WORKOUT LOGS (last 30 days, up to 10 shown) ═══
${workoutSummary}

═══ RECENT MEAL LOGS (last 7 days, up to 7 shown) ═══
${mealSummary}

═══ WEIGHT LOGS (last 14, up to 5 shown) ═══
${weightSummary}

═══ ACTIVE INJURIES ═══
${injurySummary}

═══ SLEEP LOGS (last 7) ═══
${sleepSummary}
${
  ragContext
    ? `
═══ RELEVANT FITNESS KNOWLEDGE (RAG) ═══
${ragContext}
`
    : ""
}
Answer in 3–5 sentences unless the question needs more detail. Be specific to this user's actual data.`

    // ── Build conversation history ─────────────────────────────────────────────
    // pastMessages is newest-first; reverse to chronological, take last 8
    const history = [...pastMessages]
      .reverse()
      .slice(-8)
      .map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }))

    // ── Call Groq ─────────────────────────────────────────────────────────────
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message },
      ],
    })

    const assistantReply =
      completion.choices[0]?.message?.content?.trim() ?? "Sorry, I couldn't generate a response."

    // ── Persist both messages ─────────────────────────────────────────────────
    await supabase.from("assistant_messages").insert([
      { user_id: userId, role: "user", content: message },
      { user_id: userId, role: "assistant", content: assistantReply },
    ])

    return NextResponse.json({ response: assistantReply })
  } catch (error: any) {
    console.error("ASSISTANT API ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate response" },
      { status: 500 }
    )
  }
}
