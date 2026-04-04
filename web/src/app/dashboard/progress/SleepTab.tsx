"use client"

import { useEffect, useState } from "react"
import { Moon, Zap, Loader2 } from "lucide-react"
import { supabase } from "../../../lib/supabase/client"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

type SleepLog = {
  id: string
  date: string
  sleep_hours: number
  quality: string
  notes: string | null
  created_at: string
}

const QUALITY_OPTIONS = ["Poor", "Fair", "Good", "Great"]

const QUALITY_COLORS: Record<string, string> = {
  Poor: "text-rose-600 bg-rose-50 border-rose-200",
  Fair: "text-amber-600 bg-amber-50 border-amber-200",
  Good: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Great: "text-purple-600 bg-purple-50 border-purple-200",
}

const QUALITY_DOT: Record<string, string> = {
  Poor: "#f43f5e",
  Fair: "#f59e0b",
  Good: "#10b981",
  Great: "#7c3aed",
}

export default function SleepTab() {
  const [logs, setLogs] = useState<SleepLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const today = new Date().toISOString().split("T")[0]
  const [date, setDate] = useState(today)
  const [sleepHours, setSleepHours] = useState("7")
  const [quality, setQuality] = useState("Good")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      await loadLogs(user.id)
    }
    load()
  }, [])

  const loadLogs = async (uid: string) => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from("sleep_logs")
      .select("*")
      .eq("user_id", uid)
      .order("date", { ascending: false })
      .limit(30)

    if (err) {
      setError("Could not load sleep logs. Make sure the sleep_logs table exists in Supabase.")
      setLoading(false)
      return
    }
    setLogs(data ?? [])
    setLoading(false)
  }

  const handleSave = async () => {
    if (!userId) return
    if (!sleepHours || isNaN(Number(sleepHours))) {
      setError("Enter valid sleep hours.")
      return
    }
    setSaving(true)
    setError(null)
    setStatus(null)

    const { error: err } = await supabase.from("sleep_logs").upsert(
      {
        user_id: userId,
        date,
        sleep_hours: parseFloat(sleepHours),
        quality,
        notes: notes || null,
      },
      { onConflict: "user_id,date" }
    )

    if (err) {
      setError(err.message)
    } else {
      setStatus("Sleep logged successfully.")
      setNotes("")
      await loadLogs(userId)
    }
    setSaving(false)
  }

  const avgSleep =
    logs.length > 0
      ? (logs.reduce((s, l) => s + l.sleep_hours, 0) / logs.length).toFixed(1)
      : null

  const chartData = [...logs]
    .reverse()
    .slice(-14)
    .map((l) => ({
      date: new Date(l.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      hours: l.sleep_hours,
      quality: l.quality,
    }))

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-8 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading sleep data...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Log form */}
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600">
            <Moon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Log Sleep & Recovery</h2>
            <p className="text-sm text-slate-500">Track your nightly sleep to monitor recovery trends</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={today}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Hours Slept</label>
            <input
              type="number"
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)}
              min="0"
              max="24"
              step="0.5"
              placeholder="e.g. 7.5"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Sleep Quality</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. woke up twice"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : "Log Sleep"}
        </button>

        {error && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}
        {status && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div>
        )}
      </div>

      {/* Stats row */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Avg Sleep</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{avgSleep}h</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Nights Logged</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{logs.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Best Night</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {Math.max(...logs.map((l) => l.sleep_hours))}h
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Last Night</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{logs[0]?.sleep_hours ?? "--"}h</p>
            {logs[0] && (
              <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${QUALITY_COLORS[logs[0].quality] ?? ""}`}>
                {logs[0].quality}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Sleep chart */}
      {chartData.length > 1 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-base font-semibold text-slate-900">Sleep Trend (last 14 nights)</h3>
          <p className="mb-4 text-sm text-slate-500">Hours slept per night</p>
          <div className="h-[240px] w-full">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 12]} tick={{ fontSize: 11 }} unit="h" />
                <Tooltip formatter={(v) => [`${v}h`, "Sleep"]} />
                <Line
                  type="monotone"
                  dataKey="hours"
                  stroke="#7c3aed"
                  strokeWidth={2.5}
                  dot={({ cx, cy, payload }) => (
                    <circle
                      key={`dot-${payload.date}`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={QUALITY_DOT[payload.quality] ?? "#7c3aed"}
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  )}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-400">Dot color: 🔴 Poor  🟡 Fair  🟢 Good  🟣 Great</p>
        </div>
      )}

      {/* Log history */}
      <div>
        <p className="mb-3 text-sm font-semibold text-slate-900">
          Recent Logs{" "}
          {logs.length > 0 && <span className="font-normal text-slate-400">({logs.length})</span>}
        </p>

        {logs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            No sleep logs yet. Log your first night above.
          </div>
        ) : (
          <div className="space-y-2">
            {logs.slice(0, 10).map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 text-purple-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {new Date(log.date).toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                    {log.notes && (
                      <p className="text-xs text-slate-400">{log.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${QUALITY_COLORS[log.quality] ?? ""}`}>
                    {log.quality}
                  </span>
                  <span className="text-sm font-bold text-slate-900">{log.sleep_hours}h</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
