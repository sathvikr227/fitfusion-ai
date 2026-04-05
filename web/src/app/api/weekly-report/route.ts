import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

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

function last7Days() {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - 7)
  return start.toISOString().split("T")[0]
}

export async function POST(req: Request) {
  try {
    const groq = getGroqClient()
    const supabase = getSupabase()

    const body = await req.json().catch(() => ({}))
    const userId = body?.userId

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const since = last7Days()

    // Fetch last 7 days of workout logs
    const { data: workoutLogs } = await supabase
      .from("workout_logs")
      .select("date, total_calories, is_assigned")
      .eq("user_id", userId)
      .gte("date", since)
      .order("date", { ascending: true })

    // Fetch last 7 days of weight logs
    const { data: weightLogs } = await supabase
      .from("weight_logs")
      .select("weight, date")
      .eq("user_id", userId)
      .gte("date", since)
      .order("date", { ascending: true })

    // Fetch last 7 days of meal logs
    const { data: mealLogs } = await supabase
      .from("meal_logs")
      .select("calories, logged_at")
      .eq("user_id", userId)
      .gte("logged_at", since)
      .order("logged_at", { ascending: true })

    // profiles.id IS the auth user UUID — no user_id column on profiles
    const { data: profileData } = await supabase
      .from("profiles")
      .select("goal, weight, activity_level, injuries")
      .eq("id", userId)
      .maybeSingle()

    const profile = profileData as Record<string, unknown> | null

    const workoutCount = workoutLogs?.length ?? 0
    const totalCaloriesBurned = workoutLogs?.reduce(
      (s, d) => s + (d.total_calories || 0),
      0
    ) ?? 0

    const totalCaloriesIn = mealLogs?.reduce((s, m) => s + (m.calories || 0), 0) ?? 0
    const mealDays = mealLogs?.length
      ? new Set(mealLogs.map((m) => m.logged_at?.split("T")[0])).size
      : 0
    const avgDailyCaloriesIn = mealDays > 0 ? Math.round(totalCaloriesIn / mealDays) : null

    const weightEntries = weightLogs ?? []
    const startWeight = weightEntries[0]?.weight ?? null
    const endWeight = weightEntries[weightEntries.length - 1]?.weight ?? null
    const weightChange =
      startWeight != null && endWeight != null
        ? parseFloat((endWeight - startWeight).toFixed(1))
        : null

    const prompt = `
You are an AI fitness coach writing a weekly performance report for a user.

Be encouraging, data-driven, and give 2-3 actionable recommendations for next week.
Keep the report under 250 words. Use plain text — no markdown, no bullet symbols, no asterisks.

User goal: ${profile?.goal ?? "Not specified"}
Activity level: ${profile?.activity_level ?? "Not specified"}

This week's data:
- Workouts completed: ${workoutCount}
- Total calories burned: ${totalCaloriesBurned} kcal
- Average daily calories consumed: ${avgDailyCaloriesIn != null ? `${avgDailyCaloriesIn} kcal` : "N/A"}
- Calorie balance (in - out): ${avgDailyCaloriesIn != null ? `${avgDailyCaloriesIn - Math.round(totalCaloriesBurned / 7)} kcal/day net` : "N/A"}
- Weight at start of week: ${startWeight ?? "N/A"} kg
- Weight at end of week: ${endWeight ?? "N/A"} kg
- Weight change: ${weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange} kg` : "N/A"}
- Injuries/limitations: ${profile?.injuries ?? "None"}

Write the weekly report now.
`.trim()

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    })

    const report = completion.choices[0]?.message?.content?.trim()

    if (!report) {
      throw new Error("AI did not return a report")
    }

    return NextResponse.json({
      report,
      stats: {
        workoutCount,
        totalCaloriesBurned,
        startWeight,
        endWeight,
        weightChange,
        periodStart: since,
        periodEnd: new Date().toISOString().split("T")[0],
      },
    })
  } catch (error: any) {
    console.error("WEEKLY REPORT ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate weekly report" },
      { status: 500 }
    )
  }
}
