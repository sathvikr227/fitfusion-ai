"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import {
  Activity,
  Flame,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
  Utensils,
  Dumbbell,
  ChevronRight,
  Trophy,
  Droplets,
  Plus,
  Minus,
  Bell,
  BellOff,
  Check,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type BodyMetrics = {
  bmi: number | null
  estimated_body_fat_percent: number | null
  target_bmi: number | null
  target_body_fat_percent: number | null
  status: string | null
}

type WorkoutLogRow = {
  total_calories: number | null
  date: string | null
  created_at: string
}

type MealLogRow = {
  total_calories: number | null
  date: string | null
}

type PlanDay = {
  day?: string
  type?: string | null
  exercises?: { name: string; sets?: number | null; reps?: number | null }[]
  estimated_calories_burned?: number | null
}

type PlanMeal = {
  name?: string
  items?: { food: string; calories?: number | null; protein?: number | null }[]
  total_calories?: number | null
}

type LatestPlan = {
  workout_plan?: PlanDay[]
  diet_plan?: { meals?: PlanMeal[]; daily_total_calories?: number | null }
  fitness_metrics?: BodyMetrics
  meta?: { rest_days?: number; workout_days?: number; intensity?: string }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function safePlan(value: unknown): LatestPlan | null {
  if (!value) return null
  if (typeof value === "string") {
    try { return JSON.parse(value) as LatestPlan } catch { return null }
  }
  if (typeof value === "object") return value as LatestPlan
  return null
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function sevenDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split("T")[0]
}

function calcStreak(dates: string[]): number {
  const unique = Array.from(
    new Set(dates.map((d) => new Date(d).toISOString().split("T")[0]))
  ).sort().reverse()

  if (unique.length === 0) return 0

  const today = todayStr()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split("T")[0]

  if (unique[0] !== today && unique[0] !== yesterdayStr) return 0

  let streak = 1
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1])
    const curr = new Date(unique[i])
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86400000)
    if (diffDays === 1) streak++
    else break
  }
  return streak
}

function statusColor(status: string | null) {
  if (!status) return "text-slate-500 dark:text-slate-400"
  const s = status.toLowerCase()
  if (s === "fit") return "text-emerald-600"
  if (s === "underweight") return "text-amber-600"
  if (s === "overweight" || s === "obese") return "text-rose-600"
  return "text-slate-700 dark:text-slate-300"
}

function statusBg(status: string | null) {
  if (!status) return "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
  const s = status.toLowerCase()
  if (s === "fit") return "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
  if (s === "underweight") return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
  if (s === "overweight" || s === "obese") return "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800"
  return "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <div className={`inline-flex w-fit rounded-2xl p-2.5 ${accent ?? "bg-slate-100"}`}>
        <Icon className="h-5 w-5 text-slate-700 dark:text-slate-300" />
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

function QuickLink({
  label,
  sub,
  href,
  icon: Icon,
}: {
  label: string
  sub: string
  href: string
  icon: React.ElementType
}) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.push(href)}
      className="group flex items-center gap-4 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-md"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500 text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-slate-900 dark:text-white">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-purple-600" />
    </button>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HomeDashboard() {
  const router = useRouter()

  const [username, setUsername] = useState("User")
  const [latestWeight, setLatestWeight] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<BodyMetrics | null>(null)
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLogRow[]>([])
  const [mealLogs, setMealLogs] = useState<MealLogRow[]>([])
  const [latestPlan, setLatestPlan] = useState<LatestPlan | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Water intake (localStorage, resets daily) ─────────────────────────────
  // Goal: weight(kg) × 0.033 L, clamped between 2L and 4L. Default 2.5L if no weight.
  // Tracked in 250ml steps, displayed in liters.
  const STEP_ML = 250
  const waterKey = `water-ml-${todayStr()}`
  const waterGoalL = latestWeight
    ? Math.min(4, Math.max(2, Math.round(latestWeight * 0.033 * 10) / 10))
    : 2.5
  const waterGoalMl = Math.round(waterGoalL * 1000)
  const [waterMl, setWaterMl] = useState(0)
  const [reminderTime, setReminderTime] = useState("")
  const [reminderSet, setReminderSet] = useState(false)
  const [showReminderInput, setShowReminderInput] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    // Load reminder from localStorage
    const savedReminder = localStorage.getItem("workout-reminder-time")
    if (savedReminder) { setReminderTime(savedReminder); setReminderSet(true) }
  }, [])

  const saveReminder = useCallback((time: string) => {
    if (!time) return
    localStorage.setItem("workout-reminder-time", time)
    setReminderTime(time)
    setReminderSet(true)
    setShowReminderInput(false)
    // Request notification permission and schedule
    if ("Notification" in window) {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          const [h, m] = time.split(":").map(Number)
          const now = new Date()
          const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
          if (next <= now) next.setDate(next.getDate() + 1)
          const delay = next.getTime() - now.getTime()
          setTimeout(() => {
            new Notification("FitFusion Workout Reminder 💪", {
              body: "Time to crush your workout! Your plan is ready.",
              icon: "/logo.png",
            })
          }, delay)
        }
      })
    }
  }, [])

  const clearReminder = useCallback(() => {
    localStorage.removeItem("workout-reminder-time")
    setReminderTime("")
    setReminderSet(false)
    setShowReminderInput(false)
  }, [])

  const addWater = useCallback((delta: number) => {
    setWaterMl((prev) => {
      const next = Math.max(0, Math.min(waterGoalMl + 1000, prev + delta * STEP_ML))
      // Persist to localStorage as fast fallback
      localStorage.setItem(waterKey, String(next))
      // Persist to Supabase if logged in
      if (userId) {
        supabase.from("water_logs").upsert(
          { user_id: userId, date: todayStr(), amount_ml: next },
          { onConflict: "user_id,date" }
        ).then(() => {}) // fire-and-forget
      }
      return next
    })
  }, [waterKey, waterGoalMl, userId])

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) { router.push("/login"); return }

      setUsername(user.email?.split("@")[0] ?? "User")
      setUserId(user.id)

      // Load today's water intake from Supabase
      const today = todayStr()
      const { data: waterData } = await supabase
        .from("water_logs")
        .select("amount_ml")
        .eq("user_id", user.id)
        .eq("date", today)
        .maybeSingle()
      if (waterData?.amount_ml != null) {
        setWaterMl(waterData.amount_ml)
      } else {
        // Fallback: localStorage for today
        const saved = parseInt(localStorage.getItem(`water-ml-${today}`) ?? "0", 10)
        setWaterMl(Number.isFinite(saved) ? saved : 0)
      }

      const since = sevenDaysAgo()

      const [
        weightRes,
        metricsRes,
        workoutRes,
        mealRes,
        planRes,
      ] = await Promise.all([
        supabase
          .from("weight_logs")
          .select("weight, date")
          .eq("user_id", user.id)
          .order("date", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("body_metrics")
          .select("bmi, estimated_body_fat_percent, target_bmi, target_body_fat_percent, status")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("workout_logs")
          .select("total_calories, date, created_at")
          .eq("user_id", user.id)
          .gte("date", since),
        supabase
          .from("meal_logs")
          .select("total_calories, date")
          .eq("user_id", user.id)
          .gte("date", since),
        supabase
          .from("workout_plans")
          .select("plan")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (weightRes.data?.weight != null) setLatestWeight(weightRes.data.weight)
      if (metricsRes.data) setMetrics(metricsRes.data as BodyMetrics)
      setWorkoutLogs(workoutRes.data ?? [])
      setMealLogs(mealRes.data ?? [])
      if (planRes.data?.plan) setLatestPlan(safePlan(planRes.data.plan))

      setLoading(false)
    }
    load()
  }, [router])

  // ── Derived stats ──────────────────────────────────────────────────────────

  const streak = useMemo(() => {
    return calcStreak(workoutLogs.map((w) => w.date ?? w.created_at))
  }, [workoutLogs])

  const weeklyCaloriesBurned = useMemo(() => {
    return workoutLogs.reduce((s, w) => s + safeNum(w.total_calories), 0)
  }, [workoutLogs])

  const weeklyCaloriesConsumed = useMemo(() => {
    return mealLogs.reduce((s, m) => s + safeNum(m.total_calories), 0)
  }, [mealLogs])

  const workoutSessionsThisWeek = workoutLogs.length

  // ── Plan summary ───────────────────────────────────────────────────────────

  const planSummary = useMemo(() => {
    if (!latestPlan) return null
    const meals = latestPlan.diet_plan?.meals ?? []
    const workoutDays = latestPlan.workout_plan ?? []
    const activeWorkoutDays = workoutDays.filter(
      (d) => d.type?.toLowerCase() !== "rest"
    )
    const dailyCalories =
      latestPlan.diet_plan?.daily_total_calories ??
      meals.reduce((s, m) => s + safeNum(m.total_calories), 0)
    const totalBurn = workoutDays.reduce((s, d) => s + safeNum(d.estimated_calories_burned), 0)

    return {
      mealCount: meals.length,
      workoutDayCount: activeWorkoutDays.length,
      dailyCalories,
      totalWeeklyBurn: totalBurn,
      firstMeal: meals[0]?.name ?? "—",
      todayWorkout: workoutDays[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] ?? null,
    }
  }, [latestPlan])

  // ── Today's workout card ───────────────────────────────────────────────────
  const todayWorkout = planSummary?.todayWorkout
  const isRestDay = todayWorkout?.type?.toLowerCase() === "rest"

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-10">

        {/* ── Welcome header ── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-purple-600 uppercase tracking-wide">FitFusion AI</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
              Welcome back, {username}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Here's your fitness snapshot for today.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {streak > 0 && (
              <div className="flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                <Flame className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-xs text-orange-500">Streak</p>
                  <p className="text-lg font-bold text-orange-700">{streak} days</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3">
              <Trophy className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-xs text-purple-500">This week</p>
                <p className="text-lg font-bold text-purple-700">{workoutSessionsThisWeek} sessions</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Body metrics ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Weight"
            value={latestWeight != null ? `${latestWeight} kg` : "--"}
            sub="Latest logged"
            icon={Scale}
            accent="bg-blue-50"
          />
          <MetricCard
            label="BMI"
            value={metrics?.bmi != null ? String(metrics.bmi) : "--"}
            sub={metrics?.status ?? ""}
            icon={Activity}
            accent="bg-purple-50"
          />
          <MetricCard
            label="Body Fat %"
            value={metrics?.estimated_body_fat_percent != null ? `${metrics.estimated_body_fat_percent}%` : "--"}
            sub={metrics?.target_body_fat_percent != null ? `Target: ${metrics.target_body_fat_percent}%` : undefined}
            icon={Target}
            accent="bg-cyan-50"
          />
          <MetricCard
            label="Target BMI"
            value={metrics?.target_bmi != null ? String(metrics.target_bmi) : "--"}
            sub={metrics?.status ? `Current: ${metrics.status}` : undefined}
            icon={TrendingDown}
            accent="bg-emerald-50"
          />
        </div>

        {/* ── This week's calorie summary ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Calories Burned"
            value={`${weeklyCaloriesBurned.toLocaleString()} kcal`}
            sub="This week"
            icon={Flame}
            accent="bg-orange-50"
          />
          <MetricCard
            label="Calories Consumed"
            value={`${weeklyCaloriesConsumed.toLocaleString()} kcal`}
            sub="This week"
            icon={Utensils}
            accent="bg-green-50"
          />
          <MetricCard
            label="Plan — Daily Calories"
            value={planSummary?.dailyCalories ? `${planSummary.dailyCalories} kcal` : "--"}
            sub="From your current plan"
            icon={TrendingUp}
            accent="bg-purple-50"
          />
          <MetricCard
            label="Weekly Workout Burn"
            value={planSummary?.totalWeeklyBurn ? `${planSummary.totalWeeklyBurn} kcal` : "--"}
            sub="Estimated from plan"
            icon={Dumbbell}
            accent="bg-cyan-50"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">

            {/* ── Today's workout ── */}
            {todayWorkout && (
              <div className={`rounded-3xl border p-6 shadow-sm ${isRestDay ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" : "border-purple-200 dark:border-purple-900 bg-gradient-to-br from-purple-50 to-cyan-50 dark:from-purple-900/30 dark:to-cyan-900/20"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-purple-600">Today</p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
                      {isRestDay ? "Rest Day" : `${todayWorkout.day ?? "Workout"} — ${todayWorkout.type ?? "Training"}`}
                    </h2>
                    {!isRestDay && todayWorkout.estimated_calories_burned != null && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Est. {todayWorkout.estimated_calories_burned} kcal burn
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => router.push("/dashboard/progress")}
                    className="shrink-0 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
                  >
                    Log it
                  </button>
                </div>

                {!isRestDay && Array.isArray(todayWorkout.exercises) && todayWorkout.exercises.length > 0 && (
                  <div className="mt-5 space-y-2">
                    {todayWorkout.exercises.map((ex, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-2xl bg-white/70 dark:bg-slate-700/60 px-4 py-2.5 text-sm backdrop-blur"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">{ex.name}</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {ex.sets != null && ex.reps != null
                            ? `${ex.sets} × ${ex.reps}`
                            : ex.sets != null
                              ? `${ex.sets} sets`
                              : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {isRestDay && (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    Recovery is part of the plan. Stretch, hydrate, and sleep well.
                  </p>
                )}
              </div>
            )}

            {/* ── Plan snapshot ── */}
            {planSummary && (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Current Plan Snapshot</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Summary from your latest AI-generated plan</p>
                  </div>
                  <button
                    onClick={() => router.push("/dashboard/plan")}
                    className="flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
                  >
                    View full plan
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Meals / day", value: String(planSummary.mealCount) },
                    { label: "Workout days", value: String(planSummary.workoutDayCount) },
                    { label: "Daily intake", value: `${planSummary.dailyCalories} kcal` },
                    { label: "Weekly burn", value: `${planSummary.totalWeeklyBurn} kcal` },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Quick links ── */}
            <div className="grid gap-3 sm:grid-cols-3">
              <QuickLink
                label="Log Progress"
                sub="Workout, meals, weight"
                href="/dashboard/progress"
                icon={ClipboardIcon}
              />
              <QuickLink
                label="Analytics"
                sub="Charts and trends"
                href="/dashboard/analytics"
                icon={ChartIcon}
              />
              <QuickLink
                label="Get Help"
                sub="Recipes and exercises"
                href="/dashboard/help"
                icon={HelpIcon}
              />
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-6 xl:col-span-4">

            {/* Status card */}
            {metrics && (
              <div className={`rounded-3xl border p-6 shadow-sm ${statusBg(metrics.status)}`}>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Fitness Status</h2>
                <p className={`mt-2 text-3xl font-bold ${statusColor(metrics.status)}`}>
                  {metrics.status ?? "--"}
                </p>
                <div className="mt-5 space-y-2.5 text-sm">
                  {[
                    { label: "BMI", value: metrics.bmi != null ? String(metrics.bmi) : "--" },
                    { label: "Body Fat", value: metrics.estimated_body_fat_percent != null ? `${metrics.estimated_body_fat_percent}%` : "--" },
                    { label: "Target BMI", value: metrics.target_bmi != null ? String(metrics.target_bmi) : "--" },
                    { label: "Target BF%", value: metrics.target_body_fat_percent != null ? `${metrics.target_body_fat_percent}%` : "--" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between rounded-xl bg-white/60 dark:bg-slate-700/60 px-3 py-2">
                      <span className="text-slate-500 dark:text-slate-400">{label}</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
                    </div>
                  ))}
                </div>
                {!metrics.bmi && (
                  <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                    Generate a plan to calculate your metrics.
                  </p>
                )}
              </div>
            )}

            {/* ── Water intake tracker ── */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-50">
                    <Droplets className="h-5 w-5 text-cyan-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white text-sm">Water Intake</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Goal: {waterGoalL}L
                      {latestWeight ? ` · based on ${latestWeight}kg` : " · log weight to personalise"}
                    </p>
                  </div>
                </div>
                <span className={`text-sm font-bold tabular-nums ${waterMl >= waterGoalMl ? "text-cyan-500" : "text-slate-700 dark:text-slate-300"}`}>
                  {(waterMl / 1000).toFixed(2)}L
                </span>
              </div>

              {/* Step dots */}
              <div className="my-4 flex flex-wrap gap-1.5">
                {Array.from({ length: Math.round(waterGoalL / 0.25) }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full transition-all ${
                      i < Math.floor(waterMl / STEP_ML)
                        ? "bg-cyan-400"
                        : "bg-slate-100"
                    }`}
                  />
                ))}
              </div>

              {/* Progress bar */}
              <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                  style={{ width: `${Math.min((waterMl / waterGoalMl) * 100, 100)}%` }}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => addWater(-1)}
                  disabled={waterMl === 0}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-600 dark:text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => addWater(1)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                >
                  <Plus className="h-4 w-4" />
                  +250ml
                </button>
              </div>

              {waterMl >= waterGoalMl && (
                <p className="mt-3 text-center text-xs font-medium text-cyan-600">
                  🎉 Daily goal reached!
                </p>
              )}
            </div>

            {/* Workout Reminder */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-900/30">
                    <Bell className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Workout Reminder</p>
                    {reminderSet && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">Daily at {reminderTime}</p>
                    )}
                  </div>
                </div>
                {reminderSet && (
                  <button onClick={clearReminder} title="Clear reminder" className="text-slate-400 hover:text-rose-500 transition">
                    <BellOff className="h-4 w-4" />
                  </button>
                )}
              </div>

              {reminderSet ? (
                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                    Reminder set for {reminderTime} daily
                  </p>
                </div>
              ) : showReminderInput ? (
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-purple-400"
                  />
                  <button
                    onClick={() => saveReminder(reminderTime)}
                    disabled={!reminderTime}
                    className="rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition"
                  >
                    Set
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowReminderInput(true)}
                  className="w-full rounded-2xl border border-dashed border-purple-300 dark:border-purple-700 py-3 text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                >
                  + Set daily reminder
                </button>
              )}
            </div>

            {/* No plan CTA */}
            {!latestPlan && (
              <div className="rounded-3xl border border-dashed border-purple-300 bg-purple-50 p-6 text-center shadow-sm">
                <Dumbbell className="mx-auto h-8 w-8 text-purple-400" />
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">No plan yet</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Generate your personalized AI workout and diet plan to get started.
                </p>
                <button
                  onClick={() => router.push("/generate")}
                  className="mt-4 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
                >
                  Generate Plan
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inline icon stand-ins to keep imports minimal ─────────────────────────────
function ClipboardIcon({ className }: { className?: string }) {
  return <Activity className={className} />
}
function ChartIcon({ className }: { className?: string }) {
  return <TrendingUp className={className} />
}
function HelpIcon({ className }: { className?: string }) {
  return <Target className={className} />
}
