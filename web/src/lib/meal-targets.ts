// Daily and per-meal calorie targets for Stage 2 (meal recommendations).
//
// Standard, published formulas — no model:
//   BMR   Mifflin–St Jeor (Mifflin et al., Am J Clin Nutr 1990)
//         men   10·kg + 6.25·cm − 5·age + 5
//         women 10·kg + 6.25·cm − 5·age − 161
//   TDEE  BMR × activity factor (1.2 sedentary … 1.9 extremely active)
//   goal  weight loss −20%, muscle gain +10%, otherwise maintenance
//
// The activity factor already includes planned exercise, so logged workouts are
// not added on top.

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack"

export type MealTarget = { slot: MealSlot; kcal_target: number; min_protein_g: number }

export type CalorieTargets = {
  bmr: number
  tdee: number
  daily: number
  goalAdjustment: number
  activityFactor: number
  meals: MealTarget[]
}

const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  light: 1.375,
  moderately_active: 1.55,
  moderate: 1.55,
  very_active: 1.725,
  active: 1.725,
  extremely_active: 1.9,
  athlete: 1.9,
}

// Share of the day's calories per meal.
const MEAL_SPLIT: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 }

// Protein floors (g per meal) for a muscle-gain goal; other goals have none.
const MUSCLE_GAIN_PROTEIN: Record<MealSlot, number> = { breakfast: 15, lunch: 25, dinner: 25, snack: 0 }

// Never plan below these daily intakes without clinical supervision.
const DAILY_FLOOR = { male: 1500, female: 1200, unknown: 1350 }

function key(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_")
}

function sexOf(gender: unknown): "male" | "female" | "unknown" {
  const g = key(gender)
  if (["male", "m", "man"].includes(g)) return "male"
  if (["female", "f", "woman"].includes(g)) return "female"
  return "unknown"
}

function goalAdjustmentFor(goal: unknown) {
  const g = key(goal)
  if (/(loss|lose|fat|cut|slim)/.test(g)) return -0.2
  if (/(gain|muscle|bulk|mass)/.test(g)) return 0.1
  return 0
}

/**
 * Returns null when age, height or weight is missing — the caller then skips
 * meal recommendations instead of planning around guessed body stats.
 */
export function calorieTargets(input: {
  age: number | null
  heightCm: number | null
  weightKg: number | null
  gender: unknown
  activityLevel: unknown
  goal: unknown
}): CalorieTargets | null {
  const { age, heightCm, weightKg } = input
  if (!age || !heightCm || !weightKg) return null

  const sex = sexOf(input.gender)
  const sexConstant = sex === "male" ? 5 : sex === "female" ? -161 : -78
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant

  const activityFactor = ACTIVITY_FACTORS[key(input.activityLevel)] ?? 1.375
  const tdee = bmr * activityFactor
  const goalAdjustment = goalAdjustmentFor(input.goal)
  const daily = Math.max(DAILY_FLOOR[sex], Math.round(tdee * (1 + goalAdjustment)))

  const muscleGain = goalAdjustment > 0
  const meals = (Object.keys(MEAL_SPLIT) as MealSlot[]).map((slot) => ({
    slot,
    kcal_target: Math.round(daily * MEAL_SPLIT[slot]),
    min_protein_g: muscleGain ? MUSCLE_GAIN_PROTEIN[slot] : 0,
  }))

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    daily,
    goalAdjustment,
    activityFactor,
    meals,
  }
}
