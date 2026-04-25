"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import {
  Pill,
  Plus,
  Trash2,
  Check,
  X,
  Flame,
  BarChart2,
  Star,
  Clock,
} from "lucide-react"
import { toast as appToast } from "../../../components/Toast"

// ─── Types ────────────────────────────────────────────────────────────────────

type Supplement = {
  id: string
  user_id: string
  name: string
  dosage: number
  unit: string
  timing: string
  notes: string | null
  created_at: string
}

type SupplementLog = {
  id: string
  user_id: string
  supplement_id: string
  date: string
  taken: boolean
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNITS = ["mg", "g", "mcg", "IU", "ml"]
const TIMINGS = ["Morning", "Pre-workout", "Post-workout", "Evening", "With meals"]

const QUICK_ADDS = [
  { name: "Creatine", dosage: 5, unit: "g", timing: "Post-workout" },
  { name: "Protein", dosage: 25, unit: "g", timing: "Post-workout" },
  { name: "Vitamin D", dosage: 2000, unit: "IU", timing: "Morning" },
  { name: "Omega-3", dosage: 1000, unit: "mg", timing: "With meals" },
  { name: "Magnesium", dosage: 400, unit: "mg", timing: "Evening" },
  { name: "Zinc", dosage: 10, unit: "mg", timing: "Morning" },
  { name: "Caffeine", dosage: 200, unit: "mg", timing: "Pre-workout" },
  { name: "BCAA", dosage: 5, unit: "g", timing: "Pre-workout" },
]

const TIMING_COLORS: Record<string, string> = {
  "Morning": "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  "Pre-workout": "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  "Post-workout": "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400",
  "Evening": "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400",
  "With meals": "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function calcStreak(logs: SupplementLog[], supplementId: string): number {
  const taken = logs
    .filter((l) => l.supplement_id === supplementId && l.taken)
    .map((l) => l.date)
    .sort()
    .reverse()

  if (taken.length === 0) return 0

  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const check = new Date(today)

  for (let i = 0; i < 365; i++) {
    const dateStr = check.toISOString().split("T")[0]
    if (taken.includes(dateStr)) {
      streak++
      check.setDate(check.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

function weeklyCompliance(logs: SupplementLog[], supplements: Supplement[]): number {
  if (supplements.length === 0) return 0
  const today = new Date()
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split("T")[0])
  }
  const possible = supplements.length * 7
  const taken = logs.filter(
    (l) => l.taken && dates.includes(l.date)
  ).length
  return possible === 0 ? 0 : Math.round((taken / possible) * 100)
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SupplementsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [supplements, setSupplements] = useState<Supplement[]>([])
  const [logs, setLogs] = useState<SupplementLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: "",
    dosage: "",
    unit: "mg",
    timing: "Morning",
    notes: "",
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
      else router.replace("/login")
    })
  }, [])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const [supRes, logRes] = await Promise.all([
      supabase.from("supplements").select("*").eq("user_id", userId).order("created_at"),
      supabase
        .from("supplement_logs")
        .select("*")
        .eq("user_id", userId)
        .gte("date", (() => {
          const d = new Date()
          d.setDate(d.getDate() - 30)
          return d.toISOString().split("T")[0]
        })())
        .order("date"),
    ])

    if (supRes.data) setSupplements(supRes.data as Supplement[])
    if (logRes.data) setLogs(logRes.data as SupplementLog[])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ── Add Supplement ────────────────────────────────────────────────────────

  const handleAdd = async (
    override?: { name: string; dosage: number; unit: string; timing: string }
  ) => {
    if (!userId) return
    const name = override?.name ?? form.name.trim()
    const dosage = override?.dosage ?? Number(form.dosage)
    const unit = override?.unit ?? form.unit
    const timing = override?.timing ?? form.timing

    if (!name || !dosage) {
      setToast("Name and dosage are required.")
      setTimeout(() => setToast(""), 3000)
      return
    }

    if (!Number.isFinite(dosage) || dosage <= 0) {
      setToast("Dosage must be a positive number.")
      appToast.error("Dosage must be a positive number.")
      setTimeout(() => setToast(""), 3000)
      return
    }

    setSaving(true)
    const { error } = await supabase.from("supplements").insert({
      user_id: userId,
      name,
      dosage,
      unit,
      timing,
      notes: form.notes || null,
    })
    setSaving(false)

    if (!error) {
      setForm({ name: "", dosage: "", unit: "mg", timing: "Morning", notes: "" })
      setShowForm(false)
      setToast(`${name} added!`)
      appToast.success(`${name} added.`)
      fetchData()
      setTimeout(() => setToast(""), 3000)
    } else {
      const msg = error.message || "Error adding supplement."
      console.error("Add supplement error:", error)
      setToast(msg)
      appToast.error(msg)
      setTimeout(() => setToast(""), 4000)
    }
  }

  // ── Toggle Taken ──────────────────────────────────────────────────────────

  const handleToggle = async (supplementId: string, currentlyTaken: boolean) => {
    if (!userId) return
    const today = todayStr()

    const { error } = await supabase.from("supplement_logs").upsert(
      {
        user_id: userId,
        supplement_id: supplementId,
        date: today,
        taken: !currentlyTaken,
      },
      { onConflict: "supplement_id,date" }
    )

    if (!error) {
      // Optimistic update
      setLogs((prev) => {
        const existing = prev.find((l) => l.supplement_id === supplementId && l.date === today)
        if (existing) {
          return prev.map((l) =>
            l.supplement_id === supplementId && l.date === today
              ? { ...l, taken: !currentlyTaken }
              : l
          )
        }
        return [
          ...prev,
          {
            id: `temp-${supplementId}`,
            user_id: userId,
            supplement_id: supplementId,
            date: today,
            taken: !currentlyTaken,
            created_at: new Date().toISOString(),
          },
        ]
      })
    }
  }

  // ── Delete Supplement ─────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await supabase.from("supplement_logs").delete().eq("supplement_id", id)
    const { error } = await supabase.from("supplements").delete().eq("id", id)
    setDeletingId(null)
    if (!error) {
      setSupplements((prev) => prev.filter((s) => s.id !== id))
      setLogs((prev) => prev.filter((l) => l.supplement_id !== id))
      setToast("Supplement removed.")
      setTimeout(() => setToast(""), 3000)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const today = todayStr()
  const todayLogsMap = Object.fromEntries(
    logs
      .filter((l) => l.date === today)
      .map((l) => [l.supplement_id, l.taken])
  )
  const compliance = weeklyCompliance(logs, supplements)
  const takenToday = supplements.filter((s) => todayLogsMap[s.id]).length
  const longestStreak = supplements.reduce((max, s) => {
    const st = calcStreak(logs, s.id)
    return st > max ? st : max
  }, 0)

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
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500 text-white">
              <Pill className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Supplements</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 ml-13">
            Track your daily supplement stack
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancel" : "Add Supplement"}
        </button>
      </div>

      {/* Stats Row */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Supplements", value: supplements.length.toString(), icon: Pill, accent: "bg-purple-100 dark:bg-purple-900/30" },
          { label: "Taken Today", value: `${takenToday}/${supplements.length}`, icon: Check, accent: "bg-emerald-100 dark:bg-emerald-900/30" },
          { label: "Weekly Compliance", value: `${compliance}%`, icon: BarChart2, accent: "bg-cyan-100 dark:bg-cyan-900/30" },
          { label: "Best Streak", value: `${longestStreak}d`, icon: Flame, accent: "bg-amber-100 dark:bg-amber-900/30" },
        ].map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className="flex flex-col gap-3 rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm"
          >
            <div className={`inline-flex w-fit rounded-2xl p-2.5 ${accent}`}>
              <Icon className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Add Supplement Form */}
      {showForm && (
        <div className="mb-6 rounded-3xl border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-slate-800 p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Plus className="h-4 w-4 text-purple-500" />
            New Supplement
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Name</label>
              <input
                type="text"
                placeholder="e.g. Vitamin C"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Dosage</label>
                <input
                  type="number"
                  placeholder="e.g. 500"
                  value={form.dosage}
                  onChange={(e) => setForm((p) => ({ ...p, dosage: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Timing</label>
              <select
                value={form.timing}
                onChange={(e) => setForm((p) => ({ ...p, timing: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {TIMINGS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes (optional)</label>
              <input
                type="text"
                placeholder="Any notes..."
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
          <button
            onClick={() => handleAdd()}
            disabled={saving}
            className="mt-4 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {saving ? "Saving…" : "Add Supplement"}
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: Quick Add ──────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Star className="h-4 w-4 text-amber-500" />
              Quick Add
            </h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Common supplements to add to your stack instantly
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ADDS.map((q) => {
                const alreadyAdded = supplements.some(
                  (s) => s.name.toLowerCase() === q.name.toLowerCase()
                )
                return (
                  <button
                    key={q.name}
                    onClick={() => !alreadyAdded && handleAdd(q)}
                    disabled={alreadyAdded}
                    className={`flex flex-col items-start rounded-2xl border px-3 py-2.5 text-left text-xs transition ${
                      alreadyAdded
                        ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 cursor-not-allowed"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700 hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-slate-700 dark:text-slate-300 cursor-pointer"
                    }`}
                  >
                    <span className="font-semibold">{q.name}</span>
                    <span className="opacity-70">{q.dosage}{q.unit}</span>
                    {alreadyAdded && (
                      <span className="mt-0.5 flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-2.5 w-2.5" /> Added
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Today's Stack ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Today's Stack */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Clock className="h-4 w-4 text-cyan-500" />
              {"Today's Stack"}
            </h2>

            {loading ? (
              <div className="flex h-20 items-center justify-center text-sm text-slate-400">Loading…</div>
            ) : supplements.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center gap-2 text-center">
                <Pill className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No supplements yet. Add your first one above!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Group by timing */}
                {TIMINGS.map((timing) => {
                  const group = supplements.filter((s) => s.timing === timing)
                  if (group.length === 0) return null
                  return (
                    <div key={timing}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {timing}
                      </p>
                      <div className="flex flex-col gap-2">
                        {group.map((s) => {
                          const taken = !!todayLogsMap[s.id]
                          const streak = calcStreak(logs, s.id)
                          return (
                            <div
                              key={s.id}
                              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                                taken
                                  ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20"
                                  : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50"
                              }`}
                            >
                              {/* Toggle */}
                              <button
                                onClick={() => handleToggle(s.id, taken)}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition ${
                                  taken
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-transparent hover:border-emerald-400"
                                }`}
                              >
                                <Check className="h-4 w-4" />
                              </button>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`font-semibold text-sm ${taken ? "text-emerald-800 dark:text-emerald-300" : "text-slate-900 dark:text-white"}`}>
                                    {s.name}
                                  </span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIMING_COLORS[s.timing] ?? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                                    {s.timing}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {s.dosage} {s.unit}
                                  </span>
                                  {streak > 0 && (
                                    <span className="flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400">
                                      <Flame className="h-3 w-3" />
                                      {streak}d streak
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Delete */}
                              <button
                                onClick={() => handleDelete(s.id)}
                                disabled={deletingId === s.id}
                                className="shrink-0 rounded-xl p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/20 transition disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Compliance Summary */}
          {supplements.length > 0 && (
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <BarChart2 className="h-4 w-4 text-purple-500" />
                This Week
              </h2>
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0">
                  <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-100 dark:text-slate-700" />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      fill="none"
                      stroke="url(#compGrad)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(compliance / 100) * 201} 201`}
                    />
                    <defs>
                      <linearGradient id="compGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#06b6d4" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{compliance}%</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {compliance >= 80 ? "Great consistency!" : compliance >= 50 ? "Keep it up!" : "Room to improve"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {takenToday} of {supplements.length} taken today
                  </p>
                  {longestStreak > 0 && (
                    <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <Flame className="h-3 w-3" />
                      Best streak: {longestStreak} days
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
