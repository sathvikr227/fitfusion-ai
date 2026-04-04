"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanHistoryItem = {
  id: string
  plan: string
  created_at: string
}

type ExerciseItem = {
  name?: string
  sets?: number | null
  reps?: number | null
}

type WorkoutDay = {
  day?: string
  type?: string
  exercises?: ExerciseItem[]
  estimated_calories_burned?: number
}

type MealItem = {
  food?: string
  calories?: number | null
  protein?: number | null
}

type Meal = {
  name?: string
  items?: MealItem[]
  total_calories?: number | null
}

type ParsedPlan = {
  workout_plan: WorkoutDay[]
  diet_plan: { meals: Meal[]; daily_total_calories?: number | null }
  fitness_metrics?: Record<string, unknown>
  meta?: Record<string, unknown>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePlan(raw: string | null): ParsedPlan | null {
  if (!raw) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && (obj.workout_plan || obj.diet_plan)) return obj as ParsedPlan
    return null
  } catch {
    return null
  }
}

function safePlanText(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ""
  }
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return value
  }
}

function planSummary(planText: string): string {
  const obj = safeJsonParse(planText)
  if (obj && typeof obj === "object") {
    const p = obj as ParsedPlan
    const workoutDays = p.workout_plan?.filter(
      (d) => d.type?.toLowerCase() !== "rest"
    ).length
    const restDays = p.workout_plan?.filter(
      (d) => d.type?.toLowerCase() === "rest"
    ).length
    const calories = p.diet_plan?.daily_total_calories
    const parts: string[] = []
    if (workoutDays != null) parts.push(`${workoutDays} workout days`)
    if (restDays != null) parts.push(`${restDays} rest days`)
    if (calories) parts.push(`${calories} kcal/day`)
    return parts.join(" · ") || "Plan"
  }
  return planText.slice(0, 120) + (planText.length > 120 ? "…" : "")
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WorkoutPlanView({ days }: { days: WorkoutDay[] }) {
  if (!days || days.length === 0)
    return <p className="text-sm text-slate-500">No workout plan found.</p>

  return (
    <div className="space-y-3">
      {days.map((day, i) => {
        const isRest = day.type?.toLowerCase() === "rest"
        return (
          <div
            key={i}
            className={`rounded-2xl border p-4 ${
              isRest
                ? "border-slate-100 bg-slate-50"
                : "border-purple-100 bg-purple-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isRest
                      ? "bg-slate-200 text-slate-600"
                      : "bg-purple-600 text-white"
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {day.day ?? `Day ${i + 1}`}
                  </p>
                  {day.type && (
                    <p className="text-xs text-slate-500">{day.type}</p>
                  )}
                </div>
              </div>
              {!isRest && day.estimated_calories_burned != null && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                  ~{day.estimated_calories_burned} kcal
                </span>
              )}
            </div>

            {!isRest && Array.isArray(day.exercises) && day.exercises.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {day.exercises.map((ex, j) => (
                  <li
                    key={j}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-700">{ex.name ?? "Exercise"}</span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                      {ex.sets != null && ex.reps != null
                        ? `${ex.sets} × ${ex.reps}`
                        : ex.sets != null
                          ? `${ex.sets} sets`
                          : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DietPlanView({
  meals,
  dailyCalories,
}: {
  meals: Meal[]
  dailyCalories?: number | null
}) {
  if (!meals || meals.length === 0)
    return <p className="text-sm text-slate-500">No diet plan found.</p>

  return (
    <div className="space-y-3">
      {dailyCalories != null && (
        <div className="rounded-2xl bg-cyan-50 p-3 text-center">
          <p className="text-xs text-cyan-600">Daily target</p>
          <p className="text-lg font-bold text-cyan-700">{dailyCalories} kcal</p>
        </div>
      )}
      {meals.map((meal, i) => (
        <div key={i} className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">
              {meal.name ?? `Meal ${i + 1}`}
            </p>
            {meal.total_calories != null && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-cyan-200">
                {meal.total_calories} kcal
              </span>
            )}
          </div>
          {Array.isArray(meal.items) && meal.items.length > 0 && (
            <ul className="mt-2 space-y-1">
              {meal.items.map((item, j) => (
                <li key={j} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{item.food ?? "Food"}</span>
                  <span className="text-xs text-slate-500">
                    {item.calories != null ? `${item.calories} kcal` : ""}
                    {item.protein != null ? ` · ${item.protein}g protein` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter()

  const [planRaw, setPlanRaw] = useState<string | null>(null)
  const [history, setHistory] = useState<PlanHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const parsedPlan = useMemo(() => parsePlan(planRaw), [planRaw])

  const loadDashboard = async () => {
    try {
      setError(null)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      // Create or load chat session
      const { data: existingSession } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingSession?.id) {
        setSessionId(existingSession.id)
      } else {
        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id })
          .select("id")
          .single()

        if (newSession?.id) setSessionId(newSession.id)
      }

      // Load latest plan
      const { data: latestPlan } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestPlan?.plan) {
        const text = safePlanText(latestPlan.plan)
        setPlanRaw(text)
        localStorage.setItem("plan", text)
      } else {
        const saved = localStorage.getItem("plan")
        if (saved) {
          setPlanRaw(saved)
        } else {
          router.push("/onboarding")
          return
        }
      }

      // Load history
      const { data: planHistory } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8)

      if (planHistory) {
        setHistory(
          planHistory.map((item: any) => ({
            ...item,
            plan: safePlanText(item.plan),
          })) as PlanHistoryItem[]
        )
      }
    } catch (err) {
      console.error("Dashboard load error:", err)
      const saved = localStorage.getItem("plan")
      if (saved) {
        setPlanRaw(saved)
      } else {
        router.push("/onboarding")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  const handleChat = async () => {
    if (!input.trim() || !planRaw) return

    if (!sessionId) {
      setError("Chat session not ready. Please refresh the page.")
      return
    }

    setLoadingChat(true)
    setError(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const currentPlan = safeJsonParse(planRaw) ?? planRaw

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          currentPlan,
          sessionId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update plan")
      }

      const data = await res.json()
      const nextPlan = data.plan ?? null

      if (!nextPlan) throw new Error("No updated plan returned from API")

      const nextPlanText = safePlanText(nextPlan)
      setPlanRaw(nextPlanText)
      localStorage.setItem("plan", nextPlanText)
      setInput("")

      // Save to workout_plans (single source of truth)
      await supabase.from("workout_plans").insert({
        user_id: user.id,
        plan: nextPlan,
      })

      // Refresh history
      const { data: updatedHistory } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8)

      if (updatedHistory) {
        setHistory(
          updatedHistory.map((item: any) => ({
            ...item,
            plan: safePlanText(item.plan),
          })) as PlanHistoryItem[]
        )
      }
    } catch (err: any) {
      console.error("CHAT ERROR:", err)
      setError("Failed to update plan. Please try again.")
    } finally {
      setLoadingChat(false)
    }
  }

  const handleRegenerate = () => {
    localStorage.removeItem("plan")
    router.push("/generate")
  }

  const handleRestore = async (item: PlanHistoryItem) => {
    setPlanRaw(item.plan)
    localStorage.setItem("plan", item.plan)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    // Safe JSON parse — item.plan may be a stringified JSON or plain text
    const planObj = safeJsonParse(item.plan) ?? item.plan

    const { error: saveError } = await supabase.from("workout_plans").insert({
      user_id: user.id,
      plan: planObj,
    })

    if (saveError) console.error("RESTORE SAVE ERROR:", saveError)

    const { data: updatedHistory } = await supabase
      .from("workout_plans")
      .select("id, plan, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8)

    if (updatedHistory) {
      setHistory(
        updatedHistory.map((row: any) => ({
          ...row,
          plan: safePlanText(row.plan),
        })) as PlanHistoryItem[]
      )
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" />
          <p className="text-sm text-slate-600">Loading your plan...</p>
        </div>
      </div>
    )
  }

  const workoutDays = parsedPlan?.workout_plan ?? []
  const meals = parsedPlan?.diet_plan?.meals ?? []
  const dailyCalories = parsedPlan?.diet_plan?.daily_total_calories
  const metrics = parsedPlan?.fitness_metrics as Record<string, unknown> | undefined
  const meta = parsedPlan?.meta as Record<string, unknown> | undefined

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">

        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-purple-600 uppercase">
              FitFusion AI
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900 md:text-5xl">
              Your AI fitness dashboard
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600 md:text-base">
              Review your weekly workout and diet, modify it with AI, and track
              older versions whenever you need to roll back.
            </p>
          </div>
          <button
            onClick={handleRegenerate}
            className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 text-sm font-medium text-white shadow-sm hover:opacity-95 transition"
          >
            Regenerate Plan
          </button>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Metrics bar */}
        {metrics && (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "BMI", value: metrics.bmi as string },
              { label: "Status", value: metrics.status as string },
              { label: "Body Fat %", value: metrics.estimated_body_fat_percent as string },
              { label: "Intensity", value: meta?.intensity as string },
            ].map(({ label, value }) =>
              value != null ? (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-center">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-base font-semibold text-slate-900 capitalize">{String(value)}</p>
                </div>
              ) : null
            )}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-12">
          <main className="space-y-6 xl:col-span-8">

            {/* Plan panels */}
            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Workout Plan</h2>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                    {meta?.workout_days != null ? `${meta.workout_days} days` : "Weekly"}
                  </span>
                </div>
                {parsedPlan ? (
                  <WorkoutPlanView days={workoutDays} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    {planRaw || "No workout plan found"}
                  </pre>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Diet Plan</h2>
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700">
                    Nutrition
                  </span>
                </div>
                {parsedPlan ? (
                  <DietPlanView meals={meals} dailyCalories={dailyCalories} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    No diet plan found
                  </pre>
                )}
              </div>
            </section>

            {/* Chat / Modify */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Modify your plan with AI
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Example: remove eggs, add cardio, make it beginner-friendly.
                </p>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  type="text"
                  placeholder="Type your change request..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !loadingChat) handleChat() }}
                  className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                />
                <button
                  onClick={handleChat}
                  disabled={loadingChat || !sessionId}
                  className="rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingChat ? "Updating..." : "Update Plan"}
                </button>
              </div>
            </section>
          </main>

          <aside className="space-y-6 xl:col-span-4">
            {/* Status */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Plan status</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Format</p>
                  <p className="mt-2 text-base font-medium text-slate-900">
                    {parsedPlan ? "Structured JSON plan" : "Text plan"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Saved Versions</p>
                  <p className="mt-2 text-base font-medium text-slate-900">{history.length}</p>
                </div>
              </div>
            </section>

            {/* History */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Plan History</h2>
              <p className="mt-1 text-sm text-slate-500">
                Restore any previous version with one click.
              </p>

              <div className="mt-5 space-y-3">
                {history.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No history found yet.
                  </div>
                ) : (
                  history.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => handleRestore(item)}
                      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900">
                          Version {history.length - index}
                        </p>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(item.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600 line-clamp-2">
                        {planSummary(item.plan)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
