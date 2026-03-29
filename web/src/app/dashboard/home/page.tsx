"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"

type ProgressLog = {
  weight: number | null
  completed: boolean | null
  calories_burned?: number | null
  calories_consumed?: number | null
  log_type?: string | null
  created_at: string
}

export default function HomeDashboard() {
  const router = useRouter()

  const [username, setUsername] = useState("User")
  const [streak, setStreak] = useState(0)
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  const [recentLogs, setRecentLogs] = useState<ProgressLog[]>([])
  const [totalCaloriesBurned, setTotalCaloriesBurned] = useState(0)
  const [totalCaloriesConsumed, setTotalCaloriesConsumed] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      setUsername(user.email?.split("@")[0] || "User")

      const { data } = await supabase
        .from("progress_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      if (data) {
        setRecentLogs(data.slice(0, 5))

        // latest weight
        const latest = data.find((d) => d.weight !== null)
        setLatestWeight(latest?.weight || null)

        // ✅ REAL STREAK (last consecutive completed days)
        let streakCount = 0
        for (let i = 0; i < data.length; i++) {
          if (data[i].completed) streakCount++
          else break
        }
        setStreak(streakCount)

        // ✅ CALORIE TRACKING
        const burned = data.reduce(
          (sum, d) => sum + (d.calories_burned || 0),
          0
        )

        const consumed = data.reduce(
          (sum, d) => sum + (d.calories_consumed || 0),
          0
        )

        setTotalCaloriesBurned(burned)
        setTotalCaloriesConsumed(consumed)
      }

      setLoading(false)
    }

    load()
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-black">
        Loading...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-black p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* HEADER */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-semibold">
              Welcome, {username} 👋
            </h1>
            <p className="text-slate-500 mt-1">
              Stay consistent. You're doing great.
            </p>
          </div>

          <div className="bg-white px-5 py-3 rounded-2xl shadow border">
            🔥 {streak} day streak
          </div>
        </div>

        {/* QUICK STATS */}
        <div className="grid md:grid-cols-3 gap-6">

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Latest Weight</p>
            <h2 className="text-3xl font-bold mt-2">
              {latestWeight ? `${latestWeight} kg` : "--"}
            </h2>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Calories Burned</p>
            <h2 className="text-3xl font-bold mt-2 text-purple-600">
              {totalCaloriesBurned} kcal
            </h2>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Calories Consumed</p>
            <h2 className="text-3xl font-bold mt-2 text-cyan-600">
              {totalCaloriesConsumed} kcal
            </h2>
          </div>

        </div>

        {/* QUICK ACTIONS */}
        <div className="grid md:grid-cols-3 gap-6">

          <button
            onClick={() => router.push("/dashboard/progress")}
            className="bg-white p-6 rounded-3xl shadow border hover:shadow-md transition text-left"
          >
            <h3 className="text-lg font-semibold">Log Workout / Diet</h3>
            <p className="text-sm text-slate-500 mt-1">
              Track workouts, diet & weight
            </p>
          </button>

          <button
            onClick={() => router.push("/dashboard/analytics")}
            className="bg-white p-6 rounded-3xl shadow border hover:shadow-md transition text-left"
          >
            <h3 className="text-lg font-semibold">Analytics</h3>
            <p className="text-sm text-slate-500 mt-1">
              View progress insights
            </p>
          </button>

          <button
            onClick={() => router.push("/dashboard/plan")}
            className="bg-white p-6 rounded-3xl shadow border hover:shadow-md transition text-left"
          >
            <h3 className="text-lg font-semibold">Your Plan</h3>
            <p className="text-sm text-slate-500 mt-1">
              View & edit AI plan
            </p>
          </button>

        </div>

        {/* RECENT ACTIVITY */}
        <div className="bg-white p-6 rounded-3xl shadow border">
          <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>

          {recentLogs.length === 0 ? (
            <p className="text-slate-500">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {recentLogs.map((log, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <span>
                    {new Date(log.created_at).toLocaleDateString()}
                  </span>

                  <span className="text-sm">
                    {log.weight ? `${log.weight} kg` : "--"}
                  </span>

                  <span>
                    {log.completed ? "✅" : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}