"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { toast } from "../../../components/Toast"

type DietItem = {
  food: string
  calories: number | null
  protein?: number | null
}

type Meal = {
  name: string
  items: DietItem[]
  total_calories?: number | null
}

type WorkoutExercise = {
  name: string
  sets?: number | null
  reps?: number | null
}

type WorkoutDay = {
  day: string
  type?: string | null
  exercises: WorkoutExercise[]
  estimated_calories_burned?: number | null
}

type StructuredPlan = {
  diet_plan?: {
    meals?: Meal[]
    daily_total_calories?: number | null
  }
  workout_plan?: WorkoutDay[]
}

type PlanHistoryItem = {
  id: string
  plan: unknown
  created_at: string
}

type ExecutionRecord = {
  exercise_name: string
  done: boolean
  sets_done?: number | null
  reps_done?: number | null
  weight_used?: number | null
  notes?: string | null
}

type MealExecutionRecord = {
  meal_name: string
  eaten: boolean
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parsePlanContent(value: unknown): StructuredPlan | null {
  if (!value) return null

  if (typeof value === "string") {
    const parsed = safeJsonParse(value)
    if (parsed && typeof parsed === "object") return parsed as StructuredPlan
    return null
  }

  if (typeof value === "object") {
    return value as StructuredPlan
  }

  return null
}

function asNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function getDietMealTotal(meal: Meal) {
  if (typeof meal.total_calories === "number") return meal.total_calories
  return (meal.items || []).reduce((sum, item) => sum + asNumber(item.calories), 0)
}

function getWorkoutDayBurn(day: WorkoutDay) {
  return asNumber(day.estimated_calories_burned)
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function getActualWorkoutDays(workoutDays: WorkoutDay[]) {
  return workoutDays.filter(
    (day) => String(day.type ?? "").toLowerCase() !== "rest"
  ).length
}

// Map plan day names to JS getDay() index (0=Sun)
const WEEK_DAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  "day 1": 1,
  "day 2": 2,
  "day 3": 3,
  "day 4": 4,
  "day 5": 5,
  "day 6": 6,
  "day 7": 0,
}

function getTodayWorkoutDay(workoutDays: WorkoutDay[]): WorkoutDay | null {
  const todayIndex = new Date().getDay() // 0=Sun
  for (const day of workoutDays) {
    const key = day.day.toLowerCase().trim()
    if (WEEK_DAYS[key] === todayIndex) return day
  }
  // Fallback: positional match (Mon=plan[0], Tue=plan[1], ...)
  const posMap = [6, 0, 1, 2, 3, 4, 5] // getDay() → plan index (Mon-first)
  const planIdx = posMap[todayIndex]
  if (workoutDays[planIdx]) return workoutDays[planIdx]
  return workoutDays[0] ?? null
}

function todayDateStr() {
  return new Date().toISOString().split("T")[0]
}

function getExerciseTip(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes("squat")) return "Keep your chest up, knees tracking over toes. Drive through your heels on the way up."
  if (lower.includes("deadlift")) return "Hinge at the hips, keep your back flat. Bar stays close to your body throughout the lift."
  if (lower.includes("bench")) return "Grip slightly wider than shoulder-width. Lower the bar to your lower chest, drive up explosively."
  if (lower.includes("row")) return "Squeeze your shoulder blades together at the top. Control the eccentric on the way down."
  if (lower.includes("pull") || lower.includes("chin")) return "Full hang at the bottom, chin over bar at the top. Engage your lats by thinking 'elbows to hips'."
  if (lower.includes("press") || lower.includes("overhead")) return "Brace your core to protect your lower back. Press in a straight line overhead."
  if (lower.includes("lunge")) return "Step far enough that your front knee stays above your ankle, not past your toes."
  if (lower.includes("plank")) return "Neutral spine, squeeze your glutes and abs. Don't let your hips sag or pike up."
  if (lower.includes("curl")) return "Keep your elbows pinned to your sides. Full range of motion — don't cheat with momentum."
  if (lower.includes("tricep") || lower.includes("dip") || lower.includes("extension")) return "Lock your elbows in place and isolate the triceps. Controlled movement throughout."
  if (lower.includes("calf")) return "Full stretch at the bottom, full contraction at the top. Slow and controlled is better than heavy."
  if (lower.includes("run") || lower.includes("cardio") || lower.includes("jog")) return "Maintain a conversational pace. Land midfoot, not on your heels."
  return "Focus on form over weight. Full range of motion and controlled movement build more muscle safely."
}

export default function PlanPage() {
  const router = useRouter()

  const [planContent, setPlanContent] = useState<unknown>(null)
  const [history, setHistory] = useState<PlanHistoryItem[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [completionRate, setCompletionRate] = useState<number | null>(null)
  const [upgradingDifficulty, setUpgradingDifficulty] = useState(false)

  // Workout execution tracking
  const [executionMap, setExecutionMap] = useState<Record<string, ExecutionRecord>>({})
  const [savingExercise, setSavingExercise] = useState<string | null>(null)
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null)

  // Meal execution tracking
  const [mealExecutions, setMealExecutions] = useState<Record<string, MealExecutionRecord>>({})
  const [savingMeal, setSavingMeal] = useState<string | null>(null)

  // Grocery list
  type GroceryItem = { name: string; qty: string }
  type GroceryCategory = { category: string; items: GroceryItem[] }
  const [groceries, setGroceries] = useState<GroceryCategory[] | null>(null)
  const [loadingGroceries, setLoadingGroceries] = useState(false)
  const [groceryError, setGroceryError] = useState<string | null>(null)

  const plan = useMemo(() => {
    const parsed = parsePlanContent(planContent)

    if (!parsed && typeof planContent === "object" && planContent !== null) {
      return planContent as StructuredPlan
    }

    return parsed
  }, [planContent])

  const workoutDays = plan?.workout_plan ?? []
  const dietMeals = plan?.diet_plan?.meals ?? []

  const totalDietCalories = useMemo(() => {
    if (!plan) return 0
    if (typeof plan.diet_plan?.daily_total_calories === "number") {
      return plan.diet_plan.daily_total_calories
    }
    return dietMeals.reduce((sum, meal) => sum + getDietMealTotal(meal), 0)
  }, [plan, dietMeals])

  const totalWorkoutBurn = useMemo(() => {
    if (!plan) return 0
    return workoutDays.reduce((sum, day) => sum + getWorkoutDayBurn(day), 0)
  }, [plan, workoutDays])

  const activeWorkoutDays = useMemo(() => {
    return getActualWorkoutDays(workoutDays)
  }, [workoutDays])

  const dailyWorkoutBurn = useMemo(() => {
    if (activeWorkoutDays === 0) return 0
    return Math.round(totalWorkoutBurn / activeWorkoutDays)
  }, [totalWorkoutBurn, activeWorkoutDays])

  const dailyNetCalories = useMemo(() => {
    if (!plan) return null
    return Math.round(totalDietCalories - dailyWorkoutBurn)
  }, [plan, totalDietCalories, dailyWorkoutBurn])

  const legacyText = useMemo(() => {
    if (!planContent) return ""

    if (typeof planContent === "string") return planContent

    try {
      return JSON.stringify(planContent, null, 2)
    } catch {
      return ""
    }
  }, [planContent])

  // Today's workout day derived values
  const todayWorkoutDay = useMemo(() => {
    if (workoutDays.length === 0) return null
    return getTodayWorkoutDay(workoutDays)
  }, [workoutDays])

  const todayExercises = useMemo(() => {
    if (!todayWorkoutDay) return []
    if (todayWorkoutDay.type?.toLowerCase() === "rest") return []
    return todayWorkoutDay.exercises ?? []
  }, [todayWorkoutDay])

  const doneCount = useMemo(() => {
    return todayExercises.filter((ex) => executionMap[ex.name]?.done).length
  }, [todayExercises, executionMap])

  const allDone = todayExercises.length > 0 && doneCount === todayExercises.length

  // Load today's execution state from Supabase whenever userId is set
  useEffect(() => {
    if (!userId) return
    const loadExecution = async () => {
      const today = todayDateStr()
      const { data } = await supabase
        .from("workout_execution")
        .select("exercise_name, done, sets_done, reps_done, weight_used, notes")
        .eq("user_id", userId)
        .eq("date", today)

      if (data && data.length > 0) {
        const map: Record<string, ExecutionRecord> = {}
        for (const row of data) {
          map[row.exercise_name] = row as ExecutionRecord
        }
        setExecutionMap(map)
      }

      const { data: mealData } = await supabase
        .from("meal_execution")
        .select("meal_name, eaten")
        .eq("user_id", userId)
        .eq("date", today)

      if (mealData && mealData.length > 0) {
        const mealMap: Record<string, MealExecutionRecord> = {}
        for (const row of mealData) {
          mealMap[row.meal_name] = row as MealExecutionRecord
        }
        setMealExecutions(mealMap)
      }
    }
    loadExecution()
  }, [userId])

  const toggleExerciseDone = async (exercise: WorkoutExercise) => {
    if (!userId) return
    const name = exercise.name
    const current = executionMap[name]
    const nextCompleted = !current?.done
    setSavingExercise(name)

    const today = todayDateStr()
    const { error } = await supabase.from("workout_execution").upsert(
      {
        user_id: userId,
        date: today,
        exercise_name: name,
        done: nextCompleted,
        sets_done: exercise.sets ?? null,
        reps_done: exercise.reps ?? null,
        weight_used: current?.weight_used ?? null,
        notes: current?.notes ?? null,
      },
      { onConflict: "user_id,date,exercise_name" }
    )

    if (!error) {
      setExecutionMap((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          exercise_name: name,
          done: nextCompleted,
        },
      }))
    }

    setSavingExercise(null)
  }

  const toggleMealEaten = async (mealName: string) => {
    if (!userId) return
    const current = mealExecutions[mealName]
    const nextEaten = !current?.eaten
    setSavingMeal(mealName)

    const today = todayDateStr()
    const { error } = await supabase.from("meal_execution").upsert(
      {
        user_id: userId,
        date: today,
        meal_name: mealName,
        eaten: nextEaten,
      },
      { onConflict: "user_id,date,meal_name" }
    )

    if (!error) {
      setMealExecutions((prev) => ({
        ...prev,
        [mealName]: { meal_name: mealName, eaten: nextEaten },
      }))
    }

    setSavingMeal(null)
  }

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      setUserId(user.id)

      let { data: s } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!s?.id) {
        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id })
          .select("id")
          .maybeSingle()
        s = newSession
      }

      if (s?.id) setSessionId(s.id)

      const { data: latestPlan } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestPlan?.plan) setPlanContent(latestPlan.plan)

      const { data: allPlans } = await supabase
        .from("workout_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8)

      if (allPlans) setHistory(allPlans as PlanHistoryItem[])

      // Adaptive difficulty: check assigned workout completion rate over last 14 days
      const since14 = new Date()
      since14.setDate(since14.getDate() - 14)
      const { data: recentLogs } = await supabase
        .from("workout_logs")
        .select("date, is_assigned")
        .eq("user_id", user.id)
        .eq("is_assigned", true)
        .gte("date", since14.toISOString().split("T")[0])

      if (recentLogs && recentLogs.length > 0) {
        const uniqueDays = new Set(recentLogs.map((r: any) => r.date)).size
        setCompletionRate(Math.round((uniqueDays / 14) * 100))
      } else {
        setCompletionRate(0)
      }

      setLoading(false)
    }

    load()
  }, [router])

  const handleChat = async () => {
    if (!input.trim() || !planContent) return

    setLoadingChat(true)
    setChatError(null)
    setStatus(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          message: input,
          currentPlan: planContent,
          sessionId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Request failed with status ${res.status}`)
      }

      const data = await res.json()

      const nextPlan =
        data.plan ?? data.updatedPlan ?? data.content ?? data.result ?? null

      if (nextPlan) {
        setPlanContent(nextPlan)
        setInput("")

        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          const { error } = await supabase.from("workout_plans").insert({
            user_id: user.id,
            plan: nextPlan,
          })

          if (error) {
            console.error("Error saving plan:", error.message)
            toast.error("Plan updated but couldn't save to history.")
          } else {
            toast.success("Plan updated successfully.")
            const { data: allPlans } = await supabase
              .from("workout_plans")
              .select("*")
              .eq("user_id", user.id)
              .order("created_at", { ascending: false })
              .limit(8)

            if (allPlans) setHistory(allPlans as PlanHistoryItem[])
          }
        }
      }

      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId)
      }
    } catch (error: any) {
      const msg = error?.message || "Unable to update plan right now."
      setChatError(msg)
      toast.error(msg)
    } finally {
      setLoadingChat(false)
    }
  }

  const downloadGroceryList = async () => {
    if (!groceries || groceries.length === 0) return
    const { jsPDF } = await import("jspdf")
    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const margin = 48
    let y = margin

    doc.setFillColor(124, 58, 237)
    doc.rect(0, 0, W, 60, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20)
    doc.setFont("helvetica", "bold")
    doc.text("FitFusion AI", margin, 38)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text("Smart Grocery List", margin, 52)
    doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), W - margin, 52, { align: "right" })
    y = 88

    for (const cat of groceries) {
      if (y > H - margin - 60) { doc.addPage(); y = margin }
      doc.setFillColor(244, 244, 255)
      doc.roundedRect(margin, y - 4, W - margin * 2, 22, 4, 4, "F")
      doc.setTextColor(124, 58, 237)
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.text(cat.category, margin + 8, y + 12)
      y += 28
      doc.setTextColor(15, 23, 42)
      doc.setFontSize(10)
      doc.setFont("helvetica", "normal")
      for (const item of cat.items) {
        if (y > H - margin) { doc.addPage(); y = margin }
        doc.text(`-  ${item.name}`, margin + 12, y)
        doc.setTextColor(100, 116, 139)
        doc.text(item.qty, W - margin - 12, y, { align: "right" })
        doc.setTextColor(15, 23, 42)
        y += 16
      }
      y += 8
    }

    doc.setFillColor(248, 250, 252)
    doc.rect(0, H - 30, W, 30, "F")
    doc.setTextColor(148, 163, 184)
    doc.setFontSize(8)
    doc.text("Generated by FitFusion AI · fitfusion.app", W / 2, H - 12, { align: "center" })

    doc.save(`fitfusion-grocery-${new Date().toISOString().split("T")[0]}.pdf`)
  }

  const generateGroceryList = async () => {
    if (!userId) return
    setLoadingGroceries(true)
    setGroceryError(null)
    setGroceries(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/grocery-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ userId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate grocery list")
      }

      setGroceries(data.groceries ?? [])
    } catch (err: unknown) {
      setGroceryError(err instanceof Error ? err.message : "Failed to generate grocery list")
    } finally {
      setLoadingGroceries(false)
    }
  }

  const handleUpgradeDifficulty = async () => {
    setUpgradingDifficulty(true)
    setStatus(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()
      if (!user) { router.replace("/"); return }

      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ userId: user.id, difficultyBoost: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Failed to upgrade plan")
      setStatus("🔥 Plan upgraded to higher difficulty!")
      setCompletionRate(0)
      router.refresh()
    } catch (err: any) {
      setStatus(err.message || "Failed to upgrade plan")
    } finally {
      setUpgradingDifficulty(false)
    }
  }

  const handleRegeneratePlan = async () => {
    setRegenerating(true)
    setStatus(null)
    setChatError(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace("/")
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          userId: user.id,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to regenerate plan")
      }

      setStatus("✅ Plan regenerated successfully")
      router.refresh()
    } catch (err: any) {
      setStatus(err.message || "Failed to regenerate plan")
    } finally {
      setRegenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center text-slate-900 dark:text-white">
        Loading...
      </div>
    )
  }

  const hasStructuredPlan = !!plan
  const dietDailyTotal = hasStructuredPlan ? totalDietCalories : 0
  const workoutTotal = hasStructuredPlan ? totalWorkoutBurn : 0
  const netLabel = dailyNetCalories !== null ? `${dailyNetCalories} kcal` : "--"
  const progressPct =
    todayExercises.length > 0
      ? Math.round((doneCount / todayExercises.length) * 100)
      : 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-6 py-8 text-slate-900 dark:text-white md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Your Plan & AI
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Structured workout and diet tracking with calorie totals.
          </p>
        </div>

        {/* ── Stats cards ── */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <p className="text-sm text-slate-500 dark:text-slate-400">Diet Total</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {dietDailyTotal} kcal
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <p className="text-sm text-slate-500 dark:text-slate-400">Workout Burn</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {workoutTotal} kcal
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Avg / active workout day: {dailyWorkoutBurn} kcal
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <p className="text-sm text-slate-500 dark:text-slate-400">Daily Net Calories</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {netLabel}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <p className="text-sm text-slate-500 dark:text-slate-400">Workout Days</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {workoutDays.length}
            </h2>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Workout Plan */}
              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Workout Plan</h2>
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700">
                    {workoutTotal} kcal burn
                  </span>
                </div>

                {workoutDays.length > 0 ? (
                  <div className="space-y-4">
                    {workoutDays.map((day, index) => (
                      <div
                        key={`${day.day}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">
                              {day.day}
                              {day.type ? ` — ${day.type}` : ""}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Estimated session burn
                            </p>
                          </div>

                          <div className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-800">
                            {getWorkoutDayBurn(day)} kcal
                          </div>
                        </div>

                        <div className="space-y-2">
                          {day.exercises?.length ? (
                            day.exercises.map((exercise, exIndex) => (
                              <div
                                key={`${exercise.name}-${exIndex}`}
                                className="rounded-xl bg-white dark:bg-slate-700 px-3 py-2 text-sm"
                              >
                                <div className="flex items-center justify-between gap-4">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedExercise(expandedExercise === `${day.day}-${exercise.name}` ? null : `${day.day}-${exercise.name}`)}
                                    className="font-medium text-slate-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-left"
                                  >
                                    {exercise.name}
                                    <span className="ml-1 text-xs text-slate-400 dark:text-slate-500 font-normal">
                                      {expandedExercise === `${day.day}-${exercise.name}` ? "▲" : "▼"}
                                    </span>
                                  </button>
                                  <span className="text-slate-500 dark:text-slate-400 shrink-0">
                                    {exercise.sets ? `${exercise.sets} sets` : "--"}{" "}
                                    {exercise.reps ? `× ${exercise.reps} reps` : ""}
                                  </span>
                                </div>
                                {expandedExercise === `${day.day}-${exercise.name}` && (
                                  <p className="mt-1.5 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 rounded-xl px-3 py-2 leading-relaxed">
                                    💡 {getExerciseTip(exercise.name)}
                                  </p>
                                )}
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              No exercises listed.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : legacyText ? (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {legacyText}
                  </pre>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-6 text-sm text-slate-500 dark:text-slate-400">
                    No workout plan found.
                  </div>
                )}
              </div>

              {/* Diet Plan */}
              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Diet Plan</h2>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                    {dietDailyTotal} kcal total
                  </span>
                </div>

                {dietMeals.length > 0 ? (
                  <div className="space-y-4">
                    {dietMeals.map((meal, index) => (
                      <div
                        key={`${meal.name}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">{meal.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Meal breakdown</p>
                          </div>

                          <div className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-800">
                            {getDietMealTotal(meal)} kcal
                          </div>
                        </div>

                        <div className="space-y-2">
                          {meal.items?.length ? (
                            meal.items.map((item, itemIndex) => (
                              <div
                                key={`${item.food}-${itemIndex}`}
                                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl bg-white dark:bg-slate-700 px-3 py-2 text-sm"
                              >
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {item.food}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400">
                                  {item.protein !== undefined && item.protein !== null
                                    ? `${item.protein}g protein`
                                    : ""}
                                </span>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  {asNumber(item.calories)} kcal
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              No food items listed.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-2xl border border-purple-100 bg-purple-50 p-4">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Daily Total Calories</p>
                      <p className="mt-1 text-2xl font-bold text-purple-700">
                        {dietDailyTotal} kcal
                      </p>
                    </div>
                  </div>
                ) : legacyText ? (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {legacyText}
                  </pre>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-6 text-sm text-slate-500 dark:text-slate-400">
                    No diet plan found.
                  </div>
                )}
              </div>
            </div>

            {/* AI modifier */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold">Modify your plan with AI</h2>

              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Example: reduce calories, add oats, replace bench press..."
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-white outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                />

                <button
                  onClick={handleChat}
                  disabled={loadingChat}
                  className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 font-medium text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingChat ? "Updating..." : "Update"}
                </button>

                <button
                  onClick={handleRegeneratePlan}
                  disabled={regenerating}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-3 font-semibold text-white shadow-lg transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {regenerating ? "Regenerating..." : "Regenerate Plan"}
                </button>
              </div>

              {chatError ? (
                <p className="mt-3 text-sm text-rose-500">{chatError}</p>
              ) : null}

              {status ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{status}</p> : null}
            </div>

            {/* Adaptive Difficulty Upgrade Banner */}
            {completionRate !== null && completionRate >= 75 && (
              <div className="rounded-3xl border border-emerald-200 dark:border-emerald-700 bg-gradient-to-r from-emerald-50 to-cyan-50 dark:from-emerald-900/20 dark:to-cyan-900/20 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300 text-base">
                    🔥 You&apos;re crushing it! Ready to level up?
                  </p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
                    You completed {completionRate}% of your assigned workouts in the last 2 weeks. Your current plan may be too easy.
                  </p>
                </div>
                <button
                  onClick={handleUpgradeDifficulty}
                  disabled={upgradingDifficulty}
                  className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 px-5 py-2.5 text-sm font-semibold text-white transition"
                >
                  {upgradingDifficulty ? "Upgrading..." : "Upgrade Difficulty"}
                </button>
              </div>
            )}

            {/* Dream Body — visualize your goal */}
            <div className="rounded-3xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-cyan-50 dark:from-purple-900/20 dark:to-cyan-900/20 p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <span>⭐</span> Dream Body Goal
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                    Upload an inspiration photo and let AI map a path from your current body to your goal.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/dashboard/dream-body")}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition shrink-0"
                >
                  Open Dream Body →
                </button>
              </div>
            </div>

            {/* Grocery List */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Smart Grocery List</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">AI-generated weekly shopping list from your diet plan</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    onClick={generateGroceryList}
                    disabled={loadingGroceries || !plan}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {loadingGroceries ? "Generating..." : "🛒 Generate List"}
                  </button>
                  {groceries && groceries.length > 0 && (
                    <button
                      onClick={downloadGroceryList}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                    >
                      ⬇ Download PDF
                    </button>
                  )}
                </div>
              </div>

              {!plan && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Generate a plan first to get a grocery list.
                </div>
              )}

              {groceryError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {groceryError}
                </div>
              )}

              {groceries && groceries.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {groceries.map((cat) => (
                    <div key={cat.category} className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-4">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{cat.category}</p>
                      <ul className="space-y-2">
                        {cat.items.map((item, i) => (
                          <li key={i} className="flex items-center justify-between rounded-xl bg-white dark:bg-slate-700 px-3 py-2 text-sm">
                            <span className="text-slate-800 font-medium">{item.name}</span>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">{item.qty}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {!groceries && !groceryError && !loadingGroceries && plan && (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Click &quot;Generate List&quot; to get a weekly grocery list based on your diet plan.
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6 xl:col-span-4">
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold">Plan History</h2>

              <div className="space-y-3">
                {history.length > 0 ? (
                  history.map((item, index) => {
                    const structured = parsePlanContent(item.plan)
                    const workoutCount = structured?.workout_plan?.length ?? 0
                    const mealCount = structured?.diet_plan?.meals?.length ?? 0
                    const dailyCalories =
                      structured?.diet_plan?.daily_total_calories ??
                      structured?.diet_plan?.meals?.reduce(
                        (sum, meal) => sum + getDietMealTotal(meal),
                        0
                      ) ??
                      null
                    const burn =
                      structured?.workout_plan?.reduce(
                        (sum, day) => sum + getWorkoutDayBurn(day),
                        0
                      ) ?? null

                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-4"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          Version {history.length - index}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDateTime(item.created_at)}
                        </p>

                        <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                          <p>
                            Meals: <span className="font-medium">{mealCount}</span> | Workouts:{" "}
                            <span className="font-medium">{workoutCount}</span>
                          </p>
                          <p>
                            Diet: <span className="font-medium">{dailyCalories ?? "--"} kcal</span>{" "}
                            | Burn: <span className="font-medium">{burn ?? "--"} kcal</span>
                          </p>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No history yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <h2 className="mb-3 text-xl font-semibold">Quick Summary</h2>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400">Active workout days</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{activeWorkoutDays}</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400">Avg workout burn/day</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{dailyWorkoutBurn} kcal</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                  <span className="text-slate-500 dark:text-slate-400">Net daily calories</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {dailyNetCalories !== null ? `${dailyNetCalories} kcal` : "--"}
                  </span>
                </div>

                {todayExercises.length > 0 && (
                  <div className="flex items-center justify-between rounded-2xl bg-purple-50 dark:bg-purple-900/20 px-4 py-3">
                    <span className="text-slate-500 dark:text-slate-400">Today&apos;s progress</span>
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      {doneCount}/{todayExercises.length} done
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {!hasStructuredPlan && legacyText ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Your stored plan is still in the old text format. Regenerate it once to get the
            structured calorie cards and correct analytics.
          </div>
        ) : null}
      </div>
    </div>
  )
}
