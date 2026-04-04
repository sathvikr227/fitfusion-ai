"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { Loader2, Download } from "lucide-react"
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

      const [weightRes, workoutRes] = await Promise.all([
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
      ])

      if (weightRes.data) setWeightLogs(weightRes.data)
      if (workoutRes.data) setWorkoutLogs(workoutRes.data)

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

  // ── Habit pattern analysis ─────────────────────────────────────────────────

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

    // Count consecutive rest gaps > 2 days
    const sortedDates = Array.from(
      new Set(workoutLogs.map((l) => (l.date ?? l.created_at.split("T")[0])))
    ).sort()
    let longRestCount = 0
    for (let i = 1; i < sortedDates.length; i++) {
      const gap = (new Date(sortedDates[i]).getTime() - new Date(sortedDates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
      if (gap > 2) longRestCount++
    }

    return { radarData, bestDay, worstDay, consistencyRate, longRestCount }
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
      const res = await fetch("/api/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    // Footer
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-slate-50 to-blue-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" />
          <p className="text-sm text-slate-600">Loading analytics...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 p-6 md:p-10 text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-semibold">Analytics Dashboard</h1>
          <p className="text-slate-500 mt-2">Your fitness insights powered by data.</p>
        </div>

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
                    : "text-slate-900"
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

        {/* Habit Pattern Analysis */}
        {workoutLogs.length >= 3 && (
          <div className="bg-white p-6 rounded-3xl shadow border border-slate-200">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Habit Pattern Analysis</h2>
              <p className="text-sm text-slate-500">When you work out most — based on your history</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Radar chart */}
              <div>
                <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Workouts by Day of Week</p>
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
          </div>
        )}

        {/* Achievements / Badges */}
        <div className="bg-white p-6 rounded-3xl shadow border border-slate-200">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold">Achievements</h2>
              <p className="text-sm text-slate-500">Earn badges by hitting fitness milestones</p>
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
        <div className="bg-white p-6 rounded-3xl shadow border">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Weight Progress</h2>
              <p className="text-sm text-slate-500">Actual weight + AI trend line</p>
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
            <p className="text-center text-slate-500 py-10">No weight data yet. Log your weight in the Progress tab.</p>
          ) : (
            <div className="w-full h-[300px]">
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
        <div className="bg-white p-6 rounded-3xl shadow border">
          <h2 className="text-lg font-semibold mb-1">Workout Activity</h2>
          <p className="text-sm text-slate-500 mb-4">Sessions logged per day</p>

          {workoutActivityData.length === 0 ? (
            <p className="text-center text-slate-500 py-10">No workout data yet. Log a workout in the Progress tab.</p>
          ) : (
            <div className="w-full h-[300px]">
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
          <div className="bg-white p-6 rounded-3xl shadow border">
            <h2 className="text-lg font-semibold mb-1">Calories Burned</h2>
            <p className="text-sm text-slate-500 mb-4">Total kcal burned per day</p>
            <div className="w-full h-[250px]">
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
        <div className="bg-white p-6 rounded-3xl shadow border">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Weekly AI Fitness Report</h2>
              <p className="text-sm text-slate-500">Get a personalised AI summary of your last 7 days</p>
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
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
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
              <p className="text-sm leading-7 text-slate-700 whitespace-pre-line">{report}</p>
            </div>
          )}

          {!report && !reportError && !loadingReport && (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 text-center text-sm text-slate-500">
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
          : "border-slate-200 bg-slate-50 opacity-40 grayscale"
      }`}
    >
      <div className="text-2xl mb-2">{badge.icon}</div>
      <p className="text-sm font-semibold text-slate-900 leading-tight">{badge.name}</p>
      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{badge.description}</p>
      {badge.unlocked && (
        <p className="text-xs font-medium text-emerald-600 mt-1.5">✓ Unlocked</p>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-900 mt-0.5">{value}</p>
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
    <div className="bg-white p-5 rounded-3xl shadow border">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? "text-slate-900"}`}>{value}</p>
    </div>
  )
}
