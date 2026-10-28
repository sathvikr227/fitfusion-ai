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

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Word-start match that tolerates a missing or hyphenated gap, mirroring
 * keyword_pattern() in ml-service/app/features.py: "pull up" matches "Pullups"
 * and "Pull-Up", while "run" does not match "crunch".
 */
export function keywordPattern(keyword: string): RegExp {
  const words = keyword.trim().toLowerCase().split(/[\s-]+/)
  return new RegExp("\\b" + words.map(escapeRegExp).join("[\\s-]?"))
}

const INJURY_PATTERNS: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(INJURY_MUSCLE_KEYWORDS).map(([group, keywords]) => [group, keywords.map(keywordPattern)])
)

/** True when an exercise loads one of the flagged muscle groups. */
export function exerciseTargetsGroup(exerciseName: string, group: string) {
  const text = String(exerciseName ?? "").toLowerCase()
  return (INJURY_PATTERNS[group] ?? []).some((pattern) => pattern.test(text))
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
  flaggedGroups: string[],
  options: { addRestDay?: boolean } = {}
): InjuryAdjustment {
  const addRestDay = options.addRestDay ?? true
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

  if (!addRestDay) return { workoutPlan: stripped, removedExercises, restDayAdded: null }

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

// ── User-reported pain ─────────────────────────────────────────────────────────

const BODY_PART_WORDS: Record<string, string[]> = {
  knee: ["knee", "knees", "patella", "patellar", "meniscus", "acl", "mcl", "it band", "itb"],
  back: ["back", "lower back", "spine", "spinal", "lumbar", "disc", "sciatica"],
  shoulder: ["shoulder", "shoulders", "rotator cuff", "rotator"],
  hamstring: ["hamstring", "hamstrings", "hammy"],
}

const PAIN_WORDS =
  /\b(pain|painful|sore|soreness|hurt|hurts|hurting|ache|aches|aching|achy|injur\w*|strain\w*|sprain\w*|tweak\w*|twinge|swollen|swelling|tender|discomfort|niggle|tight)\b/

function mentionsGroup(text: string, group: string) {
  return BODY_PART_WORDS[group].some((w) => new RegExp(`\\b${w}\\b`).test(text))
}

/**
 * Muscle groups the user says hurt, from free text.
 *
 * `notes` (a check-in comment) counts only when a pain word and a body part
 * share a sentence, so "knees felt great" is ignored. `injuryText` (the
 * profile's injuries field, injury-tracker rows) is already about injuries, so
 * a body part alone is enough. False positives only hold volume steady, which
 * is the safe direction.
 */
export function painGroupsFromText(notes: string, injuryText: string[] = []): string[] {
  const groups = new Set<string>()
  const sentences = String(notes ?? "").toLowerCase().split(/[.!?;\n]+/)
  for (const sentence of sentences) {
    if (!PAIN_WORDS.test(sentence)) continue
    for (const group of Object.keys(BODY_PART_WORDS)) {
      if (mentionsGroup(sentence, group)) groups.add(group)
    }
  }
  for (const entry of injuryText) {
    const text = String(entry ?? "").toLowerCase()
    for (const group of Object.keys(BODY_PART_WORDS)) {
      if (mentionsGroup(text, group)) groups.add(group)
    }
  }
  return Array.from(groups)
}

// ── Training load in runners units ─────────────────────────────────────────────

export type RecentDay = {
  date: string
  sessions: number
  total_km: number
  strength: number
  alt_hours: number
}

const RUNNING = /\b(run|jog|treadmill)/

/**
 * FitFusion rows -> one entry per day in `dayKeys` (oldest first), in the units
 * of the runners data the injury model learned from. Mirrors build_recent_days()
 * in ml-service/app/injury_load.py:
 *   sessions  = 1 if any workout log that day (duplicate rows collapsed) + cardio sessions
 *   total_km  = running / jogging / treadmill distance
 *   strength  = 1 if that day's logged exercises include a strength exercise
 *   alt_hours = duration of non-running cardio
 */
export function buildRecentDays(
  dayKeys: string[],
  workoutLogs: Array<{ id?: unknown; date?: unknown }>,
  exercisesByLog: Map<string, string[]>,
  cardioLogs: Array<{ date?: unknown; activity?: unknown; distance_km?: unknown; duration_minutes?: unknown }>,
  isStrength: (exerciseName: string) => boolean
): RecentDay[] {
  const days = new Map<string, RecentDay>(
    dayKeys.map((date) => [date, { date, sessions: 0, total_km: 0, strength: 0, alt_hours: 0 }])
  )
  for (const log of workoutLogs) {
    const day = days.get(String(log.date ?? "").slice(0, 10))
    if (!day) continue
    day.sessions = Math.max(day.sessions, 1)
    const names = exercisesByLog.get(String(log.id)) ?? []
    if (names.some(isStrength)) day.strength = 1
  }
  for (const row of cardioLogs) {
    const day = days.get(String(row.date ?? "").slice(0, 10))
    if (!day) continue
    day.sessions += 1
    if (RUNNING.test(String(row.activity ?? "").toLowerCase())) {
      day.total_km += Number(row.distance_km) || 0
    } else {
      day.alt_hours += (Number(row.duration_minutes) || 0) / 60
    }
  }
  return dayKeys.map((date) => days.get(date)!)
}

// ── Region rule levels ─────────────────────────────────────────────────────────

export const INJURY_REGIONS = ["knee", "back", "shoulder", "hamstring"] as const

/**
 * Mirrors region_levels() in ml-service/app/injury_load.py, fixed in
 * demos/model3_injury/PROTOCOL.md: a region's level comes from whether it is a
 * recorded injury/pain area, whether recent exercises load it, and whether the
 * training-load model says overall risk is elevated. Levels are ordinal, not
 * probabilities; >= 0.7 flags the region.
 */
export function injuryRegionLevels(priorInjuries: string[], recentExercises: string[], elevated: boolean) {
  const recorded = new Set(painGroupsFromText("", priorInjuries))
  const risk: Record<string, number> = {}
  const basis: Record<string, string> = {}
  const suffix = elevated ? " + elevated training-load risk" : ""
  for (const region of INJURY_REGIONS) {
    if (recorded.has(region)) {
      risk[region] = elevated ? 0.9 : 0.6
      basis[region] = "recorded injury or pain" + suffix
    } else if (recentExercises.some((name) => exerciseTargetsGroup(name, region))) {
      risk[region] = elevated ? 0.5 : 0.2
      basis[region] = "loaded by recent exercises" + suffix
    } else {
      risk[region] = 0.1
      basis[region] = "not recorded, not loaded recently"
    }
  }
  return { risk, basis }
}

// ── Progression cap ────────────────────────────────────────────────────────────

/** Most a weekly replan may add: per exercise, and across the week's sets. */
export const MAX_SET_INCREASE = 1
export const MAX_REP_INCREASE = 2
export const MAX_WEEKLY_SET_INCREASE = 0.1

function exerciseKey(name: unknown) {
  return normalize(String(name ?? "")).replace(/\s+/g, " ").trim()
}

function totalSets(plan: PlanDay[]) {
  let total = 0
  for (const day of plan) {
    if (isRestDay(day)) continue
    for (const e of day.exercises ?? []) {
      const sets = Number(e?.sets)
      if (Number.isFinite(sets) && sets > 0) total += sets
    }
  }
  return total
}

/** Caps "12" or "8-10" at the previous value + MAX_REP_INCREASE; other formats pass through. */
function capReps(next: unknown, prev: unknown): unknown {
  const pattern = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/
  const n = String(next ?? "").match(pattern)
  const p = String(prev ?? "").match(pattern)
  if (!n || !p) return next
  const prevLow = Number(p[1])
  const prevHigh = Number(p[2] ?? p[1])
  const low = Math.min(Number(n[1]), prevLow + MAX_REP_INCREASE)
  const high = Math.min(Number(n[2] ?? n[1]), prevHigh + MAX_REP_INCREASE)
  const capped = n[2] ? `${low}-${Math.max(low, high)}` : String(low)
  return typeof next === "number" ? Number(capped) : capped
}

/**
 * Guarantees a replan never jumps volume: each exercise that existed last week
 * gains at most one set and two reps, and the week's total sets rise by at most
 * 10%. Decreases are never touched.
 */
export function limitProgression(previousPlan: PlanDay[], nextPlan: PlanDay[]): PlanDay[] {
  if (!Array.isArray(previousPlan) || !Array.isArray(nextPlan)) return nextPlan

  const previous = new Map<string, PlanExercise>()
  for (const day of previousPlan) {
    for (const e of day.exercises ?? []) previous.set(exerciseKey(e?.name), e)
  }

  const capped = nextPlan.map((day) => {
    if (isRestDay(day)) return day
    const exercises = (day.exercises ?? []).map((e) => {
      const prev = previous.get(exerciseKey(e?.name))
      if (!prev) return e
      const sets = Number(e?.sets)
      const prevSets = Number(prev.sets)
      const out: PlanExercise = { ...e, reps: capReps(e?.reps, prev.reps) }
      if (Number.isFinite(sets) && Number.isFinite(prevSets) && sets > prevSets + MAX_SET_INCREASE) {
        out.sets = prevSets + MAX_SET_INCREASE
      }
      return out
    })
    return { ...day, exercises }
  })

  // Weekly cap: trim added sets, latest exercises first, until within budget.
  const budget = Math.floor(totalSets(previousPlan) * (1 + MAX_WEEKLY_SET_INCREASE))
  let excess = totalSets(capped) - budget
  for (let d = capped.length - 1; d >= 0 && excess > 0; d--) {
    const exercises = capped[d].exercises ?? []
    for (let i = exercises.length - 1; i >= 0 && excess > 0; i--) {
      const prev = previous.get(exerciseKey(exercises[i]?.name))
      const sets = Number(exercises[i]?.sets)
      const floor = prev ? Number(prev.sets) : 1
      if (Number.isFinite(sets) && Number.isFinite(floor) && sets > floor) {
        const cut = Math.min(sets - floor, excess)
        exercises[i] = { ...exercises[i], sets: sets - cut }
        excess -= cut
      }
    }
  }

  return capped
}
