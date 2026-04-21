import type { ExerciseDef, RepRecord, SessionSummary } from "./types"

export function computeRomPct(def: ExerciseDef, minAngle: number, maxAngle: number): number {
  const ideal = def.idealMaxAngle - def.idealMinAngle
  const actual = maxAngle - minAngle
  if (ideal <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((actual / ideal) * 100)))
}

export function buildSummary(opts: {
  def: ExerciseDef
  reps: RepRecord[]
  rejectedReps: number
  holdSeconds?: number
  startedAt: string
  endedAt: string
}): SessionSummary {
  const { def, reps, rejectedReps, holdSeconds, startedAt, endedAt } = opts

  const totalReps = reps.length
  const avgTempoSec = totalReps > 0 ? reps.reduce((s, r) => s + r.durationSec, 0) / totalReps : 0
  const avgRomPct = totalReps > 0 ? reps.reduce((s, r) => s + r.romPct, 0) / totalReps : 0

  const formErrorCounts: Record<string, number> = {}
  for (const r of reps) {
    for (const e of r.errors) {
      formErrorCounts[e] = (formErrorCounts[e] ?? 0) + 1
    }
  }

  return {
    exerciseId: def.id,
    exerciseName: def.name,
    reps,
    totalReps,
    avgTempoSec: Math.round(avgTempoSec * 10) / 10,
    avgRomPct: Math.round(avgRomPct),
    formErrorCounts,
    rejectedReps,
    holdSeconds,
    startedAt,
    endedAt,
  }
}

// Human-readable bullets — used when Groq is unavailable.
export function summarizeToBullets(s: SessionSummary, def: ExerciseDef): string[] {
  const bullets: string[] = []

  if (s.totalReps > 0) {
    bullets.push(`Completed ${s.totalReps} valid rep${s.totalReps === 1 ? "" : "s"}.`)
  }
  if (s.rejectedReps > 0) {
    bullets.push(`${s.rejectedReps} attempt${s.rejectedReps === 1 ? "" : "s"} didn't match the exercise pattern.`)
  }
  if (s.holdSeconds != null) {
    bullets.push(`Held the position for ${s.holdSeconds}s.`)
  }

  if (s.avgRomPct >= 85) bullets.push("Excellent range of motion.")
  else if (s.avgRomPct >= 65) bullets.push(`Decent ROM (${s.avgRomPct}%) — push a little deeper.`)
  else if (s.totalReps > 0) bullets.push(`Limited range of motion (${s.avgRomPct}%) — aim for fuller reps.`)

  if (def.targetTempoSec && s.avgTempoSec > 0) {
    const ratio = s.avgTempoSec / def.targetTempoSec
    if (ratio < 0.6) bullets.push(`Tempo is too fast (${s.avgTempoSec}s/rep) — slow down for better control.`)
    else if (ratio > 1.5) bullets.push(`Tempo is slow (${s.avgTempoSec}s/rep) — move with intent.`)
    else bullets.push(`Good tempo (${s.avgTempoSec}s/rep).`)
  }

  const errorEntries = Object.entries(s.formErrorCounts).sort((a, b) => b[1] - a[1])
  for (const [err, count] of errorEntries.slice(0, 2)) {
    bullets.push(`Form issue flagged ${count}×: ${err}`)
  }

  if (bullets.length === 0) bullets.push("No data captured — try running the session again.")

  return bullets
}
