import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

type JsonValue = Record<string, any>

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing")
  }

  return new Groq({ apiKey })
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")

  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain valid JSON")
  }

  const jsonText = cleaned.slice(firstBrace, lastBrace + 1)
  const parsed = safeJsonParse(jsonText)

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response JSON could not be parsed")
  }

  return parsed
}

function numOrNull(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sumCalories(items: any[]) {
  return items.reduce((sum, item) => sum + (Number(item?.calories) || 0), 0)
}

function asText(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function pickFirstDefined(profile: JsonValue, keys: string[]) {
  for (const key of keys) {
    const value = profile?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value
    }
  }
  return null
}

function parseHeightCm(raw: unknown) {
  if (raw === null || raw === undefined) return null

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 3 ? raw : raw * 100
  }

  const text = String(raw).trim().toLowerCase()
  if (!text) return null

  if (text.includes("cm")) {
    const v = parseFloat(text)
    return Number.isFinite(v) ? v : null
  }

  if (text.includes("m") && !text.includes("cm")) {
    const v = parseFloat(text)
    return Number.isFinite(v) ? v * 100 : null
  }

  if (text.includes("'") || text.includes("ft")) {
    const feetMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/i)
    const inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")/i)

    const feet = feetMatch ? parseFloat(feetMatch[1]) : 0
    const inches = inchMatch ? parseFloat(inchMatch[1]) : 0

    if (Number.isFinite(feet) || Number.isFinite(inches)) {
      return feet * 30.48 + inches * 2.54
    }
  }

  const v = parseFloat(text)
  if (!Number.isFinite(v)) return null

  return v > 3 ? v : v * 100
}

function parseWeightKg(raw: unknown) {
  if (raw === null || raw === undefined) return null

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw
  }

  const text = String(raw).trim().toLowerCase()
  if (!text) return null

  if (text.includes("lb")) {
    const v = parseFloat(text)
    return Number.isFinite(v) ? v * 0.45359237 : null
  }

  const v = parseFloat(text)
  return Number.isFinite(v) ? v : null
}

function normalizeGender(raw: unknown) {
  const text = String(raw ?? "").trim().toLowerCase()
  if (text === "female" || text === "f") return "female"
  if (text === "male" || text === "m") return "male"
  // "other", "non-binary", "unknown" — use average of male/female formulas
  return "other"
}

function getBMI(weightKg: number, heightCm: number) {
  const heightM = heightCm / 100
  if (!weightKg || !heightM) return null
  const bmi = weightKg / (heightM * heightM)
  return Number.isFinite(bmi) ? bmi : null
}

function estimateBodyFatPercent(bmi: number, age: number, gender: string) {
  if (!Number.isFinite(bmi) || !Number.isFinite(age)) return null

  const base = 1.2 * bmi + 0.23 * age - 16.2
  let adjusted: number
  if (gender === "female") adjusted = base + 10.8
  else if (gender === "other") adjusted = base + 5.4 // average of male and female offsets
  else adjusted = base // male
  return clamp(Number(adjusted.toFixed(1)), 3, 50)
}

function getStatusFromBMI(bmi: number) {
  if (!Number.isFinite(bmi)) return "Unknown"
  if (bmi < 18.5) return "Underweight"
  if (bmi < 25) return "Fit"
  if (bmi < 30) return "Overweight"
  return "Obese"
}

function getTargetBMI(status: string, goal: string) {
  const g = goal.toLowerCase()

  if (status === "Underweight") {
    return g.includes("muscle") ? 22.0 : 21.0
  }

  if (status === "Fit") {
    if (g.includes("muscle")) return 23.5
    if (g.includes("fat") || g.includes("lose")) return 22.0
    return 22.5
  }

  if (status === "Overweight") {
    if (g.includes("fat") || g.includes("lose")) return 23.0
    if (g.includes("muscle")) return 24.0
    return 23.5
  }

  if (status === "Obese") {
    if (g.includes("fat") || g.includes("lose")) return 24.0
    if (g.includes("muscle")) return 25.0
    return 24.5
  }

  return 22.5
}

function getTargetBodyFatPercent(status: string, goal: string, gender: string) {
  const g = goal.toLowerCase()
  const isMale = gender === "male"

  if (isMale) {
    if (status === "Underweight") return 14
    if (status === "Fit") {
      if (g.includes("muscle")) return 13
      if (g.includes("fat") || g.includes("lose")) return 11
      return 12
    }
    if (status === "Overweight") {
      if (g.includes("fat") || g.includes("lose")) return 15
      if (g.includes("muscle")) return 16
      return 15
    }
    if (status === "Obese") {
      if (g.includes("fat") || g.includes("lose")) return 18
      if (g.includes("muscle")) return 19
      return 18
    }
    return 14
  }

  if (status === "Underweight") return 22
  if (status === "Fit") {
    if (g.includes("muscle")) return 21
    if (g.includes("fat") || g.includes("lose")) return 19
    return 20
  }
  if (status === "Overweight") {
    if (g.includes("fat") || g.includes("lose")) return 23
    if (g.includes("muscle")) return 24
    return 23
  }
  if (status === "Obese") {
    if (g.includes("fat") || g.includes("lose")) return 26
    if (g.includes("muscle")) return 27
    return 26
  }
  return 22
}

function getRestDays(profile: JsonValue, body: JsonValue) {
  const candidates = [
    body?.restDays,
    body?.rest_days,
    profile?.rest_days,
    profile?.days_off_per_week,
    profile?.rest_days_per_week,
    profile?.days_off,
    profile?.weekly_rest_days,
  ]

  for (const candidate of candidates) {
    const n = Number(candidate)
    if (Number.isFinite(n)) {
      return clamp(Math.trunc(n), 0, 6)
    }
  }

  return 1
}

function parseWorkoutMinutes(raw: unknown) {
  if (raw === null || raw === undefined) return null

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw))
  }

  const text = String(raw).trim().toLowerCase()
  if (!text) return null

  const rangeMatch = text.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return Math.round((a + b) / 2)
    }
  }

  const singleMatch = text.match(/(\d+)/)
  if (singleMatch) {
    return parseInt(singleMatch[1], 10)
  }

  return null
}

function getTrainingIntensity(profile: JsonValue) {
  const sleepHours = toNumber(
    pickFirstDefined(profile, ["sleep_hours", "sleepHours", "sleep", "sleep_time"]),
    0
  )
  const injuries = asText(
    pickFirstDefined(profile, ["injuries", "limitations", "injury", "physical_limitations"])
  ).toLowerCase()
  const workoutMinutes = parseWorkoutMinutes(
    pickFirstDefined(profile, ["workout_time", "daily_workout_time", "workoutDuration", "training_time"])
  )

  let intensity: "low" | "moderate" | "high" = "moderate"

  if (sleepHours > 0 && sleepHours < 6) intensity = "low"
  if (sleepHours >= 7) intensity = "high"

  if (injuries && injuries !== "no" && injuries !== "none" && injuries !== "na") {
    intensity = intensity === "high" ? "moderate" : "low"
  }

  if (workoutMinutes !== null && workoutMinutes <= 30) {
    intensity = "low"
  }

  return {
    intensity,
    sleepHours: sleepHours || null,
    workoutMinutes,
    injuries: injuries || "No",
  }
}

function calculateFitnessMetrics(profile: JsonValue) {
  const age = toNumber(profile?.age, 0)
  const gender = normalizeGender(profile?.gender ?? profile?.sex)
  const heightCm = parseHeightCm(profile?.height)
  const weightKg = parseWeightKg(profile?.weight)

  const bmi =
    heightCm && weightKg ? Number(getBMI(weightKg, heightCm)?.toFixed(1)) : null

  const estimatedBodyFatPercent =
    bmi !== null ? estimateBodyFatPercent(bmi, age, gender) : null

  const status = bmi !== null ? getStatusFromBMI(bmi) : "Unknown"

  const goal = String(profile?.goal ?? "").trim()

  const rawTargetBMI = bmi !== null ? getTargetBMI(status, goal) : null
  // If goal is fat loss, target BMI must not exceed current BMI
  const isLossFatGoal = goal.toLowerCase().includes("fat") || goal.toLowerCase().includes("lose") || goal.toLowerCase().includes("weight")
  const targetBMI = rawTargetBMI !== null
    ? Number((isLossFatGoal ? Math.min(rawTargetBMI, bmi!) : rawTargetBMI).toFixed(1))
    : null

  const targetBodyFatPercent = Number(
    getTargetBodyFatPercent(status, goal, gender).toFixed(1)
  )

  return {
    bmi,
    estimated_body_fat_percent: estimatedBodyFatPercent,
    target_bmi: targetBMI,
    target_body_fat_percent: targetBodyFatPercent,
    status,
  }
}

function isRestDay(day: any) {
  const type = String(day?.type ?? "").toLowerCase()
  const exercisesLength = Array.isArray(day?.exercises) ? day.exercises.length : 0
  const burn = Number(day?.estimated_calories_burned) || 0
  return type === "rest" || (exercisesLength === 0 && burn === 0)
}

function defaultWorkoutDay(dayLabel: string, index: number, intensity: "low" | "moderate" | "high") {
  const baseTemplates = [
    {
      type: "Push",
      exercises: [
        { name: "Push-ups", sets: 3, reps: 12 },
        { name: "Dumbbell Press", sets: 3, reps: 10 },
        { name: "Shoulder Press", sets: 3, reps: 10 },
      ],
      estimated_calories_burned: 300,
    },
    {
      type: "Pull",
      exercises: [
        { name: "Pull-ups", sets: 3, reps: 8 },
        { name: "Barbell Rows", sets: 4, reps: 8 },
        { name: "Biceps Curls", sets: 3, reps: 12 },
      ],
      estimated_calories_burned: 320,
    },
    {
      type: "Legs",
      exercises: [
        { name: "Squats", sets: 4, reps: 10 },
        { name: "Lunges", sets: 3, reps: 12 },
        { name: "Leg Press", sets: 3, reps: 10 },
      ],
      estimated_calories_burned: 350,
    },
    {
      type: "Upper Body",
      exercises: [
        { name: "Incline Dumbbell Press", sets: 3, reps: 10 },
        { name: "Lat Pulldown", sets: 3, reps: 10 },
        { name: "Lateral Raises", sets: 3, reps: 12 },
      ],
      estimated_calories_burned: 300,
    },
    {
      type: "Core",
      exercises: [
        { name: "Plank", sets: 3, reps: 60 },
        { name: "Crunches", sets: 3, reps: 20 },
        { name: "Leg Raises", sets: 3, reps: 15 },
      ],
      estimated_calories_burned: 250,
    },
    {
      type: "Cardio",
      exercises: [
        { name: "Treadmill Walk", sets: 1, reps: 20 },
        { name: "Cycling", sets: 1, reps: 20 },
        { name: "Jump Rope", sets: 1, reps: 10 },
      ],
      estimated_calories_burned: 280,
    },
    {
      type: "Full Body",
      exercises: [
        { name: "Burpees", sets: 3, reps: 12 },
        { name: "Goblet Squats", sets: 3, reps: 12 },
        { name: "Mountain Climbers", sets: 3, reps: 30 },
      ],
      estimated_calories_burned: 330,
    },
  ]

  const pick = baseTemplates[index % baseTemplates.length]

  const intensityMultiplier = intensity === "high" ? 1.15 : intensity === "low" ? 0.85 : 1

  return {
    day: dayLabel,
    type: pick.type,
    exercises: pick.exercises,
    estimated_calories_burned: Math.round(pick.estimated_calories_burned * intensityMultiplier),
  }
}

function normalizeMeal(meal: any, index: number) {
  if (Array.isArray(meal?.items)) {
    const items = meal.items.map((item: any) => ({
      food: String(item?.food ?? item?.name ?? "Food item"),
      calories: numOrNull(item?.calories),
      protein: numOrNull(item?.protein),
    }))

    return {
      name: String(meal?.name ?? meal?.meal ?? `Meal ${index + 1}`),
      items,
      total_calories: numOrNull(meal?.total_calories) ?? sumCalories(items),
    }
  }

  if (meal?.food) {
    const item = {
      food: String(meal.food),
      calories: numOrNull(meal.calories),
      protein: numOrNull(meal.protein),
    }

    return {
      name: String(meal?.name ?? meal?.meal ?? `Meal ${index + 1}`),
      items: [item],
      total_calories: numOrNull(meal?.total_calories) ?? (Number(item.calories) || 0),
    }
  }

  return {
    name: String(meal?.name ?? meal?.meal ?? `Meal ${index + 1}`),
    items: [],
    total_calories: numOrNull(meal?.total_calories) ?? 0,
  }
}

const PLAN_WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function normalizeWorkoutDay(day: any, index: number) {
  const exercises = Array.isArray(day?.exercises)
    ? day.exercises.map((ex: any) => ({
        name: String(ex?.name ?? "Exercise"),
        sets: numOrNull(ex?.sets),
        reps: numOrNull(ex?.reps),
      }))
    : []

  // Prefer the AI-generated day name if it looks like a real weekday;
  // fall back to Monday–Sunday by position so the UI can always match real dates
  const rawDay = day?.day ? String(day.day) : null
  const isWeekdayName = rawDay
    ? /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(rawDay.trim())
    : false
  const resolvedDay = isWeekdayName ? rawDay!.charAt(0).toUpperCase() + rawDay!.slice(1).toLowerCase()
    : (PLAN_WEEK_DAYS[index] ?? `Day ${index + 1}`)

  return {
    day: resolvedDay,
    type: day?.type ? String(day.type) : null,
    exercises,
    estimated_calories_burned:
      numOrNull(day?.estimated_calories_burned) ??
      numOrNull(day?.calories_burned) ??
      0,
  }
}

function normalizePlan(plan: any) {
  const rawDietMeals = plan?.diet_plan?.meals ?? plan?.meals ?? []

  const meals = Array.isArray(rawDietMeals)
    ? rawDietMeals.map((meal: any, index: number) => normalizeMeal(meal, index))
    : []

  const rawWorkout = plan?.workout_plan ?? plan?.workouts ?? []

  const workout_plan = Array.isArray(rawWorkout)
    ? rawWorkout.map((day: any, index: number) => normalizeWorkoutDay(day, index))
    : []

  const daily_total_calories =
    numOrNull(plan?.diet_plan?.daily_total_calories) ??
    meals.reduce((sum: number, meal: any) => sum + (Number(meal.total_calories) || 0), 0)

  return {
    diet_plan: {
      meals,
      daily_total_calories,
    },
    workout_plan,
  }
}

function enforceWeeklyStructure(plan: any, restDays: number, intensity: "low" | "moderate" | "high") {
  const workoutPlan = Array.isArray(plan.workout_plan) ? [...plan.workout_plan] : []

  while (workoutPlan.length < 7) {
    const idx = workoutPlan.length
    workoutPlan.push(defaultWorkoutDay(PLAN_WEEK_DAYS[idx] ?? `Day ${idx + 1}`, idx, intensity))
  }

  if (workoutPlan.length > 7) {
    workoutPlan.length = 7
  }

  const forced = workoutPlan.map((day: any, index: number) => {
    const dayLabel = String(day?.day ?? PLAN_WEEK_DAYS[index] ?? `Day ${index + 1}`)
    const shouldBeRest = index >= 7 - restDays

    if (shouldBeRest) {
      return {
        day: dayLabel,
        type: "Rest",
        exercises: [],
        estimated_calories_burned: 0,
      }
    }

    if (isRestDay(day)) {
      return defaultWorkoutDay(dayLabel, index, intensity)
    }

    const baseBurn = Number(day?.estimated_calories_burned) || 250
    const adjustedBurn =
      intensity === "high" ? Math.round(baseBurn * 1.1) : intensity === "low" ? Math.round(baseBurn * 0.9) : baseBurn

    return {
      day: dayLabel,
      type: String(day?.type ?? "Workout"),
      exercises: Array.isArray(day?.exercises) ? day.exercises : [],
      estimated_calories_burned: adjustedBurn > 0 ? adjustedBurn : 250,
    }
  })

  return {
    ...plan,
    workout_plan: forced,
  }
}

function buildPrompt(profile: JsonValue, restDays: number, metrics: JsonValue, difficultyBoost = false) {
  const training = getTrainingIntensity(profile)
  const workoutDays = 7 - restDays

  const goal = asText(profile?.goal || pickFirstDefined(profile, ["goal", "primary_goal", "fitness_goal"])) || "N/A"
  const age = asText(profile?.age) || "N/A"
  const gender = asText(profile?.gender ?? profile?.sex) || "N/A"
  const height = asText(profile?.height) || "N/A"
  const weight = asText(profile?.weight) || "N/A"
  const activityLevel = asText(
    pickFirstDefined(profile, ["activity_level", "activityLevel", "activity", "daily_activity"])
  ) || "N/A"
  const dietType = asText(pickFirstDefined(profile, ["diet_preference", "diet_type", "dietType", "diet", "food_preference"])) || "N/A"
  const dietaryRestrictions = Array.isArray(profile?.dietary_restrictions) && profile.dietary_restrictions.length > 0
    ? (profile.dietary_restrictions as string[]).join(", ")
    : null
  const trainingStyle = asText(pickFirstDefined(profile, ["training_style", "trainingStyle", "workout_style"])) || "N/A"
  const sleepHours = asText(
    pickFirstDefined(profile, ["sleep_hours", "sleepHours", "sleep", "sleep_time"])
  ) || "N/A"
  const workoutTime = asText(
    pickFirstDefined(profile, ["workout_time", "daily_workout_time", "workoutDuration", "training_time"])
  ) || "N/A"
  const injuries = asText(
    pickFirstDefined(profile, ["injuries", "limitations", "injury", "physical_limitations"])
  ) || "No"
  const daysOff = asText(
    pickFirstDefined(profile, ["days_off", "rest_days", "days_off_per_week", "rest_days_per_week"])
  ) || String(restDays)

  const extraFields = Object.fromEntries(
    Object.entries(profile || {}).filter(
      ([key]) =>
        ![
          "id",
          "user_id",
          "created_at",
          "updated_at",
          "email",
          "avatar_url",
          "full_name",
        ].includes(key)
    )
  )

  return `
You are an expert fitness coach.

Return STRICT JSON ONLY. No markdown. No explanation. No code fences.

You MUST consider all onboarding steps and every usable profile field:
1) Goal
2) Body stats
3) Activity level
4) Diet type / food preference
5) Weekly training availability
6) Lifestyle constraints and recovery

Use EXACTLY this schema:

{
  "diet_plan": {
    "meals": [
      {
        "name": "Breakfast",
        "items": [
          {
            "food": "Food name",
            "calories": 400,
            "protein": 25
          }
        ],
        "total_calories": 400
      }
    ],
    "daily_total_calories": 1800
  },
  "workout_plan": [
    {
      "day": "Day 1",
      "type": "Push",
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "reps": 8
        }
      ],
      "estimated_calories_burned": 350
    }
  ]
}

Hard rules:
- Total days must be exactly 7
- Rest days must be exactly ${restDays}
- Workout days must be exactly ${workoutDays}
- Rest days must have type "Rest", empty exercises, and 0 calories burned
- Workout days must have NON-ZERO calories burned
- DO NOT create extra rest days
- DO NOT ignore rest day count

CRITICAL:
${
  restDays === 0
    ? '- ALL 7 days MUST be workout days. NO rest day allowed.'
    : `- EXACTLY ${restDays} rest days must exist.`
}

- Meals must include breakfast, lunch, dinner, and at least one snack if appropriate
- Calories and protein must be numbers
- Keep the plan realistic and balanced
- Make the response valid JSON only

${difficultyBoost ? `ADAPTIVE DIFFICULTY UPGRADE:
The user has completed 75%+ of their assigned workouts over the last 2 weeks. Increase workout intensity noticeably:
- Add 1 extra set to each strength exercise
- Increase reps by 2-3 per set
- Add 1 new challenging compound exercise per workout day
- Reduce rest time between sets (suggest 60-90s instead of 2min)
- Increase estimated_calories_burned by 15-20%
Keep the plan safe and injury-free. Just make it more challenging overall.

` : ""}User profile:
Goal: ${goal}
Age: ${age}
Gender: ${gender}
Height: ${height}
Weight: ${weight}
Activity level: ${activityLevel}
Diet type / preference: ${dietType}
${dietaryRestrictions ? `Dietary restrictions: ${dietaryRestrictions}` : "Dietary restrictions: None"}
Training style: ${trainingStyle}
Sleep hours: ${sleepHours}
Workout time available: ${workoutTime}
Days off per week: ${daysOff}
Injuries / limitations: ${injuries}

Derived coaching rules:
- Training intensity: ${training.intensity}
- Recovery priority: ${training.sleepHours !== null && training.sleepHours < 6 ? "High" : "Normal"}
- Workout duration guidance: ${training.workoutMinutes ?? "N/A"} minutes
- Avoid aggravating injuries: ${injuries !== "No" ? "Yes" : "No"}
- Respect rest days and recovery completely
${dietaryRestrictions ? `- DIETARY RESTRICTIONS: ${dietaryRestrictions}. ALL meal suggestions MUST comply with these restrictions. Do not include any foods that violate them.` : ""}

Current metrics:
BMI: ${metrics.bmi ?? "N/A"}
Estimated Body Fat %: ${metrics.estimated_body_fat_percent ?? "N/A"}
Target BMI: ${metrics.target_bmi ?? "N/A"}
Target Body Fat %: ${metrics.target_body_fat_percent ?? "N/A"}
Status: ${metrics.status ?? "N/A"}

Additional onboarding data:
${JSON.stringify(extraFields, null, 2)}
`
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const groq = getGroqClient()

    const body = await req.json().catch(() => ({}))
    const userId = body?.userId

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.replace("Bearer ", "")
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser || authUser.id !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let profile: JsonValue | null = null

    const byId = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()

    if (byId.data) {
      profile = byId.data as JsonValue
    } else {
      const byUserId = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle()

      if (byUserId.data) {
        profile = byUserId.data as JsonValue
      }
    }

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const restDays = getRestDays(profile, body)
    const metrics = calculateFitnessMetrics(profile)
    const training = getTrainingIntensity(profile)
    const difficultyBoost = body?.difficultyBoost === true
    const prompt = buildPrompt(profile, restDays, metrics, difficultyBoost)

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.35,
    })

    const raw = response.choices[0]?.message?.content?.trim()

    if (!raw) {
      throw new Error("AI failed to return content")
    }

    const parsed = extractJson(raw)
    const normalized = normalizePlan(parsed)
    const planCore = enforceWeeklyStructure(normalized, restDays, training.intensity)

    const plan = {
      ...planCore,
      fitness_metrics: metrics,
      meta: {
        rest_days: restDays,
        workout_days: 7 - restDays,
        total_days: 7,
        intensity: training.intensity,
        sleep_hours: training.sleepHours,
        workout_minutes: training.workoutMinutes,
        injuries: training.injuries,
      },
    }

    const today = new Date().toISOString().split("T")[0]

    // Save workout plan
    const { error: saveError } = await supabase.from("workout_plans").insert({
      user_id: userId,
      date: today,
      plan,
    })

    if (saveError) {
      console.warn("Plan save warning:", saveError.message)
    }

    // Save body metrics snapshot so home/analytics pages can read it
    const heightCm = parseHeightCm(profile.height)
    const weightKg = parseWeightKg(profile.weight)
    const { error: metricsError } = await supabase.from("body_metrics").insert({
      user_id: userId,
      date: today,
      bmi: metrics.bmi,
      estimated_body_fat_percent: metrics.estimated_body_fat_percent,
      target_bmi: metrics.target_bmi,
      target_body_fat_percent: metrics.target_body_fat_percent,
      status: metrics.status,
      weight: weightKg,
      height: heightCm,
      goal: String(profile?.goal ?? ""),
    })

    if (metricsError) {
      console.warn("Body metrics save warning:", metricsError.message)
    }

    return NextResponse.json({
      plan,
      fitness_metrics: metrics,
    })
  } catch (error: any) {
    console.error("GENERATE PLAN ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate plan" },
      { status: 500 }
    )
  }
}