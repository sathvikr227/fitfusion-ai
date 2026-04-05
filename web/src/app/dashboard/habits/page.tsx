"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import {
  Flame,
  Trash2,
  Plus,
  Check,
  X,
  Sparkles,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Habit = {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  created_at: string
}

type HabitLog = {
  id: string
  habit_id: string
  date: string
  completed: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_OPTIONS = ["💧", "🏃‍♂️", "😴", "📚", "🧘‍♂️", "🥗", "💊", "🚶‍♂️", "🏋️", "💤", "🧹", "🍎"]

const COLOR_OPTIONS = [
  { value: "violet", bg: "bg-violet-500", light: "bg-violet-100 dark:bg-violet-900/40", border: "border-violet-400" },
  { value: "cyan", bg: "bg-cyan-500", light: "bg-cyan-100 dark:bg-cyan-900/40", border: "border-cyan-400" },
  { value: "emerald", bg: "bg-emerald-500", light: "bg-emerald-100 dark:bg-emerald-900/40", border: "border-emerald-400" },
  { value: "rose", bg: "bg-rose-500", light: "bg-rose-100 dark:bg-rose-900/40", border: "border-rose-400" },
  { value: "amber", bg: "bg-amber-500", light: "bg-amber-100 dark:bg-amber-900/40", border: "border-amber-400" },
  { value: "indigo", bg: "bg-indigo-500", light: "bg-indigo-100 dark:bg-indigo-900/40", border: "border-indigo-400" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function last7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().split("T")[0]
  })
}

function computeStreak(logs: HabitLog[], habitId: string): number {
  const doneDates = new Set(
    logs.filter((l) => l.habit_id === habitId && l.completed).map((l) => l.date)
  )
  let streak = 0
  let d = new Date()
  // allow today or yesterday as streak start
  const today = todayStr()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split("T")[0]

  if (!doneDates.has(today) && !doneDates.has(yesterdayStr)) return 0

  // start from today going backward
  while (true) {
    const ds = d.toISOString().split("T")[0]
    if (doneDates.has(ds)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

function getColorConfig(color: string) {
  return COLOR_OPTIONS.find((c) => c.value === color) ?? COLOR_OPTIONS[0]
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HabitsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [habits, setHabits] = useState<Habit[]>([])
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("💧")
  const [newColor, setNewColor] = useState("violet")
  const [saving, setSaving] = useState(false)

  const today = todayStr()
  const days7 = last7Days()

  // ── Auth & load ──────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      setUserId(user.id)
      await loadData(user.id)
    }
    init()
  }, [router])

  const loadData = useCallback(async (uid: string) => {
    setLoading(true)
    const [{ data: habitsData }, { data: logsData }] = await Promise.all([
      supabase.from("habits").select("*").eq("user_id", uid).order("created_at", { ascending: true }),
      supabase.from("habit_logs").select("*").eq("user_id", uid).gte("date", days7[0]),
    ])
    setHabits(habitsData ?? [])
    setLogs(logsData ?? [])
    setLoading(false)
  }, [days7])

  // ── Toggle today's habit ──────────────────────────────────────────────────────

  async function toggleHabit(habitId: string) {
    if (!userId) return
    const existing = logs.find((l) => l.habit_id === habitId && l.date === today)
    const newCompleted = !(existing?.completed ?? false)

    // Optimistic update
    setLogs((prev) => {
      const without = prev.filter((l) => !(l.habit_id === habitId && l.date === today))
      return [...without, {
        id: existing?.id ?? "temp",
        habit_id: habitId,
        date: today,
        completed: newCompleted,
      }]
    })

    await supabase.from("habit_logs").upsert(
      { user_id: userId, habit_id: habitId, date: today, completed: newCompleted },
      { onConflict: "habit_id,date" }
    )
  }

  // ── Add habit ─────────────────────────────────────────────────────────────────

  async function addHabit() {
    if (!userId || !newName.trim()) return
    setSaving(true)
    const { data } = await supabase.from("habits").insert({
      user_id: userId,
      name: newName.trim(),
      icon: newIcon,
      color: newColor,
    }).select().single()
    if (data) {
      setHabits((prev) => [...prev, data])
    }
    setNewName("")
    setNewIcon("💧")
    setNewColor("violet")
    setShowForm(false)
    setSaving(false)
  }

  // ── Delete habit ──────────────────────────────────────────────────────────────

  async function deleteHabit(habitId: string) {
    if (!confirm("Delete this habit and all its logs?")) return
    await supabase.from("habit_logs").delete().eq("habit_id", habitId)
    await supabase.from("habits").delete().eq("id", habitId)
    setHabits((prev) => prev.filter((h) => h.id !== habitId))
    setLogs((prev) => prev.filter((l) => l.habit_id !== habitId))
  }

  // ── Derived stats ─────────────────────────────────────────────────────────────

  const todayDone = habits.filter((h) =>
    logs.some((l) => l.habit_id === h.id && l.date === today && l.completed)
  ).length

  const longestStreak = habits.reduce((max, h) => {
    return Math.max(max, computeStreak(logs, h.id))
  }, 0)

  const weekDone = days7.reduce((acc, day) => {
    const dayCount = habits.filter((h) =>
      logs.some((l) => l.habit_id === h.id && l.date === day && l.completed)
    ).length
    return acc + dayCount
  }, 0)
  const weekPct = habits.length > 0
    ? Math.round((weekDone / (habits.length * 7)) * 100)
    : 0

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Habit Tracker</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Build consistency, one day at a time</p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-opacity"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "Add Habit"}
          </button>
        </div>

        {/* Stats Row */}
        {habits.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Today", value: `${todayDone} / ${habits.length}`, sub: "completed" },
              { label: "Best Streak", value: `${longestStreak}d`, sub: "consecutive days" },
              { label: "This Week", value: `${weekPct}%`, sub: "completion rate" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-center shadow-sm">
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{s.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add Habit Form */}
        {showForm && (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-5">
            <h2 className="font-semibold text-slate-900 dark:text-white">New Habit</h2>

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">Habit Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Drink 8 glasses of water"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400"
                onKeyDown={(e) => e.key === "Enter" && addHabit()}
              />
            </div>

            {/* Emoji */}
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">Icon</label>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setNewIcon(e)}
                    className={`rounded-xl p-2 text-xl transition-all ${newIcon === e ? "ring-2 ring-violet-500 bg-violet-50 dark:bg-violet-900/30" : "hover:bg-slate-100 dark:hover:bg-slate-700"}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">Color</label>
              <div className="flex gap-3">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewColor(c.value)}
                    className={`h-8 w-8 rounded-full ${c.bg} transition-all ${newColor === c.value ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : "hover:scale-105"}`}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={addHabit}
              disabled={!newName.trim() || saving}
              className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? "Saving…" : "Add Habit"}
            </button>
          </div>
        )}

        {/* Empty state */}
        {habits.length === 0 && !showForm && (
          <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-900/30 text-3xl">
              <Sparkles className="h-8 w-8 text-violet-500" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white">No habits yet</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add your first habit and start building streaks!</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
            >
              Add your first habit
            </button>
          </div>
        )}

        {/* Habit List */}
        {habits.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Today — {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            {habits.map((habit) => {
              const cc = getColorConfig(habit.color)
              const doneToday = logs.some((l) => l.habit_id === habit.id && l.date === today && l.completed)
              const streak = computeStreak(logs, habit.id)

              return (
                <div
                  key={habit.id}
                  className={`rounded-2xl border ${doneToday ? `${cc.light} border-${habit.color}-200 dark:border-${habit.color}-800` : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"} p-4 shadow-sm transition-all`}
                >
                  <div className="flex items-center gap-4">
                    {/* Toggle */}
                    <button
                      onClick={() => toggleHabit(habit.id)}
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all ${doneToday ? `${cc.bg} border-transparent text-white` : `border-slate-300 dark:border-slate-600 hover:border-${habit.color}-400`}`}
                    >
                      {doneToday ? <Check className="h-5 w-5" /> : <span className="text-xl">{habit.icon}</span>}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${doneToday ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"}`}>
                        {habit.icon} {habit.name}
                      </p>
                      {/* Weekly heatmap */}
                      <div className="mt-2 flex gap-1.5 items-center">
                        {days7.map((day) => {
                          const done = logs.some((l) => l.habit_id === habit.id && l.date === day && l.completed)
                          const isToday = day === today
                          return (
                            <div
                              key={day}
                              title={day}
                              className={`h-3 w-3 rounded-full transition-all ${done ? `${cc.bg} opacity-90` : "bg-slate-200 dark:bg-slate-700"} ${isToday ? "ring-1 ring-offset-1 ring-slate-400 dark:ring-slate-500" : ""}`}
                            />
                          )
                        })}
                        <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">7d</span>
                      </div>
                    </div>

                    {/* Streak */}
                    {streak > 0 && (
                      <div className="flex items-center gap-1 rounded-xl bg-orange-50 dark:bg-orange-900/20 px-2.5 py-1">
                        <span className="text-sm">🔥</span>
                        <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{streak}</span>
                      </div>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => deleteHabit(habit.id)}
                      className="rounded-xl p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Legend */}
        {habits.length > 0 && (
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-slate-200 dark:bg-slate-700" />
              Missed
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-emerald-500" />
              Done
            </div>
            <div className="flex items-center gap-1.5">
              <Flame className="h-3 w-3 text-orange-500" />
              Current streak
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
