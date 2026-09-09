// Plan surgery for flagged injury-risk muscle groups.
//
// Mirrors INJURY_MUSCLE_KEYWORDS in ml-service/app/features.py. The keywords
// live on both sides because the ML service scores risk but never sees the
// plan, and Next.js edits the plan but never scores risk. Keep the two lists in
// sync when adding a muscle group.

export const INJURY_MUSCLE_KEYWORDS: Record<string, string[]> = {
  knee: [
    "squat", "lunge", "leg press", "leg extension", "step up", "jump",
    "box jump", "burpee", "running", "run", "jog", "sprint", "plyo",
    "wall sit", "pistol", "skater",
  ],
  back: [
    "deadlift", "good morning", "barbell row", "bent over row", "back extension",
    "hyperextension", "clean", "snatch", "sit up", "sit-up", "russian twist",
    "toe touch", "superman",
  ],
  shoulder: [
    "overhead press", "shoulder press", "military press", "lateral raise",
    "front raise", "upright row", "pull up", "pull-up", "chin up", "dip",
    "bench press", "push up", "push-up", "arnold press", "handstand",
  ],
  hamstring: [
    "deadlift", "romanian deadlift", "rdl", "leg curl", "hamstring curl",
    "good morning", "sprint", "kettlebell swing", "nordic", "hip thrust",
    "glute ham",
  ],
}

export type PlanExercise = { name?: string; sets?: unknown; reps?: unknown }
export type PlanDay = {
  day?: string
  type?: string | null
  exercises?: PlanExercise[]
  estimated_calories_burned?: number
}

function normalize(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
}

/** True when an exercise loads one of the flagged muscle groups. */
export function exerciseTargetsGroup(exerciseName: string, group: string) {
  const text = normalize(String(exerciseName ?? ""))
  return (INJURY_MUSCLE_KEYWORDS[group] ?? []).some((kw) => text.includes(kw))
}

export function isRestDay(day: PlanDay) {
  const type = String(day?.type ?? "").toLowerCase()
  const count = Array.isArray(day?.exercises) ? day.exercises.length : 0
  return type === "rest" || count === 0
}

export type InjuryAdjustment = {
  workoutPlan: PlanDay[]
  removedExercises: Array<{ day: string; exercise: string; group: string }>
  restDayAdded: string | null
}

/**
 * Applies the documented rule: for every muscle group scoring above the
 * threshold, strip exercises that load it and insert a rest day.
 *
 * The rest day is placed on whichever workout day is left with the least work
 * after stripping — usually a day gutted by removals. Resting the day that
 * *had* the most flagged exercises would also discard the healthy exercises
 * sharing it, costing the user a full session they could still train.
 *
 * The plan keeps its seven-day shape and every day keeps its label.
 */
export function applyInjuryAdjustments(
  workoutPlan: PlanDay[],
  flaggedGroups: string[]
): InjuryAdjustment {
  if (flaggedGroups.length === 0 || !Array.isArray(workoutPlan)) {
    return { workoutPlan, removedExercises: [], restDayAdded: null }
  }

  const removedExercises: InjuryAdjustment["removedExercises"] = []
  const remainingPerDay = new Map<number, number>()

  const stripped = workoutPlan.map((day, index) => {
    if (isRestDay(day)) return day

    const kept: PlanExercise[] = []

    for (const exercise of day.exercises ?? []) {
      const name = String(exercise?.name ?? "")
      const group = flaggedGroups.find((g) => exerciseTargetsGroup(name, g))
      if (group) {
        removedExercises.push({ day: String(day.day ?? `Day ${index + 1}`), exercise: name, group })
      } else {
        kept.push(exercise)
      }
    }

    remainingPerDay.set(index, kept.length)
    return { ...day, exercises: kept }
  })

  // Rest the emptiest remaining workout day. Later days win ties so recovery
  // lands toward the end of the week rather than interrupting its start.
  let restIndex = -1
  let fewest = Number.POSITIVE_INFINITY
  for (const [index, remaining] of remainingPerDay) {
    if (remaining <= fewest) {
      fewest = remaining
      restIndex = index
    }
  }

  let restDayAdded: string | null = null
  if (restIndex >= 0) {
    const label = String(stripped[restIndex].day ?? `Day ${restIndex + 1}`)
    stripped[restIndex] = {
      day: label,
      type: "Rest",
      exercises: [],
      estimated_calories_burned: 0,
    }
    restDayAdded = label
  }

  return { workoutPlan: stripped, removedExercises, restDayAdded }
}

/**
 * Scales a plan's volume by the RL agent's intensity delta (-15%, 0, +15%).
 *
 * The LLaMA call already reshapes the plan in the requested direction; this is
 * the deterministic backstop that guarantees the delta is actually applied to
 * sets and projected burn even when the model's edit is timid.
 */
export function applyIntensityDelta(workoutPlan: PlanDay[], delta: number): PlanDay[] {
  if (!delta || !Array.isArray(workoutPlan)) return workoutPlan

  return workoutPlan.map((day) => {
    if (isRestDay(day)) return day

    const exercises = (day.exercises ?? []).map((exercise) => {
      const sets = Number(exercise?.sets)
      if (!Number.isFinite(sets) || sets <= 0) return exercise
      const scaled = Math.round(sets * (1 + delta))
      return { ...exercise, sets: Math.max(1, Math.min(8, scaled)) }
    })

    const burn = Number(day.estimated_calories_burned) || 0
    return {
      ...day,
      exercises,
      estimated_calories_burned: burn > 0 ? Math.round(burn * (1 + delta)) : burn,
    }
  })
}
