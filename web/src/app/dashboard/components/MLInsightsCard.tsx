"use client"

import { useEffect, useState } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2 } from "lucide-react"

import { supabase } from "../../../lib/supabase/client"

// Surfaces the ML intelligence layer on the analytics page: the Transformer's
// trajectory call with the 4-session sparkline behind it, the injury-risk
// scores, and the last decision the RL agent made.
//
// Renders nothing at all if the ML service is unreachable, so the page looks
// exactly as it did before this layer existed.

type SparkPoint = {
  date: string | null
  completionRate: number
  durationHours: number
  workoutType: string | null
}

type Insights = {
  trajectory: {
    label: "IMPROVE" | "PLATEAU" | "REGRESS"
    score: number
    probs: Record<string, number>
    sessionsUsed: number
    modelVersion: string
    fromFallback: boolean
  } | null
  sparkline: SparkPoint[]
  injury: {
    risk: Record<string, number>
    threshold: number
    flagged: string[]
    disclaimer: string
    fromFallback: boolean
  }
  week: {
    completionRate: number
    avgSleep: number | null
    streak: number
    activeInjuries: number
  }
  lastDecision: {
    action: "REDUCE" | "MAINTAIN" | "INCREASE"
    intensityDelta: number
    confidence: number
    restDayAdded: string | null
    removedExercises: Array<{ day: string; exercise: string; group: string }>
    generatedAt: string | null
  } | null
}

const TRAJECTORY_STYLE = {
  IMPROVE: {
    icon: ArrowUpRight,
    label: "Improving",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    border: "border-emerald-200 dark:border-emerald-800",
    stroke: "#10b981",
    blurb: "Your recent sessions point upward — next week should keep building.",
  },
  PLATEAU: {
    icon: ArrowRight,
    label: "Holding steady",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-200 dark:border-amber-800",
    stroke: "#f59e0b",
    blurb: "Performance is flat. A change in stimulus may be what moves it.",
  },
  REGRESS: {
    icon: ArrowDownRight,
    label: "Trending down",
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-900/20",
    border: "border-rose-200 dark:border-rose-800",
    stroke: "#f43f5e",
    blurb: "Recent sessions are slipping. Recovery is likely the constraint.",
  },
} as const

const MUSCLE_LABEL: Record<string, string> = {
  knee: "Knee",
  back: "Lower back",
  shoulder: "Shoulder",
  hamstring: "Hamstring",
}

function Sparkline({ points, stroke }: { points: SparkPoint[]; stroke: string }) {
  if (points.length < 2) return null

  const width = 180
  const height = 44
  const padding = 4
  const step = (width - padding * 2) / (points.length - 1)

  const coords = points.map((p, i) => {
    const x = padding + i * step
    const y = height - padding - (p.completionRate / 100) * (height - padding * 2)
    return [x, y] as const
  })

  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ")

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3.5 : 2.5} fill={stroke} />
      ))}
    </svg>
  )
}

export function MLInsightsCard() {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) return

        const res = await fetch("/api/ml-insights", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return

        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        console.warn("ML insights unavailable:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 flex items-center gap-3 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading ML insights…</span>
      </div>
    )
  }

  // Nothing to show without a trajectory read — stay out of the way.
  if (!data?.trajectory) return null

  const style = TRAJECTORY_STYLE[data.trajectory.label] ?? TRAJECTORY_STYLE.PLATEAU
  const Icon = style.icon

  const risks = Object.entries(data.injury?.risk ?? {}).sort((a, b) => b[1] - a[1])
  const threshold = data.injury?.threshold ?? 0.7

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-lg text-slate-800 dark:text-white">
          Training intelligence
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Predictions from your last {data.trajectory.sessionsUsed} logged session
          {data.trajectory.sessionsUsed === 1 ? "" : "s"}.
        </p>
      </div>

      {/* Trajectory */}
      <div className={`rounded-xl border p-4 ${style.border} ${style.bg}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Progression trajectory
            </p>
            <div className={`flex items-center gap-2 mt-1 ${style.text}`}>
              <Icon className="w-5 h-5" />
              <span className="text-xl font-bold">{style.label}</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 max-w-sm">
              {style.blurb}
            </p>
          </div>
          <div className="text-right">
            <Sparkline points={data.sparkline} stroke={style.stroke} />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Completion, last {data.sparkline.length} sessions
            </p>
          </div>
        </div>
      </div>

      {/* Injury risk */}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Predicted strain risk
          </h3>
          {data.injury.flagged.length > 0 && (
            <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {data.injury.flagged.map((g) => MUSCLE_LABEL[g] ?? g).join(", ")} above threshold
            </span>
          )}
        </div>

        <div className="space-y-2">
          {risks.map(([group, score]) => {
            const flagged = score >= threshold
            return (
              <div key={group} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-slate-600 dark:text-slate-300">
                  {MUSCLE_LABEL[group] ?? group}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${flagged ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.round(score * 100)}%` }}
                  />
                </div>
                <span
                  className={`w-10 shrink-0 text-right text-xs tabular-nums ${
                    flagged
                      ? "text-rose-600 dark:text-rose-400 font-semibold"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {Math.round(score * 100)}%
                </span>
              </div>
            )
          })}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500 mt-3">
          {data.injury.disclaimer}
        </p>
      </div>

      {/* Last replan decision */}
      {data.lastDecision && (
        <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Last plan adjustment
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            The agent chose{" "}
            <span className="font-semibold">{data.lastDecision.action.toLowerCase()}</span>
            {data.lastDecision.intensityDelta !== 0 && (
              <>
                {" "}
                ({data.lastDecision.intensityDelta > 0 ? "+" : ""}
                {Math.round(data.lastDecision.intensityDelta * 100)}% volume)
              </>
            )}
            {data.lastDecision.restDayAdded && (
              <> and added a rest day on {data.lastDecision.restDayAdded}</>
            )}
            .
          </p>
          {data.lastDecision.removedExercises.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Removed {data.lastDecision.removedExercises.length} exercise
              {data.lastDecision.removedExercises.length === 1 ? "" : "s"} loading at-risk
              muscle groups.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
