// Run with: npm test   (node --test; Node 23.6+ loads the .ts module directly)
import assert from "node:assert/strict"
import { test } from "node:test"

import { replanState } from "./rl-history.ts"

const plan = (at, action, delta) => ({ created_at: at, plan: { ml_meta: { rl: { action, intensity_delta: delta } } } })

test("a user with no replans starts like a simulated user", () => {
  assert.deepEqual(replanState([]), { planned_intensity: 1, previous_action: "MAINTAIN", replans: 0 })
  // plans generated before the RL layer have no ml_meta and do not count
  assert.equal(replanState([{ created_at: "2026-10-01", plan: { workout_plan: [] } }]).replans, 0)
})

test("intensity multiplies the applied steps in time order, whatever order rows arrive in", () => {
  const rows = [
    plan("2026-10-15T09:00:00Z", "REDUCE", -0.15),
    plan("2026-10-01T09:00:00Z", "INCREASE", 0.15),
    plan("2026-10-08T09:00:00Z", "INCREASE", 0.15),
  ]
  const state = replanState(rows)
  assert.equal(state.planned_intensity, Math.round(1.15 * 1.15 * 0.85 * 10000) / 10000)
  assert.equal(state.previous_action, "REDUCE")
  assert.equal(state.replans, 3)
})

test("intensity is clipped to the simulator's range at every step", () => {
  const ups = Array.from({ length: 12 }, (_, i) => plan(`2026-01-${String(i + 1).padStart(2, "0")}`, "INCREASE", 0.15))
  assert.equal(replanState(ups).planned_intensity, 2.5)
  const downs = Array.from({ length: 12 }, (_, i) => plan(`2026-02-${String(i + 1).padStart(2, "0")}`, "REDUCE", -0.15))
  assert.equal(replanState(downs).planned_intensity, 0.4)
})

test("plans stored as JSON text are read too, malformed ones are skipped", () => {
  const rows = [
    { created_at: "2026-10-01", plan: JSON.stringify({ ml_meta: { rl: { action: "INCREASE", intensity_delta: 0.15 } } }) },
    { created_at: "2026-10-02", plan: "{not json" },
    { created_at: "2026-10-03", plan: { ml_meta: { rl: { action: "JUMP", intensity_delta: 9 } } } },
  ]
  assert.deepEqual(replanState(rows), { planned_intensity: 1.15, previous_action: "INCREASE", replans: 1 })
})
