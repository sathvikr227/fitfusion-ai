"use client"

import { useEffect, useMemo, useState } from "react"
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

type BodyMetricsRow = {
  bmi: number | null
  estimated_body_fat_percent: number | null
  target_bmi: number | null
  target_body_fat_percent: number | null
  status: string | null
  created_at: string
}

type Meal = {
  name?: string
  items?: {
    food: string
    calories?: number | null
    protein?: number | null
  }[]
  total_calories?: number | null
}

type WorkoutDay = {
  day?: string
  type?: string | null
  exercises?: {
    name: string
    sets?: number | null
    reps?: number | null
  }[]
  estimated_calories_burned?: number | null
}

type PlanMetrics = {
  diet_plan?: {
    meals?: Meal[]
    daily_total_calories?: number | null
  }
  workout_plan?: WorkoutDay[]
  fitness_metrics?: {
    bmi?: number | null
    estimated_body_fat_percent?: number | null
    target_bmi?: number | null
    target_body_fat_percent?: number | null
    status?: string | null
  }
  meta?: {
    rest_days?: number | null
    workout_days?: number | null
    total_days?: number | null
  }
}

function safeParsePlan(value: unknown): PlanMetrics | null {
  if (!value) return null
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as PlanMetrics
    } catch {
      return null
    }
  }
  if (typeof value === "object") return value as PlanMetrics
  return null
}

function asNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function getMealCalories(meal: Meal) {
  if (typeof meal.total_calories === "number") return meal.total_calories
  return (meal.items || []).reduce((sum, item) => sum + asNumber(item.calories), 0)
}

function getWorkoutBurn(day: WorkoutDay) {
  return asNumber(day.estimated_calories_burned)
}

export default function HomeDashboard() {
  const router = useRouter()

  const [username, setUsername] = useState("User")
  const [streak, setStreak] = useState(0)
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  const [recentLogs, setRecentLogs] = useState<ProgressLog[]>([])
  const [totalCaloriesBurned, setTotalCaloriesBurned] = useState(0)
  const [totalCaloriesConsumed, setTotalCaloriesConsumed] = useState(0)
  const [latestMetrics, setLatestMetrics] = useState<BodyMetricsRow | null>(null)
  const [latestPlan, setLatestPlan] = useState<PlanMetrics | null>(null)
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

      const [logsResult, metricsResult, planResult] = await Promise.all([
        supabase
          .from("progress_logs")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("body_metrics")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("workout_plans")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      const logs = logsResult.data ?? []
      setRecentLogs(logs.slice(0, 5))

      const latestWeightLog = logs.find((d) => d.weight !== null && d.weight !== undefined)
      setLatestWeight(latestWeightLog?.weight ?? null)

      let streakCount = 0
      for (let i = 0; i < logs.length; i++) {
        if (logs[i].completed) streakCount++
        else break
      }
      setStreak(streakCount)

      setTotalCaloriesBurned(
        logs.reduce((sum, d) => sum + (d.calories_burned || 0), 0)
      )

      setTotalCaloriesConsumed(
        logs.reduce((sum, d) => sum + (d.calories_consumed || 0), 0)
      )

      if (metricsResult.data) {
        setLatestMetrics(metricsResult.data as BodyMetricsRow)
      }

      if (planResult.data?.plan) {
        setLatestPlan(safeParsePlan(planResult.data.plan))
      }

      setLoading(false)
    }

    load()
  }, [router])

  const planSummary = useMemo(() => {
    const plan = latestPlan
    const meals = plan?.diet_plan?.meals ?? []
    const workouts = plan?.workout_plan ?? []

    const dietCalories =
      plan?.diet_plan?.daily_total_calories ??
      meals.reduce((sum, meal) => sum + getMealCalories(meal), 0)

    const workoutCalories = workouts.reduce((sum, day) => sum + getWorkoutBurn(day), 0)

    const workoutDays = workouts.filter(
      (day) => String(day.type ?? "").toLowerCase() !== "rest" && getWorkoutBurn(day) > 0
    ).length

    return {
      mealCount: meals.length,
      workoutDayCount: workoutDays,
      dietCalories,
      workoutCalories,
      firstMeal: meals[0]?.name ?? "—",
      firstWorkout: workouts[0]?.day ?? "—",
    }
  }, [latestPlan])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-900 bg-gradient-to-br from-white via-slate-50 to-blue-50">
        Loading...
      </div>
    )
  }

  const bmi = latestMetrics?.bmi ?? null
  const bodyFat = latestMetrics?.estimated_body_fat_percent ?? null
  const targetBmi = latestMetrics?.target_bmi ?? null
  const targetBodyFat = latestMetrics?.target_body_fat_percent ?? null
  const status = latestMetrics?.status ?? "—"

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-900 px-6 py-8 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">FitFusion AI Dashboard</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-tight">
              Welcome back, {username} 👋
            </h1>
            <p className="mt-2 text-slate-500">
              Track your body metrics, latest plan, and daily progress in one place.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Current streak</p>
            <div className="mt-1 text-3xl font-bold">{streak} days 🔥</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Latest Weight</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {latestWeight !== null ? `${latestWeight} kg` : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">BMI</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {bmi !== null ? bmi.toFixed(1) : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Body Fat %</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {bodyFat !== null ? `${bodyFat.toFixed(1)}%` : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Status</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">{status}</h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Target BMI</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {targetBmi !== null ? targetBmi.toFixed(1) : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Target Body Fat %</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {targetBodyFat !== null ? `${targetBodyFat.toFixed(1)}%` : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Calories Burned</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-purple-600">
              {totalCaloriesBurned} kcal
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Calories Consumed</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-cyan-600">
              {totalCaloriesConsumed} kcal
            </h2>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Latest Plan Snapshot</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Quick view of the most recent plan you confirmed.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/dashboard/plan")}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Open plan
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Meals</p>
                  <p className="mt-1 text-2xl font-bold">{planSummary.mealCount}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    First meal: {planSummary.firstMeal}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Workout days</p>
                  <p className="mt-1 text-2xl font-bold">{planSummary.workoutDayCount}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    First workout: {planSummary.firstWorkout}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Diet total</p>
                  <p className="mt-1 text-2xl font-bold">{planSummary.dietCalories} kcal</p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Workout burn</p>
                  <p className="mt-1 text-2xl font-bold">{planSummary.workoutCalories} kcal</p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <button
                onClick={() => router.push("/dashboard/progress")}
                className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <h3 className="text-lg font-semibold">Log Workout / Diet</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Track workouts, meals, and weight.
                </p>
              </button>

              <button
                onClick={() => router.push("/dashboard/analytics")}
                className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <h3 className="text-lg font-semibold">Analytics</h3>
                <p className="mt-2 text-sm text-slate-500">
                  See your progress over time.
                </p>
              </button>

              <button
                onClick={() => router.push("/dashboard/plan")}
                className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <h3 className="text-lg font-semibold">Your Plan</h3>
                <p className="mt-2 text-sm text-slate-500">
                  View and update your AI plan.
                </p>
              </button>
            </div>
          </div>

          <div className="space-y-6 xl:col-span-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Body Metrics</h2>
              <p className="mt-1 text-sm text-slate-500">
                Latest saved metrics from your confirmed plan.
              </p>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">BMI</span>
                  <span className="font-semibold">{bmi !== null ? bmi.toFixed(1) : "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Body Fat %</span>
                  <span className="font-semibold">
                    {bodyFat !== null ? `${bodyFat.toFixed(1)}%` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Target BMI</span>
                  <span className="font-semibold">
                    {targetBmi !== null ? targetBmi.toFixed(1) : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Target Body Fat %</span>
                  <span className="font-semibold">
                    {targetBodyFat !== null ? `${targetBodyFat.toFixed(1)}%` : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Status</span>
                  <span className="font-semibold">{status}</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Recent Activity</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your latest logs at a glance.
              </p>

              <div className="mt-5 space-y-3">
                {recentLogs.length === 0 ? (
                  <p className="text-sm text-slate-500">No activity yet.</p>
                ) : (
                  recentLogs.map((log, i) => (
                    <div
                      key={`${log.created_at}-${i}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {formatDateTime(log.created_at)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {log.log_type ?? "activity"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold">
                          {log.completed ? "✅ Completed" : "—"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
                        <div>Weight: {log.weight !== null ? `${log.weight} kg` : "--"}</div>
                        <div>Burn: {log.calories_burned ?? 0} kcal</div>
                        <div>Consumed: {log.calories_consumed ?? 0} kcal</div>
                        <div>Done: {log.completed ? "Yes" : "No"}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Weekly Summary</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Confirmed plan calories</p>
              <p className="mt-1 text-2xl font-bold">{planSummary.dietCalories} kcal</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Estimated burn</p>
              <p className="mt-1 text-2xl font-bold">{planSummary.workoutCalories} kcal</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Net daily calories</p>
              <p className="mt-1 text-2xl font-bold">
                {planSummary.dietCalories - Math.round(planSummary.workoutCalories / Math.max(planSummary.workoutDayCount || 1, 1))} kcal
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}