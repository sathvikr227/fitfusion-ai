/**
 * Model 5 round 3 (ml-service/demos/model5_rl/PROTOCOL_ROUND3.md): the two extra
 * inputs the 7-input PPO agent reads, rebuilt from the decisions FitFusion already
 * stores in each replan's `ml_meta.rl`.
 *
 *   planned_intensity = product of (1 + applied intensity_delta) over past replans,
 *                       clipped to [0.4, 2.5] like the simulator's planned load
 *   previous_action   = the last replan's applied action
 *
 * A user with no replans yet starts where every simulated user starts: intensity 1.0,
 * previous action MAINTAIN.
 */

import type { RLAction } from "./types"

export const INTENSITY_MIN = 0.4
export const INTENSITY_MAX = 2.5
const ACTIONS: RLAction[] = ["REDUCE", "MAINTAIN", "INCREASE"]

type StoredPlan = { plan?: unknown; created_at?: unknown }
type StoredRl = { action?: unknown; intensity_delta?: unknown }

function rlOf(row: StoredPlan): StoredRl | null {
  const plan = typeof row.plan === "string" ? safeParse(row.plan) : row.plan
  const meta = (plan as { ml_meta?: { rl?: StoredRl } } | null)?.ml_meta
  return meta?.rl ?? null
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Plans in any order; only those with a recorded RL decision count. */
export function replanState(plans: StoredPlan[]): {
  planned_intensity: number
  previous_action: RLAction
  replans: number
} {
  const decisions = plans
    .map((row) => ({ at: String(row.created_at ?? ""), rl: rlOf(row) }))
    .filter((d): d is { at: string; rl: StoredRl } => d.rl !== null && ACTIONS.includes(d.rl.action as RLAction))
    .sort((a, b) => a.at.localeCompare(b.at))

  let intensity = 1
  for (const { rl } of decisions) {
    const delta = Number(rl.intensity_delta)
    intensity *= 1 + (Number.isFinite(delta) ? delta : 0)
    intensity = Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, intensity))
  }
  const last = decisions.at(-1)
  return {
    planned_intensity: Math.round(intensity * 10000) / 10000,
    previous_action: last ? (last.rl.action as RLAction) : "MAINTAIN",
    replans: decisions.length,
  }
}
