import { supabase } from "./supabase/client"

// Home and Today both write water_logs. Fire-and-forget upserts from quick
// taps could land out of order, leaving the table one step behind the screen
// (Home 0.50 L vs Today 0.25 L). Writes now go through one queue, and only the
// latest value is sent.

export const WATER_STEP_ML = 250

/** Daily goal: weight × 33 ml, clamped to 2-4 L; 2.5 L when weight is unknown. */
export function waterGoalMl(weightKg: number | null | undefined): number {
  const w = Number(weightKg)
  if (!Number.isFinite(w) || w <= 0) return 2500
  return Math.round(Math.min(4, Math.max(2, Math.round(w * 0.033 * 10) / 10)) * 1000)
}

let queue: Promise<void> = Promise.resolve()
let pending: { userId: string; date: string; ml: number } | null = null

export function saveWater(userId: string, date: string, ml: number) {
  try {
    localStorage.setItem(`water-ml-${date}`, String(ml))
  } catch {
    // storage unavailable; the database write below still runs
  }
  pending = { userId, date, ml }
  queue = queue.then(async () => {
    const next = pending
    pending = null
    if (!next) return
    const { error } = await supabase
      .from("water_logs")
      .upsert(
        { user_id: next.userId, date: next.date, amount_ml: next.ml },
        { onConflict: "user_id,date" }
      )
    if (error) console.error("Saving water intake failed:", error.message)
  })
  return queue
}
