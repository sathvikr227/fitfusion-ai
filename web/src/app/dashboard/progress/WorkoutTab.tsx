"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../../lib/supabase/client"
import { MET_VALUES } from "../../../lib/calories"

type Mode = "custom" | "assigned"

type ExerciseInput = {
  name: string
  sets: string
  reps: string
  duration: string
  weight: string
}

type AssignedDay = {
  day: string
  workoutName: string
  type: string
  exercises: ExerciseInput[]
  estimatedCalories: number
}

type WorkoutLogRow = {
  id: string
  user_id: string
  date: string | null
  is_assigned: boolean | null
  plan_id: string | null
  total_calories: number | null
  created_at: string | null
}

type ExerciseLogRow = {
  id: string
  workout_log_id: string
  exercise_name: string
  sets: number | null
  reps: number | null
  weight: number | null
  duration: number | null
  calories: number | null
}


const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]

function toNumber(value: any) {
  if (value === "" || value === null || value === undefined) return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function safeParseJson(value: any) {
  if (!value) return null
  if (typeof value === "object") return value
  if (typeof value !== "string") return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function todayDateString() {
  return new Date().toISOString().split("T")[0]
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Unknown date"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "Unknown date"
  return d.toLocaleString()
}

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** Returns 0 for Monday … 6 for Sunday (consistent with WEEK_DAYS array). */
function dayIndexForToday(): number {
  const jsDay = new Date().getDay() // 0 = Sunday
  return jsDay === 0 ? 6 : jsDay - 1
}

/** Returns "YYYY-MM-DD" for the weekday at the given index within the current week. */
function getDateForDayIndex(index: number): string {
  const today = new Date()
  const diff = index - dayIndexForToday()
  const target = new Date(today)
  target.setDate(today.getDate() + diff)
  return target.toISOString().split("T")[0]
}

/**
 * Old plans used "Day 1"–"Day 7" labels. Remap them to real weekday names so
 * the matching logic against today's day works correctly.
 */
function normalizeDayLabels(days: AssignedDay[]): AssignedDay[] {
  const hasOldFormat = days.some((d) => /^day\s*\d+$/i.test(d.day.trim()))
  if (!hasOldFormat) return days
  return days.map((d, i) => ({ ...d, day: WEEK_DAYS[i] ?? d.day }))
}

function getCurrentDayName() {
  return WEEK_DAYS[dayIndexForToday()]
}

function getMET(exerciseName: string) {
  const lower = exerciseName.toLowerCase()
  const foundKey = Object.keys(MET_VALUES).find((key) => lower.includes(key))
  return foundKey ? MET_VALUES[foundKey] : 5.5
}

function estimateExerciseDurationMinutes(exercise: ExerciseInput) {
  const duration = toNumber(exercise.duration)
  if (duration > 0) return duration

  const sets = toNumber(exercise.sets)
  const reps = toNumber(exercise.reps)

  if (sets > 0 && reps > 0) {
    return Math.max(sets * 3, Math.ceil((sets * reps) / 8))
  }

  if (sets > 0) return Math.max(sets * 3, 5)
  if (reps > 0) return Math.max(Math.ceil(reps / 4), 5)

  return 10
}

function estimateExerciseCalories(exercise: ExerciseInput, bodyWeightKg: number) {
  if (!bodyWeightKg || bodyWeightKg <= 0) return 0

  const met = getMET(exercise.name)
  const durationMinutes = estimateExerciseDurationMinutes(exercise)
  const exerciseWeight = toNumber(exercise.weight)

  const weightMultiplier =
    exerciseWeight > 0 ? 1 + Math.min(exerciseWeight / 200, 0.15) : 1

  const calories = met * bodyWeightKg * (durationMinutes / 60) * weightMultiplier
  return Math.max(0, Math.round(calories * 1.05))
}

function estimateWorkoutCalories(exercises: ExerciseInput[], bodyWeightKg: number) {
  return exercises.reduce(
    (sum, exercise) => sum + estimateExerciseCalories(exercise, bodyWeightKg),
    0
  )
}

function normalizeExercise(raw: any): ExerciseInput {
  return {
    name: String(raw?.name ?? raw?.exercise_name ?? raw?.title ?? "Exercise"),
    sets: raw?.sets !== undefined ? String(raw.sets) : "",
    reps: raw?.reps !== undefined ? String(raw.reps) : "",
    duration: raw?.duration !== undefined ? String(raw.duration) : "",
    weight: raw?.weight !== undefined ? String(raw.weight) : "",
  }
}

function extractDayName(header: string) {
  const weekdayMatch = header.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  )
  if (weekdayMatch?.[1]) {
    const day = weekdayMatch[1]
    return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()
  }

  const dayNumberMatch = header.match(/\bday\s*\d+\b/i)
  if (dayNumberMatch?.[0]) {
    return dayNumberMatch[0]
      .replace(/\s+/g, " ")
      .replace(/^day/i, "Day")
      .trim()
  }

  return "Workout Day"
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function deriveWorkoutType(header: string, day: string) {
  let type = header.trim()

  const dayRegex = new RegExp(`^\\s*${escapeRegExp(day)}\\s*`, "i")
  type = type.replace(dayRegex, "").trim()
  type = type.replace(/^[:\-–—\s]+/, "").trim()

  return type || day
}

function isDayHeader(line: string) {
  const lower = line.toLowerCase().trim()
  if (WEEKDAYS.some((day) => lower.includes(day))) return true
  if (/^day\s*\d+/i.test(lower)) return true
  return /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
    line
  )
}

function parseExerciseLine(line: string): ExerciseInput | null {
  const cleaned = line
    .replace(/^[\s>*\-–—•\d.)]+/, "")
    .trim()

  if (!cleaned) return null

  if (/^(notes?|tip|tips|rest day|warm[- ]?up|cool[- ]?down)\b/i.test(cleaned)) {
    return null
  }

  const setsMatch =
    cleaned.match(/(\d+(?:\.\d+)?)\s*(?:x|×)?\s*sets?/i) ||
    cleaned.match(/(\d+(?:\.\d+)?)\s*sets?/i)

  const repsMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*reps?/i)
  const durationMatch = cleaned.match(
    /(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/i
  )
  const weightMatch = cleaned.match(
    /(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?|lb|lbs|pounds?)\b/i
  )

  let name = cleaned
    .replace(/\b\d+(?:\.\d+)?\s*(?:sets?|reps?|rep|min|mins|minute|minutes|kg|kgs|kilograms?|lb|lbs|pounds?)\b/gi, " ")
    .replace(/\b(?:x|×)\b/gi, " ")
    .replace(/[-–—:|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!name) name = cleaned

  return {
    name,
    sets: setsMatch?.[1] ? String(setsMatch[1]) : "",
    reps: repsMatch?.[1] ? String(repsMatch[1]) : "",
    duration: durationMatch?.[1] ? String(durationMatch[1]) : "",
    weight: weightMatch?.[1] ? String(weightMatch[1]) : "",
  }
}

function parsePlainTextWorkoutPlan(planText: string): AssignedDay[] {
  const lines = String(planText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())

  const sections: Array<{ header: string; lines: string[] }> = []
  let current = { header: "Workout Day", lines: [] as string[] }
  let hasAnyHeader = false

  for (const line of lines) {
    if (!line) continue

    if (isDayHeader(line)) {
      if (current.lines.length > 0 || hasAnyHeader) {
        sections.push(current)
      }
      current = { header: line, lines: [] }
      hasAnyHeader = true
    } else {
      current.lines.push(line)
    }
  }

  if (current.lines.length > 0 || sections.length === 0) {
    sections.push(current)
  }

  return sections
    .map((section) => {
      const day = extractDayName(section.header)
      const type = deriveWorkoutType(section.header, day)

      const exercises = section.lines
        .map(parseExerciseLine)
        .filter(Boolean) as ExerciseInput[]

      return {
        day,
        workoutName: `${day} — ${type}`,
        type,
        exercises,
        estimatedCalories: 0,
      } as AssignedDay
    })
    .filter((x) => x.day || x.workoutName || x.exercises.length > 0)
}

function parseWorkoutPlanFromPlanText(planText: any): AssignedDay[] {
  const parsed = safeParseJson(planText)

  if (parsed && typeof parsed === "object") {
    const workoutPlanRaw =
      parsed.workout_plan ||
      parsed.workoutPlan ||
      parsed.weekPlan ||
      parsed.weeklyPlan ||
      parsed.plan ||
      parsed.days ||
      []

    if (Array.isArray(workoutPlanRaw)) {
      return workoutPlanRaw
        .map((dayItem: any) => {
          const day = String(dayItem?.day ?? dayItem?.name ?? "Workout Day")
          const type = String(dayItem?.type ?? dayItem?.workout_type ?? day)
          const exercisesRaw = Array.isArray(dayItem?.exercises)
            ? dayItem.exercises
            : []

          const exercises = exercisesRaw.map(normalizeExercise)

          const estimatedCalories =
            toNumber(dayItem?.estimated_calories_burned) ||
            toNumber(dayItem?.estimatedCalories) ||
            toNumber(dayItem?.calories) ||
            0

          return {
            day,
            workoutName: `${day} — ${type}`,
            type,
            exercises,
            estimatedCalories,
          } as AssignedDay
        })
        .filter((x) => x.day || x.workoutName || x.exercises.length > 0)
    }
  }

  return parsePlainTextWorkoutPlan(
    typeof planText === "string" ? planText : String(planText ?? "")
  )
}

function inferWeightFromRow(row: any) {
  const candidates = [
    row?.weight,
    row?.body_weight,
    row?.bodyWeight,
    row?.weight_kg,
    row?.current_weight,
    row?.value,
    row?.kilograms,
    row?.kg,
  ]

  for (const candidate of candidates) {
    const n = toNumber(candidate)
    if (n > 0) return n
  }

  return 0
}

function calculateCurrentStreak(rows: WorkoutLogRow[]) {
  const uniqueDates = Array.from(
    new Set(
      rows
        .map((row) => row.date)
        .filter((date): date is string => Boolean(date))
    )
  ).sort((a, b) => b.localeCompare(a))

  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)

  for (const date of uniqueDates) {
    const expected = cursor.toISOString().split("T")[0]
    if (date === expected) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
      continue
    }
    if (date < expected) break
  }

  return streak
}

export default function WorkoutTab() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [mode, setMode] = useState<Mode>("assigned")

  const [latestWeight, setLatestWeight] = useState<number>(0)

  const [exerciseName, setExerciseName] = useState("")
  const [sets, setSets] = useState("")
  const [reps, setReps] = useState("")
  const [duration, setDuration] = useState("")
  const [weight, setWeight] = useState("")

  const [exercises, setExercises] = useState<ExerciseInput[]>([])
  const [logs, setLogs] = useState<WorkoutLogRow[]>([])
  const [assignedDays, setAssignedDays] = useState<AssignedDay[]>([])
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null)
  const [exerciseLogsByWorkout, setExerciseLogsByWorkout] = useState<
    Record<string, ExerciseLogRow[]>
  >({})

  const [statusMessage, setStatusMessage] = useState("")
  const [todayCompleted, setTodayCompleted] = useState(false)
  const [currentStreak, setCurrentStreak] = useState(0)

  const currentDay = useMemo(() => getCurrentDayName(), [])
  const todayDayIndex = useMemo(() => dayIndexForToday(), [])
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(dayIndexForToday)
  const bodyWeightKg = latestWeight

  const currentSessionCalories = useMemo(
    () => estimateWorkoutCalories(exercises, bodyWeightKg),
    [exercises, bodyWeightKg]
  )

  const selectedDayDate = useMemo(() => getDateForDayIndex(selectedDayIndex), [selectedDayIndex])

  const selectedDayWorkout = useMemo(() => {
    if (!assignedDays.length) return null
    // Match by weekday name first; fall back to position index
    const byName = assignedDays.find(
      (d) => d.day.toLowerCase() === WEEK_DAYS[selectedDayIndex].toLowerCase()
    )
    return byName ?? assignedDays[selectedDayIndex] ?? assignedDays[0]
  }, [assignedDays, selectedDayIndex])

  // Keep todayWorkout as an alias for backward compat elsewhere
  const todayWorkout = selectedDayWorkout

  /** True if a workout has already been logged for the currently selected day */
  const selectedDayCompleted = useMemo(
    () => logs.some((row) => row.date === selectedDayDate),
    [logs, selectedDayDate]
  )

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (assignedDays.length > 0) {
      setMode("assigned")
    }
  }, [assignedDays.length])

  async function loadData() {
    setLoading(true)
    setStatusMessage("")

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error) {
      setStatusMessage("Could not read current user.")
      setLoading(false)
      return
    }

    if (!user) {
      setStatusMessage("Please log in to view workout tracking.")
      setLoading(false)
      return
    }

    setUserId(user.id)

    await Promise.all([
      loadLatestWeight(user.id),
      loadAssignedPlan(user.id),
      loadWorkoutLogs(user.id),
    ])

    setLoading(false)
  }

  async function loadLatestWeight(currentUserId: string) {
    const { data, error } = await supabase
      .from("weight_logs")
      .select("*")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(1)

    if (error) {
      console.error("Error loading latest weight:", error.message)
      setLatestWeight(0)
      return
    }

    if (!data || data.length === 0) {
      setLatestWeight(0)
      return
    }

    const inferred = inferWeightFromRow(data[0])
    setLatestWeight(inferred)
  }

  async function loadAssignedPlan(currentUserId: string) {
    const { data, error } = await supabase
      .from("workout_plans")
      .select("id, plan, created_at")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(1)

    if (error) {
      console.error("Error loading workout plan:", error.message)
      setAssignedDays([])
      setCurrentPlanId(null)
      return
    }

    if (!data || data.length === 0) {
      setAssignedDays([])
      setCurrentPlanId(null)
      return
    }

    const latestPlanRow = data[0]
    setCurrentPlanId(latestPlanRow.id)

    let parsedDays: AssignedDay[] = []
    try {
      parsedDays = parseWorkoutPlanFromPlanText(latestPlanRow.plan)
      // Remap "Day 1" → "Monday" etc. for old plans so the day-matching works correctly
      parsedDays = normalizeDayLabels(parsedDays)
    } catch (err) {
      console.error("Error parsing plan:", err)
      parsedDays = []
    }

    setAssignedDays(parsedDays)
  }

  async function loadWorkoutLogs(currentUserId: string) {
    const { data, error } = await supabase
      .from("workout_logs")
      .select("*")
      .eq("user_id", currentUserId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error loading workout logs:", error.message)
      setLogs([])
      setExerciseLogsByWorkout({})
      setTodayCompleted(false)
      setCurrentStreak(0)
      return
    }

    const rows = (data ?? []) as WorkoutLogRow[]
    setLogs(rows)

    const today = todayDateString()
    setTodayCompleted(rows.some((row) => row.date === today))
    setCurrentStreak(calculateCurrentStreak(rows))

    if (rows.length === 0) {
      setExerciseLogsByWorkout({})
      return
    }

    const ids = rows.map((r) => r.id)

    const { data: exerciseData, error: exerciseError } = await supabase
      .from("exercise_logs")
      .select("*")
      .in("workout_log_id", ids)

    if (exerciseError) {
      console.error("Error loading exercise logs:", exerciseError.message)
      setExerciseLogsByWorkout({})
      return
    }

    const grouped: Record<string, ExerciseLogRow[]> = {}
    ;(exerciseData ?? []).forEach((row: any) => {
      const normalized: ExerciseLogRow = {
        id: String(row.id),
        workout_log_id: String(row.workout_log_id),
        exercise_name: String(row.exercise_name ?? "Exercise"),
        sets: row.sets !== undefined && row.sets !== null ? Number(row.sets) : null,
        reps: row.reps !== undefined && row.reps !== null ? Number(row.reps) : null,
        weight:
          row.weight !== undefined && row.weight !== null ? Number(row.weight) : null,
        duration:
          row.duration !== undefined && row.duration !== null
            ? Number(row.duration)
            : null,
        calories:
          row.calories !== undefined && row.calories !== null
            ? Number(row.calories)
            : null,
      }

      if (!grouped[normalized.workout_log_id]) grouped[normalized.workout_log_id] = []
      grouped[normalized.workout_log_id].push(normalized)
    })

    setExerciseLogsByWorkout(grouped)
  }

  function addExercise() {
    if (!exerciseName.trim()) {
      setStatusMessage("Please enter an exercise name.")
      return
    }

    setExercises((prev) => [
      ...prev,
      {
        name: exerciseName.trim(),
        sets,
        reps,
        duration,
        weight,
      },
    ])

    setExerciseName("")
    setSets("")
    setReps("")
    setDuration("")
    setWeight("")
    setStatusMessage("")
  }

  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index))
  }

  async function checkWorkoutExistsForDate(currentUserId: string, date: string) {
    const { data, error } = await supabase
      .from("workout_logs")
      .select("id")
      .eq("user_id", currentUserId)
      .eq("date", date)
      .limit(1)

    if (error) {
      console.error("Error checking workout for date:", error.message)
      return false
    }

    return Boolean(data && data.length > 0)
  }

  async function insertWorkoutAndExercises(params: {
    isAssigned: boolean
    planId: string | null
    exercises: ExerciseInput[]
    calories: number
    date: string
  }) {
    if (!userId) return null

    const alreadyExists = await checkWorkoutExistsForDate(userId, params.date)
    if (alreadyExists) {
      throw new Error("Workout already logged for this day.")
    }

    const insertData: any = {
      user_id: userId,
      date: params.date,
      is_assigned: params.isAssigned,
      total_calories: params.calories,
    }

    if (params.isAssigned) {
      if (!params.planId) {
        throw new Error("No assigned workout plan found. Please generate a plan first.")
      }
      insertData.plan_id = params.planId
    }

    const { data: workoutLog, error: workoutError } = await supabase
      .from("workout_logs")
      .insert(insertData)
      .select("id")
      .single()

    if (workoutError) {
      throw workoutError
    }

    const workoutLogId = workoutLog.id as string

    const exerciseRows = params.exercises.map((ex) => {
      const exerciseCalories = estimateExerciseCalories(ex, bodyWeightKg)

      return {
        workout_log_id: workoutLogId,
        exercise_name: ex.name,
        sets: toNumber(ex.sets) || null,
        reps: toNumber(ex.reps) || null,
        weight: toNumber(ex.weight) || null,
        duration: toNumber(ex.duration) || null,
        calories: exerciseCalories,
      }
    })

    if (exerciseRows.length > 0) {
      const { error: exerciseInsertError } = await supabase
        .from("exercise_logs")
        .insert(exerciseRows)

      if (exerciseInsertError) {
        throw exerciseInsertError
      }
    }

    return workoutLogId
  }

  async function saveCustomWorkout() {
    if (!userId) return

    if (!exercises.length) {
      setStatusMessage("Add at least one exercise before saving.")
      return
    }

    if (!bodyWeightKg || bodyWeightKg <= 0) {
      setStatusMessage("No weight found in weight logs. Add a weight log first.")
      return
    }

    const exists = await checkWorkoutExistsForDate(userId, todayDateString())
    if (exists) {
      setStatusMessage("You already logged a workout today.")
      return
    }

    setSaving(true)
    setStatusMessage("")

    const totalCalories = estimateWorkoutCalories(exercises, bodyWeightKg)

    try {
      await insertWorkoutAndExercises({
        isAssigned: false,
        planId: null,
        exercises,
        calories: totalCalories,
        date: todayDateString(),
      })

      setExercises([])
      await loadWorkoutLogs(userId)
      setStatusMessage(`Saved custom workout. You burned about ${totalCalories} kcal.`)
    } catch (error: any) {
      console.error("Error saving custom workout:", error?.message || error)
      setStatusMessage(
        error?.message ||
          "Could not save custom workout. Check your workout_logs and exercise_logs tables."
      )
    } finally {
      setSaving(false)
    }
  }

  async function completeAssignedWorkout(day: AssignedDay) {
    if (!userId) return

    const targetDate = selectedDayDate
    const exists = await checkWorkoutExistsForDate(userId, targetDate)
    if (exists) {
      setStatusMessage(`${day.day}'s workout already completed ✅`)
      return
    }

    if (!bodyWeightKg || bodyWeightKg <= 0) {
      setStatusMessage("No weight found in weight logs. Add a weight log first.")
      return
    }

    setSaving(true)
    setStatusMessage("")

    let caloriesBurned = day.estimatedCalories
    if (!caloriesBurned && day.exercises.length > 0) {
      caloriesBurned = estimateWorkoutCalories(day.exercises, bodyWeightKg)
    }

    try {
      await insertWorkoutAndExercises({
        isAssigned: true,
        planId: currentPlanId,
        exercises: day.exercises,
        calories: caloriesBurned,
        date: targetDate,
      })

      await loadWorkoutLogs(userId)
      setStatusMessage(
        `Marked ${day.day}'s workout as completed. Burned about ${caloriesBurned || 0} kcal.`
      )
    } catch (error: any) {
      console.error("Error completing assigned workout:", error?.message || error)
      setStatusMessage(
        error?.message ||
          "Could not mark workout completed. Check your workout_logs and exercise_logs tables."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => setMode("custom")}
          className={`px-4 py-2 rounded-xl border transition ${
            mode === "custom"
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white dark:bg-slate-800 text-black dark:text-white border-slate-200 dark:border-slate-700"
          }`}
        >
          Custom Workout
        </button>

        <button
          onClick={() => setMode("assigned")}
          className={`px-4 py-2 rounded-xl border transition ${
            mode === "assigned"
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white dark:bg-slate-800 text-black dark:text-white border-slate-200 dark:border-slate-700"
          }`}
        >
          Assigned Workout
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
              Latest body weight from weight log
            </label>
            <div className="text-2xl font-semibold">
              {bodyWeightKg > 0 ? `${bodyWeightKg} kg` : "No weight found"}
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              🔥 {currentStreak} day streak
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {todayCompleted ? "✅ Already completed today" : "⏳ Not completed today"}
            </div>
          </div>

          <button
            onClick={loadData}
            className="px-4 py-2 rounded-xl border border-slate-200 text-purple-600"
          >
            Refresh Weight
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Calories are calculated automatically from your latest logged weight.
        </p>
      </div>

      {mode === "custom" && (
        <>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
            <h2 className="font-semibold text-lg">Add Exercise</h2>

            <input
              type="text"
              placeholder="Exercise name"
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="number"
                value={sets}
                onChange={(e) => setSets(e.target.value)}
                placeholder="Sets (optional)"
                className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                min="0"
              />

              <input
                type="number"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                placeholder="Reps (optional)"
                className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                min="0"
              />

              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="Duration in minutes (optional)"
                className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                min="0"
              />

              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Dumbbell / barbell weight (optional)"
                className="w-full border border-slate-200 px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-purple-500"
                min="0"
              />
            </div>

            <button
              onClick={addExercise}
              className="w-full py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition"
            >
              Add Exercise
            </button>
          </div>

          {exercises.length > 0 && (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h3 className="font-semibold">Current Session</h3>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  Estimated calories: <strong>{currentSessionCalories} kcal</strong>
                </span>
              </div>

              <div className="space-y-3">
                {exercises.map((ex, index) => {
                  const calories =
                    bodyWeightKg > 0 ? estimateExerciseCalories(ex, bodyWeightKg) : 0

                  return (
                    <div
                      key={`${ex.name}-${index}`}
                      className="flex items-start justify-between gap-4 border border-slate-200 rounded-xl p-3"
                    >
                      <div>
                        <div className="font-medium">{ex.name}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {ex.sets ? `${ex.sets} sets` : null}
                          {ex.sets && ex.reps ? " × " : ""}
                          {ex.reps ? `${ex.reps} reps` : null}
                          {ex.duration ? ` • ${ex.duration} min` : null}
                          {ex.weight ? ` • ${ex.weight} kg` : null}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm text-slate-700 dark:text-slate-300">
                          {bodyWeightKg > 0 ? `${calories} kcal` : "No weight"}
                        </div>
                        <button
                          onClick={() => removeExercise(index)}
                          className="text-xs text-red-500 mt-1 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={saveCustomWorkout}
            disabled={saving || todayCompleted}
            className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition disabled:opacity-60"
          >
            {todayCompleted ? "Already Completed" : saving ? "Saving..." : "Save Workout"}
          </button>
        </>
      )}

      {mode === "assigned" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="font-semibold text-lg mb-3">Assigned Workout</h2>

            {/* Day-of-week navigation row */}
            <div className="flex gap-1 flex-wrap">
              {WEEK_DAYS.map((dayName, idx) => {
                const isToday = idx === todayDayIndex
                const isSelected = idx === selectedDayIndex
                const dayDate = getDateForDayIndex(idx)
                const isCompleted = logs.some((row) => row.date === dayDate)

                return (
                  <button
                    key={dayName}
                    onClick={() => setSelectedDayIndex(idx)}
                    className={`relative flex-1 min-w-[40px] py-2 rounded-xl text-xs font-medium transition border
                      ${isSelected
                        ? "bg-purple-600 text-white border-purple-600"
                        : isToday
                          ? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                          : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600"
                      }`}
                  >
                    {dayName.slice(0, 3)}
                    {isToday && !isSelected && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-500" />
                    )}
                    {isCompleted && (
                      <span className="block text-[10px] mt-0.5 text-green-500">✓</span>
                    )}
                  </button>
                )
              })}
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Tap a day to view and log that day’s workout. Today is{" "}
              <strong>{currentDay}</strong>.
            </p>
          </div>

          {assignedDays.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
              Start logging workouts to track your progress 💪
            </div>
          ) : (
            <>
              {selectedDayWorkout && (
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-xl">
                        {selectedDayWorkout.day} — {selectedDayWorkout.type}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {selectedDayIndex === todayDayIndex ? "Today’s workout" : selectedDayDate}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-slate-700 dark:text-slate-300">
                        Estimated:{" "}
                        <strong>{selectedDayWorkout.estimatedCalories || "—"} kcal</strong>
                      </div>
                    </div>
                  </div>

                  {selectedDayWorkout.exercises.length > 0 ? (
                    <div className="space-y-2">
                      {selectedDayWorkout.exercises.map((ex, idx) => (
                        <div
                          key={`${ex.name}-${idx}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3"
                        >
                          <div>
                            <div className="font-medium">{ex.name}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                              {ex.sets ? `${ex.sets} sets` : ""}
                              {ex.sets && ex.reps ? " × " : ""}
                              {ex.reps ? `${ex.reps} reps` : ""}
                              {ex.duration ? ` • ${ex.duration} min` : ""}
                              {ex.weight ? ` • ${ex.weight} kg` : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Rest day — no exercises scheduled.
                    </div>
                  )}

                  <button
                    onClick={() => completeAssignedWorkout(selectedDayWorkout)}
                    disabled={saving || selectedDayCompleted}
                    className="w-full py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition disabled:opacity-60"
                  >
                    {selectedDayCompleted
                      ? `${selectedDayWorkout.day} Already Completed ✓`
                      : saving
                        ? "Saving..."
                        : `Log ${selectedDayWorkout.day}’s Workout`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {statusMessage && (
        <div className="bg-blue-50 border border-blue-100 text-blue-700 px-4 py-3 rounded-xl">
          {statusMessage}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="font-semibold text-lg">Workout History</h2>
          <button onClick={loadData} className="text-sm text-purple-600 hover:underline">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-slate-500 dark:text-slate-400">Loading history...</div>
        ) : logs.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400">Start logging workouts to track your progress 💪</div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => {
              const exerciseRows = exerciseLogsByWorkout[log.id] ?? []
              const calories =
                log.total_calories ??
                exerciseRows.reduce((sum, ex) => sum + (ex.calories ?? 0), 0)

              return (
                <div
                  key={log.id}
                  className="border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {log.is_assigned ? "Assigned Workout" : "Custom Workout"}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        Date: {log.date || formatDateTime(log.created_at)}
                      </div>
                    </div>

                    <div className="text-sm">
                      <span className="font-semibold">{calories || 0} kcal</span>
                    </div>
                  </div>

                  {exerciseRows.length > 0 && (
                    <div className="space-y-2">
                      {exerciseRows.slice(0, 4).map((ex) => (
                        <div
                          key={ex.id}
                          className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              {ex.exercise_name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {ex.sets ? `${ex.sets} sets` : ""}
                              {ex.sets && ex.reps ? " × " : ""}
                              {ex.reps ? `${ex.reps} reps` : ""}
                              {ex.duration ? ` • ${ex.duration} min` : ""}
                              {ex.weight ? ` • ${ex.weight} kg` : ""}
                            </div>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            {ex.calories ?? 0} kcal
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}