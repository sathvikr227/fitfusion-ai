"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { Loader2, Download, Brain, ChevronDown, ChevronUp } from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
} from "recharts"

// ─── Types ────────────────────────────────────────────────────────────────────

type WeightLog = {
  weight: number | null
  date: string | null
  created_at: string
}

type WorkoutLog = {
  total_calories: number | null
  date: string | null
  created_at: string
}

type MealLog = {
  total_calories: number | null
  date: string | null
}

// ─── AnomalyAlerts ────────────────────────────────────────────────────────────

type AnomalyAlert = {
  type: "anomaly" | "plateau" | "spike"
  severity: "warning" | "info"
  message: string
}

function computeAnomalyAlerts(
  weightLogs: WeightLog[],
  mealLogs: MealLog[]
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = []

  // ── Weight change z-scores ─────────────────────────────────────────────────
  const validWeight = weightLogs
    .filter((l) => l.weight != null && (l.date ?? l.created_at))
    .map((l) => ({
      date: l.date ?? l.created_at.split("T")[0],
      weight: l.weight as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (validWeight.length >= 3) {
    const changes: { date: string; change: number }[] = []
    for (let i = 1; i < validWeight.length; i++) {
      changes.push({
        date: validWeight[i].date,
        change: validWeight[i].weight - validWeight[i - 1].weight,
      })
    }

    const vals = changes.map((c) => c.change)
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const stddev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)

    if (stddev > 0) {
      changes.forEach(({ date, change }) => {
        const z = (change - mean) / stddev
        if (Math.abs(z) >= 2) {
          const direction = change > 0 ? "+" : ""
          alerts.push({
            type: "spike",
            severity: "warning",
            message: `Weight spike detected on ${date} (${direction}${change.toFixed(1)}kg, z-score: ${z.toFixed(1)})`,
          })
        }
      })
    }

    // ── Plateau detection ────────────────────────────────────────────────────
    const now = new Date()
    const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]
    const last14 = validWeight.filter((l) => l.date >= cutoff)

    if (last14.length > 5) {
      const totalChange = Math.abs(last14[last14.length - 1].weight - last14[0].weight)
      if (totalChange < 0.3) {
        alerts.push({
          type: "plateau",
          severity: "info",
          message: "Weight plateau detected — no significant change in the last 14 days",
        })
      }
    }
  }

  // ── Calorie z-scores ───────────────────────────────────────────────────────
  const calsByDate: Record<string, number> = {}
  mealLogs.forEach((m) => {
    if (!m.date || m.total_calories == null) return
    calsByDate[m.date] = (calsByDate[m.date] ?? 0) + m.total_calories
  })

  const calEntries = Object.entries(calsByDate).sort(([a], [b]) => a.localeCompare(b))
  if (calEntries.length >= 3) {
    const cals = calEntries.map(([, v]) => v)
    const mean = cals.reduce((s, v) => s + v, 0) / cals.length
    const stddev = Math.sqrt(cals.reduce((s, v) => s + (v - mean) ** 2, 0) / cals.length)

    if (stddev > 0) {
      calEntries.forEach(([date, cal]) => {
        const z = (cal - mean) / stddev
        if (z >= 2) {
          alerts.push({
            type: "anomaly",
            severity: "warning",
            message: `Unusually high calorie intake on ${date} (${Math.round(cal)} kcal, z-score: ${z.toFixed(1)})`,
          })
        } else if (z <= -2) {
          alerts.push({
            type: "anomaly",
            severity: "info",
            message: `Very low calorie intake on ${date} (${Math.round(cal)} kcal, z-score: ${z.toFixed(1)})`,
          })
        }
      })
    }
  }

  return alerts
}

function AnomalyAlerts({
  weightLogs,
  mealLogs,
}: {
  weightLogs: WeightLog[]
  mealLogs: MealLog[]
}) {
  const alerts = useMemo(
    () => computeAnomalyAlerts(weightLogs, mealLogs),
    [weightLogs, mealLogs]
  )
  const [open, setOpen] = useState(alerts.length > 0)

  // Re-open if new alerts appear
  useEffect(() => {
    if (alerts.length > 0) setOpen(true)
  }, [alerts.length])

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-slate-900 dark:text-white text-sm">AI Anomaly Detection</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {alerts.length === 0
                ? "All metrics look normal"
                : `${alerts.length} alert${alerts.length > 1 ? "s" : ""} detected`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {alerts.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs font-semibold">
              {alerts.length}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="px-6 pb-5 border-t border-slate-100 dark:border-slate-700">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 pt-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                <span className="text-emerald-600 text-sm font-bold">✓</span>
              </div>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                All metrics look normal — no anomalies detected.
              </p>
            </div>
          ) : (
            <ul className="pt-4 space-y-2.5">
              {alerts.map((alert, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={`shrink-0 mt-0.5 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      alert.severity === "warning"
                        ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                    }`}
                  >
                    {alert.severity === "warning" ? "Warning" : "Info"}
                  </span>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{alert.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ─── K-Means clustering ────────────────────────────────────────────────────────

function kMeans(points: number[][], k: number, maxIter = 40): { clusters: number[]; centroids: number[][] } {
  if (points.length === 0) return { clusters: [], centroids: [] }
  const n = points.length
  const dim = points[0].length
  if (n <= k) return { clusters: points.map((_, i) => i), centroids: points.slice() }

  // Deterministic init: pick k evenly spaced points
  const step = Math.floor(n / k)
  const centroids = Array.from({ length: k }, (_, i) => [...points[i * step]])
  let clusters = new Array(n).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    const newClusters = points.map((p) => {
      let best = 0
      let minDist = Infinity
      for (let ci = 0; ci < k; ci++) {
        const d = centroids[ci].reduce((s, v, di) => s + (v - p[di]) ** 2, 0)
        if (d < minDist) { minDist = d; best = ci }
      }
      return best
    })
    if (newClusters.every((c, i) => c === clusters[i])) break
    clusters = newClusters
    for (let ci = 0; ci < k; ci++) {
      const pts = points.filter((_, i) => clusters[i] === ci)
      if (pts.length === 0) continue
      for (let di = 0; di < dim; di++) {
        centroids[ci][di] = pts.reduce((s, p) => s + p[di], 0) / pts.length
      }
    }
  }
  return { clusters, centroids }
}

// ─── Linear regression (weight prediction) ────────────────────────────────────

function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length
  if (n < 2) return null

  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  return { slope, intercept }
}

// ─── Streak calculation ────────────────────────────────────────────────────────

function calculateStreak(workoutDates: string[]): { current: number; longest: number } {
  if (workoutDates.length === 0) return { current: 0, longest: 0 }

  const uniqueDays = Array.from(
    new Set(workoutDates.map((d) => new Date(d).toISOString().split("T")[0]))
  ).sort()

  let current = 0
  let longest = 0
  let streak = 1

  for (let i = uniqueDays.length - 1; i >= 0; i--) {
    const today = new Date().toISOString().split("T")[0]
    const dayDiff =
      (new Date(today).getTime() - new Date(uniqueDays[i]).getTime()) /
      (1000 * 60 * 60 * 24)

    if (i === uniqueDays.length - 1) {
      current = dayDiff <= 1 ? 1 : 0
    } else {
      const prev = uniqueDays[i + 1]
      const curr = uniqueDays[i]
      const gap =
        (new Date(prev).getTime() - new Date(curr).getTime()) /
        (1000 * 60 * 60 * 24)
      if (gap === 1) {
        streak++
        if (i === uniqueDays.length - 2 || current > 0) current = streak
      } else {
        longest = Math.max(longest, streak)
        streak = 1
        if (current === 0) current = 0
      }
    }
  }

  longest = Math.max(longest, streak)
  if (current === 0 && uniqueDays.length > 0) {
    const today = new Date().toISOString().split("T")[0]
    const last = uniqueDays[uniqueDays.length - 1]
    const gap =
      (new Date(today).getTime() - new Date(last).getTime()) /
      (1000 * 60 * 60 * 24)
    if (gap <= 1) current = streak
  }

  return { current, longest }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter()

  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([])
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([])
  const [mealLogs, setMealLogs] = useState<MealLog[]>([])
  const [sleepByDate, setSleepByDate] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  // Weekly report state
  const [report, setReport] = useState<string | null>(null)
  const [reportStats, setReportStats] = useState<Record<string, unknown> | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

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

      const [weightRes, workoutRes, sleepRes, mealRes] = await Promise.all([
        supabase
          .from("weight_logs")
          .select("weight, date, created_at")
          .eq("user_id", user.id)
          .order("date", { ascending: true, nullsFirst: false }),
        supabase
          .from("workout_logs")
          .select("total_calories, date, created_at")
          .eq("user_id", user.id)
          .order("date", { ascending: true, nullsFirst: false }),
        supabase
          .from("sleep_logs")
          .select("date, sleep_hours")
          .eq("user_id", user.id),
        supabase
          .from("meal_logs")
          .select("total_calories, date")
          .eq("user_id", user.id)
          .order("date", { ascending: true, nullsFirst: false }),
      ])

      if (weightRes.data) setWeightLogs(weightRes.data)
      if (workoutRes.data) setWorkoutLogs(workoutRes.data)
      if (mealRes.data) setMealLogs(mealRes.data as MealLog[])
      if (sleepRes.data) {
        const m = new Map<string, number>()
        sleepRes.data.forEach((r: any) => { if (r.date && r.sleep_hours != null) m.set(r.date, Number(r.sleep_hours)) })
        setSleepByDate(m)
      }

      setLoading(false)
    }

    load()
  }, [router])

  // ── Weight chart data + prediction ────────────────────────────────────────

  const weightChartData = useMemo(() => {
    const points = weightLogs
      .filter((d) => d.weight != null)
      .map((d, i) => ({
        x: i,
        y: d.weight as number,
        date: new Date(d.date ?? d.created_at).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        }),
      }))

    const reg = linearRegression(points.map((p) => ({ x: p.x, y: p.y })))

    return points.map((p) => ({
      date: p.date,
      weight: p.y,
      predicted: reg
        ? parseFloat((reg.slope * p.x + reg.intercept).toFixed(1))
        : undefined,
    }))
  }, [weightLogs])

  const weightPrediction = useMemo(() => {
    const points = weightLogs
      .filter((d) => d.weight != null)
      .map((d, i) => ({ x: i, y: d.weight as number }))

    const reg = linearRegression(points)
    if (!reg || points.length < 2) return null

    const nextX = points.length + 6
    const predicted = parseFloat((reg.slope * nextX + reg.intercept).toFixed(1))
    const direction = reg.slope < -0.05 ? "losing" : reg.slope > 0.05 ? "gaining" : "maintaining"
    return { predicted, direction, ratePerWeek: parseFloat((reg.slope * 7).toFixed(2)) }
  }, [weightLogs])

  // ── Workout activity chart ─────────────────────────────────────────────────

  const workoutActivityData = useMemo(() => {
    const dayMap: Record<string, number> = {}
    const caloriesMap: Record<string, number> = {}

    workoutLogs.forEach((d) => {
      const dateStr = d.date ?? d.created_at.split("T")[0]
      const label = new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
      dayMap[label] = (dayMap[label] || 0) + 1
      caloriesMap[label] = (caloriesMap[label] || 0) + (d.total_calories || 0)
    })

    return Object.keys(dayMap).map((day) => ({
      day,
      workouts: dayMap[day],
      calories: caloriesMap[day],
    }))
  }, [workoutLogs])

  // ── Streak ─────────────────────────────────────────────────────────────────

  const streak = useMemo(() => {
    const dates = workoutLogs.map((d) => d.date ?? d.created_at)
    return calculateStreak(dates)
  }, [workoutLogs])

  // ── Habit pattern analysis + K-Means clustering ───────────────────────────

  const habitPatterns = useMemo(() => {
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const dayCounts: Record<string, number> = {}
    DAYS.forEach((d) => (dayCounts[d] = 0))

    workoutLogs.forEach((log) => {
      const date = new Date(log.date ?? log.created_at)
      const day = DAYS[date.getDay()]
      dayCounts[day] = (dayCounts[day] || 0) + 1
    })

    const radarData = DAYS.map((day) => ({ day, workouts: dayCounts[day] }))
    const sortedDays = [...DAYS].sort((a, b) => dayCounts[b] - dayCounts[a])
    const bestDay = sortedDays[0]
    const worstDay = sortedDays[sortedDays.length - 1]

    const totalDays = workoutLogs.length > 0
      ? Math.ceil(
          (new Date(workoutLogs[workoutLogs.length - 1].date ?? workoutLogs[workoutLogs.length - 1].created_at).getTime() -
            new Date(workoutLogs[0].date ?? workoutLogs[0].created_at).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : 0
    const consistencyRate = totalDays > 0 ? Math.min(100, Math.round((workoutLogs.length / totalDays) * 100)) : 0

    const sortedDates = Array.from(
      new Set(workoutLogs.map((l) => (l.date ?? l.created_at.split("T")[0])))
    ).sort()
    let longRestCount = 0
    for (let i = 1; i < sortedDates.length; i++) {
      const gap = (new Date(sortedDates[i]).getTime() - new Date(sortedDates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
      if (gap > 2) longRestCount++
    }

    // ── K-Means clustering on workout sessions ────────────────────────────────
    // Features: [day_of_week (0–1), calories (0–1), sleep_hours (0–1)]
    const maxCals = Math.max(...workoutLogs.map((l) => l.total_calories || 0), 1)
    const maxSleep = 10 // normalize against 10h max
    const points = workoutLogs.map((log) => {
      const dateStr = (log.date ?? log.created_at ?? "").split("T")[0]
      const dayIdx = new Date(log.date ?? log.created_at).getDay()
      const calNorm = (log.total_calories || 0) / maxCals
      const sleepNorm = (sleepByDate.get(dateStr) ?? 7) / maxSleep // default 7h if no log
      return [dayIdx / 6, calNorm, sleepNorm]
    })

    const K = Math.min(3, workoutLogs.length)
    const { clusters, centroids } = kMeans(points, K)

    const clusterLabels = centroids.map((c) => {
      const calPct = c[1] * 100
      const sleepH = c[2] * maxSleep
      if (calPct >= 65 && sleepH >= 7) return "High Intensity + Well Rested"
      if (calPct >= 65) return "High Intensity"
      if (calPct >= 30) return "Moderate"
      return "Light / Recovery"
    })

    const clusterSizes = Array.from({ length: K }, (_, ci) =>
      clusters.filter((c) => c === ci).length
    )

    const kMeansClusters = clusterLabels.map((label, i) => ({
      label,
      count: clusterSizes[i],
      avgCalories: Math.round(centroids[i][1] * maxCals),
      dominantDay: DAYS[Math.round(centroids[i][0] * 6)],
      avgSleep: Math.round(centroids[i][2] * maxSleep * 10) / 10,
    }))

    return { radarData, bestDay, worstDay, consistencyRate, longRestCount, kMeansClusters }
  }, [workoutLogs, sleepByDate])

  // ── Injury / wellness risk prediction ─────────────────────────────────────

  const injuryRisk = useMemo(() => {
    if (workoutLogs.length === 0) return null

    const today = new Date()
    const last14 = workoutLogs.filter((l) => {
      const d = new Date(l.date ?? l.created_at)
      return (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 14
    })
    const last7 = last14.filter((l) => {
      const d = new Date(l.date ?? l.created_at)
      return (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 7
    })

    const workoutsLast7 = new Set(last7.map((l) => (l.date ?? l.created_at.split("T")[0]))).size

    // Find max consecutive workout days
    const sortedDates = Array.from(
      new Set(workoutLogs.map((l) => (l.date ?? l.created_at.split("T")[0])))
    ).sort().reverse()

    let maxConsecutive = 1, currentRun = 1
    for (let i = 1; i < sortedDates.length; i++) {
      const gap = (new Date(sortedDates[i - 1]).getTime() - new Date(sortedDates[i]).getTime()) / (1000 * 60 * 60 * 24)
      if (Math.round(gap) === 1) { currentRun++; maxConsecutive = Math.max(maxConsecutive, currentRun) }
      else currentRun = 1
    }

    let level: "low" | "moderate" | "high"
    let message: string
    const flags: string[] = []

    if (maxConsecutive >= 6 || workoutsLast7 >= 6) {
      level = "high"
      message = "Overtraining detected — schedule at least 1–2 rest days this week."
      if (maxConsecutive >= 6) flags.push(`${maxConsecutive} consecutive workout days`)
      if (workoutsLast7 >= 6) flags.push(`${workoutsLast7} sessions in last 7 days`)
    } else if (maxConsecutive >= 4 || workoutsLast7 >= 5) {
      level = "moderate"
      message = "High training load — monitor fatigue and prioritise sleep and nutrition."
      if (maxConsecutive >= 4) flags.push(`${maxConsecutive} consecutive workout days`)
      if (workoutsLast7 >= 5) flags.push(`${workoutsLast7} sessions in last 7 days`)
    } else {
      level = "low"
      message = "Training load looks healthy — good balance of work and recovery."
    }

    return { level, message, flags, workoutsLast7, maxConsecutive }
  }, [workoutLogs])

  // ── Summary stats ──────────────────────────────────────────────────────────

  const latestWeight = weightLogs.filter((d) => d.weight != null).at(-1)?.weight ?? null
  const startWeight = weightLogs.filter((d) => d.weight != null)[0]?.weight ?? null
  const weightChange =
    latestWeight != null && startWeight != null
      ? parseFloat((latestWeight - startWeight).toFixed(1))
      : null

  const totalWorkouts = workoutLogs.length
  const totalCaloriesBurned = workoutLogs.reduce(
    (s, d) => s + (d.total_calories || 0),
    0
  )

  // ── Badges ─────────────────────────────────────────────────────────────────

  const badges = useMemo(() => {
    const weightLogsCount = weightLogs.filter((l) => l.weight != null).length
    return [
      { id: "first_workout", name: "First Step", icon: "👟", description: "Log your first workout", unlocked: totalWorkouts >= 1, tier: "bronze" as const },
      { id: "streak_3", name: "Hot Streak", icon: "🔥", description: "Achieve a 3-day streak", unlocked: streak.longest >= 3, tier: "bronze" as const },
      { id: "streak_7", name: "Weekly Warrior", icon: "⚡", description: "Achieve a 7-day streak", unlocked: streak.longest >= 7, tier: "silver" as const },
      { id: "streak_14", name: "Two Week Titan", icon: "💪", description: "Achieve a 14-day streak", unlocked: streak.longest >= 14, tier: "gold" as const },
      { id: "streak_30", name: "Monthly Monster", icon: "🏆", description: "Achieve a 30-day streak", unlocked: streak.longest >= 30, tier: "platinum" as const },
      { id: "workouts_10", name: "Getting Serious", icon: "🎯", description: "Log 10 workouts", unlocked: totalWorkouts >= 10, tier: "bronze" as const },
      { id: "workouts_25", name: "Fitness Fanatic", icon: "🌟", description: "Log 25 workouts", unlocked: totalWorkouts >= 25, tier: "silver" as const },
      { id: "workouts_50", name: "Iron Will", icon: "🦾", description: "Log 50 workouts", unlocked: totalWorkouts >= 50, tier: "gold" as const },
      { id: "weight_logged", name: "Scale Watcher", icon: "⚖️", description: "Log your weight once", unlocked: weightLogsCount >= 1, tier: "bronze" as const },
      { id: "data_driven", name: "Data Driven", icon: "📊", description: "Log weight 5+ times", unlocked: weightLogsCount >= 5, tier: "silver" as const },
      { id: "lost_1kg", name: "Making Progress", icon: "📉", description: "Lose 1 kg total", unlocked: weightChange !== null && weightChange <= -1, tier: "silver" as const },
      { id: "transformation", name: "Transformation", icon: "✨", description: "Lose 5 kg total", unlocked: weightChange !== null && weightChange <= -5, tier: "gold" as const },
    ]
  }, [totalWorkouts, streak, weightLogs, weightChange])

  const generateReport = async () => {
    if (!userId) return
    setLoadingReport(true)
    setReportError(null)
    setReport(null)
    setReportStats(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/weekly-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ userId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate report")
      }

      setReport(data.report)
      setReportStats(data.stats)
    } catch (err: any) {
      setReportError(err.message || "Failed to generate report")
    } finally {
      setLoadingReport(false)
    }
  }

  const downloadPdf = async () => {
    if (!report) return
    const { jsPDF } = await import("jspdf")
    const html2canvas = (await import("html2canvas")).default
    const doc = new jsPDF({ unit: "pt", format: "a4" })

    const W = doc.internal.pageSize.getWidth()
    const margin = 48
    const contentW = W - margin * 2
    let y = margin

    // Header bar
    doc.setFillColor(124, 58, 237)
    doc.rect(0, 0, W, 60, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20)
    doc.setFont("helvetica", "bold")
    doc.text("FitFusion AI", margin, 38)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text("Weekly Fitness Report", margin, 52)
    doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), W - margin, 52, { align: "right" })

    y = 88

    // Stats grid
    if (reportStats) {
      const stats = [
        { label: "Workouts", value: String(reportStats.workoutCount ?? 0) },
        { label: "Calories Burned", value: `${reportStats.totalCaloriesBurned ?? 0} kcal` },
        { label: "Start Weight", value: reportStats.startWeight != null ? `${reportStats.startWeight} kg` : "--" },
        { label: "Weight Change", value: reportStats.weightChange != null ? `${(reportStats.weightChange as number) > 0 ? "+" : ""}${reportStats.weightChange} kg` : "--" },
      ]
      const cellW = contentW / 4
      stats.forEach((s, i) => {
        const x = margin + i * cellW
        doc.setFillColor(248, 250, 252)
        doc.roundedRect(x, y, cellW - 6, 52, 6, 6, "F")
        doc.setTextColor(100, 116, 139)
        doc.setFontSize(8)
        doc.setFont("helvetica", "normal")
        doc.text(s.label, x + 10, y + 16)
        doc.setTextColor(15, 23, 42)
        doc.setFontSize(13)
        doc.setFont("helvetica", "bold")
        doc.text(s.value, x + 10, y + 36)
      })
      y += 68
    }

    // Divider
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, y, W - margin, y)
    y += 20

    // Report heading
    doc.setTextColor(124, 58, 237)
    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.text("Your AI Coach Summary", margin, y)
    y += 18

    // Report body — word-wrap
    doc.setTextColor(51, 65, 85)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    const lines = doc.splitTextToSize(report, contentW)
    lines.forEach((line: string) => {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y)
      y += 15
    })

    // Charts — each tagged element gets captured and added on its own page
    const chartElements = Array.from(document.querySelectorAll<HTMLElement>("[data-pdf-chart]"))
    for (const el of chartElements) {
      const title = el.getAttribute("data-pdf-chart") ?? "Chart"
      try {
        const canvas = await html2canvas(el, {
          backgroundColor: "#ffffff",
          scale: 2,
          logging: false,
          useCORS: true,
        })
        const imgData = canvas.toDataURL("image/png")
        doc.addPage()
        let cy = margin
        doc.setTextColor(124, 58, 237)
        doc.setFontSize(13)
        doc.setFont("helvetica", "bold")
        doc.text(title, margin, cy)
        cy += 14

        const imgRatio = canvas.height / canvas.width
        const imgW = contentW
        const imgH = imgW * imgRatio
        const pageH = doc.internal.pageSize.getHeight()
        const maxImgH = pageH - cy - margin
        const finalH = Math.min(imgH, maxImgH)
        const finalW = finalH < imgH ? finalH / imgRatio : imgW
        doc.addImage(imgData, "PNG", margin, cy, finalW, finalH)
      } catch (err) {
        console.warn("Failed to capture chart:", title, err)
      }
    }

    // Footer on the last page
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFillColor(248, 250, 252)
    doc.rect(0, pageH - 30, W, 30, "F")
    doc.setTextColor(148, 163, 184)
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.text("Generated by FitFusion AI · fitfusion.app", W / 2, pageH - 12, { align: "center" })

    doc.save(`fitfusion-report-${new Date().toISOString().split("T")[0]}.pdf`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Loading analytics...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-6 md:p-10 text-slate-900 dark:text-white">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-semibold">Analytics Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Your fitness insights powered by data.</p>
        </div>

        {/* AI Anomaly Alerts */}
        <AnomalyAlerts weightLogs={weightLogs} mealLogs={mealLogs} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Latest Weight" value={latestWeight != null ? `${latestWeight} kg` : "--"} />
          <StatCard
            label="Weight Change"
            value={
              weightChange != null
                ? `${weightChange > 0 ? "+" : ""}${weightChange} kg`
                : "--"
            }
            color={
              weightChange != null
                ? weightChange < 0
                  ? "text-green-600"
                  : weightChange > 0
                    ? "text-rose-600"
                    : "text-slate-900 dark:text-white"
                : undefined
            }
          />
          <StatCard label="Total Workouts" value={String(totalWorkouts)} />
          <StatCard label="Calories Burned" value={`${totalCaloriesBurned.toLocaleString()} kcal`} />
        </div>

        {/* Streak cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <p className="text-sm text-orange-600 font-medium">🔥 Current Streak</p>
            <p className="mt-2 text-4xl font-bold text-orange-700">{streak.current} days</p>
            <p className="mt-1 text-xs text-orange-500">Keep going — don't break the chain!</p>
          </div>
          <div className="rounded-3xl border border-purple-200 bg-purple-50 p-6 shadow-sm">
            <p className="text-sm text-purple-600 font-medium">🏆 Longest Streak</p>
            <p className="mt-2 text-4xl font-bold text-purple-700">{streak.longest} days</p>
            <p className="mt-1 text-xs text-purple-500">Your personal best</p>
          </div>
        </div>

        {/* Injury / Wellness Risk */}
        {injuryRisk && (
          <div className={`rounded-3xl border p-5 ${
            injuryRisk.level === "high"
              ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20"
              : injuryRisk.level === "moderate"
                ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20"
                : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
          }`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{injuryRisk.level === "high" ? "🚨" : injuryRisk.level === "moderate" ? "⚠️" : "✅"}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={`font-semibold capitalize ${
                    injuryRisk.level === "high" ? "text-rose-700 dark:text-rose-300"
                    : injuryRisk.level === "moderate" ? "text-amber-700 dark:text-amber-300"
                    : "text-emerald-700 dark:text-emerald-300"
                  }`}>
                    {injuryRisk.level === "high" ? "High Injury Risk" : injuryRisk.level === "moderate" ? "Moderate Load" : "Low Risk"} — Wellness Score
                  </p>
                  <div className="flex gap-3 text-xs font-medium">
                    <span className="rounded-xl bg-white/60 dark:bg-black/20 px-2.5 py-1">
                      {injuryRisk.workoutsLast7} sessions / 7 days
                    </span>
                    <span className="rounded-xl bg-white/60 dark:bg-black/20 px-2.5 py-1">
                      {injuryRisk.maxConsecutive} day max streak
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{injuryRisk.message}</p>
                {injuryRisk.flags.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {injuryRisk.flags.map((f, i) => (
                      <li key={i} className="text-xs text-slate-500 dark:text-slate-400 flex gap-1.5">
                        <span>→</span><span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Habit Pattern Analysis */}
        {workoutLogs.length >= 3 && (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Habit Pattern Analysis</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">When you work out most — based on your history</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Radar chart */}
              <div data-pdf-chart="Workouts by Day of Week">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">Workouts by Day of Week</p>
                <div className="h-[220px]">
                  <ResponsiveContainer>
                    <RadarChart data={habitPatterns.radarData}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="day" tick={{ fontSize: 12, fill: "#64748b" }} />
                      <Radar
                        name="Workouts"
                        dataKey="workouts"
                        stroke="#7c3aed"
                        fill="#7c3aed"
                        fillOpacity={0.2}
                        strokeWidth={2}
                      />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Insight cards */}
              <div className="grid grid-cols-2 gap-3 content-start">
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
                  <p className="text-xs text-emerald-600 font-medium">Best Day</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{habitPatterns.bestDay || "--"}</p>
                  <p className="text-xs text-emerald-500 mt-0.5">Most workouts logged</p>
                </div>
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
                  <p className="text-xs text-amber-600 font-medium">Weakest Day</p>
                  <p className="text-2xl font-bold text-amber-700 mt-1">{habitPatterns.worstDay || "--"}</p>
                  <p className="text-xs text-amber-500 mt-0.5">Fewest workouts</p>
                </div>
                <div className="rounded-2xl bg-purple-50 border border-purple-200 p-4">
                  <p className="text-xs text-purple-600 font-medium">Consistency</p>
                  <p className="text-2xl font-bold text-purple-700 mt-1">{habitPatterns.consistencyRate}%</p>
                  <p className="text-xs text-purple-500 mt-0.5">Active days ratio</p>
                </div>
                <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
                  <p className="text-xs text-rose-600 font-medium">Long Breaks</p>
                  <p className="text-2xl font-bold text-rose-700 mt-1">{habitPatterns.longRestCount}</p>
                  <p className="text-xs text-rose-500 mt-0.5">Gaps &gt; 2 days</p>
                </div>
              </div>
            </div>

            {/* K-Means clusters */}
            {habitPatterns.kMeansClusters.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  K-Means Session Clusters
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {habitPatterns.kMeansClusters.map((cluster, i) => {
                    const colors = [
                      "border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20",
                      "border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-900/20",
                      "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800",
                    ]
                    const textColors = ["text-purple-700 dark:text-purple-300", "text-cyan-700 dark:text-cyan-300", "text-slate-700 dark:text-slate-300"]
                    return (
                      <div key={i} className={`rounded-2xl border p-4 ${colors[i % 3]}`}>
                        <p className={`text-sm font-semibold ${textColors[i % 3]}`}>{cluster.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{cluster.count} sessions · ~{cluster.avgCalories} kcal avg</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Peak: {cluster.dominantDay} · Sleep: {cluster.avgSleep}h avg</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Achievements / Badges */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold">Achievements</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Earn badges by hitting fitness milestones</p>
            </div>
            <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
              {badges.filter((b) => b.unlocked).length} / {badges.length} unlocked
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {badges.map((badge) => (
              <BadgeCard key={badge.id} badge={badge} />
            ))}
          </div>
        </div>

        {/* Weight chart */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Weight Progress</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Actual weight + AI trend line</p>
            </div>
            {weightPrediction && (
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm">
                <p className="text-cyan-600 font-medium">
                  {weightPrediction.direction === "losing"
                    ? "📉 Losing"
                    : weightPrediction.direction === "gaining"
                      ? "📈 Gaining"
                      : "⚖️ Maintaining"}
                  {" "}~{Math.abs(weightPrediction.ratePerWeek)} kg/week
                </p>
                <p className="text-xs text-cyan-500 mt-0.5">
                  Predicted in ~6 entries: {weightPrediction.predicted} kg
                </p>
              </div>
            )}
          </div>

          {weightChartData.length === 0 ? (
            <p className="text-center text-slate-500 dark:text-slate-400 py-10">No weight data yet. Log your weight in the Progress tab.</p>
          ) : (
            <div className="w-full h-[300px]" data-pdf-chart="Weight Trend">
              <ResponsiveContainer>
                <LineChart data={weightChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="#7c3aed"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="Actual"
                  />
                  {weightChartData.some((d) => d.predicted != null) && (
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Trend"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Workout activity chart */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-1">Workout Activity</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Sessions logged per day</p>

          {workoutActivityData.length === 0 ? (
            <p className="text-center text-slate-500 dark:text-slate-400 py-10">No workout data yet. Log a workout in the Progress tab.</p>
          ) : (
            <div className="w-full h-[300px]" data-pdf-chart="Workout Activity">
              <ResponsiveContainer>
                <BarChart data={workoutActivityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="workouts" fill="#7c3aed" radius={[6, 6, 0, 0]} name="Sessions" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Calories burned chart */}
        {workoutActivityData.some((d) => d.calories > 0) && (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold mb-1">Calories Burned</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Total kcal burned per day</p>
            <div className="w-full h-[250px]" data-pdf-chart="Calories Burned">
              <ResponsiveContainer>
                <BarChart data={workoutActivityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="calories" fill="#f97316" radius={[6, 6, 0, 0]} name="kcal burned" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Weekly AI Report */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Weekly AI Fitness Report</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Get a personalised AI summary of your last 7 days</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={generateReport}
                disabled={loadingReport}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                {loadingReport ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Generating...</>
                ) : (
                  "Generate Report"
                )}
              </button>
              {report && (
                <button
                  onClick={downloadPdf}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>
              )}
            </div>
          </div>

          {reportError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {reportError}
            </div>
          )}

          {reportStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MiniStat label="Workouts" value={String(reportStats.workoutCount ?? 0)} />
              <MiniStat label="Calories Burned" value={`${reportStats.totalCaloriesBurned ?? 0} kcal`} />
              <MiniStat label="Start Weight" value={reportStats.startWeight != null ? `${reportStats.startWeight} kg` : "--"} />
              <MiniStat
                label="Weight Change"
                value={
                  reportStats.weightChange != null
                    ? `${(reportStats.weightChange as number) > 0 ? "+" : ""}${reportStats.weightChange} kg`
                    : "--"
                }
              />
            </div>
          )}

          {report && (
            <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-cyan-50 border border-purple-100 p-5">
              <p className="text-sm font-semibold text-purple-700 mb-2">Your Weekly Report</p>
              <p className="text-sm leading-7 text-slate-700 dark:text-slate-300 whitespace-pre-line">{report}</p>
            </div>
          )}

          {!report && !reportError && !loadingReport && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Click &quot;Generate Report&quot; to get your personalised AI fitness summary for the past week.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Badge card ───────────────────────────────────────────────────────────────

const TIER_STYLES = {
  bronze: "border-amber-200 bg-amber-50",
  silver: "border-slate-300 bg-slate-50",
  gold: "border-yellow-300 bg-yellow-50",
  platinum: "border-purple-300 bg-purple-50",
}

function BadgeCard({
  badge,
}: {
  badge: {
    id: string
    name: string
    icon: string
    description: string
    unlocked: boolean
    tier: "bronze" | "silver" | "gold" | "platinum"
  }
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${
        badge.unlocked
          ? TIER_STYLES[badge.tier]
          : "border-slate-200 bg-slate-50 dark:bg-slate-800/50 opacity-40 grayscale"
      }`}
    >
      <div className="text-2xl mb-2">{badge.icon}</div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{badge.name}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{badge.description}</p>
      {badge.unlocked && (
        <p className="text-xs font-medium text-emerald-600 mt-1.5">✓ Unlocked</p>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 p-3 text-center">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">{value}</p>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl shadow border border-slate-200 dark:border-slate-700">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-slate-900 dark:text-white"}`}>{value}</p>
    </div>
  )
}
