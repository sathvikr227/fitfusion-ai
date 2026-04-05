"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase/client"

type WeightLog = {
  id: string
  user_id: string
  weight: number | null
  date: string | null
  created_at: string | null
}

function todayDateString() {
  return new Date().toISOString().split("T")[0]
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown date"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "Unknown date"
  return d.toLocaleDateString()
}

function toNumber(value: string) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default function WeightTab() {
  const [weight, setWeight] = useState("")
  const [logs, setLogs] = useState<WeightLog[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")

  const latestWeight = useMemo(() => {
    if (logs.length === 0) return null
    return logs[0].weight
  }, [logs])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setStatusMessage("")

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      setStatusMessage("Could not read current user.")
      setLoading(false)
      return
    }

    if (!user) {
      setStatusMessage("Please log in to track your weight.")
      setLoading(false)
      return
    }

    setUserId(user.id)

    const { data, error } = await supabase
      .from("weight_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error loading weight logs:", error.message)
      setStatusMessage("Could not load weight history.")
      setLogs([])
      setLoading(false)
      return
    }

    const normalized: WeightLog[] = (data ?? []).map((row: any) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      weight: row.weight !== null && row.weight !== undefined ? Number(row.weight) : null,
      date: row.date ?? null,
      created_at: row.created_at ?? null,
    }))

    setLogs(normalized)
    setLoading(false)
  }

  const saveWeight = async () => {
    if (!userId) {
      setStatusMessage("Please log in first.")
      return
    }

    const weightValue = toNumber(weight)
    if (!weightValue || weightValue <= 0) {
      setStatusMessage("Please enter a valid weight.")
      return
    }

    setSaving(true)
    setStatusMessage("")

    const { error } = await supabase.from("weight_logs").upsert(
      { user_id: userId, weight: weightValue, date: todayDateString() },
      { onConflict: "user_id,date" }
    )

    setSaving(false)

    if (error) {
      console.error("Error saving weight:", error.message)
      setStatusMessage("Could not save weight. Check your weight_logs table columns or RLS policy.")
      return
    }

    setWeight("")
    await loadData()
    setStatusMessage("Weight saved successfully.")
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Log Weight</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Latest weight:{" "}
            <strong>{latestWeight !== null ? `${latestWeight} kg` : "No logs yet"}</strong>
          </p>
        </div>

        <input
          type="number"
          placeholder="Enter weight"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
          min="0"
          step="0.1"
        />

        <button
          onClick={saveWeight}
          disabled={saving}
          className="w-full mt-1 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Weight"}
        </button>
      </div>

      {statusMessage && (
        <div className="bg-blue-50 border border-blue-100 text-blue-700 px-4 py-3 rounded-xl">
          {statusMessage}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="font-semibold text-lg">Weight History</h2>
          <button onClick={loadData} className="text-sm text-purple-600 hover:underline">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-slate-500 dark:text-slate-400">Loading weight history...</div>
        ) : logs.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400">No weight logs yet.</div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex justify-between items-center border border-slate-200 rounded-xl p-4"
              >
                <span className="text-slate-700 dark:text-slate-300">
                  {formatDate(log.date ?? log.created_at)}
                </span>
                <span className="font-semibold">{log.weight} kg</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}