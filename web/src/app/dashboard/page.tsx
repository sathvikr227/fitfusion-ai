"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"

type PlanHistoryItem = {
  id: string
  plan: string
  created_at: string
}

function splitPlan(plan: string) {
  const workoutMatch = plan.match(
    /Workout Plan:\s*([\s\S]*?)(?:\n\s*Diet Plan:|$)/i
  )
  const dietMatch = plan.match(/Diet Plan:\s*([\s\S]*)$/i)

  const workout = workoutMatch?.[1]?.trim() || ""
  const diet = dietMatch?.[1]?.trim() || ""

  return {
    workout: workout || plan,
    diet,
    hasStructuredSections: Boolean(workout || diet),
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

function safePlanText(value: unknown) {
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

export default function Dashboard() {
  const router = useRouter()

  const [plan, setPlan] = useState<string | null>(null)
  const [history, setHistory] = useState<PlanHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const parsed = useMemo(() => {
    if (!plan) {
      return {
        workout: "",
        diet: "",
        hasStructuredSections: false,
      }
    }
    return splitPlan(plan)
  }, [plan])

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

      // Create or load chat session for memory-enabled chat
      const { data: existingSession, error: sessionError } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!sessionError && existingSession?.id) {
        setSessionId(existingSession.id)
      } else {
        const { data: newSession, error: newSessionError } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id })
          .select("id")
          .single()

        if (!newSessionError && newSession?.id) {
          setSessionId(newSession.id)
        }
      }

      const { data: latestPlan, error: latestError } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!latestError && latestPlan?.plan) {
        const latestPlanText = safePlanText(latestPlan.plan)
        setPlan(latestPlanText)
        localStorage.setItem("plan", latestPlanText)
      } else {
        const savedPlan = localStorage.getItem("plan")
        if (savedPlan) {
          setPlan(savedPlan)
        } else {
          router.push("/onboarding")
          return
        }
      }

      const { data: planHistory, error: historyError } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8)

      if (!historyError && planHistory) {
        const normalizedHistory = planHistory.map((item: any) => ({
          ...item,
          plan: safePlanText(item.plan),
        }))
        setHistory(normalizedHistory as PlanHistoryItem[])
      }
    } catch (err) {
      console.error("Dashboard load error:", err)

      const savedPlan = localStorage.getItem("plan")
      if (savedPlan) {
        setPlan(savedPlan)
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
    if (!input.trim() || !plan || !sessionId) return

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

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input,
          currentPlan: plan,
          sessionId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update plan")
      }

      const data = await res.json()
      const nextPlan = data.plan ?? null

      if (!nextPlan) {
        throw new Error("No updated plan returned from API")
      }

      const nextPlanText = safePlanText(nextPlan)

      setPlan(nextPlanText)
      localStorage.setItem("plan", nextPlanText)
      setInput("")

      // Save updated plan to workout_plans
      const { error: saveError } = await supabase.from("workout_plans").insert({
        user_id: user.id,
        plan: nextPlan,
      })

      if (saveError) {
        console.error("SAVE ERROR:", saveError)
      }

      const { data: updatedHistory } = await supabase
        .from("workout_plans")
        .select("id, plan, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8)

      if (updatedHistory) {
        const normalizedHistory = updatedHistory.map((item: any) => ({
          ...item,
          plan: safePlanText(item.plan),
        }))
        setHistory(normalizedHistory as PlanHistoryItem[])
      }
    } catch (err) {
      console.error("CHAT ERROR:", err)
      setError("Failed to update plan. Please try again.")
    } finally {
      setLoadingChat(false)
    }
  }

  const handleRegenerate = async () => {
    localStorage.removeItem("plan")
    router.push("/generate")
  }

  const handleRestore = async (item: PlanHistoryItem) => {
    setPlan(item.plan)
    localStorage.setItem("plan", item.plan)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { error: saveError } = await supabase.from("workout_plans").insert({
      user_id: user.id,
      plan: JSON.parse(item.plan),
    })

    if (saveError) {
      console.error("RESTORE SAVE ERROR:", saveError)
    }

    const { data: updatedHistory } = await supabase
      .from("workout_plans")
      .select("id, plan, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8)

    if (updatedHistory) {
      const normalizedHistory = updatedHistory.map((row: any) => ({
        ...row,
        plan: safePlanText(row.plan),
      }))
      setHistory(normalizedHistory as PlanHistoryItem[])
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
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

        <div className="grid gap-6 xl:grid-cols-12">
          <main className="space-y-6 xl:col-span-8">
            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Workout Plan
                  </h2>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                    Weekly
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {parsed.workout || "No workout plan found"}
                </pre>
              </div>

              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Diet Plan
                  </h2>
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700">
                    Nutrition
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {parsed.diet || "No diet plan found"}
                </pre>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Modify your plan with AI
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Example: remove eggs, add cardio, make it beginner-friendly.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  type="text"
                  placeholder="Type your change request..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                />

                <button
                  onClick={handleChat}
                  disabled={loadingChat}
                  className="rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingChat ? "Updating..." : "Update Plan"}
                </button>
              </div>
            </section>
          </main>

          <aside className="space-y-6 xl:col-span-4">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Plan status</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Current State
                  </p>
                  <p className="mt-2 text-base font-medium text-slate-900">
                    {parsed.hasStructuredSections ? "Structured plan" : "Raw plan"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Saved Versions
                  </p>
                  <p className="mt-2 text-base font-medium text-slate-900">
                    {history.length}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Plan History</h2>
              <p className="mt-1 text-sm text-slate-500">
                Restore any previous version with one click.
              </p>

              <div className="mt-5 space-y-3">
                {history.length === 0 ? (
                  <div className="rounded-2xl border border-gray-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No history found yet.
                  </div>
                ) : (
                  history.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => handleRestore(item)}
                      className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900">
                          Version {history.length - index}
                        </p>
                        <span className="text-xs text-slate-400">
                          {formatDateTime(item.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                        {item.plan.slice(0, 180)}
                        {item.plan.length > 180 ? "..." : ""}
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