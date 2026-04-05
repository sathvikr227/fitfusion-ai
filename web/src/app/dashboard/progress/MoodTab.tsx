"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase/client"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

type MoodLog = {
  id: string
  user_id: string
  date: string
  energy: number
  mood: number
  stress: number
  notes: string | null
  created_at: string | null
}

const ENERGY_EMOJIS = ["", "😴", "😐", "😊", "😄", "⚡"]
const MOOD_EMOJIS   = ["", "😢", "😕", "😐", "😊", "😄"]
const STRESS_EMOJIS = ["", "😌", "🙂", "😐", "😤", "🤯"]

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function getLast7Days(): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().split("T")[0])
  }
  return days
}

function shortDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function avg(nums: number[]) {
  if (nums.length === 0) return null
  return (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1)
}

export default function MoodTab() {
  const [userId, setUserId] = useState<string | null>(null)
  const [logs, setLogs] = useState<MoodLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("")
  const [editing, setEditing] = useState(false)

  // Form / slider state
  const [energy, setEnergy] = useState(3)
  const [mood, setMood] = useState(3)
  const [stress, setStress] = useState(3)
  const [notes, setNotes] = useState("")

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    setStatus("")
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      setStatus("Please log in to track mood.")
      setLoading(false)
      return
    }
    setUserId(user.id)
    const { data, error } = await supabase
      .from("mood_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(30)
    if (error) {
      console.error("Error loading mood logs:", error.message)
      setStatus("Could not load mood history.")
      setLogs([])
      setLoading(false)
      return
    }
    const normalized: MoodLog[] = (data ?? []).map((r: any) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      date: r.date,
      energy: Number(r.energy ?? 3),
      mood: Number(r.mood ?? 3),
      stress: Number(r.stress ?? 3),
      notes: r.notes ?? null,
      created_at: r.created_at ?? null,
    }))
    setLogs(normalized)
    setLoading(false)
  }

  const today = todayStr()
  const todayLog = useMemo(() => logs.find((l) => l.date === today) ?? null, [logs, today])
  const checkedInToday = todayLog !== null && !editing

  // Pre-fill form with today's values when editing
  useEffect(() => {
    if (editing && todayLog) {
      setEnergy(todayLog.energy)
      setMood(todayLog.mood)
      setStress(todayLog.stress)
      setNotes(todayLog.notes ?? "")
    }
  }, [editing, todayLog])

  const saveCheckin = async () => {
    if (!userId) { setStatus("Please log in first."); return }
    setSaving(true)
    setStatus("")
    const { error } = await supabase.from("mood_logs").upsert(
      { user_id: userId, date: today, energy, mood, stress, notes: notes || null },
      { onConflict: "user_id,date" }
    )
    setSaving(false)
    if (error) {
      console.error("Error saving mood:", error.message)
      setStatus("Could not save check-in.")
      return
    }
    setEditing(false)
    await loadData()
    setStatus("Check-in saved.")
  }

  // 7-day area chart data
  const chartData = useMemo(() => {
    const days = getLast7Days()
    return days.map((day) => {
      const log = logs.find((l) => l.date === day)
      return {
        date: shortDate(day),
        Energy: log?.energy ?? null,
        Mood: log?.mood ?? null,
        Stress: log?.stress ?? null,
      }
    })
  }, [logs])

  // Weekly averages
  const last7Days = getLast7Days()
  const weekLogs = logs.filter((l) => last7Days.includes(l.date))
  const avgEnergy = avg(weekLogs.map((l) => l.energy))
  const avgMood   = avg(weekLogs.map((l) => l.mood))
  const avgStress = avg(weekLogs.map((l) => l.stress))

  return (
    <div className="space-y-6">

      {/* DAILY CHECK-IN */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Daily Check-in</h2>
          {checkedInToday && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-purple-600 hover:underline"
            >
              Edit today
            </button>
          )}
        </div>

        {checkedInToday && todayLog ? (
          /* Already checked in — show read-only values */
          <div className="space-y-4">
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              You have checked in today.
            </p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Energy", val: todayLog.energy, emojis: ENERGY_EMOJIS, color: "text-yellow-500" },
                { label: "Mood",   val: todayLog.mood,   emojis: MOOD_EMOJIS,   color: "text-blue-500" },
                { label: "Stress", val: todayLog.stress, emojis: STRESS_EMOJIS, color: "text-red-400" },
              ].map((item) => (
                <div key={item.label} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{item.label}</p>
                  <p className="text-3xl">{item.emojis[item.val]}</p>
                  <p className={`text-xl font-semibold mt-1 ${item.color}`}>{item.val}/5</p>
                </div>
              ))}
            </div>
            {todayLog.notes && (
              <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 px-4 py-3 rounded-xl">
                {todayLog.notes}
              </p>
            )}
          </div>
        ) : (
          /* Check-in form */
          <div className="space-y-5">
            {[
              {
                label: "Energy", val: energy, set: setEnergy,
                emojis: ENERGY_EMOJIS, color: "accent-yellow-400",
                description: "How energetic do you feel?",
              },
              {
                label: "Mood", val: mood, set: setMood,
                emojis: MOOD_EMOJIS, color: "accent-blue-500",
                description: "What's your overall mood?",
              },
              {
                label: "Stress", val: stress, set: setStress,
                emojis: STRESS_EMOJIS, color: "accent-red-400",
                description: "How stressed are you?",
              },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-slate-800 dark:text-white">{item.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{item.description}</span>
                  </div>
                  <span className="text-2xl">{item.emojis[item.val]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-4">1</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={item.val}
                    onChange={(e) => item.set(Number(e.target.value))}
                    className={`flex-1 h-2 rounded-full cursor-pointer ${item.color}`}
                  />
                  <span className="text-xs text-slate-400 w-4">5</span>
                  <span className="w-8 text-center font-semibold text-slate-700 dark:text-slate-200">
                    {item.val}
                  </span>
                </div>
                {/* Pip labels */}
                <div className="flex justify-between px-6 mt-1">
                  {item.emojis.slice(1).map((emoji, i) => (
                    <span key={i} className={`text-sm transition-opacity ${item.val === i + 1 ? "opacity-100" : "opacity-30"}`}>{emoji}</span>
                  ))}
                </div>
              </div>
            ))}

            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Notes (optional)</label>
              <textarea
                rows={2}
                placeholder="How are you feeling today?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              />
            </div>

            <button
              onClick={saveCheckin}
              disabled={saving}
              className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition disabled:opacity-60"
            >
              {saving ? "Saving..." : editing ? "Update Check-in" : "Save Check-in"}
            </button>

            {editing && (
              <button
                onClick={() => setEditing(false)}
                className="w-full py-2 text-sm text-slate-500 hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {status && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-xl">
          {status}
        </div>
      )}

      {/* WEEKLY AVERAGES */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Avg Energy", val: avgEnergy, color: "text-yellow-500", emoji: "⚡" },
          { label: "Avg Mood",   val: avgMood,   color: "text-blue-500",   emoji: "😊" },
          { label: "Avg Stress", val: avgStress, color: "text-red-400",    emoji: "😤" },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm text-center">
            <p className="text-lg">{s.emoji}</p>
            <p className={`text-2xl font-semibold mt-1 ${s.color}`}>
              {s.val !== null ? `${s.val}/5` : "—"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 7-DAY TREND CHART */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold mb-4">7-Day Trend</h2>
        {loading ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorMood" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorStress" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value: any, name: any) => [`${value}/5`, name]}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="Energy"
                stroke="#eab308"
                strokeWidth={2}
                fill="url(#colorEnergy)"
                connectNulls
                dot={{ r: 3 }}
              />
              <Area
                type="monotone"
                dataKey="Mood"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#colorMood)"
                connectNulls
                dot={{ r: 3 }}
              />
              <Area
                type="monotone"
                dataKey="Stress"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#colorStress)"
                connectNulls
                dot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

    </div>
  )
}
