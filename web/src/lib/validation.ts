// Plausible ranges for user-entered health data. One table so every form (and
// the database check constraints in supabase/migrations) agree.

export const RANGES = {
  age: { min: 13, max: 100, label: "Age", unit: "years" },
  heightCm: { min: 100, max: 250, label: "Height", unit: "cm" },
  weightKg: { min: 25, max: 300, label: "Weight", unit: "kg" },
  sleepHours: { min: 0, max: 24, label: "Sleep", unit: "hours" },
  systolic: { min: 70, max: 250, label: "Systolic pressure", unit: "mmHg" },
  diastolic: { min: 40, max: 150, label: "Diastolic pressure", unit: "mmHg" },
  heartRate: { min: 30, max: 220, label: "Heart rate", unit: "bpm" },
  bloodSugar: { min: 20, max: 600, label: "Blood sugar", unit: "mg/dL" },
  spo2: { min: 70, max: 100, label: "SpO2", unit: "%" },
} as const

export type RangeKey = keyof typeof RANGES

/**
 * Error message for a value outside its range, or null when it's fine.
 * Empty input is fine here; required-field checks stay with each form.
 */
export function rangeError(key: RangeKey, raw: unknown): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null
  const value = Number(raw)
  const { min, max, label, unit } = RANGES[key]
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${label} must be between ${min} and ${max} ${unit}.`
  }
  return null
}

/** First error among several fields, or null. */
export function firstRangeError(fields: Array<[RangeKey, unknown]>): string | null {
  for (const [key, value] of fields) {
    const error = rangeError(key, value)
    if (error) return error
  }
  return null
}
