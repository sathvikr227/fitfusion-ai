"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import {
  Dumbbell,
  Utensils,
  Droplets,
  Smile,
  CheckCircle2,
  Circle,
  ChevronRight,
  Flame,
  Plus,
  Minus,
  Loader2,
  Trophy,
  Sun,
  Moon,
  Sunset,
} from "lucide-react"

const MOODS = [
  { emoji: "😴", label: "Tired", value: 1 },
  { emoji: "😕", label: "Meh", value: 2 },
  { emoji: "😊", label: "Good", value: 3 },
  { emoji: "💪", label: "Strong", value: 4 },
  { emoji: "🔥", label: "Fired Up", value: 5 },
]

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return { text: "Good morning", icon: Sun }
  if (hour < 18) return { text: "Good afternoon", icon: Sunset }
  return { text: "Good evening", icon: Moon }
}

type Exercise = {
  name: string
  sets?: number | null
  reps?: number | null
  duration?: string | null
}

type PlanDay = {
  day?: string
  type?: string | null
  exercises?: Exercise[]
  estimated_calories_burned?: number | null
}

type PlanMeal = {
  name?: string
  items?: { food: string; calories?: number | null }[]
  total_calories?: number | null
}

export default function TodayPage() {
  const router = useRouter()
  const today = todayStr()
  const greeting = getGreeting()
  const GreetingIcon = greeting.icon

  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState("User")

  // Workout state
  const [todayWorkout, setTodayWorkout] = useState<PlanDay | null>(null)
  const [completedExercises, setCompletedExercises] = useState<Set<string>>(new Set())

  // Meal state
  const [meals, setMeals] = useState<PlanMeal[]>([])
  const [eatenMeals, setEatenMeals] = useState<Set<string>>(new Set())

  // Water state
  const STEP_ML = 250
  const waterGoalMl = 2500
  const [waterMl, setWaterMl] = useState(0)

  // Mood state
  const [mood, setMood] = useState<number | null>(null)
  const [moodSaved, setMoodSaved] = useState(false)

  // Streak
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace("/login"); return }

      setUserId(user.id)
      setUsername(user.email?.split("@")[0] ?? "User")

      // Fetch everything in parallel
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
      const [planRes, executionRes, mealExecRes, waterRes, moodRes, workoutLogsRes] = await Promise.all([
        supabase.from("workout_plans").select("plan").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("workout_execution").select("exercise_name, done").eq("user_id", user.id).eq("date", today),
        supabase.from("meal_execution").select("meal_name, eaten").eq("user_id", user.id).eq("date", today),
        supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("date", today).maybeSingle(),
        supabase.from("mood_logs").select("mood").eq("user_id", user.id).eq("date", today).maybeSingle(),
        supabase.from("workout_logs").select("date").eq("user_id", user.id).gte("date", thirtyDaysAgo).order("date", { ascending: false }),
      ])

      // Parse plan
      if (planRes.data?.plan) {
        let plan: any = planRes.data.plan
        if (typeof plan === "string") { try { plan = JSON.parse(plan) } catch {} }
        const workoutDays: PlanDay[] = plan?.workout_plan ?? []
        const dayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
        setTodayWorkout(workoutDays[dayIndex] ?? null)
        const planMeals: PlanMeal[] = plan?.diet_plan?.meals ?? []
        setMeals(planMeals)
      }

      // Restore exercise completions
      if (executionRes.data) {
        setCompletedExercises(new Set(
          executionRes.data.filter((r: any) => r.done).map((r: any) => r.exercise_name)
        ))
      }

      // Restore meal completions
      if (mealExecRes.data) {
        setEatenMeals(new Set(
          mealExecRes.data.filter((r: any) => r.eaten).map((r: any) => r.meal_name)
        ))
      }

      // Water
      if (waterRes.data?.amount_ml != null) {
        setWaterMl(waterRes.data.amount_ml)
      } else {
        const saved = parseInt(localStorage.getItem(`water-ml-${today}`) ?? "0", 10)
        setWaterMl(Number.isFinite(saved) ? saved : 0)
      }

      // Mood
      if (moodRes.data?.mood) setMood(moodRes.data.mood)

      // Streak calculation
      if (workoutLogsRes.data && workoutLogsRes.data.length > 0) {
        const dates = [...new Set(workoutLogsRes.data.map((r: any) => r.date?.split("T")[0]))].sort().reverse() as string[]
        let s = 0
        let cursor = today
        for (const d of dates) {
          if (d === cursor) {
            s++
            const prev = new Date(cursor)
            prev.setDate(prev.getDate() - 1)
            cursor = prev.toISOString().split("T")[0]
          } else if (d < cursor) {
            break
          }
        }
        setStreak(s)
      }

      setLoading(false)
    }
    load()
  }, [router, today])

  const toggleExercise = useCallback(async (name: string) => {
    if (!userId) return
    const newDone = !completedExercises.has(name)
    setCompletedExercises(prev => {
      const next = new Set(prev)
      newDone ? next.add(name) : next.delete(name)
      return next
    })
    await supabase.from("workout_execution").upsert(
      { user_id: userId, date: today, exercise_name: name, done: newDone },
      { onConflict: "user_id,date,exercise_name" }
    )
  }, [userId, today, completedExercises])

  const toggleMeal = useCallback(async (name: string) => {
    if (!userId) return
    const newEaten = !eatenMeals.has(name)
    setEatenMeals(prev => {
      const next = new Set(prev)
      newEaten ? next.add(name) : next.delete(name)
      return next
    })
    await supabase.from("meal_execution").upsert(
      { user_id: userId, date: today, meal_name: name, eaten: newEaten },
      { onConflict: "user_id,date,meal_name" }
    )
  }, [userId, today, eatenMeals])

  const addWater = useCallback((delta: number) => {
    setWaterMl(prev => {
      const next = Math.max(0, Math.min(waterGoalMl + 1000, prev + delta * STEP_ML))
      localStorage.setItem(`water-ml-${today}`, String(next))
      if (userId) {
        supabase.from("water_logs").upsert(
          { user_id: userId, date: today, amount_ml: next },
          { onConflict: "user_id,date" }
        ).then(() => {})
      }
      return next
    })
  }, [userId, today, waterGoalMl])

  const saveMood = useCallback(async (value: number) => {
    if (mood !== null) return
    setMood(value)
    if (userId) {
      await supabase.from("mood_logs").upsert(
        { user_id: userId, date: today, mood: value },
        { onConflict: "user_id,date" }
      )
      setMoodSaved(true)
    }
  }, [userId, today, mood])

  // Computed progress
  const exercises = todayWorkout?.exercises ?? []
  const isRestDay = todayWorkout?.type?.toLowerCase() === "rest"
  const workoutPct = exercises.length > 0
    ? Math.round((completedExercises.size / exercises.length) * 100)
    : 0
  const mealPct = meals.length > 0
    ? Math.round((eatenMeals.size / meals.length) * 100)
    : 0
  const waterPct = Math.min(Math.round((waterMl / waterGoalMl) * 100), 100)
  const overallPct = Math.round((workoutPct + mealPct + waterPct) / 3)

  const eatenCalories = meals
    .filter(m => eatenMeals.has(m.name ?? ""))
    .reduce((s, m) => s + (m.total_calories ?? 0), 0)
  const totalCalories = meals.reduce((s, m) => s + (m.total_calories ?? 0), 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 md:p-8">
        <div className="mx-auto max-w-2xl space-y-4 animate-pulse">
          <div className="h-24 rounded-3xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-48 rounded-3xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-40 rounded-3xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-32 rounded-3xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-2xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <GreetingIcon className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{greeting.text}, {username}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Today's Focus
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            {streak > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-orange-100 dark:bg-orange-900/30 px-3 py-1">
                <Flame className="h-3.5 w-3.5 text-orange-500" />
                <span className="text-xs font-bold text-orange-700 dark:text-orange-400">{streak}-day streak</span>
              </div>
            )}
          </div>
          {/* Overall ring */}
          <div className="relative h-16 w-16">
            <svg className="-rotate-90 h-16 w-16">
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-100 dark:text-slate-700" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                stroke="url(#todayGrad)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={163}
                strokeDashoffset={163 * (1 - overallPct / 100)}
                style={{ transition: "stroke-dashoffset 0.5s ease" }}
              />
              <defs>
                <linearGradient id="todayGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#9333ea" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{overallPct}%</span>
            </div>
          </div>
        </div>

        {/* Progress summary bar */}
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Workout", pct: workoutPct, color: "bg-purple-500" },
              { label: "Nutrition", pct: mealPct, color: "bg-cyan-500" },
              { label: "Hydration", pct: waterPct, color: "bg-blue-500" },
            ].map(({ label, pct, color }) => (
              <div key={label} className="text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">{label}</p>
                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">{pct}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Workout section */}
        <div className={`rounded-3xl border p-5 shadow-sm ${isRestDay ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" : "border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20"}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${isRestDay ? "bg-slate-100 dark:bg-slate-700" : "bg-purple-100 dark:bg-purple-900/50"}`}>
                <Dumbbell className={`h-4 w-4 ${isRestDay ? "text-slate-400" : "text-purple-600 dark:text-purple-400"}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isRestDay ? "Rest Day" : todayWorkout ? `${todayWorkout.day ?? "Workout"} — ${todayWorkout.type ?? "Training"}` : "No Workout Planned"}
                </p>
                {!isRestDay && exercises.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{completedExercises.size}/{exercises.length} exercises done</p>
                )}
              </div>
            </div>
            {!isRestDay && exercises.length > 0 && (
              <span className={`text-sm font-bold ${workoutPct === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-purple-600 dark:text-purple-400"}`}>
                {workoutPct === 100 ? "✓ Done!" : `${workoutPct}%`}
              </span>
            )}
          </div>

          {isRestDay ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Recovery day — stretch, walk, and sleep well.</p>
          ) : exercises.length === 0 ? (
            <button
              onClick={() => router.push("/dashboard/plan")}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-purple-300 dark:border-purple-700 py-3 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
            >
              Go to Plan <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="space-y-2">
              {exercises.map((ex) => {
                const done = completedExercises.has(ex.name)
                return (
                  <button
                    key={ex.name}
                    onClick={() => toggleExercise(ex.name)}
                    className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-all ${
                      done
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
                        : "bg-white/70 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600 hover:border-purple-200 dark:hover:border-purple-700"
                    }`}
                  >
                    {done
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <Circle className="h-4 w-4 text-slate-300 dark:text-slate-500 shrink-0" />
                    }
                    <span className={`flex-1 font-medium ${done ? "text-emerald-700 dark:text-emerald-300 line-through opacity-70" : "text-slate-900 dark:text-white"}`}>
                      {ex.name}
                    </span>
                    {(ex.sets || ex.reps) && (
                      <span className="text-xs text-slate-400">
                        {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ex.sets ? `${ex.sets} sets` : ""}
                      </span>
                    )}
                  </button>
                )
              })}

              {workoutPct === 100 && (
                <div className="mt-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 px-4 py-3 text-center">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">🎉 Workout complete! Amazing work.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Meals section */}
        {meals.length > 0 && (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-50 dark:bg-cyan-900/30">
                  <Utensils className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Today's Meals</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {eatenCalories} / {totalCalories} kcal eaten
                  </p>
                </div>
              </div>
              <span className={`text-sm font-bold ${mealPct === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-cyan-600 dark:text-cyan-400"}`}>
                {eatenMeals.size}/{meals.length}
              </span>
            </div>

            {/* Calorie progress bar */}
            {totalCalories > 0 && (
              <div className="mb-3 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${Math.min((eatenCalories / totalCalories) * 100, 100)}%` }}
                />
              </div>
            )}

            <div className="space-y-2">
              {meals.map((meal) => {
                const eaten = eatenMeals.has(meal.name ?? "")
                return (
                  <button
                    key={meal.name}
                    onClick={() => toggleMeal(meal.name ?? "")}
                    className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-all ${
                      eaten
                        ? "bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800"
                        : "bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600 hover:border-cyan-200"
                    }`}
                  >
                    {eaten
                      ? <CheckCircle2 className="h-4 w-4 text-cyan-500 shrink-0" />
                      : <Circle className="h-4 w-4 text-slate-300 dark:text-slate-500 shrink-0" />
                    }
                    <span className={`flex-1 font-medium ${eaten ? "text-cyan-700 dark:text-cyan-300 opacity-70" : "text-slate-900 dark:text-white"}`}>
                      {meal.name ?? "Meal"}
                    </span>
                    {meal.total_calories != null && (
                      <span className="text-xs text-slate-400">{meal.total_calories} kcal</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Water tracker */}
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-900/30">
                <Droplets className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Hydration</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Goal: {(waterGoalMl / 1000).toFixed(1)}L</p>
              </div>
            </div>
            <span className={`text-sm font-bold tabular-nums ${waterMl >= waterGoalMl ? "text-blue-500" : "text-slate-700 dark:text-slate-300"}`}>
              {(waterMl / 1000).toFixed(2)}L
            </span>
          </div>

          <div className="mb-3 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-500 transition-all duration-300"
              style={{ width: `${waterPct}%` }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => addWater(-1)}
              disabled={waterMl === 0}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 transition"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={() => addWater(1)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-500 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
            >
              <Plus className="h-4 w-4" /> +250ml
            </button>
          </div>

          {waterMl >= waterGoalMl && (
            <p className="mt-3 text-center text-xs font-medium text-blue-600 dark:text-blue-400">
              🎉 Hydration goal reached!
            </p>
          )}
        </div>

        {/* Mood check-in */}
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-900/30">
              <Smile className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {mood ? "Today's Mood" : "How are you feeling?"}
            </p>
          </div>
          <div className="flex gap-2">
            {MOODS.map(({ emoji, label, value }) => (
              <button
                key={value}
                onClick={() => saveMood(value)}
                disabled={mood !== null && mood !== value}
                className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border py-3 text-xs font-medium transition-all ${
                  mood === value
                    ? "border-amber-400 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 scale-105"
                    : "border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-amber-300 disabled:opacity-30"
                }`}
              >
                <span className="text-xl">{emoji}</span>
                <span className="hidden sm:block">{label}</span>
              </button>
            ))}
          </div>
          {moodSaved && (
            <p className="mt-3 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ Mood saved!</p>
          )}
        </div>

        {/* Completed state */}
        {overallPct === 100 && (
          <div className="rounded-3xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 p-6 shadow-lg text-center">
            <Trophy className="h-10 w-10 text-white mx-auto mb-3" />
            <h2 className="text-xl font-bold text-white">Perfect Day!</h2>
            <p className="mt-1 text-white/80 text-sm">You've completed every goal today. You're unstoppable!</p>
          </div>
        )}

        {/* Quick navigation */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push("/dashboard/progress")}
            className="flex items-center gap-3 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-left hover:border-purple-300 hover:shadow-md transition"
          >
            <Flame className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Log Progress</p>
              <p className="text-xs text-slate-400">Weight, workout, meals</p>
            </div>
          </button>
          <button
            onClick={() => router.push("/dashboard/plan")}
            className="flex items-center gap-3 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-left hover:border-cyan-300 hover:shadow-md transition"
          >
            <Dumbbell className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Full Plan</p>
              <p className="text-xs text-slate-400">Week view & diet</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
