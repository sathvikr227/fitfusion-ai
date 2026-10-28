// Builds the model inputs that both /api/adaptive-replan and /api/ml-insights
// need from a user's Supabase history: recent sessions for the Transformer,
// completion rate, sleep average, streak, and the injury model's features.
//
// One implementation so the replan decision and the dashboard readout can never
// disagree about what the user's week looked like.

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeWorkoutType } from "./index"
import type { SessionFeatures } from "./types"
import { buildRecentDays, type RecentDay } from "./injury-rules"
import { injuryListFromProfile } from "./profile"

export const SESSION_WINDOW = 4

/** A logged session with no per-exercise timing recorded. */
const DEFAULT_SESSION_MINUTES = 45

export type UserHistory = {
  /** Oldest first, ready for the Transformer. */
  sessions: SessionFeatures[]
  /** Whole percent, 0-100. */
  completionRate: number
  completionSource: "plan_exercises" | "workout_execution" | "plan_ratio"
  avgSleep: number | null
  streak: number
  activeInjuries: Array<{ body_part?: string | null; name?: string | null }>
  profile: Record<string, any> | null
  /** Inputs for /predict/injury-risk: the last 7 days of training load. */
  injuryFeatures: {
    recent_days: RecentDay[]
    recent_exercises: string[]
    sleep_avg_hours?: number
    prior_injuries: string[]
  }
  bmi: number | null
}

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split("T")[0]
}

const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/**
 * Exercises the plan scheduled between `from` and `to` (YYYY-MM-DD,
 * inclusive), matching plan days to dates by weekday name. Returns null when
 * the plan has no weekday-named days to match.
 */
export function plannedExerciseCount(plan: any, from: string, to: string): number | null {
  const days: any[] = Array.isArray(plan?.workout_plan) ? plan.workout_plan : []
  const byName = new Map<string, number>()
  for (const day of days) {
    const name = String(day?.day ?? "").trim().toLowerCase()
    const isRest = String(day?.type ?? "").toLowerCase() === "rest"
    const count = Array.isArray(day?.exercises) ? day.exercises.length : 0
    if (name) byName.set(name, isRest ? 0 : count)
  }
  if (!WEEK_DAYS.some((d) => byName.has(d.toLowerCase()))) return null

  let total = 0
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    total += byName.get(WEEK_DAYS[cursor.getUTCDay()].toLowerCase()) ?? 0
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return total
}

/** Consecutive days ending today (or yesterday) that have a workout log. */
export function computeStreak(dates: string[]): number {
  const unique = Array.from(new Set(dates)).sort().reverse()
  if (unique.length === 0) return 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const first = new Date(unique[0])
  first.setHours(0, 0, 0, 0)
  if (Math.round((today.getTime() - first.getTime()) / 86_400_000) > 1) return 0

  let streak = 1
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1])
    const curr = new Date(unique[i])
    prev.setHours(0, 0, 0, 0)
    curr.setHours(0, 0, 0, 0)
    if (Math.round((prev.getTime() - curr.getTime()) / 86_400_000) === 1) streak += 1
    else break
  }
  return streak
}

export function bmiFrom(height: unknown, weight: unknown): number | null {
  const rawHeight = Number(height)
  const weightKg = Number(weight)
  if (!Number.isFinite(rawHeight) || rawHeight <= 0) return null
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null
  const metres = rawHeight > 3 ? rawHeight / 100 : rawHeight
  return Math.round((weightKg / (metres * metres)) * 10) / 10
}

function safeParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function buildUserHistory(
  supabase: SupabaseClient,
  userId: string,
  options: { plannedWorkoutDays?: number } = {}
): Promise<UserHistory> {
  const since = daysAgo(7)
  const sinceMonth = daysAgo(30)

  const [weekLogsRes, profileRes, sleepRes, execRes, injuriesRes, recentLogsRes, cardioRes, planRes] =
    await Promise.all([
      supabase
        .from("workout_logs")
        .select("id, date")
        .eq("user_id", userId)
        .gte("date", since),

      supabase
        .from("profiles")
        .select("goal, weight, height, age, activity_level, injuries, rest_days_per_week, days_off, dietary_restrictions, diet_preference")
        .eq("id", userId)
        .maybeSingle(),

      // sleep_logs stores sleep_hours; that is the column the rest of the app writes.
      supabase
        .from("sleep_logs")
        .select("sleep_hours, date")
        .eq("user_id", userId)
        .gte("date", since),

      supabase
        .from("workout_execution")
        .select("date, done")
        .eq("user_id", userId)
        .gte("date", since),

      supabase
        .from("injuries")
        .select("body_part, name")
        .eq("user_id", userId)
        .eq("status", "active"),

      supabase
        .from("workout_logs")
        .select("id, date")
        .eq("user_id", userId)
        .gte("date", sinceMonth)
        .order("date", { ascending: false })
        .limit(SESSION_WINDOW * 2),

      supabase
        .from("cardio_logs")
        .select("date, activity, distance_km, duration_minutes")
        .eq("user_id", userId)
        .gte("date", since),

      supabase
        .from("workout_plans")
        .select("plan, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const executionRows = execRes.data ?? []
  const weekDates = (weekLogsRes.data ?? []).map((r: any) => String(r.date))

  // ── Completion rate ────────────────────────────────────────────────────────
  // Ticked exercises over the exercises the plan scheduled since the later of
  // a week ago and the plan's creation. Today counts once anything is ticked,
  // so an unstarted day doesn't drag the rate down. Rows only exist for
  // exercises someone ticked, so dividing by rows alone reads 2-of-2 as 100%.
  const today = daysAgo(0)
  const doneRows = executionRows.filter((r: any) => r.done)
  const rawPlan = planRes.data?.plan
  const latestPlan = typeof rawPlan === "string" ? safeParse(rawPlan) : rawPlan
  const planStart = planRes.data?.created_at ? String(planRes.data.created_at).slice(0, 10) : since
  const windowStart = planStart > since ? planStart : since
  const tickedToday = executionRows.some((r: any) => String(r.date) === today)
  const windowEnd = tickedToday ? today : daysAgo(1)
  const planned = windowEnd >= windowStart ? plannedExerciseCount(latestPlan, windowStart, windowEnd) : 0

  let completionRate: number
  let completionSource: UserHistory["completionSource"]
  if (planned !== null && planned > 0 && executionRows.length > 0) {
    const doneInWindow = doneRows.filter((r: any) => String(r.date) >= windowStart).length
    completionRate = Math.round((doneInWindow / Math.max(planned, doneInWindow)) * 100)
    completionSource = "plan_exercises"
  } else if (executionRows.length > 0) {
    const done = doneRows.length
    completionRate = Math.round((done / executionRows.length) * 100)
    completionSource = "workout_execution"
  } else {
    const plannedDays = options.plannedWorkoutDays && options.plannedWorkoutDays > 0
      ? options.plannedWorkoutDays
      : 4
    completionRate = Math.round((new Set(weekDates).size / plannedDays) * 100)
    completionSource = "plan_ratio"
  }
  completionRate = Math.max(0, Math.min(100, completionRate))

  // ── Sleep ──────────────────────────────────────────────────────────────────
  const sleepValues = (sleepRes.data ?? [])
    .map((r: any) => Number(r.sleep_hours))
    .filter((n: number) => Number.isFinite(n) && n > 0)
  const avgSleep =
    sleepValues.length > 0
      ? Math.round((sleepValues.reduce((s, n) => s + n, 0) / sleepValues.length) * 10) / 10
      : null

  // ── Sessions for the Transformer ───────────────────────────────────────────
  const recentLogs = (recentLogsRes.data ?? []).slice().reverse() // oldest first
  const executionByDate = new Map<string, { done: number; total: number }>()
  for (const row of executionRows) {
    const key = String(row.date)
    const entry = executionByDate.get(key) ?? { done: 0, total: 0 }
    entry.total += 1
    if (row.done) entry.done += 1
    executionByDate.set(key, entry)
  }

  // One read covers the Transformer's sessions and the injury model's week.
  const weekLogs = weekLogsRes.data ?? []
  const logIds = Array.from(new Set([...recentLogs, ...weekLogs].map((r) => String(r.id))))
  const exerciseByLog = new Map<string, { duration: number; names: string[] }>()
  if (logIds.length > 0) {
    const { data: exerciseRows } = await supabase
      .from("exercise_logs")
      .select("workout_log_id, exercise_name, duration")
      .in("workout_log_id", logIds)

    for (const row of exerciseRows ?? []) {
      const key = String(row.workout_log_id)
      const entry = exerciseByLog.get(key) ?? { duration: 0, names: [] }
      entry.duration += Number(row.duration) || 0
      if (row.exercise_name) entry.names.push(String(row.exercise_name))
      exerciseByLog.set(key, entry)
    }
  }

  const sessions: SessionFeatures[] = recentLogs.slice(-SESSION_WINDOW).map((row: any) => {
    const detail = exerciseByLog.get(String(row.id))
    const minutes = detail?.duration || DEFAULT_SESSION_MINUTES
    const execution = executionByDate.get(String(row.date))
    return {
      duration: Math.round((minutes / 60) * 100) / 100,
      // A logged day with no tick-list rows means the session was completed.
      completion_rate: execution ? execution.done / Math.max(execution.total, 1) : 1,
      workout_type: normalizeWorkoutType((detail?.names ?? []).join(" ")),
      day_of_week: new Date(row.date).getDay(),
      date: String(row.date),
    }
  })

  const profile = profileRes.data ?? null
  const activeInjuries = injuriesRes.data ?? []
  const bmi = bmiFrom(profile?.height, profile?.weight)

  // ── Training load for the injury model ─────────────────────────────────────
  // The 7 days before today, oldest first, in the runners data's units.
  const loadDays = Array.from({ length: 7 }, (_, i) => daysAgo(7 - i))
  const namesByLog = new Map(Array.from(exerciseByLog, ([id, entry]) => [id, entry.names]))
  const recentDays = buildRecentDays(
    loadDays,
    weekLogs,
    namesByLog,
    cardioRes.data ?? [],
    (name) => normalizeWorkoutType(name) === "Strength"
  )
  const recentExercises = weekLogs
    .filter((r) => String(r.date) < daysAgo(0))
    .flatMap((r) => namesByLog.get(String(r.id)) ?? [])

  return {
    sessions,
    completionRate,
    completionSource,
    avgSleep,
    streak: computeStreak(weekDates),
    activeInjuries,
    profile,
    bmi,
    injuryFeatures: {
      recent_days: recentDays,
      recent_exercises: recentExercises,
      sleep_avg_hours: avgSleep ?? undefined,
      prior_injuries: injuryListFromProfile(profile, activeInjuries),
    },
  }
}
