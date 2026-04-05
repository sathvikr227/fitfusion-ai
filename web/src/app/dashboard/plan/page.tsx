"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"

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
        // Rate relative to 14 days (conservative denominator)
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        console.log("Saving plan:", nextPlan)

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
          } else {
            console.log("Plan saved successfully ✅")

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
      setChatError(error?.message || "Unable to update plan right now.")
    } finally {
      setLoadingChat(false)
    }
  }

  const generateGroceryList = async () => {
    if (!userId) return
    setLoadingGroceries(true)
    setGroceryError(null)
    setGroceries(null)

    try {
      const res = await fetch("/api/grocery-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      if (!user) { router.replace("/"); return }

      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
                                className="flex items-center justify-between gap-4 rounded-xl bg-white dark:bg-slate-700 px-3 py-2 text-sm"
                              >
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {exercise.name}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400">
                                  {exercise.sets ? `${exercise.sets} sets` : "--"}{" "}
                                  {exercise.reps ? `× ${exercise.reps} reps` : ""}
                                </span>
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

            {/* Grocery List */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Smart Grocery List</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">AI-generated weekly shopping list from your diet plan</p>
                </div>
                <button
                  onClick={generateGroceryList}
                  disabled={loadingGroceries || !plan}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition shrink-0"
                >
                  {loadingGroceries ? "Generating..." : "🛒 Generate List"}
                </button>
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