"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { Lock, Star, Zap, Trophy } from "lucide-react"

// ─── Achievement Definitions ──────────────────────────────────────────────────

type AchievementDef = {
  id: string
  name: string
  desc: string
  icon: string
  category: "Workout" | "Streak" | "Diet" | "Health" | "Special"
}

const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_workout", name: "First Step", desc: "Log your first workout", icon: "🎯", category: "Workout" },
  { id: "workout_7", name: "Week Warrior", desc: "Log 7 workouts total", icon: "🔥", category: "Workout" },
  { id: "workout_30", name: "Monthly Beast", desc: "Log 30 workouts total", icon: "💪", category: "Workout" },
  { id: "workout_100", name: "Century Club", desc: "Log 100 workouts total", icon: "🏆", category: "Workout" },
  { id: "streak_3", name: "Hat Trick", desc: "3-day workout streak", icon: "3️⃣", category: "Streak" },
  { id: "streak_7", name: "Week Streak", desc: "7-day workout streak", icon: "🗓️", category: "Streak" },
  { id: "streak_30", name: "Iron Will", desc: "30-day workout streak", icon: "⚡", category: "Streak" },
  { id: "first_meal", name: "Food Logger", desc: "Log your first meal", icon: "🥗", category: "Diet" },
  { id: "meals_7", name: "Nutrition Starter", desc: "Log meals for 7 days", icon: "🍎", category: "Diet" },
  { id: "meals_30", name: "Nutrition Pro", desc: "Log meals for 30 days", icon: "🥦", category: "Diet" },
  { id: "water_7", name: "Hydration Hero", desc: "Log water for 7 days straight", icon: "💧", category: "Health" },
  { id: "first_weight", name: "Scale Starter", desc: "Log your first weight", icon: "⚖️", category: "Health" },
  { id: "weight_30", name: "Scale Master", desc: "Log weight for 30 days", icon: "📊", category: "Health" },
  { id: "early_bird", name: "Early Bird", desc: "Log a workout before 7am", icon: "🌅", category: "Special" },
  { id: "plan_generated", name: "Planner", desc: "Generate your first AI plan", icon: "🤖", category: "Special" },
]

const CATEGORIES = ["All", "Workout", "Streak", "Diet", "Health", "Special"] as const
type CategoryFilter = (typeof CATEGORIES)[number]

const XP_PER_ACHIEVEMENT = 100
const XP_PER_LEVEL = 500

// ─── Types ────────────────────────────────────────────────────────────────────

type EarnedMap = Record<string, string> // achievementId -> earned_at ISO string

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcStreak(dates: string[]): number {
  const unique = Array.from(new Set(dates.map((d) => d.split("T")[0]))).sort().reverse()
  if (!unique.length) return 0
  const today = new Date().toISOString().split("T")[0]
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yest = yesterday.toISOString().split("T")[0]
  if (unique[0] !== today && unique[0] !== yest) return 0
  let streak = 1
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1])
    const curr = new Date(unique[i])
    if (Math.round((prev.getTime() - curr.getTime()) / 86400000) === 1) streak++
    else break
  }
  return streak
}

function getDistinctDays(rows: { date?: string | null; created_at?: string }[]): string[] {
  return Array.from(new Set(rows.map((r) => (r.date ?? r.created_at ?? "").split("T")[0]).filter(Boolean)))
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AchievementsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [earnedMap, setEarnedMap] = useState<EarnedMap>({})
  const [newlyEarned, setNewlyEarned] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<CategoryFilter>("All")

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      setUserId(user.id)
      await checkAndAwardAchievements(user.id)
    }
    init()
  }, [router])

  const checkAndAwardAchievements = useCallback(async (uid: string) => {
    setLoading(true)

    // 1. Fetch already-earned achievements
    const { data: existingRaw } = await supabase
      .from("user_achievements")
      .select("achievement_id, earned_at")
      .eq("user_id", uid)

    const existing: EarnedMap = {}
    for (const row of existingRaw ?? []) {
      existing[row.achievement_id] = row.earned_at
    }

    // 2. Fetch source data
    const [
      { data: workoutLogs },
      { data: mealLogs },
      { data: waterLogs },
      { data: weightLogs },
      { data: plans },
    ] = await Promise.all([
      supabase.from("workout_logs").select("date, created_at").eq("user_id", uid),
      supabase.from("meal_logs").select("date, created_at").eq("user_id", uid),
      supabase.from("water_logs").select("date, created_at").eq("user_id", uid),
      supabase.from("weight_logs").select("created_at").eq("user_id", uid),
      supabase.from("fitness_plans").select("created_at").eq("user_id", uid).limit(1),
    ])

    const workouts = workoutLogs ?? []
    const meals = mealLogs ?? []
    const waters = waterLogs ?? []
    const weights = weightLogs ?? []

    const workoutCount = workouts.length
    const workoutDates = getDistinctDays(workouts)
    const workoutStreak = calcStreak(workoutDates)
    const mealDays = getDistinctDays(meals)
    const waterDays = getDistinctDays(waters)
    const waterStreak = calcStreak(waterDays)
    const weightCount = weights.length
    const hasPlan = (plans ?? []).length > 0

    const earlyBird = workouts.some((w) => {
      const h = new Date(w.created_at).getHours()
      return h < 7
    })

    // 3. Determine which to award
    function shouldEarn(id: string): boolean {
      if (existing[id]) return false
      switch (id) {
        case "first_workout": return workoutCount >= 1
        case "workout_7": return workoutCount >= 7
        case "workout_30": return workoutCount >= 30
        case "workout_100": return workoutCount >= 100
        case "streak_3": return workoutStreak >= 3
        case "streak_7": return workoutStreak >= 7
        case "streak_30": return workoutStreak >= 30
        case "first_meal": return meals.length >= 1
        case "meals_7": return mealDays.length >= 7
        case "meals_30": return mealDays.length >= 30
        case "water_7": return waterStreak >= 7
        case "first_weight": return weightCount >= 1
        case "weight_30": return weightCount >= 30
        case "early_bird": return earlyBird
        case "plan_generated": return hasPlan
        default: return false
      }
    }

    const toAward = ACHIEVEMENTS.filter((a) => shouldEarn(a.id))

    // 4. Insert new achievements
    if (toAward.length > 0) {
      const now = new Date().toISOString()
      const inserts = toAward.map((a) => ({
        user_id: uid,
        achievement_id: a.id,
        earned_at: now,
      }))
      await supabase.from("user_achievements").insert(inserts)
      for (const a of toAward) {
        existing[a.id] = now
      }
      setNewlyEarned(toAward.map((a) => a.id))
      // Clear the "newly earned" highlight after 4 seconds
      setTimeout(() => setNewlyEarned([]), 4000)
    }

    setEarnedMap(existing)
    setLoading(false)
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────────

  const earnedCount = Object.keys(earnedMap).length
  const totalCount = ACHIEVEMENTS.length
  const xp = earnedCount * XP_PER_ACHIEVEMENT
  const level = Math.floor(xp / XP_PER_LEVEL)
  const xpIntoLevel = xp % XP_PER_LEVEL
  const xpPct = Math.round((xpIntoLevel / XP_PER_LEVEL) * 100)

  const recentlyEarned = ACHIEVEMENTS
    .filter((a) => earnedMap[a.id])
    .sort((a, b) => new Date(earnedMap[b.id]).getTime() - new Date(earnedMap[a.id]).getTime())
    .slice(0, 3)

  const filtered = filter === "All"
    ? ACHIEVEMENTS
    : ACHIEVEMENTS.filter((a) => a.category === filter)

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Achievements</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Track your milestones and level up your fitness journey</p>
        </div>

        {/* XP / Level card */}
        <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-cyan-500 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                <Trophy className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/70">Current Level</p>
                <p className="text-3xl font-bold">{level}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-white/70">Total XP</p>
              <p className="text-2xl font-bold">{xp} XP</p>
              <p className="text-xs text-white/70">{earnedCount} / {totalCount} achievements</p>
            </div>
          </div>
          {/* XP progress bar */}
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-white/70">
              <span>Level {level}</span>
              <span>{xpIntoLevel} / {XP_PER_LEVEL} XP to Level {level + 1}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-white/20">
              <div
                className="h-2.5 rounded-full bg-white transition-all duration-700"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Recently Earned */}
        {recentlyEarned.length > 0 && (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <h2 className="font-semibold text-slate-900 dark:text-white">Recently Earned</h2>
            </div>
            <div className="space-y-2.5">
              {recentlyEarned.map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="text-2xl">{a.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{a.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{a.desc}</p>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{fmtDate(earnedMap[a.id])}</span>
                  <span className="rounded-xl bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">+100 XP</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-all ${filter === cat
                ? "bg-gradient-to-r from-violet-500 to-cyan-500 text-white shadow"
                : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-violet-300 dark:hover:border-violet-700"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Achievement grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((a) => {
            const earned = !!earnedMap[a.id]
            const isNew = newlyEarned.includes(a.id)

            return (
              <div
                key={a.id}
                className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm transition-all
                  ${earned
                    ? "border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50 to-cyan-50 dark:from-violet-900/20 dark:to-cyan-900/20"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grayscale"
                  }
                  ${isNew ? "animate-pulse ring-2 ring-violet-400 ring-offset-2" : ""}
                `}
              >
                {/* Lock overlay for unearned */}
                {!earned && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-slate-900/60 rounded-2xl">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                )}

                <div className={!earned ? "opacity-40" : ""}>
                  <span className="text-3xl">{a.icon}</span>
                  <div className="mt-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{a.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">{a.desc}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${earned ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" : "bg-slate-100 dark:bg-slate-700 text-slate-500"}`}>
                      {a.category}
                    </span>
                    {earned && (
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">100 XP</span>
                      </div>
                    )}
                  </div>
                  {earned && earnedMap[a.id] && (
                    <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{fmtDate(earnedMap[a.id])}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Progress footer */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Overall Progress</p>
            <p className="text-sm font-bold text-violet-600 dark:text-violet-400">{earnedCount} / {totalCount}</p>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-700"
              style={{ width: `${Math.round((earnedCount / totalCount) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
            {totalCount - earnedCount} achievement{totalCount - earnedCount !== 1 ? "s" : ""} remaining
          </p>
        </div>

      </div>
    </div>
  )
}
