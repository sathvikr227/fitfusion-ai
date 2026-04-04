"use client"

import { useState, useEffect } from "react"
import { supabase } from "../../lib/supabase/client"
import {
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Dumbbell,
  Utensils,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronRight,
  RefreshCw,
} from "lucide-react"

type Feasibility = {
  rating: "excellent" | "good" | "challenging" | "aggressive"
  message: string
  weeklyWeightChange: number
}

type Roadmap = {
  feasibility: Feasibility
  dailyCalories: number
  macros: { protein: number; carbs: number; fat: number }
  workoutSplit: { daysPerWeek: number; focus: string; structure: string[] }
  milestones: { week: number; weight: number; milestone: string }[]
  tips: string[]
  warnings?: string[]
}

const ACTIVITY_LEVELS = [
  { value: "sedentary", label: "Sedentary", desc: "Desk job, little exercise" },
  { value: "lightly_active", label: "Lightly Active", desc: "1–3 days/week" },
  { value: "moderately_active", label: "Moderately Active", desc: "3–5 days/week" },
  { value: "very_active", label: "Very Active", desc: "6–7 days/week" },
  { value: "extremely_active", label: "Athlete", desc: "Twice daily training" },
]

const GOALS = [
  { value: "lose_fat", label: "Lose Fat", icon: TrendingDown },
  { value: "build_muscle", label: "Build Muscle", icon: TrendingUp },
  { value: "recomposition", label: "Recomposition", icon: RefreshCw },
  { value: "maintain", label: "Maintain", icon: Target },
]

const TIMEFRAMES = [
  { weeks: 4, label: "1 Month" },
  { weeks: 8, label: "2 Months" },
  { weeks: 12, label: "3 Months" },
  { weeks: 24, label: "6 Months" },
  { weeks: 52, label: "1 Year" },
]

const feasibilityColor = {
  excellent: "text-emerald-600 dark:text-emerald-400",
  good: "text-blue-600 dark:text-blue-400",
  challenging: "text-amber-600 dark:text-amber-400",
  aggressive: "text-rose-600 dark:text-rose-400",
}

const feasibilityBg = {
  excellent: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
  good: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  challenging: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
  aggressive: "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800",
}

export default function DreamBodyPage() {
  const [currentWeight, setCurrentWeight] = useState("")
  const [targetWeight, setTargetWeight] = useState("")
  const [currentBodyFat, setCurrentBodyFat] = useState("")
  const [targetBodyFat, setTargetBodyFat] = useState("")
  const [heightCm, setHeightCm] = useState("")
  const [age, setAge] = useState("")
  const [gender, setGender] = useState("male")
  const [activityLevel, setActivityLevel] = useState("moderately_active")
  const [goal, setGoal] = useState("lose_fat")
  const [timeframeWeeks, setTimeframeWeeks] = useState(12)
  const [loading, setLoading] = useState(false)
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null)
  const [error, setError] = useState("")

  // Pre-fill from profile
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from("profiles")
        .select("weight_kg, height_cm, age, gender")
        .eq("id", user.id)
        .maybeSingle()

      if (profile) {
        if (profile.weight_kg) setCurrentWeight(String(profile.weight_kg))
        if (profile.height_cm) setHeightCm(String(profile.height_cm))
        if (profile.age) setAge(String(profile.age))
        if (profile.gender) setGender(profile.gender)
      }

      // Also try latest weight log
      const { data: wLog } = await supabase
        .from("weight_logs")
        .select("weight_kg")
        .eq("user_id", user.id)
        .order("logged_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (wLog?.weight_kg) setCurrentWeight(String(wLog.weight_kg))
    }
    load()
  }, [])

  const generate = async () => {
    if (!currentWeight || !targetWeight) {
      setError("Please enter your current and target weight.")
      return
    }
    setError("")
    setLoading(true)
    setRoadmap(null)

    try {
      const res = await fetch("/api/dream-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentWeight: parseFloat(currentWeight),
          targetWeight: parseFloat(targetWeight),
          currentBodyFat: currentBodyFat ? parseFloat(currentBodyFat) : null,
          targetBodyFat: targetBodyFat ? parseFloat(targetBodyFat) : null,
          heightCm: heightCm ? parseFloat(heightCm) : null,
          age: age ? parseInt(age) : null,
          gender,
          activityLevel,
          goal,
          timeframeWeeks,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to generate")
      setRoadmap(data.roadmap)
    } catch (err: any) {
      setError(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    "w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-purple-400 transition"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-4xl space-y-8">

        {/* Header */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-purple-100 dark:bg-purple-900/40 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide">
              AI Transformation
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-4xl">
            Dream Body Planner
          </h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Enter your goals and get a personalised AI roadmap — calories, macros, workout split, and milestones.
          </p>
        </div>

        {/* Form */}
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-6">

          {/* Goal selector */}
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Primary Goal</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {GOALS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setGoal(value)}
                  className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-medium transition ${
                    goal === value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Weight inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Current Weight (kg) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                value={currentWeight}
                onChange={(e) => setCurrentWeight(e.target.value)}
                placeholder="e.g. 85"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Target Weight (kg) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
                placeholder="e.g. 75"
                className={inputClass}
              />
            </div>
          </div>

          {/* Optional body fat */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Current Body Fat % <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                value={currentBodyFat}
                onChange={(e) => setCurrentBodyFat(e.target.value)}
                placeholder="e.g. 25"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Target Body Fat % <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                value={targetBodyFat}
                onChange={(e) => setTargetBodyFat(e.target.value)}
                placeholder="e.g. 15"
                className={inputClass}
              />
            </div>
          </div>

          {/* Physical stats */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Height (cm)</label>
              <input
                type="number"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                placeholder="e.g. 175"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Age</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 25"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={inputClass}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>

          {/* Activity level */}
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Activity Level</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {ACTIVITY_LEVELS.map(({ value, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setActivityLevel(value)}
                  className={`rounded-2xl border p-3 text-left text-xs transition ${
                    activityLevel === value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  <p className="font-semibold">{label}</p>
                  <p className="mt-0.5 opacity-70">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Timeframe */}
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Timeframe</p>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map(({ weeks, label }) => (
                <button
                  key={weeks}
                  onClick={() => setTimeframeWeeks(weeks)}
                  className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                    timeframeWeeks === weeks
                      ? "border-purple-500 bg-purple-600 text-white"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            onClick={generate}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 py-4 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating your roadmap...</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate My Dream Body Plan</>
            )}
          </button>
        </div>

        {/* Results */}
        {roadmap && (
          <div className="space-y-6">

            {/* Feasibility banner */}
            <div className={`rounded-3xl border p-5 ${feasibilityBg[roadmap.feasibility.rating]}`}>
              <div className="flex items-start gap-3">
                <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${feasibilityColor[roadmap.feasibility.rating]}`} />
                <div>
                  <p className={`font-semibold capitalize ${feasibilityColor[roadmap.feasibility.rating]}`}>
                    {roadmap.feasibility.rating} goal
                    <span className="ml-2 text-sm font-normal">
                      ({roadmap.feasibility.weeklyWeightChange > 0 ? "+" : ""}{roadmap.feasibility.weeklyWeightChange} kg/week)
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{roadmap.feasibility.message}</p>
                </div>
              </div>
            </div>

            {/* Warnings */}
            {roadmap.warnings && roadmap.warnings.length > 0 && (
              <div className="rounded-3xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <p className="font-semibold text-amber-700 dark:text-amber-300 text-sm">Important Notes</p>
                </div>
                <ul className="space-y-1.5">
                  {roadmap.warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700 dark:text-amber-300 flex gap-2">
                      <span>•</span><span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Calories + Macros */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Utensils className="h-4 w-4 text-purple-600" />
                  <p className="font-semibold text-slate-900 dark:text-white">Daily Nutrition Target</p>
                </div>
                <p className="text-4xl font-extrabold text-purple-600 dark:text-purple-400">
                  {roadmap.dailyCalories.toLocaleString()}
                  <span className="ml-1 text-lg font-normal text-slate-500 dark:text-slate-400">kcal</span>
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: "Protein", value: roadmap.macros.protein, color: "bg-blue-500" },
                    { label: "Carbs", value: roadmap.macros.carbs, color: "bg-amber-500" },
                    { label: "Fat", value: roadmap.macros.fat, color: "bg-rose-500" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-3 text-center">
                      <div className={`mx-auto mb-1.5 h-1.5 w-8 rounded-full ${color}`} />
                      <p className="text-lg font-bold text-slate-900 dark:text-white">{value}g</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Dumbbell className="h-4 w-4 text-cyan-600" />
                  <p className="font-semibold text-slate-900 dark:text-white">Workout Split</p>
                </div>
                <p className="text-3xl font-extrabold text-cyan-600 dark:text-cyan-400">
                  {roadmap.workoutSplit.daysPerWeek}
                  <span className="ml-1 text-lg font-normal text-slate-500 dark:text-slate-400">days/week</span>
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{roadmap.workoutSplit.focus}</p>
                <ul className="mt-4 space-y-1.5">
                  {roadmap.workoutSplit.structure.map((day, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500" />
                      {day}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Milestones */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <Calendar className="h-4 w-4 text-indigo-600" />
                <p className="font-semibold text-slate-900 dark:text-white">Transformation Timeline</p>
              </div>
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />
                <ul className="space-y-5 pl-10">
                  {roadmap.milestones.map((m, i) => (
                    <li key={i} className="relative">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-purple-500 bg-white dark:bg-slate-900" />
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Week {m.week}
                          </p>
                          <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-200">{m.milestone}</p>
                        </div>
                        <span className="shrink-0 rounded-xl bg-purple-50 dark:bg-purple-900/30 px-2.5 py-1 text-sm font-bold text-purple-700 dark:text-purple-300">
                          {m.weight} kg
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Tips */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <p className="font-semibold text-slate-900 dark:text-white">Success Tips</p>
              </div>
              <ul className="space-y-2.5">
                {roadmap.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* Regenerate */}
            <button
              onClick={generate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" /> Regenerate Plan
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
