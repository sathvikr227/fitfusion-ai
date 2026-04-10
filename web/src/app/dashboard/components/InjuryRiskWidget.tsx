"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../../lib/supabase/client"

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "Low" | "Moderate" | "High"

type RiskData = {
  score: number
  level: RiskLevel
  factors: string[]
  recommendation: string
  workoutsLast7: number
  avgSleepHours: number
  activeInjuries: number
  totalMinutesLast7: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val))
}

function computeRiskScore(
  workoutsLast7: number,
  avgSleepHours: number,
  activeInjuries: number,
  totalMinutesLast7: number
): { score: number; level: RiskLevel; factors: string[]; recommendation: string } {
  const sleepScore = avgSleepHours >= 7 ? 0 : (7 - avgSleepHours) * 15
  const injuryPenalty = activeInjuries * 25
  const volumeScore = totalMinutesLast7 > 300 ? (totalMinutesLast7 - 300) / 10 : 0
  const overtrainingScore = workoutsLast7 > 6 ? (workoutsLast7 - 6) * 15 : 0

  const score = clamp(sleepScore + injuryPenalty + volumeScore + overtrainingScore, 0, 100)

  let level: RiskLevel
  let recommendation: string

  if (score <= 30) {
    level = "Low"
    recommendation = "Great balance! Keep up your current routine and prioritize recovery."
  } else if (score <= 60) {
    level = "Moderate"
    recommendation = "Monitor fatigue closely — add an extra rest day and aim for 7–8h sleep."
  } else {
    level = "High"
    recommendation = "High injury risk detected — reduce training volume and address active injuries."
  }

  const factors: string[] = []
  if (avgSleepHours < 7 && avgSleepHours > 0) {
    factors.push(`Low sleep avg (${avgSleepHours.toFixed(1)}h/night)`)
  }
  if (activeInjuries > 0) {
    factors.push(`${activeInjuries} active injur${activeInjuries === 1 ? "y" : "ies"}`)
  }
  if (workoutsLast7 > 6) {
    factors.push(`Overtraining (${workoutsLast7} sessions/week)`)
  } else if (workoutsLast7 > 4) {
    factors.push(`High frequency (${workoutsLast7} sessions/week)`)
  }
  if (totalMinutesLast7 > 300) {
    factors.push(`High volume (${totalMinutesLast7} min this week)`)
  }
  if (factors.length === 0) {
    factors.push("Training load within safe range")
  }

  return { score: Math.round(score), level, factors: factors.slice(0, 3), recommendation }
}

// ─── SVG Gauge ────────────────────────────────────────────────────────────────

function RiskGauge({
  score,
  level,
}: {
  score: number
  level: RiskLevel
}) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  // Show only the top 75% of the circle (270 degrees arc)
  const arcLength = circumference * 0.75
  const dashOffset = arcLength - (score / 100) * arcLength

  const strokeColor =
    level === "Low"
      ? "#22c55e"
      : level === "Moderate"
        ? "#f59e0b"
        : "#ef4444"

  const textColor =
    level === "Low"
      ? "text-green-600 dark:text-green-400"
      : level === "Moderate"
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400"

  return (
    <div className="relative flex items-center justify-center" style={{ width: 110, height: 110 }}>
      <svg
        width="110"
        height="110"
        viewBox="0 0 110 110"
        style={{ transform: "rotate(135deg)" }}
      >
        {/* Track */}
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-slate-100 dark:text-slate-700"
          strokeWidth="10"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Progress */}
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="10"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold tabular-nums ${textColor}`}>{score}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">/100</span>
      </div>
    </div>
  )
}

// ─── Widget ───────────────────────────────────────────────────────────────────

export function InjuryRiskWidget({ userId }: { userId: string }) {
  const [data, setData] = useState<RiskData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return

    const load = async () => {
      setLoading(true)
      try {
        const now = new Date()
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]

        const [workoutRes, sleepRes, injuryRes, volumeRes] = await Promise.all([
          // Workout frequency last 7 days
          supabase
            .from("workout_logs")
            .select("date", { count: "exact" })
            .eq("user_id", userId)
            .gte("date", sevenDaysAgo),
          // Sleep last 7 days
          supabase
            .from("sleep_logs")
            .select("sleep_hours")
            .eq("user_id", userId)
            .gte("date", sevenDaysAgo),
          // Active injuries
          supabase
            .from("injuries")
            .select("id", { count: "exact" })
            .eq("user_id", userId)
            .eq("status", "active"),
          // Workout volume (duration_minutes) last 7 days
          supabase
            .from("workout_logs")
            .select("duration_minutes")
            .eq("user_id", userId)
            .gte("date", sevenDaysAgo),
        ])

        const workoutsLast7 = workoutRes.count ?? (workoutRes.data?.length ?? 0)
        const activeInjuries = injuryRes.count ?? (injuryRes.data?.length ?? 0)

        const sleepEntries = sleepRes.data ?? []
        const avgSleepHours =
          sleepEntries.length > 0
            ? sleepEntries.reduce((s: number, r: { sleep_hours: number | null }) => s + (r.sleep_hours ?? 0), 0) /
              sleepEntries.length
            : 7 // default to healthy if no data

        const totalMinutesLast7 = (volumeRes.data ?? []).reduce(
          (s: number, r: { duration_minutes: number | null }) => s + (r.duration_minutes ?? 0),
          0
        )

        const { score, level, factors, recommendation } = computeRiskScore(
          workoutsLast7,
          avgSleepHours,
          activeInjuries,
          totalMinutesLast7
        )

        setData({
          score,
          level,
          factors,
          recommendation,
          workoutsLast7,
          avgSleepHours: Math.round(avgSleepHours * 10) / 10,
          activeInjuries,
          totalMinutesLast7,
        })
      } catch (err) {
        console.error("InjuryRiskWidget error:", err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [userId])

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-2">
            <div className="h-4 w-32 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-20 rounded-full bg-slate-100 dark:bg-slate-700/50" />
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const levelColors = {
    Low: {
      border: "border-green-200 dark:border-green-800",
      bg: "bg-green-50 dark:bg-green-900/20",
      badge: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
      label: "text-green-700 dark:text-green-300",
    },
    Moderate: {
      border: "border-yellow-200 dark:border-yellow-800",
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
      badge: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300",
      label: "text-yellow-700 dark:text-yellow-300",
    },
    High: {
      border: "border-red-200 dark:border-red-800",
      bg: "bg-red-50 dark:bg-red-900/20",
      badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
      label: "text-red-700 dark:text-red-300",
    },
  }

  const colors = levelColors[data.level]

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${colors.border} ${colors.bg}`}>
      {/* Title row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Injury Risk Predictor
          </p>
          <p className={`text-lg font-bold mt-0.5 ${colors.label}`}>
            {data.level} Risk
          </p>
        </div>
        <RiskGauge score={data.score} level={data.level} />
      </div>

      {/* Contributing factors */}
      <div className="flex flex-wrap gap-2 mb-3">
        {data.factors.map((factor, i) => (
          <span
            key={i}
            className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-medium ${colors.badge}`}
          >
            {factor}
          </span>
        ))}
      </div>

      {/* Recommendation */}
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {data.recommendation}
      </p>

      {/* Mini stats row */}
      <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-current/10">
        {[
          { label: "Sessions/7d", value: String(data.workoutsLast7) },
          { label: "Avg Sleep", value: data.avgSleepHours > 0 ? `${data.avgSleepHours}h` : "--" },
          { label: "Active Injuries", value: String(data.activeInjuries) },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-base font-bold text-slate-800 dark:text-white">{value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
