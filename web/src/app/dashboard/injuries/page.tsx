"use client"

import { useState, useEffect } from "react"
import { supabase } from "../../../lib/supabase/client"
import { AlertTriangle, Plus, X, Activity, Calendar, ChevronDown, ChevronUp } from "lucide-react"
import { InjuryRiskWidget } from "../components/InjuryRiskWidget"

type Injury = {
  id: string
  name: string
  body_part: string
  severity: "mild" | "moderate" | "severe"
  status: "active" | "recovering" | "healed"
  date_occurred: string
  notes: string
  created_at: string
}

const BODY_PARTS = [
  "Neck", "Shoulder (Left)", "Shoulder (Right)", "Upper Back", "Lower Back",
  "Chest", "Elbow (Left)", "Elbow (Right)", "Wrist (Left)", "Wrist (Right)",
  "Hip (Left)", "Hip (Right)", "Knee (Left)", "Knee (Right)",
  "Ankle (Left)", "Ankle (Right)", "Hamstring (Left)", "Hamstring (Right)",
  "Quad (Left)", "Quad (Right)", "Calf (Left)", "Calf (Right)", "Other"
]

const SEVERITY_COLORS = {
  mild: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800",
  moderate: "text-orange-600 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800",
  severe: "text-red-600 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800",
}

const STATUS_COLORS = {
  active: "text-red-600 bg-red-50 dark:bg-red-900/20",
  recovering: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
  healed: "text-green-600 bg-green-50 dark:bg-green-900/20",
}

export default function InjuriesPage() {
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "active" | "recovering" | "healed">("all")
  const [userId, setUserId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    body_part: "Knee (Left)",
    severity: "mild" as "mild" | "moderate" | "severe",
    status: "active" as "active" | "recovering" | "healed",
    date_occurred: new Date().toISOString().split("T")[0],
    notes: "",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadInjuries() }, [])

  async function loadInjuries() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)
    const { data } = await supabase
      .from("injuries")
      .select("*")
      .eq("user_id", user.id)
      .order("date_occurred", { ascending: false })
    setInjuries((data as Injury[]) ?? [])
    setLoading(false)
  }

  async function saveInjury() {
    if (!form.name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    await supabase.from("injuries").insert({
      user_id: user.id,
      ...form,
    })
    setForm({
      name: "",
      body_part: "Knee (Left)",
      severity: "mild",
      status: "active",
      date_occurred: new Date().toISOString().split("T")[0],
      notes: "",
    })
    setShowForm(false)
    setSaving(false)
    loadInjuries()
  }

  async function updateStatus(id: string, status: "active" | "recovering" | "healed") {
    await supabase.from("injuries").update({ status }).eq("id", id)
    setInjuries((prev) => prev.map((i) => i.id === id ? { ...i, status } : i))
  }

  async function deleteInjury(id: string) {
    await supabase.from("injuries").delete().eq("id", id)
    setInjuries((prev) => prev.filter((i) => i.id !== id))
  }

  const filtered = filter === "all" ? injuries : injuries.filter((i) => i.status === filter)

  const stats = {
    active: injuries.filter((i) => i.status === "active").length,
    recovering: injuries.filter((i) => i.status === "recovering").length,
    healed: injuries.filter((i) => i.status === "healed").length,
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-purple-600 font-medium">Health</p>
          <h1 className="text-3xl font-bold mt-1">Injury Tracker</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Log and monitor injuries to train smarter and recover safely.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-medium text-sm shadow-lg hover:opacity-90 transition"
        >
          <Plus className="h-4 w-4" /> Log Injury
        </button>
      </div>

      {/* INJURY RISK WIDGET */}
      {userId && <InjuryRiskWidget userId={userId} />}

      {/* STATS */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active", count: stats.active, color: "text-red-500" },
          { label: "Recovering", count: stats.recovering, color: "text-yellow-500" },
          { label: "Healed", count: stats.healed, color: "text-green-500" },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-center shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* FILTER */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "recovering", "healed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-all capitalize ${
              filter === f
                ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow"
                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
            }`}
          >
            {f === "all" ? `All (${injuries.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${stats[f]})`}
          </button>
        ))}
      </div>

      {/* ADD FORM */}
      {showForm && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Log New Injury</h2>
            <button onClick={() => setShowForm(false)}>
              <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Injury Name *</label>
              <input
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g. Runner's knee, Sprained ankle"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Body Part</label>
              <select
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none"
                value={form.body_part}
                onChange={(e) => setForm({ ...form, body_part: e.target.value })}
              >
                {BODY_PARTS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Severity</label>
              <select
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value as any })}
              >
                <option value="mild">Mild — Minor discomfort</option>
                <option value="moderate">Moderate — Affects training</option>
                <option value="severe">Severe — Cannot train</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Status</label>
              <select
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as any })}
              >
                <option value="active">Active</option>
                <option value="recovering">Recovering</option>
                <option value="healed">Healed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Date Occurred</label>
              <input
                type="date"
                className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none"
                value={form.date_occurred}
                onChange={(e) => setForm({ ...form, date_occurred: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Notes</label>
            <textarea
              rows={3}
              className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none resize-none"
              placeholder="Describe how it happened, exercises to avoid, treatment plan..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <button
            onClick={saveInjury}
            disabled={saving || !form.name.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition"
          >
            {saving ? "Saving..." : "Save Injury"}
          </button>
        </div>
      )}

      {/* LIST */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-sm">
          <AlertTriangle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No injuries logged</p>
          <p className="text-slate-400 text-sm mt-1">Stay safe! Log injuries to train smarter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((injury) => (
            <div
              key={injury.id}
              className={`bg-white dark:bg-slate-800 border rounded-2xl shadow-sm overflow-hidden transition-all ${SEVERITY_COLORS[injury.severity]}`}
            >
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === injury.id ? null : injury.id)}
              >
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">{injury.name}</p>
                    <p className="text-xs opacity-70">{injury.body_part} · {new Date(injury.date_occurred).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${STATUS_COLORS[injury.status]}`}>
                    {injury.status}
                  </span>
                  <span className="text-xs px-2 py-1 rounded-full bg-white/50 font-medium capitalize">
                    {injury.severity}
                  </span>
                  {expandedId === injury.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>

              {expandedId === injury.id && (
                <div className="border-t border-current/20 px-5 py-4 bg-white/50 dark:bg-slate-900/30 space-y-4">
                  {injury.notes && (
                    <p className="text-sm opacity-80">{injury.notes}</p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium opacity-70">Update status:</span>
                    {(["active", "recovering", "healed"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => updateStatus(injury.id, s)}
                        className={`text-xs px-3 py-1 rounded-full border font-medium capitalize transition ${
                          injury.status === s
                            ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent"
                            : "bg-white dark:bg-slate-800 border-current/30 hover:bg-slate-100"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                    <button
                      onClick={() => deleteInjury(injury.id)}
                      className="ml-auto text-xs px-3 py-1 rounded-full border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="text-xs opacity-60 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Logged {new Date(injury.created_at).toLocaleDateString()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* RECOVERY TIPS */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Recovery Tips</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { tip: "R.I.C.E Method", desc: "Rest, Ice, Compression, Elevation for acute injuries." },
            { tip: "Don't skip rehab", desc: "Light movement often accelerates healing more than full rest." },
            { tip: "Log exercises to avoid", desc: "Note which movements aggravate your injury to prevent re-injury." },
            { tip: "See a professional", desc: "Consult a physiotherapist for persistent or severe injuries." },
          ].map((t) => (
            <div key={t.tip} className="flex gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
              <div className="h-2 w-2 rounded-full bg-purple-500 mt-1.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{t.tip}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
