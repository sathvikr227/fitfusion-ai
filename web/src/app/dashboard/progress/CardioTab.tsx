"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase/client"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

type CardioLog = {
  id: string
  user_id: string
  date: string
  activity: string
  duration_minutes: number
  distance_km: number | null
  calories_burned: number | null
  avg_heart_rate: number | null
  notes: string | null
  created_at: string | null
}

const ACTIVITIES = [
  "Running", "Walking", "Cycling", "Swimming", "Jump Rope",
  "Rowing", "Elliptical", "Hiking", "HIIT", "Stair Climber", "Other",
]

const MET: Record<string, number> = {
  Running: 9.8, Walking: 3.5, Cycling: 7.5, Swimming: 8.0,
  "Jump Rope": 12.0, Rowing: 7.0, Elliptical: 5.0, Hiking: 6.0,
  HIIT: 10.0, "Stair Climber": 9.0, Other: 5.0,
}

const ACTIVITY_EMOJI: Record<string, string> = {
  Running: "🏃", Walking: "🚶", Cycling: "🚴", Swimming: "🏊",
  "Jump Rope": "🪢", Rowing: "🚣", Elliptical: "⚙️", Hiking: "🥾",
  HIIT: "🔥", "Stair Climber": "🪜", Other: "💪",
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function formatDate(val: string | null | undefined) {
  if (!val) return "—"
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function getLast7Days() {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().split("T")[0])
  }
  return days
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-US", { weekday: "short" })
}

function startOfWeek() {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split("T")[0]
}

export default function CardioTab() {
  const [userId, setUserId] = useState<string | null>(null)
  const [weightKg, setWeightKg] = useState<number>(70)
  const [logs, setLogs] = useState<CardioLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("")

  // Form state
  const [date, setDate] = useState(todayStr())
  const [activity, setActivity] = useState("Running")
  const [duration, setDuration] = useState("")
  const [distance, setDistance] = useState("")
  const [heartRate, setHeartRate] = useState("")
  const [notes, setNotes] = useState("")
  const [calories, setCalories] = useState<number | null>(null)

  useEffect(() => { loadData() }, [])

  // Auto-calc calories when activity/duration/weight changes
  useEffect(() => {
    const dur = parseFloat(duration)
    if (isFinite(dur) && dur > 0 && weightKg > 0) {
      const met = MET[activity] ?? 5.0
      setCalories(Math.round(met * weightKg * (dur / 60)))
    } else {
      setCalories(null)
    }
  }, [activity, duration, weightKg])

  const loadData = async () => {
    setLoading(true)
    setStatus("")
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      setStatus("Please log in to track cardio.")
      setLoading(false)
      return
    }
    setUserId(user.id)

    // Load latest weight
    const { data: wData } = await supabase
      .from("weight_logs")
      .select("weight")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(1)
    if (wData && wData.length > 0 && wData[0].weight) {
      setWeightKg(Number(wData[0].weight))
    }

    // Load cardio logs
    const { data, error } = await supabase
      .from("cardio_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(50)
    if (error) {
      console.error("Error loading cardio logs:", error.message)
      setStatus("Could not load cardio history.")
      setLogs([])
      setLoading(false)
      return
    }
    const normalized: CardioLog[] = (data ?? []).map((r: any) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      date: r.date ?? null,
      activity: r.activity ?? "Other",
      duration_minutes: Number(r.duration_minutes ?? 0),
      distance_km: r.distance_km !== null ? Number(r.distance_km) : null,
      calories_burned: r.calories_burned !== null ? Number(r.calories_burned) : null,
      avg_heart_rate: r.avg_heart_rate !== null ? Number(r.avg_heart_rate) : null,
      notes: r.notes ?? null,
      created_at: r.created_at ?? null,
    }))
    setLogs(normalized)
    setLoading(false)
  }

  const saveCardio = async () => {
    if (!userId) { setStatus("Please log in first."); return }
    const dur = parseFloat(duration)
    if (!isFinite(dur) || dur <= 0) { setStatus("Please enter a valid duration."); return }
    setSaving(true)
    setStatus("")
    const dist = parseFloat(distance)
    const hr = parseFloat(heartRate)
    const { error } = await supabase.from("cardio_logs").insert({
      user_id: userId,
      date,
      activity,
      duration_minutes: dur,
      distance_km: isFinite(dist) && dist > 0 ? dist : null,
      calories_burned: calories,
      avg_heart_rate: isFinite(hr) && hr > 0 ? hr : null,
      notes: notes || null,
    })
    setSaving(false)
    if (error) {
      console.error("Error saving cardio:", error.message)
      setStatus("Could not save cardio session.")
      return
    }
    setDate(todayStr())
    setActivity("Running")
    setDuration("")
    setDistance("")
    setHeartRate("")
    setNotes("")
    setCalories(null)
    await loadData()
    setStatus("Cardio session saved successfully.")
  }

  // Weekly stats
  const weekStart = startOfWeek()
  const weekLogs = useMemo(() => logs.filter((l) => l.date >= weekStart), [logs, weekStart])
  const weekMinutes = weekLogs.reduce((s, l) => s + l.duration_minutes, 0)
  const weekDistance = weekLogs.reduce((s, l) => s + (l.distance_km ?? 0), 0)
  const weekCalories = weekLogs.reduce((s, l) => s + (l.calories_burned ?? 0), 0)

  // Bar chart data — last 7 days
  const barData = useMemo(() => {
    const days = getLast7Days()
    return days.map((day) => {
      const dayLogs = logs.filter((l) => l.date === day)
      const total = dayLogs.reduce((s, l) => s + l.duration_minutes, 0)
      return { day: dayLabel(day), minutes: total }
    })
  }, [logs])

  const recentLogs = logs.slice(0, 10)

  return (
    <div className="space-y-6">

      {/* LOG FORM */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
        <h2 className="text-lg font-semibold">Log Cardio Session</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Activity</label>
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            >
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>{ACTIVITY_EMOJI[a]} {a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Duration (minutes)</label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 30"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Distance (km, optional)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 5.0"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Avg Heart Rate (optional)</label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 145"
              value={heartRate}
              onChange={(e) => setHeartRate(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="flex items-end">
            <div className="w-full bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Est. Calories Burned</p>
              <p className="text-2xl font-semibold text-purple-600">
                {calories !== null ? `${calories} kcal` : "—"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Based on {weightKg} kg body weight</p>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              placeholder="How did it go?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            />
          </div>
        </div>

        <button
          onClick={saveCardio}
          disabled={saving}
          className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Cardio Session"}
        </button>
      </div>

      {status && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-xl">
          {status}
        </div>
      )}

      {/* STATS ROW */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "This Week", value: `${weekMinutes} min`, sub: "Cardio time" },
          { label: "Distance", value: `${weekDistance.toFixed(1)} km`, sub: "This week" },
          { label: "Calories", value: `${weekCalories.toLocaleString()} kcal`, sub: "Burned this week" },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{s.label}</p>
            <p className="text-xl font-semibold mt-1">{s.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* BAR CHART */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold mb-4">Weekly Cardio Duration</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" min" />
            <Tooltip formatter={(v: any) => [`${v} min`, "Duration"]} />
            <Bar dataKey="minutes" fill="#a855f7" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* RECENT CARDIO CARDS */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Sessions</h2>
          <button onClick={loadData} className="text-sm text-purple-600 hover:underline">Refresh</button>
        </div>

        {loading ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
        ) : recentLogs.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">No cardio sessions logged yet.</div>
        ) : (
          <div className="space-y-3">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-slate-200 dark:border-slate-700 rounded-xl p-4 gap-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{ACTIVITY_EMOJI[log.activity] ?? "💪"}</span>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-white">{log.activity}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(log.date)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full font-medium">
                    {log.duration_minutes} min
                  </span>
                  {log.distance_km !== null && (
                    <span className="bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-3 py-1 rounded-full font-medium">
                      {log.distance_km} km
                    </span>
                  )}
                  {log.calories_burned !== null && (
                    <span className="bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-3 py-1 rounded-full font-medium">
                      {log.calories_burned} kcal
                    </span>
                  )}
                  {log.avg_heart_rate !== null && (
                    <span className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 px-3 py-1 rounded-full font-medium">
                      ❤️ {log.avg_heart_rate} bpm
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
