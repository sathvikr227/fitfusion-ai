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

function periodStart(period: string): string | null {
  const now = new Date()
  if (period === "monthly") {
    const start = new Date(now)
    start.setDate(start.getDate() - 30)
    return start.toISOString().split("T")[0]
  }
  if (period === "lifetime") {
    return null // no lower bound
  }
  // default: weekly (7 days)
  const start = new Date(now)
  start.setDate(start.getDate() - 7)
  return start.toISOString().split("T")[0]
}

function periodLabel(period: string): string {
  if (period === "monthly") return "monthly (last 30 days)"
  if (period === "lifetime") return "all-time / lifetime"
  return "weekly (last 7 days)"
}

export async function POST(req: Request) {
  try {
    const groq = getGroqClient()
    const supabase = getSupabase()

    const body = await req.json().catch(() => ({}))
    const userId = body?.userId
    const period: string = ["weekly", "monthly", "lifetime"].includes(body?.period) ? body.period : "weekly"

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser || authUser.id !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const since = periodStart(period)

    const workoutQuery = supabase
      .from("workout_logs")
      .select("date, total_calories, is_assigned")
      .eq("user_id", userId)
      .order("date", { ascending: true })
    const weightQuery = supabase
      .from("weight_logs")
      .select("weight, date")
      .eq("user_id", userId)
      .order("date", { ascending: true })
    const mealQuery = supabase
      .from("meal_logs")
      .select("total_calories, date")
      .eq("user_id", userId)
      .order("date", { ascending: true })

    const [workoutsRes, weightsRes, mealsRes] = await Promise.all([
      since ? workoutQuery.gte("date", since) : workoutQuery,
      since ? weightQuery.gte("date", since) : weightQuery,
      since ? mealQuery.gte("date", since) : mealQuery,
    ])
    const workoutLogs = workoutsRes.data
    const weightLogs = weightsRes.data
    const mealLogs = mealsRes.data

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

    const totalCaloriesIn = mealLogs?.reduce((s, m) => s + ((m as any).total_calories || 0), 0) ?? 0
    const mealDays = mealLogs?.length
      ? new Set(mealLogs.map((m) => (m as any).date?.split("T")[0])).size
      : 0
    const avgDailyCaloriesIn = mealDays > 0 ? Math.round(totalCaloriesIn / mealDays) : null

    const weightEntries = weightLogs ?? []
    const startWeight = weightEntries[0]?.weight ?? null
    const endWeight = weightEntries[weightEntries.length - 1]?.weight ?? null
    const weightChange =
      startWeight != null && endWeight != null
        ? parseFloat((endWeight - startWeight).toFixed(1))
        : null

    const periodDays = period === "lifetime"
      ? Math.max(1, mealDays || 1)
      : period === "monthly" ? 30 : 7
    const wordLimit = period === "lifetime" ? 500 : period === "monthly" ? 350 : 250

    const prompt = `
You are an AI fitness coach writing a ${periodLabel(period)} performance report for a user.

Be encouraging, data-driven, and give ${period === "lifetime" ? "4-5" : "2-3"} actionable recommendations for the next period.
Keep the report under ${wordLimit} words. Use plain text — no markdown, no bullet symbols, no asterisks.
${period === "lifetime" ? "This is a lifetime / detailed summary — discuss long-term trends and consistency over the entire period." : ""}

User goal: ${profile?.goal ?? "Not specified"}
Activity level: ${profile?.activity_level ?? "Not specified"}

Period data (${periodLabel(period)}):
- Workouts completed: ${workoutCount}
- Total calories burned: ${totalCaloriesBurned} kcal
- Average daily calories consumed: ${avgDailyCaloriesIn != null ? `${avgDailyCaloriesIn} kcal` : "N/A"}
- Calorie balance (in - out): ${avgDailyCaloriesIn != null ? `${avgDailyCaloriesIn - Math.round(totalCaloriesBurned / periodDays)} kcal/day net` : "N/A"}
- Weight at start of period: ${startWeight ?? "N/A"} kg
- Weight at end of period: ${endWeight ?? "N/A"} kg
- Weight change: ${weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange} kg` : "N/A"}
- Injuries/limitations: ${profile?.injuries ?? "None"}

Write the ${period === "lifetime" ? "detailed lifetime" : period} report now.
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
      period,
      stats: {
        workoutCount,
        totalCaloriesBurned,
        startWeight,
        endWeight,
        weightChange,
        avgDailyCaloriesIn,
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
