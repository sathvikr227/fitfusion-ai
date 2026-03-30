"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "../../lib/supabase/client"

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

type FitnessMetrics = {
  bmi?: number | null
  estimated_body_fat_percent?: number | null
  target_bmi?: number | null
  target_body_fat_percent?: number | null
  status?: string | null
}

type StructuredPlan = {
  diet_plan?: {
    meals?: Meal[]
    daily_total_calories?: number | null
  }
  workout_plan?: WorkoutDay[]
  fitness_metrics?: FitnessMetrics
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

function getActualWorkoutDays(workoutDays: WorkoutDay[]) {
  return workoutDays.filter((day) => String(day.type ?? "").toLowerCase() !== "rest").length
}

export default function GeneratePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromOnboarding = searchParams.get("from") === "onboarding"

  const [planContent, setPlanContent] = useState<unknown>(null)
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [loadingConfirm, setLoadingConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savedMetrics, setSavedMetrics] = useState<FitnessMetrics | null>(null)

  const plan = useMemo(() => parsePlanContent(planContent), [planContent])

  const workoutDays = plan?.workout_plan ?? []
  const dietMeals = plan?.diet_plan?.meals ?? []
  const metrics = plan?.fitness_metrics ?? savedMetrics ?? null

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

  const rawText = useMemo(() => {
    if (!planContent) return ""
    if (typeof planContent === "string") return planContent
    try {
      return JSON.stringify(planContent, null, 2)
    } catch {
      return ""
    }
  }, [planContent])

  const handleGenerate = async () => {
    setLoadingGenerate(true)
    setError(null)
    setSuccess(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("User not logged in")
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
        throw new Error(data?.error || "Failed to generate plan")
      }

      const nextPlan = data.plan ?? data.updatedPlan ?? data.content ?? data.result ?? null

      setPlanContent(nextPlan)
      setSavedMetrics(data.fitness_metrics ?? nextPlan?.fitness_metrics ?? null)
      setSuccess("Plan generated successfully.")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingGenerate(false)
    }
  }

  useEffect(() => {
    if (fromOnboarding) {
      handleGenerate()
    }
  }, [fromOnboarding])

  const handleConfirm = async () => {
    if (!planContent) return

    setLoadingConfirm(true)
    setError(null)
    setSuccess(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const planToSave =
        typeof planContent === "string"
          ? safeJsonParse(planContent) ?? planContent
          : planContent

      const currentMetrics = (planToSave as StructuredPlan)?.fitness_metrics ?? savedMetrics ?? null

      const { error: planSaveError } = await supabase.from("workout_plans").insert({
        user_id: user.id,
        plan: planToSave,
      })

      if (planSaveError) throw planSaveError

      if (currentMetrics) {
        const { error: metricsSaveError } = await supabase.from("body_metrics").insert({
          user_id: user.id,
          bmi: currentMetrics.bmi ?? null,
          estimated_body_fat_percent: currentMetrics.estimated_body_fat_percent ?? null,
          target_bmi: currentMetrics.target_bmi ?? null,
          target_body_fat_percent: currentMetrics.target_body_fat_percent ?? null,
          status: currentMetrics.status ?? null,
          created_at: new Date().toISOString(),
        })

        if (metricsSaveError) {
          console.warn("Metrics save warning:", metricsSaveError.message)
        }
      }

      setSuccess("Plan saved successfully.")
      router.push("/dashboard/home")
    } catch (err: any) {
      setError(err?.message || "Failed to save plan.")
    } finally {
      setLoadingConfirm(false)
    }
  }

  const hasStructuredPlan = !!plan

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 px-6 py-8 text-slate-900 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Your AI Fitness Plan
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Generate, review, and confirm your structured workout, diet, and body metrics.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={loadingGenerate}
              className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 font-medium text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingGenerate ? "Generating..." : hasStructuredPlan ? "Regenerate Plan" : "Generate Plan"}
            </button>

            <button
              onClick={handleConfirm}
              disabled={!planContent || loadingConfirm}
              className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingConfirm ? "Saving..." : "Confirm Plan"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Diet Total</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {hasStructuredPlan ? totalDietCalories : 0} kcal
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Workout Burn</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {hasStructuredPlan ? totalWorkoutBurn : 0} kcal
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Avg / active workout day: {hasStructuredPlan ? dailyWorkoutBurn : 0} kcal
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Daily Net Calories</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {dailyNetCalories !== null ? `${dailyNetCalories} kcal` : "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Workout Days</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {activeWorkoutDays}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Status</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {metrics?.status ?? "--"}
            </h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">BMI</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {metrics?.bmi ?? "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Body Fat %</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {metrics?.estimated_body_fat_percent ?? "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Target BMI</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {metrics?.target_bmi ?? "--"}
            </h2>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Target Body Fat %</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {metrics?.target_body_fat_percent ?? "--"}
            </h2>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Workout Preview</h2>
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700">
                    {hasStructuredPlan ? totalWorkoutBurn : 0} kcal burn
                  </span>
                </div>

                {workoutDays.length > 0 ? (
                  <div className="space-y-4">
                    {workoutDays.map((day, index) => (
                      <div
                        key={`${day.day}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">
                              {day.day}
                              {day.type ? ` — ${day.type}` : ""}
                            </p>
                            <p className="text-xs text-slate-500">
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
                                className="flex items-center justify-between gap-4 rounded-xl bg-white px-3 py-2 text-sm"
                              >
                                <span className="font-medium text-slate-900">
                                  {exercise.name}
                                </span>
                                <span className="text-slate-500">
                                  {exercise.sets ? `${exercise.sets} sets` : "--"}{" "}
                                  {exercise.reps ? `× ${exercise.reps} reps` : ""}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">
                              No exercises listed.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : rawText ? (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {rawText}
                  </pre>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                    No workout plan generated yet.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Diet Preview</h2>
                  <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                    {hasStructuredPlan ? totalDietCalories : 0} kcal total
                  </span>
                </div>

                {dietMeals.length > 0 ? (
                  <div className="space-y-4">
                    {dietMeals.map((meal, index) => (
                      <div
                        key={`${meal.name}-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">{meal.name}</p>
                            <p className="text-xs text-slate-500">Meal breakdown</p>
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
                                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm"
                              >
                                <span className="font-medium text-slate-900">
                                  {item.food}
                                </span>
                                <span className="text-slate-500">
                                  {item.protein !== undefined && item.protein !== null
                                    ? `${item.protein}g protein`
                                    : ""}
                                </span>
                                <span className="font-semibold text-slate-700">
                                  {asNumber(item.calories)} kcal
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">
                              No food items listed.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-2xl border border-purple-100 bg-purple-50 p-4">
                      <p className="text-sm text-slate-500">Daily Total Calories</p>
                      <p className="mt-1 text-2xl font-bold text-purple-700">
                        {hasStructuredPlan ? totalDietCalories : 0} kcal
                      </p>
                    </div>
                  </div>
                ) : rawText ? (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {rawText}
                  </pre>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                    No diet plan generated yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-xl font-semibold">Before you confirm</h2>
              <p className="text-sm text-slate-500">
                Confirming will save this plan and your body metrics to Supabase and make it available for tracking.
              </p>
            </div>
          </div>

          <div className="space-y-6 xl:col-span-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold">Quick Summary</h2>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Active workout days</span>
                  <span className="font-semibold text-slate-900">
                    {hasStructuredPlan ? activeWorkoutDays : 0}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Avg workout burn/day</span>
                  <span className="font-semibold text-slate-900">
                    {hasStructuredPlan ? dailyWorkoutBurn : 0} kcal
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Net daily calories</span>
                  <span className="font-semibold text-slate-900">
                    {dailyNetCalories !== null ? `${dailyNetCalories} kcal` : "--"}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-xl font-semibold">Metrics Snapshot</h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">BMI</span>
                  <span className="font-semibold text-slate-900">{metrics?.bmi ?? "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Body Fat %</span>
                  <span className="font-semibold text-slate-900">
                    {metrics?.estimated_body_fat_percent ?? "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Target BMI</span>
                  <span className="font-semibold text-slate-900">{metrics?.target_bmi ?? "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Target Body Fat %</span>
                  <span className="font-semibold text-slate-900">
                    {metrics?.target_body_fat_percent ?? "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-slate-500">Status</span>
                  <span className="font-semibold text-slate-900">{metrics?.status ?? "--"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-xl font-semibold">Saved format</h2>
              <p className="text-sm text-slate-500">
                This page expects the generated plan to use the same structured JSON shape as the plan page.
              </p>
            </div>
          </div>
        </div>

        {!hasStructuredPlan && rawText ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            The generated response is still in a raw/old format. Regenerate once so it matches the structured
            plan schema and saves cleanly to the dashboard.
          </div>
        ) : null}
      </div>
    </div>
  )
}