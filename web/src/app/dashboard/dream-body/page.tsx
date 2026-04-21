"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
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
  Upload,
  X,
  Camera,
  Zap,
  Save,
  ArrowRight,
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
  const router = useRouter()
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
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle")

  // Photo inspiration state
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoAnalysis, setPhotoAnalysis] = useState<any>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [photoError, setPhotoError] = useState("")
  const [showPhotoSection, setShowPhotoSection] = useState(false)
  const [applied, setApplied] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // Auth guard + pre-fill from profile
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace("/login"); return }

      const { data: profile } = await supabase
        .from("profiles")
        .select("weight, height, age, gender")
        .eq("id", user.id)
        .maybeSingle()

      if (profile) {
        if (profile.weight) setCurrentWeight(String(profile.weight))
        if (profile.height) setHeightCm(String(profile.height))
        if (profile.age) setAge(String(profile.age))
        if (profile.gender) setGender(profile.gender)
      }

      // Also try latest weight log
      const { data: wLog } = await supabase
        .from("weight_logs")
        .select("weight")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (wLog?.weight) setCurrentWeight(String(wLog.weight))
    }
    load()
  }, [])

  const handlePhotoSelect = (file: File) => {
    setPhotoFile(file)
    setPhotoAnalysis(null)
    setPhotoError("")
    const reader = new FileReader()
    reader.onload = (e) => setPhotoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const analyzePhoto = async () => {
    if (!photoFile) return
    setPhotoLoading(true)
    setPhotoError("")
    setPhotoAnalysis(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace("/login"); return }
      const fd = new FormData()
      fd.append("image", photoFile)
      const res = await fetch("/api/analyze-inspiration", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to analyze")
      setPhotoAnalysis(data.analysis)
    } catch (err: any) {
      setPhotoError(err.message || "Failed to analyze photo")
    } finally {
      setPhotoLoading(false)
    }
  }

  const applyPhotoAnalysis = () => {
    if (!photoAnalysis) return
    if (photoAnalysis.primaryGoal) setGoal(photoAnalysis.primaryGoal)
    if (photoAnalysis.suggestedTargetBodyFat) setTargetBodyFat(String(photoAnalysis.suggestedTargetBodyFat))
    setApplied(true)
    setTimeout(() => setApplied(false), 3000)
    // Scroll down to the form so user can see what changed
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
  }

  const generate = async () => {
    if (!currentWeight || !targetWeight) {
      setError("Please enter your current and target weight.")
      return
    }
    setError("")
    setLoading(true)
    setRoadmap(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace("/login"); return }
      const res = await fetch("/api/dream-body", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
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

  const saveRoadmapAsPlan = async () => {
    if (!roadmap) return
    setSaving(true)
    setSaveStatus("idle")
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace("/login"); return }

      // 1. Save calorie + macro targets to profile
      await supabase
        .from("profiles")
        .update({
          calorie_target: roadmap.dailyCalories,
          protein_target: roadmap.macros.protein,
          carbs_target: roadmap.macros.carbs,
          fat_target: roadmap.macros.fat,
        })
        .eq("id", session.user.id)

      // 2. Generate and save a full workout plan via the existing API
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId: session.user.id }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to generate workout plan")
      }

      setSaveStatus("saved")
      // Navigate to the plan page after a short delay
      setTimeout(() => router.push("/dashboard/plan"), 1200)
    } catch (err: any) {
      console.error("Save roadmap error:", err)
      setSaveStatus("error")
    } finally {
      setSaving(false)
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

        {/* Photo Inspiration Section */}
        <div className="rounded-3xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-6 shadow-sm">
          <button
            onClick={() => setShowPhotoSection((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white">
                <Camera className="h-5 w-5" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-slate-900 dark:text-white">Inspiration Photo Analyzer</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Upload a celebrity or physique photo — AI will build your plan around it</p>
              </div>
            </div>
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40 px-3 py-1 rounded-full">
              {showPhotoSection ? "Hide" : "Try it"}
            </span>
          </button>

          {showPhotoSection && (
            <div className="mt-5 space-y-4">
              {/* Upload area */}
              {!photoPreview ? (
                <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 p-10 cursor-pointer hover:border-purple-500 transition">
                  <Upload className="h-8 w-8 text-purple-400" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop a photo here or click to upload</p>
                    <p className="text-xs text-slate-400 mt-1">Celebrity, athlete, or any physique photo · JPG, PNG, WebP</p>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handlePhotoSelect(f)
                    }}
                  />
                </label>
              ) : (
                <div className="flex gap-4 items-start">
                  <div className="relative shrink-0">
                    <img
                      src={photoPreview}
                      alt="Inspiration"
                      className="h-40 w-32 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow"
                    />
                    <button
                      onClick={() => { setPhotoPreview(null); setPhotoFile(null); setPhotoAnalysis(null); setPhotoError("") }}
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-red-500 transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-3">
                    {!photoAnalysis && (
                      <button
                        onClick={analyzePhoto}
                        disabled={photoLoading}
                        className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold text-sm shadow hover:opacity-90 transition disabled:opacity-60"
                      >
                        {photoLoading ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing physique...</>
                        ) : (
                          <><Zap className="h-4 w-4" /> Analyze This Physique</>
                        )}
                      </button>
                    )}
                    {photoError && (
                      <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{photoError}</p>
                    )}

                    {/* Analysis result */}
                    {photoAnalysis && (
                      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <p className="font-semibold text-sm text-slate-900 dark:text-white">AI Analysis Complete</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5">
                            <p className="text-slate-400">Physique Type</p>
                            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">{photoAnalysis.physiqueType}</p>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5">
                            <p className="text-slate-400">Est. Body Fat</p>
                            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">{photoAnalysis.estimatedBodyFat}</p>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5">
                            <p className="text-slate-400">Muscle Level</p>
                            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">{photoAnalysis.muscleLevel}</p>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5">
                            <p className="text-slate-400">Time Estimate</p>
                            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">{photoAnalysis.estimatedTimeToAchieve}</p>
                          </div>
                        </div>

                        {photoAnalysis.observations && (
                          <div>
                            <p className="text-xs font-medium text-slate-500 mb-1.5">Key Observations</p>
                            <ul className="space-y-1">
                              {photoAnalysis.observations.map((o: string, i: number) => (
                                <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-1.5">
                                  <span className="text-purple-500 shrink-0">•</span>{o}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-1.5 text-xs">
                          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2">
                            <span className="text-blue-500 font-medium">Workout: </span>
                            <span className="text-slate-700 dark:text-slate-300">{photoAnalysis.workoutFocus}</span>
                          </div>
                          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
                            <span className="text-amber-500 font-medium">Diet: </span>
                            <span className="text-slate-700 dark:text-slate-300">{photoAnalysis.dietApproach}</span>
                          </div>
                          {photoAnalysis.keyMuscleGroups && (
                            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl px-3 py-2">
                              <span className="text-purple-500 font-medium">Focus Muscles: </span>
                              <span className="text-slate-700 dark:text-slate-300">{photoAnalysis.keyMuscleGroups.join(", ")}</span>
                            </div>
                          )}
                        </div>

                        {photoAnalysis.inspiration && (
                          <p className="text-xs italic text-slate-500 dark:text-slate-400 border-l-2 border-purple-400 pl-3">
                            {photoAnalysis.inspiration}
                          </p>
                        )}

                        <button
                          onClick={applyPhotoAnalysis}
                          className={`w-full py-2.5 rounded-xl text-white text-xs font-semibold transition flex items-center justify-center gap-2 ${applied ? "bg-green-500" : "bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90"}`}
                        >
                          {applied ? (
                            <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Applied! Scroll down to see</>
                          ) : (
                            "Apply to My Plan Form"
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form */}
        <div ref={formRef} className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-6">
          {applied && (
            <div className="flex items-center gap-2 rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-green-700 dark:text-green-400 text-sm font-medium">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Analysis applied! Goal and target body fat have been updated below.
            </div>
          )}

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

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-6 animate-pulse">
            <div className="h-20 rounded-3xl bg-slate-200 dark:bg-slate-800" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="h-44 rounded-3xl bg-slate-200 dark:bg-slate-800" />
              <div className="h-44 rounded-3xl bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="h-64 rounded-3xl bg-slate-200 dark:bg-slate-800" />
            <div className="h-32 rounded-3xl bg-slate-200 dark:bg-slate-800" />
          </div>
        )}

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

            {/* Save & Apply CTA */}
            <div className="rounded-3xl border-2 border-purple-200 dark:border-purple-700 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-6 space-y-4">
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-lg">Ready to make it official?</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Save your calorie & macro targets, then generate a full workout plan tailored to this roadmap.
                </p>
              </div>

              {saveStatus === "saved" && (
                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Plan saved! Redirecting to your dashboard…
                </div>
              )}
              {saveStatus === "error" && (
                <div className="flex items-center gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Something went wrong. Please try again.
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={saveRoadmapAsPlan}
                  disabled={saving || saveStatus === "saved"}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 py-4 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Saving & Generating Plan…</>
                  ) : saveStatus === "saved" ? (
                    <><CheckCircle2 className="h-4 w-4" /> Saved!</>
                  ) : (
                    <><Save className="h-4 w-4" /> Save & Generate My Workout Plan</>
                  )}
                </button>
                <button
                  onClick={() => router.push("/dashboard/plan")}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  View My Plan <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 p-3 text-center">
                  <p className="text-xl font-extrabold text-purple-600 dark:text-purple-400">{roadmap.dailyCalories.toLocaleString()}</p>
                  <p className="text-xs text-slate-400 mt-0.5">kcal / day</p>
                </div>
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 p-3 text-center">
                  <p className="text-xl font-extrabold text-cyan-600 dark:text-cyan-400">{roadmap.workoutSplit.daysPerWeek}x</p>
                  <p className="text-xs text-slate-400 mt-0.5">days/week</p>
                </div>
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 p-3 text-center">
                  <p className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">{roadmap.milestones.length}</p>
                  <p className="text-xs text-slate-400 mt-0.5">milestones</p>
                </div>
              </div>
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
