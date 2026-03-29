//////////////////////////////////////////////
// 🔥 MET VALUES (extend this over time)
//////////////////////////////////////////////

export const MET_VALUES: Record<string, number> = {
  "bench press": 6,
  "incline dumbbell press": 5,
  "dumbbell press": 5,
  "push ups": 4,
  "pull ups": 6,
  "squats": 6,
  "deadlift": 6,
  "lunges": 5,
  "shoulder press": 5,
  "bicep curls": 3.5,
  "tricep dips": 4,
  "plank": 3,
  "running": 10,
  "cycling": 8,
  "walking": 3.5,
  "jump rope": 12,
};

//////////////////////////////////////////////
// 🧠 HELPER: Normalize Exercise Name
//////////////////////////////////////////////

function normalizeExerciseName(name: string) {
  return name.toLowerCase().trim()
}

//////////////////////////////////////////////
// 🔥 WORKOUT CALORIE CALCULATION
//////////////////////////////////////////////

/**
 * Calculate calories burned using MET formula
 * Calories = MET × weight (kg) × duration (hours)
 */
export function calculateWorkoutCalories(
  weightKg: number,
  durationMinutes: number,
  exerciseName: string
) {
  const normalized = normalizeExerciseName(exerciseName)

  const MET = MET_VALUES[normalized] ?? 5 // default if unknown

  const durationHours = durationMinutes / 60

  const calories = MET * weightKg * durationHours

  return Math.round(calories)
}

//////////////////////////////////////////////
// 🔥 TOTAL WORKOUT CALORIES (MULTIPLE EXERCISES)
//////////////////////////////////////////////

export function calculateTotalWorkoutCalories(
  weightKg: number,
  exercises: {
    name: string
    duration: number // minutes
  }[]
) {
  let total = 0

  for (const ex of exercises) {
    total += calculateWorkoutCalories(
      weightKg,
      ex.duration,
      ex.name
    )
  }

  return Math.round(total)
}

//////////////////////////////////////////////
// 🍛 FOOD CALORIE CALCULATION
//////////////////////////////////////////////

/**
 * Calculate calories from food quantity
 */
export function calculateFoodCalories(
  caloriesPerUnit: number,
  quantity: number
) {
  return Math.round(caloriesPerUnit * quantity)
}

//////////////////////////////////////////////
// 🍱 TOTAL DAILY CALORIES
//////////////////////////////////////////////

export function calculateDailyCalories(
  meals: {
    items: {
      calories: number
    }[]
  }[]
) {
  let total = 0

  for (const meal of meals) {
    for (const item of meal.items) {
      total += item.calories
    }
  }

  return total
}

//////////////////////////////////////////////
// ⚡ QUICK ESTIMATION (FOR SETS-BASED WORKOUTS)
//////////////////////////////////////////////

/**
 * Estimate calories if only sets are given (no duration)
 * Assumption: 1 set ≈ 2–3 minutes
 */
export function estimateCaloriesFromSets(
  weightKg: number,
  sets: number,
  exerciseName: string
) {
  const avgMinutesPerSet = 2.5
  const totalMinutes = sets * avgMinutesPerSet

  return calculateWorkoutCalories(
    weightKg,
    totalMinutes,
    exerciseName
  )
}

//////////////////////////////////////////////
// 🧠 BONUS: DIET VS WORKOUT BALANCE
//////////////////////////////////////////////

export function calculateCalorieBalance(
  caloriesIn: number,
  caloriesOut: number
) {
  return caloriesIn - caloriesOut
}