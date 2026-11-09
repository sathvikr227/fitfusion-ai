"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../../lib/supabase/client"

// Injury-risk card for Home and the Injuries page.
//
// It reads /api/ml-insights, the same route the analytics dashboard and the
// replan use, so this card can never disagree with them. The overall score is
// the Model 3 training-load XGBoost (3 weekly load summaries); the body regions
// come from the fixed rule table. When the ML service is down the route already
// returns the rule-based fallback, and the card says so instead of inventing a
// score of its own.

type RiskLevel = "Low" | "Moderate" | "High"

type Insights = {
  injury: {
    risk: Record<string, number>
    threshold: number
    flagged: string[]
    basis: Record<string, string>
    overallRisk: number | null
    relativeRisk: number | null
    overallElevated: boolean
    disclaimer: string
    modelVersion: string
    fromFallback: boolean
  }
  week: {
    avgSleep: number | null
    activeInjuries: number
  }
}

const REGION_LABEL: Record<string, string> = {
  knee: "Knee",
  back: "Back",
  shoulder: "Shoulder",
  hamstring: "Hamstring",
}

function levelFor(injury: Insights["injury"]): RiskLevel {
  if (injury.overallElevated || injury.flagged.length > 0) return "High"
  const anyRegionUp = Object.values(injury.risk ?? {}).some((v) => v >= injury.threshold / 2)
  if ((injury.relativeRisk ?? 0) >= 1 || anyRegionUp) return "Moderate"
  return "Low"
}

const RECOMMENDATION: Record<RiskLevel, string> = {
  Low: "Training load looks normal. Keep your routine and prioritise recovery.",
  Moderate: "Load is around or above average. Watch for fatigue and keep at least one rest day.",
  High: "Load or a body region is flagged. Ease off the flagged areas and consider an extra rest day.",
}

const LEVEL_COLORS: Record<RiskLevel, { border: string; bg: string; badge: string; label: string }> = {
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

export function InjuryRiskWidget({ userId }: { userId: string }) {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error("no session")

        const res = await fetch("/api/ml-insights", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`ml-insights ${res.status}`)
        const json = (await res.json()) as Insights
        if (!json?.injury) throw new Error("no injury block")
        if (!cancelled) setData(json)
      } catch (err) {
        console.warn("InjuryRiskWidget: injury risk unavailable:", err)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
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

  if (error || !data) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Injury risk
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Injury risk isn&apos;t available right now. Log a few workouts and check back later.
        </p>
      </div>
    )
  }

  const { injury, week } = data
  const level = levelFor(injury)
  const colors = LEVEL_COLORS[level]
  const regions = Object.entries(injury.risk ?? {}).sort((a, b) => b[1] - a[1])
  const flagged = new Set(injury.flagged)

  const overallText =
    injury.overallRisk == null || injury.relativeRisk == null
      ? "Not enough logged history (21 days) for the training-load model yet."
      : `Last 3 weeks: ${injury.relativeRisk.toFixed(1)}× the average injury rate in the training data${
          injury.overallElevated ? " (elevated)" : ""
        }.`

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${colors.border} ${colors.bg}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Injury risk from training load
          </p>
          <p className={`text-lg font-bold mt-0.5 ${colors.label}`}>{level} Risk</p>
        </div>
        {injury.relativeRisk != null && (
          <div className="text-right">
            <p className={`text-2xl font-bold tabular-nums ${colors.label}`}>
              {injury.relativeRisk.toFixed(1)}×
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">vs average</p>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{overallText}</p>

      {regions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {regions.map(([region, value]) => (
            <span
              key={region}
              title={injury.basis?.[region]}
              className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-medium ${
                flagged.has(region)
                  ? LEVEL_COLORS.High.badge
                  : value >= injury.threshold / 2
                    ? LEVEL_COLORS.Moderate.badge
                    : "bg-white/60 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
              }`}
            >
              {REGION_LABEL[region] ?? region}
              {flagged.has(region) ? " · flagged" : ""}
            </span>
          ))}
        </div>
      )}

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{RECOMMENDATION[level]}</p>

      <div className="mt-4 grid grid-cols-3 gap-2 pt-3 border-t border-current/10">
        {[
          { label: "Flagged Regions", value: String(injury.flagged.length) },
          { label: "Avg Sleep", value: week?.avgSleep != null ? `${week.avgSleep.toFixed(1)}h` : "--" },
          { label: "Active Injuries", value: String(week?.activeInjuries ?? 0) },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-base font-bold text-slate-800 dark:text-white">{value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        {injury.fromFallback ? "Rule-based estimate (ML service unavailable). " : ""}
        {injury.disclaimer}
      </p>
    </div>
  )
}
