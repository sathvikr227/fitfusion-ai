// Run with: npm test   (node --test; Node 23.6+ loads the .ts module directly)
import assert from "node:assert/strict"
import { test } from "node:test"

import { INTENSITY_DELTA, ruleBasedAction, safeAction } from "./rl-rules.ts"

const state = (completion_rate, sleep_avg = 8, injury_flag = 0) => ({ completion_rate, sleep_avg, injury_flag })

// Same cases as test_threshold_rule_is_masked in ml-service/tests/test_model5_rl.py.
test("thresholds match the service's rule", () => {
  assert.equal(ruleBasedAction(state(0.5)), "REDUCE")
  assert.equal(ruleBasedAction(state(0.7)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.95)), "INCREASE")
  // the boundaries belong to MAINTAIN
  assert.equal(ruleBasedAction(state(0.6)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.85)), "MAINTAIN")
})

test("the mask holds an injured or short-slept user at MAINTAIN instead of INCREASE", () => {
  assert.equal(ruleBasedAction(state(0.95, 8, 1)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.95, 5.0, 0)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.95, 5.5, 0)), "INCREASE")
})

test("an injury or short sleep alone never forces REDUCE", () => {
  // An ongoing injury sets injury_flag every week; a fully adherent user must
  // not lose 15% of their sets at every check-in because of it.
  assert.equal(ruleBasedAction(state(1.0, 8, 1)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.7, 8, 1)), "MAINTAIN")
  assert.equal(ruleBasedAction(state(0.7, 4, 0)), "MAINTAIN")
  // low completion still reduces, injured or not
  assert.equal(ruleBasedAction(state(0.4, 8, 1)), "REDUCE")
})

test("the mask only ever changes INCREASE", () => {
  for (const unsafe of [state(0.9, 8, 1), state(0.9, 3, 0)]) {
    assert.equal(safeAction("INCREASE", unsafe), "MAINTAIN")
    assert.equal(safeAction("MAINTAIN", unsafe), "MAINTAIN")
    assert.equal(safeAction("REDUCE", unsafe), "REDUCE")
  }
  assert.equal(safeAction("INCREASE", state(0.9)), "INCREASE")
})

test("intensity deltas are the service's ±15% steps", () => {
  assert.deepEqual(INTENSITY_DELTA, { REDUCE: -0.15, MAINTAIN: 0, INCREASE: 0.15 })
})
