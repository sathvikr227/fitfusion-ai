"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase/client"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Dumbbell, Search, TrendingUp, Trophy, BarChart2, Loader2 } from "lucide-react"

type WorkoutLogRow = {
  id: string
  date: string | null
  created_at: string | null
}

type ExerciseLogRow = {
  workout_log_id: string
  exercise_name: string
  sets: number | null
  reps: number | null
  weight: number | null
}

type SessionPoint = {
  date: string
  displayDate: string
  weight: number
  sets: number
  reps: number
  oneRM: number
  volume: number
  repsVolume: number
}

/** Epley formula: w × (1 + reps/30) */
function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30))
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function StrengthTab() {
  const [loading, setLoading] = useState(true)
  const [exerciseMap, setExerciseMap] = useState<Map<string, { date: string; log: ExerciseLogRow }[]>>(new Map())
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Step 1: get all workout log IDs + dates for this user
    const { data: wlogs } = await supabase
      .from("workout_logs")
      .select("id, date, created_at")
      .eq("user_id", user.id)
      .order("date", { ascending: true })

    if (!wlogs || wlogs.length === 0) { setLoading(false); return }

    const idDateMap = new Map<string, string>(
      wlogs.map((w: WorkoutLogRow) => [w.id, w.date ?? w.created_at ?? ""])
    )
    const ids = wlogs.map((w: WorkoutLogRow) => w.id)

    // Step 2: get all exercise_logs for those workout_log_ids
    const { data: elogs } = await supabase
      .from("exercise_logs")
      .select("workout_log_id, exercise_name, sets, reps, weight")
      .in("workout_log_id", ids)

    if (!elogs || elogs.length === 0) { setLoading(false); return }

    // Step 3: group by normalized exercise name
    const map = new Map<string, { date: string; log: ExerciseLogRow }[]>()
    for (const row of elogs as ExerciseLogRow[]) {
      if (!row.exercise_name) continue
      const name = row.exercise_name.trim()
      const date = idDateMap.get(row.workout_log_id) ?? ""
      if (!date) continue
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push({ date, log: row })
    }

    setExerciseMap(map)
    setLoading(false)
  }

  const exerciseNames = useMemo(() => {
    const names = Array.from(exerciseMap.keys()).sort((a, b) => {
      // Sort by number of sessions descending so most-logged appear first
      return (exerciseMap.get(b)?.length ?? 0) - (exerciseMap.get(a)?.length ?? 0)
    })
    if (!query.trim()) return names
    const q = query.toLowerCase()
    return names.filter((n) => n.toLowerCase().includes(q))
  }, [exerciseMap, query])

  const sessionData = useMemo((): SessionPoint[] => {
    if (!selected) return []
    const entries = exerciseMap.get(selected) ?? []

    // Group by date — if multiple sets logged same day, take best 1RM set
    const byDate = new Map<string, ExerciseLogRow[]>()
    for (const { date, log } of entries) {
      const d = date.split("T")[0]
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(log)
    }

    const points: SessionPoint[] = []
    for (const [date, rows] of byDate.entries()) {
      let bestOneRM = 0
      let totalVolume = 0
      let bestWeight = 0
      let bestSets = 0
      let bestReps = 0
      let totalRepsVolume = 0 // sets × reps fallback when no weight

      for (const r of rows) {
        const w = r.weight ?? 0
        const s = r.sets ?? 1
        const reps = r.reps ?? 1
        const orm = epley1RM(w, reps)
        const vol = w > 0 ? w * s * reps : 0
        totalVolume += vol
        totalRepsVolume += s * reps
        if (orm > bestOneRM || (orm === 0 && s * reps > bestSets * bestReps)) {
          bestOneRM = orm
          bestWeight = w
          bestSets = s
          bestReps = reps
        }
      }

      points.push({
        date,
        displayDate: formatDate(date),
        weight: bestWeight,
        sets: bestSets,
        reps: bestReps,
        oneRM: bestOneRM,
        volume: totalVolume > 0 ? Math.round(totalVolume) : 0,
        repsVolume: totalRepsVolume, // sets × reps, no weight needed
      })
    }

    return points.sort((a, b) => a.date.localeCompare(b.date))
  }, [selected, exerciseMap])

  const stats = useMemo(() => {
    if (!sessionData.length) return null
    const hasWeight = sessionData.some((s) => s.weight > 0)
    const maxOneRM = Math.max(...sessionData.map((s) => s.oneRM))
    const maxWeight = Math.max(...sessionData.map((s) => s.weight))
    const maxVolume = hasWeight
      ? Math.max(...sessionData.map((s) => s.volume))
      : Math.max(...sessionData.map((s) => s.repsVolume))
    const sessions = sessionData.length

    const recent = sessionData.slice(-3)
    const scoreOf = (s: SessionPoint) => s.oneRM > 0 ? s.oneRM : s.repsVolume
    const trend = recent.length >= 2
      ? scoreOf(recent[recent.length - 1]) > scoreOf(recent[0])
        ? "up"
        : scoreOf(recent[recent.length - 1]) < scoreOf(recent[0])
        ? "down"
        : "flat"
      : "flat"

    return { maxOneRM, maxWeight, maxVolume, sessions, trend, hasWeight }
  }, [sessionData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
      </div>
    )
  }

  if (exerciseMap.size === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No exercise history yet.</p>
        <p className="text-sm mt-1">Log workouts in the Workout tab to track strength progression.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Strength Progression</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Track progressive overload — weight, estimated 1RM, and session volume per exercise.
        </p>
      </div>

      {/* Exercise Selector */}
      <div className="relative max-w-sm">
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
            placeholder="Search exercise…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
        </div>

        {showDropdown && exerciseNames.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg">
            {exerciseNames.slice(0, 30).map((name) => (
              <button
                key={name}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-purple-50 dark:hover:bg-slate-700 transition-colors ${
                  selected === name ? "bg-purple-50 dark:bg-slate-700 font-medium text-purple-600 dark:text-purple-400" : "text-slate-700 dark:text-slate-300"
                }`}
                onMouseDown={() => {
                  setSelected(name)
                  setQuery(name)
                  setShowDropdown(false)
                }}
              >
                {name}
                <span className="ml-2 text-xs text-slate-400">
                  {exerciseMap.get(name)?.length ?? 0} sets
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selected && (
        <div className="text-center py-16 text-slate-400">
          <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Select an exercise to see your progression</p>
        </div>
      )}

      {selected && sessionData.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          No session data recorded for this exercise yet.
        </div>
      )}

      {selected && sessionData.length > 0 && (
        <>
          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label={stats.hasWeight ? "Best Est. 1RM" : "Best Reps Volume"}
                value={stats.hasWeight ? `${stats.maxOneRM} kg` : `${stats.maxVolume} reps`}
                icon={<Trophy className="w-4 h-4 text-amber-500" />}
                accent="amber"
              />
              <StatCard
                label={stats.hasWeight ? "Max Weight" : "Max Reps/Set"}
                value={stats.hasWeight ? `${stats.maxWeight} kg` : `${Math.max(...sessionData.map(s => s.reps))} reps`}
                icon={<Dumbbell className="w-4 h-4 text-purple-500" />}
                accent="purple"
              />
              <StatCard
                label="Best Volume"
                value={stats.hasWeight ? `${stats.maxVolume.toLocaleString()} kg` : `${stats.maxVolume} reps`}
                icon={<BarChart2 className="w-4 h-4 text-cyan-500" />}
                accent="cyan"
              />
              <StatCard
                label="Sessions"
                value={String(stats.sessions)}
                icon={<TrendingUp className={`w-4 h-4 ${stats.trend === "up" ? "text-emerald-500" : stats.trend === "down" ? "text-rose-500" : "text-slate-400"}`} />}
                accent={stats.trend === "up" ? "emerald" : stats.trend === "down" ? "rose" : "slate"}
                sub={stats.trend === "up" ? "Trending up" : stats.trend === "down" ? "Trending down" : "Stable"}
              />
            </div>
          )}

          {/* 1RM Chart — only when weight is tracked */}
          {stats?.hasWeight && <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              Estimated 1-Rep Max (Epley) — kg
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={sessionData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis dataKey="displayDate" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "none", borderRadius: "10px", fontSize: "12px", color: "#f1f5f9" }}
                  formatter={(v) => [`${v ?? 0} kg`, "Est. 1RM"]}
                />
                <Line
                  type="monotone"
                  dataKey="oneRM"
                  stroke="#a855f7"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#a855f7", strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>}

          {/* Volume Chart */}
          {(() => {
            const hasWeight = sessionData.some((s) => s.volume > 0)
            const volumeKey = hasWeight ? "volume" : "repsVolume"
            const volumeLabel = hasWeight ? "Volume (sets × reps × weight) — kg" : "Volume (sets × reps)"
            const volumeUnit = hasWeight ? "kg" : "reps"
            return (
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">{volumeLabel}</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={sessionData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                    <XAxis dataKey="displayDate" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "none", borderRadius: "10px", fontSize: "12px", color: "#f1f5f9" }}
                      formatter={(v) => [`${Number(v ?? 0).toLocaleString()} ${volumeUnit}`, "Volume"]}
                    />
                    <Line
                      type="monotone"
                      dataKey={volumeKey}
                      stroke="#06b6d4"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#06b6d4", strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          })()}

          {/* Recent Sessions Table */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Recent Sessions</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-right">Weight</th>
                    <th className="px-4 py-2.5 text-right">Sets</th>
                    <th className="px-4 py-2.5 text-right">Reps</th>
                    <th className="px-4 py-2.5 text-right">Est. 1RM</th>
                    <th className="px-4 py-2.5 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionData.slice().reverse().slice(0, 12).map((s) => (
                    <tr key={s.date} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{s.displayDate}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{s.weight > 0 ? `${s.weight} kg` : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{s.sets || "—"}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{s.reps || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-purple-600 dark:text-purple-400">
                        {s.oneRM > 0 ? `${s.oneRM} kg` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">
                        {s.volume > 0 ? `${s.volume.toLocaleString()} kg` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  accent,
  sub,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: "amber" | "purple" | "cyan" | "emerald" | "rose" | "slate"
  sub?: string
}) {
  const bg: Record<string, string> = {
    amber: "bg-amber-50 dark:bg-amber-900/20",
    purple: "bg-purple-50 dark:bg-purple-900/20",
    cyan: "bg-cyan-50 dark:bg-cyan-900/20",
    emerald: "bg-emerald-50 dark:bg-emerald-900/20",
    rose: "bg-rose-50 dark:bg-rose-900/20",
    slate: "bg-slate-100 dark:bg-slate-800",
  }

  return (
    <div className={`rounded-2xl px-4 py-3 ${bg[accent]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className="text-xl font-semibold text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
