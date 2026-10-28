// Running sessions for the Model 4 trajectory Transformer.
//
// Mirrors the Strava training data (demos/model4_trajectory/PROTOCOL.md): one
// session per day with a run (several runs on a day are summed, as in the
// dataset's daily file), kept only if 1-60 km at 3-15 min/km. The model reads
// the last 4 such days plus the gap before each, so a 5th, earlier run day is
// needed for the first gap.

export type RunSession = {
  date: string
  /** Hours, the unit /predict/trajectory uses for every session. */
  duration: number
  distance_km: number
  gap_days: number
  /** Monday = 0, as in the training data. */
  day_of_week: number
  completion_rate: number
  workout_type: "Cardio"
}

const RUNNING = /\b(run|jog|treadmill)/
const DAY_MS = 86_400_000

export function buildRunSessions(
  cardioLogs: Array<{ date?: unknown; activity?: unknown; distance_km?: unknown; duration_minutes?: unknown }>,
  count = 4
): RunSession[] {
  const byDay = new Map<string, { km: number; minutes: number }>()
  for (const row of cardioLogs) {
    if (!RUNNING.test(String(row.activity ?? "").toLowerCase())) continue
    const km = Number(row.distance_km)
    const minutes = Number(row.duration_minutes)
    if (!(km > 0) || !(minutes > 0)) continue
    const day = String(row.date ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const entry = byDay.get(day) ?? { km: 0, minutes: 0 }
    entry.km += km
    entry.minutes += minutes
    byDay.set(day, entry)
  }

  const days = Array.from(byDay.entries())
    .filter(([, r]) => r.km >= 1 && r.km <= 60 && r.minutes / r.km >= 3 && r.minutes / r.km <= 15)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  if (days.length < count + 1) return []

  const sessions: RunSession[] = []
  for (let i = days.length - count; i < days.length; i++) {
    const [day, run] = days[i]
    const time = Date.parse(`${day}T00:00:00Z`)
    sessions.push({
      date: day,
      duration: Math.round((run.minutes / 60) * 1000) / 1000,
      distance_km: Math.round(run.km * 100) / 100,
      gap_days: Math.round((time - Date.parse(`${days[i - 1][0]}T00:00:00Z`)) / DAY_MS),
      day_of_week: (new Date(time).getUTCDay() + 6) % 7,
      completion_rate: 1,
      workout_type: "Cardio",
    })
  }
  return sessions
}
