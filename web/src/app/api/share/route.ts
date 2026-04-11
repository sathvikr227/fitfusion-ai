import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase env vars missing")
  return createClient(url, key)
}

// POST /api/share — generate a share token for the authenticated user
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const bearerToken = authHeader.replace("Bearer ", "")
    const supabase = getSupabase()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(bearerToken)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const shareToken = crypto.randomUUID()

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ share_token: shareToken })
      .eq("id", user.id)

    if (updateError) {
      console.error("Failed to save share token:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ token: shareToken })
  } catch (err) {
    console.error("POST /api/share error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET /api/share?token=xxx — public stats for a share token (no auth required)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const token = searchParams.get("token")

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 })
    }

    const supabase = getSupabase()

    // Look up profile by share token
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, goal")
      .eq("share_token", token)
      .maybeSingle()

    if (profileError) {
      console.error("Profile lookup error:", profileError)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const userId = profile.id

    // Derive display username: full_name > email prefix
    const username =
      profile.full_name ||
      (profile.email ? profile.email.split("@")[0] : "Fitness User")

    // Workouts this month (last 30 days count)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0]

    const { data: workoutLogs, error: workoutError } = await supabase
      .from("workout_logs")
      .select("logged_at")
      .eq("user_id", userId)
      .gte("logged_at", thirtyDaysAgoStr)

    if (workoutError) {
      console.error("Workout logs error:", workoutError)
    }

    const workoutsThisMonth = workoutLogs?.length ?? 0

    // Avg daily calories (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0]

    const { data: mealLogs, error: mealError } = await supabase
      .from("meal_logs")
      .select("calories, logged_at")
      .eq("user_id", userId)
      .gte("logged_at", sevenDaysAgoStr)

    if (mealError) {
      console.error("Meal logs error:", mealError)
    }

    let avgDailyCalories = 0
    if (mealLogs && mealLogs.length > 0) {
      const totalCalories = mealLogs.reduce(
        (sum, log) => sum + (Number(log.calories) || 0),
        0
      )
      // Group by day to get accurate daily average
      const dayMap: Record<string, number> = {}
      for (const log of mealLogs) {
        const day = log.logged_at
          ? log.logged_at.toString().split("T")[0]
          : sevenDaysAgoStr
        dayMap[day] = (dayMap[day] ?? 0) + (Number(log.calories) || 0)
      }
      const days = Object.keys(dayMap).length
      avgDailyCalories = days > 0 ? Math.round(totalCalories / days) : 0
    }

    // Streak calculation — consecutive days ending at today
    let streak = 0
    if (workoutLogs && workoutLogs.length > 0) {
      // Collect unique workout dates (YYYY-MM-DD)
      const dateSet = new Set<string>()
      for (const log of workoutLogs) {
        const day = log.logged_at
          ? log.logged_at.toString().split("T")[0]
          : null
        if (day) dateSet.add(day)
      }

      // Also fetch all workout logs to get complete history for streak
      const { data: allLogs } = await supabase
        .from("workout_logs")
        .select("logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })

      const allDateSet = new Set<string>()
      if (allLogs) {
        for (const log of allLogs) {
          const day = log.logged_at
            ? log.logged_at.toString().split("T")[0]
            : null
          if (day) allDateSet.add(day)
        }
      }

      // Count consecutive days ending at today (or yesterday)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const todayStr = today.toISOString().split("T")[0]
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split("T")[0]

      // Start from today if there's a workout today, otherwise yesterday
      let startDate: Date | null = null
      if (allDateSet.has(todayStr)) {
        startDate = today
      } else if (allDateSet.has(yesterdayStr)) {
        startDate = yesterday
      }

      if (startDate) {
        let current = new Date(startDate)
        while (true) {
          const dayStr = current.toISOString().split("T")[0]
          if (allDateSet.has(dayStr)) {
            streak++
            current.setDate(current.getDate() - 1)
          } else {
            break
          }
        }
      }
    }

    return NextResponse.json({
      username,
      streak,
      workouts_this_month: workoutsThisMonth,
      avg_daily_calories: avgDailyCalories,
      goal: profile.goal || null,
    })
  } catch (err) {
    console.error("GET /api/share error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
