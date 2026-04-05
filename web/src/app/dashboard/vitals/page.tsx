"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "../../../lib/supabase/client"
import {
  Heart,
  Activity,
  Droplets,
  Zap,
  FileText,
  Save,
  TrendingUp,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type VitalsLog = {
  id: string
  user_id: string
  date: string
  systolic: number | null
  diastolic: number | null
  resting_heart_rate: number | null
  blood_sugar_mg_dl: number | null
  oxygen_saturation: number | null
  notes: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function bpStatus(systolic: number | null, diastolic: number | null): { label: string; color: string; bg: string } {
  if (!systolic || !diastolic) return { label: "—", color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-700" }
  if (systolic < 120 && diastolic < 80) return { label: "Normal", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" }
  if (systolic < 130 && diastolic < 80) return { label: "Elevated", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" }
  if (systolic < 140 || (diastolic >= 80 && diastolic < 90)) return { label: "High Stage 1", color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30" }
  return { label: "High Stage 2", color: "text-rose-700 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/30" }
}

function hrStatus(hr: number | null): { label: string; color: string; bg: string } {
  if (!hr) return { label: "—", color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-700" }
  if (hr < 60) return { label: "Low", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" }
  if (hr <= 100) return { label: "Normal", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" }
  return { label: "High", color: "text-rose-700 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/30" }
}

function spo2Status(spo2: number | null): { label: string; color: string; bg: string } {
  if (!spo2) return { label: "—", color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-700" }
  if (spo2 >= 95) return { label: "Normal", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" }
  if (spo2 >= 90) return { label: "Low", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" }
  return { label: "Critical", color: "text-rose-700 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-900/30" }
}

function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bg} ${color}`}>
      {label}
    </span>
  )
}

// ─── Inline SVG Line Chart ────────────────────────────────────────────────────

function LineChart({
  data,
  color = "#a855f7",
  color2,
  label,
  label2,
  height = 80,
}: {
  data: { date: string; value: number }[]
  color?: string
  color2?: string
  label: string
  label2?: string
  data2?: { date: string; value: number }[]
  height?: number
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
        Not enough data to display chart
      </div>
    )
  }

  const width = 400
  const pad = { top: 8, right: 8, bottom: 8, left: 8 }
  const allVals = data.map((d) => d.value)
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const range = max - min || 1

  const toX = (i: number) => pad.left + (i / (data.length - 1)) * (width - pad.left - pad.right)
  const toY = (v: number) => pad.top + ((max - v) / range) * (height - pad.top - pad.bottom)

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.value).toFixed(1)}`).join(" ")

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full" style={{ background: color }} />
          {label}
        </span>
        {label2 && color2 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-full" style={{ background: color2 }} />
            {label2}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function DualLineChart({
  data1,
  data2,
  color1 = "#a855f7",
  color2 = "#06b6d4",
  label1,
  label2,
  height = 80,
}: {
  data1: { date: string; value: number }[]
  data2: { date: string; value: number }[]
  color1?: string
  color2?: string
  label1: string
  label2: string
  height?: number
}) {
  if (data1.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
        Not enough data to display chart
      </div>
    )
  }

  const width = 400
  const pad = { top: 8, right: 8, bottom: 8, left: 8 }
  const allVals = [...data1.map((d) => d.value), ...data2.map((d) => d.value)]
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const range = max - min || 1
  const n = Math.max(data1.length, data2.length)

  const toX = (i: number) => pad.left + (i / (n - 1)) * (width - pad.left - pad.right)
  const toY = (v: number) => pad.top + ((max - v) / range) * (height - pad.top - pad.bottom)

  const path1 = data1.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.value).toFixed(1)}`).join(" ")
  const path2 = data2.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(d.value).toFixed(1)}`).join(" ")

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full" style={{ background: color1 }} />
          {label1}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full" style={{ background: color2 }} />
          {label2}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <path d={path1} fill="none" stroke={color1} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path2} fill="none" stroke={color2} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function VitalsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [logs, setLogs] = useState<VitalsLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState("")

  const [form, setForm] = useState({
    date: todayStr(),
    systolic: "",
    diastolic: "",
    resting_heart_rate: "",
    blood_sugar_mg_dl: "",
    oxygen_saturation: "",
    notes: "",
  })

  // ── Auth + data ───────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id)
      }
    })
  }, [])

  const fetchLogs = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data } = await supabase
      .from("vitals_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
      .order("date", { ascending: false })
      .limit(30)
    if (data) setLogs(data as VitalsLog[])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Pre-fill form with today's log if it exists
  useEffect(() => {
    const todayLog = logs.find((l) => l.date === form.date)
    if (todayLog) {
      setForm((prev) => ({
        ...prev,
        systolic: todayLog.systolic?.toString() ?? "",
        diastolic: todayLog.diastolic?.toString() ?? "",
        resting_heart_rate: todayLog.resting_heart_rate?.toString() ?? "",
        blood_sugar_mg_dl: todayLog.blood_sugar_mg_dl?.toString() ?? "",
        oxygen_saturation: todayLog.oxygen_saturation?.toString() ?? "",
        notes: todayLog.notes ?? "",
      }))
    }
  }, [logs, form.date])

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!userId) return
    setSaving(true)
    const payload = {
      user_id: userId,
      date: form.date,
      systolic: form.systolic ? Number(form.systolic) : null,
      diastolic: form.diastolic ? Number(form.diastolic) : null,
      resting_heart_rate: form.resting_heart_rate ? Number(form.resting_heart_rate) : null,
      blood_sugar_mg_dl: form.blood_sugar_mg_dl ? Number(form.blood_sugar_mg_dl) : null,
      oxygen_saturation: form.oxygen_saturation ? Number(form.oxygen_saturation) : null,
      notes: form.notes || null,
    }
    const { error } = await supabase
      .from("vitals_logs")
      .upsert(payload, { onConflict: "user_id,date" })
    setSaving(false)
    if (!error) {
      setToast("Vitals saved!")
      fetchLogs()
      setTimeout(() => setToast(""), 3000)
    } else {
      setToast("Error saving vitals.")
      setTimeout(() => setToast(""), 3000)
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const latest = logs[0] ?? null
  const history = logs.slice(0, 10)
  const chronological = [...logs].sort((a, b) => a.date.localeCompare(b.date))

  const bpData1 = chronological
    .filter((l) => l.systolic != null)
    .map((l) => ({ date: l.date, value: l.systolic! }))
  const bpData2 = chronological
    .filter((l) => l.diastolic != null)
    .map((l) => ({ date: l.date, value: l.diastolic! }))
  const hrData = chronological
    .filter((l) => l.resting_heart_rate != null)
    .map((l) => ({ date: l.date, value: l.resting_heart_rate! }))

  const bpSt = bpStatus(latest?.systolic ?? null, latest?.diastolic ?? null)
  const hrSt = hrStatus(latest?.resting_heart_rate ?? null)
  const spo2St = spo2Status(latest?.oxygen_saturation ?? null)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 md:p-8">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 dark:bg-white px-5 py-3 text-sm font-medium text-white dark:text-slate-900 shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500 text-white">
            <Activity className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Health Vitals</h1>
        </div>
        <p className="ml-13 text-sm text-slate-500 dark:text-slate-400 pl-13">
          Track your blood pressure, heart rate, and more
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column: Form + Latest ──────────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          {/* Log Vitals Form */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <FileText className="h-4 w-4 text-purple-500" />
              Log Vitals
            </h2>

            <div className="flex flex-col gap-4">
              {/* Date */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Blood Pressure */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Blood Pressure (mmHg)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Systolic"
                    value={form.systolic}
                    onChange={(e) => setForm((p) => ({ ...p, systolic: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-slate-400 font-bold">/</span>
                  <input
                    type="number"
                    placeholder="Diastolic"
                    value={form.diastolic}
                    onChange={(e) => setForm((p) => ({ ...p, diastolic: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Heart Rate */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Resting Heart Rate (bpm)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 72"
                  value={form.resting_heart_rate}
                  onChange={(e) => setForm((p) => ({ ...p, resting_heart_rate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Blood Sugar */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Blood Sugar (mg/dL)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 95"
                  value={form.blood_sugar_mg_dl}
                  onChange={(e) => setForm((p) => ({ ...p, blood_sugar_mg_dl: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* SpO2 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Oxygen Saturation SpO2 (%)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 98"
                  min="80"
                  max="100"
                  value={form.oxygen_saturation}
                  onChange={(e) => setForm((p) => ({ ...p, oxygen_saturation: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional notes..."
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save Vitals"}
              </button>
            </div>
          </div>

          {/* Latest Reading Card */}
          {latest && (
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <Heart className="h-4 w-4 text-rose-500" />
                Latest Reading
              </h2>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                {new Date(latest.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </p>

              <div className="flex flex-col gap-3">
                {/* BP */}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Droplets className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Blood Pressure</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {latest.systolic ?? "—"}/{latest.diastolic ?? "—"}
                    </span>
                    <StatusBadge {...bpSt} />
                  </div>
                </div>

                {/* HR */}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-rose-500" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Heart Rate</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {latest.resting_heart_rate ?? "—"} bpm
                    </span>
                    <StatusBadge {...hrSt} />
                  </div>
                </div>

                {/* Blood Sugar */}
                {latest.blood_sugar_mg_dl != null && (
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Blood Sugar</span>
                    </div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {latest.blood_sugar_mg_dl} mg/dL
                    </span>
                  </div>
                )}

                {/* SpO2 */}
                {latest.oxygen_saturation != null && (
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-cyan-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">SpO2</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {latest.oxygen_saturation}%
                      </span>
                      <StatusBadge {...spo2St} />
                    </div>
                  </div>
                )}

                {latest.notes && (
                  <p className="rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3 text-xs text-slate-500 dark:text-slate-400 italic">
                    {latest.notes}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: Charts + History ──────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Charts */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              Trends (Last 30 Days)
            </h2>

            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
            ) : (
              <div className="flex flex-col gap-6">
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                    Blood Pressure
                  </p>
                  <DualLineChart
                    data1={bpData1}
                    data2={bpData2}
                    color1="#a855f7"
                    color2="#06b6d4"
                    label1="Systolic"
                    label2="Diastolic"
                    height={90}
                  />
                </div>
                <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                  <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                    Heart Rate
                  </p>
                  <LineChart
                    data={hrData}
                    color="#f43f5e"
                    label="Resting HR (bpm)"
                    height={80}
                  />
                </div>
              </div>
            )}
          </div>

          {/* History Table */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Activity className="h-4 w-4 text-cyan-500" />
              History
            </h2>

            {loading ? (
              <div className="flex h-20 items-center justify-center text-sm text-slate-400">Loading…</div>
            ) : history.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                No vitals logged yet. Add your first reading above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                      <th className="pb-2 text-left font-medium">Date</th>
                      <th className="pb-2 text-center font-medium">BP</th>
                      <th className="pb-2 text-center font-medium">Status</th>
                      <th className="pb-2 text-center font-medium">HR</th>
                      <th className="pb-2 text-center font-medium">Sugar</th>
                      <th className="pb-2 text-center font-medium">SpO2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((log) => {
                      const bp = bpStatus(log.systolic, log.diastolic)
                      const hr = hrStatus(log.resting_heart_rate)
                      return (
                        <tr
                          key={log.id}
                          className="border-b border-slate-50 dark:border-slate-700/50 last:border-0"
                        >
                          <td className="py-2.5 pr-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {new Date(log.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </td>
                          <td className="py-2.5 px-2 text-center font-semibold text-slate-900 dark:text-white">
                            {log.systolic ?? "—"}/{log.diastolic ?? "—"}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <StatusBadge {...bp} />
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <span className={`inline-flex items-center gap-1 font-medium ${hr.color}`}>
                              {log.resting_heart_rate ?? "—"}
                              {log.resting_heart_rate && <span className="text-xs font-normal text-slate-400">bpm</span>}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-600 dark:text-slate-300">
                            {log.blood_sugar_mg_dl != null ? `${log.blood_sugar_mg_dl} mg/dL` : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-600 dark:text-slate-300">
                            {log.oxygen_saturation != null ? `${log.oxygen_saturation}%` : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
