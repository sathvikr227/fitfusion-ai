//////////////////////////////////////////////
// 🔥 MET VALUES (extend this over time)
//////////////////////////////////////////////

export const MET_VALUES: Record<string, number> = {
  // Chest
  "bench press": 6,
  "chest press": 6,
  "incline dumbbell press": 6,
  "dumbbell press": 6,
  "cable fly": 4.5,
  "chest fly": 4.5,
  // Back
  "barbell row": 5.8,
  "dumbbell row": 5.8,
  "lat pulldown": 5.5,
  "pull up": 8.5,
  "pull ups": 8.5,
  "row": 5.8,
  // Shoulders
  "shoulder press": 5.8,
  "overhead press": 5.8,
  "lateral raises": 3.5,
  // Arms
  "bicep curl": 4.8,
  "bicep curls": 4.8,
  "tricep extension": 4.8,
  "tricep dips": 4.8,
  // Legs
  "squat": 5.5,
  "squats": 5.5,
  "deadlift": 6,
  "lunges": 5.3,
  "leg press": 5.5,
  "leg curl": 4.5,
  "calf raise": 4,
  // Core
  "push up": 8,
  "push ups": 8,
  "plank": 3.3,
  "crunch": 4,
  "crunches": 4,
  "leg raises": 4,
  "mountain climbers": 8,
  "burpees": 8,
  // Cardio
  "running": 9.8,
  "jogging": 7,
  "cycling": 7.5,
  "walking": 3.5,
  "jump rope": 12,
  "treadmill": 7.5,
  "stationary bike": 7,
  "cardio": 6.5,
  "treadmill walk": 3.5,
  "goblet squats": 5.5,
};

//////////////////////////////////////////////
// 🧠 HELPER: Normalize Exercise Name
//////////////////////////////////////////////

function normalizeExerciseName(name: string) {
  return name.toLowerCase().trim()
}

function findMET(exerciseName: string): number {
  const normalized = normalizeExerciseName(exerciseName)
  // Exact match first
  if (MET_VALUES[normalized] !== undefined) return MET_VALUES[normalized]
  // Substring match — handles "Dumbbell Chest Press" matching "chest press"
  for (const [key, met] of Object.entries(MET_VALUES)) {
    if (normalized.includes(key) || key.includes(normalized)) return met
  }
  return 5 // default MET
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
  const MET = findMET(exerciseName)

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