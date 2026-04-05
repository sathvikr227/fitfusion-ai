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

type Measurement = {
  id: string
  user_id: string
  date: string
  waist_cm: number | null
  chest_cm: number | null
  hips_cm: number | null
  left_arm_cm: number | null
  right_arm_cm: number | null
  left_thigh_cm: number | null
  right_thigh_cm: number | null
  neck_cm: number | null
  notes: string | null
  created_at: string | null
}

const FIELDS: { key: keyof Measurement; label: string; color: string }[] = [
  { key: "waist_cm",       label: "Waist",       color: "#a855f7" },
  { key: "chest_cm",       label: "Chest",       color: "#06b6d4" },
  { key: "hips_cm",        label: "Hips",        color: "#f59e0b" },
  { key: "left_arm_cm",    label: "Left Arm",    color: "#10b981" },
  { key: "right_arm_cm",   label: "Right Arm",   color: "#3b82f6" },
  { key: "left_thigh_cm",  label: "Left Thigh",  color: "#ef4444" },
  { key: "right_thigh_cm", label: "Right Thigh", color: "#ec4899" },
  { key: "neck_cm",        label: "Neck",        color: "#8b5cf6" },
]

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function formatDate(val: string | null | undefined) {
  if (!val) return "—"
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function toNum(s: string) {
  const n = parseFloat(s)
  return isFinite(n) && n > 0 ? n : null
}

export default function MeasurementsTab() {
  const [userId, setUserId] = useState<string | null>(null)
  const [logs, setLogs] = useState<Measurement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState("")
  const [chartField, setChartField] = useState<keyof Measurement>("waist_cm")

  // Form state
  const [date, setDate] = useState(todayStr())
  const [form, setForm] = useState<Record<string, string>>({
    waist_cm: "", chest_cm: "", hips_cm: "", left_arm_cm: "",
    right_arm_cm: "", left_thigh_cm: "", right_thigh_cm: "", neck_cm: "", notes: "",
  })

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    setStatus("")
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      setStatus("Please log in to track measurements.")
      setLoading(false)
      return
    }
    setUserId(user.id)
    const { data, error } = await supabase
      .from("body_measurements")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
    if (error) {
      console.error("Error loading measurements:", error.message)
      setStatus("Could not load measurements.")
      setLogs([])
      setLoading(false)
      return
    }
    const normalized: Measurement[] = (data ?? []).map((r: any) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      date: r.date ?? null,
      waist_cm: r.waist_cm !== null ? Number(r.waist_cm) : null,
      chest_cm: r.chest_cm !== null ? Number(r.chest_cm) : null,
      hips_cm: r.hips_cm !== null ? Number(r.hips_cm) : null,
      left_arm_cm: r.left_arm_cm !== null ? Number(r.left_arm_cm) : null,
      right_arm_cm: r.right_arm_cm !== null ? Number(r.right_arm_cm) : null,
      left_thigh_cm: r.left_thigh_cm !== null ? Number(r.left_thigh_cm) : null,
      right_thigh_cm: r.right_thigh_cm !== null ? Number(r.right_thigh_cm) : null,
      neck_cm: r.neck_cm !== null ? Number(r.neck_cm) : null,
      notes: r.notes ?? null,
      created_at: r.created_at ?? null,
    }))
    setLogs(normalized)
    setLoading(false)
  }

  const saveMeasurements = async () => {
    if (!userId) { setStatus("Please log in first."); return }
    setSaving(true)
    setStatus("")
    const payload: Record<string, any> = {
      user_id: userId,
      date,
      notes: form.notes || null,
    }
    for (const f of FIELDS) {
      payload[String(f.key)] = toNum(form[String(f.key)])
    }
    const { error } = await supabase
      .from("body_measurements")
      .upsert(payload, { onConflict: "user_id,date" })
    setSaving(false)
    if (error) {
      console.error("Error saving:", error.message)
      setStatus("Could not save measurements.")
      return
    }
    setForm({ waist_cm: "", chest_cm: "", hips_cm: "", left_arm_cm: "", right_arm_cm: "", left_thigh_cm: "", right_thigh_cm: "", neck_cm: "", notes: "" })
    setDate(todayStr())
    await loadData()
    setStatus("Measurements saved successfully.")
  }

  const latest = logs[0] ?? null
  const prev = logs[1] ?? null

  const chartData = useMemo(() => {
    return [...logs]
      .slice(0, 12)
      .reverse()
      .map((l) => ({
        date: l.date ? new Date(l.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—",
        value: l[chartField] as number | null,
      }))
      .filter((d) => d.value !== null)
  }, [logs, chartField])

  const tableLogs = logs.slice(0, 10)

  function delta(field: keyof Measurement) {
    if (!latest || !prev) return null
    const a = latest[field] as number | null
    const b = prev[field] as number | null
    if (a === null || b === null) return null
    return +(a - b).toFixed(1)
  }

  return (
    <div className="space-y-6">

      {/* LOG FORM */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
        <h2 className="text-lg font-semibold">Log Measurements</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {FIELDS.map((f) => (
            <div key={String(f.key)}>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">{f.label} (cm)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder={`e.g. 75.5`}
                value={form[String(f.key)]}
                onChange={(e) => setForm((prev) => ({ ...prev, [String(f.key)]: e.target.value }))}
                className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          ))}

          <div className="sm:col-span-2">
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              placeholder="Any notes..."
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            />
          </div>
        </div>

        <button
          onClick={saveMeasurements}
          disabled={saving}
          className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Measurements"}
        </button>
      </div>

      {status && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-xl">
          {status}
        </div>
      )}

      {/* LATEST MEASUREMENTS CARD */}
      {latest && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-1">Latest Measurements</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{formatDate(latest.date)}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {FIELDS.map((f) => {
              const val = latest[f.key] as number | null
              const d = delta(f.key)
              return (
                <div key={String(f.key)} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{f.label}</p>
                  <p className="text-xl font-semibold">{val !== null ? `${val} cm` : "—"}</p>
                  {d !== null && (
                    <p className={`text-xs font-medium mt-1 ${d < 0 ? "text-green-500" : d > 0 ? "text-red-400" : "text-slate-400"}`}>
                      {d > 0 ? `+${d}` : d} cm vs prev
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* LINE CHART */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Measurement Trend</h2>
          <select
            value={String(chartField)}
            onChange={(e) => setChartField(e.target.value as keyof Measurement)}
            className="border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-500"
          >
            {FIELDS.map((f) => (
              <option key={String(f.key)} value={String(f.key)}>{f.label}</option>
            ))}
          </select>
        </div>

        {chartData.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">No data to chart yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit=" cm" domain={["auto", "auto"]} />
              <Tooltip formatter={(v: any) => [`${v} cm`, FIELDS.find(f => f.key === chartField)?.label ?? ""]} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={FIELDS.find(f => f.key === chartField)?.color ?? "#a855f7"}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                name={FIELDS.find(f => f.key === chartField)?.label ?? ""}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* PROGRESS TABLE */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">History (Last 10)</h2>
          <button onClick={loadData} className="text-sm text-purple-600 hover:underline">Refresh</button>
        </div>

        {loading ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
        ) : tableLogs.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400 text-sm">No measurements logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 pr-4 font-medium text-slate-500 dark:text-slate-400">Date</th>
                  {FIELDS.map((f) => (
                    <th key={String(f.key)} className="pb-2 pr-4 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableLogs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatDate(log.date)}</td>
                    {FIELDS.map((f) => {
                      const val = log[f.key] as number | null
                      return (
                        <td key={String(f.key)} className="py-2 pr-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {val !== null ? `${val}` : "—"}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
