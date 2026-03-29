"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts"

type Progress = {
  weight: number | null
  completed: boolean | null
  created_at: string
}

export default function AnalyticsPage() {
  const router = useRouter()

  const [data, setData] = useState<Progress[]>([])
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

      const { data, error } = await supabase
        .from("progress_logs")
        .select("weight, completed, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })

      if (error) {
        console.error(error)
      }

      if (data) setData(data)

      setLoading(false)
    }

    load()
  }, [router])

  // 📊 Weight Data
  const weightData = data
    .filter((d) => d.weight !== null)
    .map((d) => ({
      date: new Date(d.created_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
      weight: d.weight,
    }))

  // 📊 Workout Data (group by day)
  const workoutMap: Record<string, number> = {}

  data.forEach((d) => {
    if (!d.completed) return

    const day = new Date(d.created_at).toLocaleDateString("en-IN", {
      weekday: "short",
    })

    workoutMap[day] = (workoutMap[day] || 0) + 1
  })

  const workoutData = Object.keys(workoutMap).map((day) => ({
    day,
    workouts: workoutMap[day],
  }))

  // 📈 Insights
  const latestWeight = weightData.at(-1)?.weight || 0
  const startWeight = weightData[0]?.weight || 0
  const change =
    weightData.length >= 2 ? (latestWeight - startWeight).toFixed(1) : "--"

  const totalWorkouts = data.filter((d) => d.completed).length
  const totalEntries = data.length

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-black">
        Loading analytics...
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 md:p-10 bg-gradient-to-br from-white via-slate-50 to-blue-50 text-black">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* HEADER */}
        <div>
          <h1 className="text-4xl font-semibold">Analytics Dashboard</h1>
          <p className="text-slate-500 mt-2">
            Your fitness insights powered by data.
          </p>
        </div>

        {/* STATS */}
        <div className="grid md:grid-cols-4 gap-6">

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Latest Weight</p>
            <h2 className="text-2xl font-bold mt-2">
              {latestWeight || "--"} kg
            </h2>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Start Weight</p>
            <h2 className="text-2xl font-bold mt-2">
              {startWeight || "--"} kg
            </h2>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Total Change</p>
            <h2 className="text-2xl font-bold mt-2">
              {change} kg
            </h2>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow border">
            <p className="text-sm text-slate-500">Workouts Done</p>
            <h2 className="text-2xl font-bold mt-2">
              {totalWorkouts}
            </h2>
          </div>

        </div>

        {/* WEIGHT CHART */}
        <div className="bg-white p-6 rounded-3xl shadow border">
          <h2 className="text-lg font-semibold mb-4">Weight Progress</h2>

          {weightData.length === 0 ? (
            <p className="text-center text-slate-500 py-10">
              No weight data yet
            </p>
          ) : (
            <div className="w-full h-[300px]">
              <ResponsiveContainer>
                <LineChart data={weightData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#7c3aed"
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* WORKOUT CHART */}
        <div className="bg-white p-6 rounded-3xl shadow border">
          <h2 className="text-lg font-semibold mb-4">
            Weekly Workout Activity
          </h2>

          {workoutData.length === 0 ? (
            <p className="text-center text-slate-500 py-10">
              No workout data yet
            </p>
          ) : (
            <div className="w-full h-[300px]">
              <ResponsiveContainer>
                <BarChart data={workoutData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="workouts" fill="#06b6d4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}