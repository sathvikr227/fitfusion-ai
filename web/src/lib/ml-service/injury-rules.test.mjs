// Run with: npm test   (node --test; Node 23.6+ loads the .ts module directly)
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyInjuryAdjustments,
  buildRecentDays,
  exerciseTargetsGroup,
  injuryRegionLevels,
  keywordPattern,
} from "./injury-rules.ts"

test("matcher tolerates missing and hyphenated gaps", () => {
  for (const name of ["Pullups", "Pull-Up", "pull up", "Wide Grip Pull-ups"]) {
    assert.equal(exerciseTargetsGroup(name, "shoulder"), true, name)
  }
  assert.equal(exerciseTargetsGroup("Pushups", "shoulder"), true)
  assert.equal(exerciseTargetsGroup("Situps", "back"), true)
  assert.equal(exerciseTargetsGroup("Step-ups", "knee"), true)
})

test("matcher only matches at word starts", () => {
  assert.equal(exerciseTargetsGroup("Crunch", "knee"), false) // "run" inside "crunch"
  assert.equal(exerciseTargetsGroup("Bicycle Crunches", "knee"), false)
  assert.equal(exerciseTargetsGroup("Running", "knee"), true)
  assert.equal(exerciseTargetsGroup("Romanian Deadlift", "hamstring"), true)
  assert.equal(keywordPattern("pull up").test("pullover"), false)
})

test("a shoulder flag now strips pull-ups from the plan", () => {
  const plan = [{ day: "Monday", type: "Pull", exercises: [{ name: "Pullups" }, { name: "Barbell Curl" }] }]
  const { workoutPlan, removedExercises } = applyInjuryAdjustments(plan, ["shoulder"], { addRestDay: false })
  assert.deepEqual(removedExercises.map((r) => r.exercise), ["Pullups"])
  assert.deepEqual(workoutPlan[0].exercises.map((e) => e.name), ["Barbell Curl"])
})

test("buildRecentDays maps FitFusion rows onto runners units", () => {
  const keys = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]
  const workoutLogs = [
    { id: "a", date: "2026-10-21" },
    { id: "b", date: "2026-10-21" }, // duplicate row the same day: still one session
    { id: "c", date: "2026-10-27" },
    { id: "z", date: "2026-10-28" }, // today: outside the window
  ]
  const exercises = new Map([["a", ["Back Squat"]], ["c", ["Yoga Flow"]]])
  const cardio = [
    { date: "2026-10-22", activity: "Running", distance_km: 5, duration_minutes: 30 },
    { date: "2026-10-22", activity: "Cycling", distance_km: 20, duration_minutes: 45 },
    { date: "2026-10-27", activity: "Treadmill jog", distance_km: "3.5", duration_minutes: 25 },
  ]
  const days = buildRecentDays(keys, workoutLogs, exercises, cardio, (n) => /squat/i.test(n))
  assert.equal(days.length, 7)
  assert.deepEqual(days[0], { date: "2026-10-21", sessions: 1, total_km: 0, strength: 1, alt_hours: 0 })
  assert.deepEqual(days[1], { date: "2026-10-22", sessions: 2, total_km: 5, strength: 0, alt_hours: 0.75 })
  assert.equal(days[2].sessions, 0)
  assert.deepEqual(days[6], { date: "2026-10-27", sessions: 2, total_km: 3.5, strength: 0, alt_hours: 0 })
})

test("region levels follow the PROTOCOL.md table", () => {
  const quiet = injuryRegionLevels(["Left knee pain"], ["Bench Press"], false)
  assert.equal(quiet.risk.knee, 0.6)
  assert.equal(quiet.risk.shoulder, 0.2)
  assert.equal(quiet.risk.back, 0.1)

  const high = injuryRegionLevels(["Left knee pain"], ["Bench Press"], true)
  assert.equal(high.risk.knee, 0.9)
  assert.equal(high.risk.shoulder, 0.5)
  assert.equal(high.risk.hamstring, 0.1)
  // Only a recorded region under elevated load reaches the 0.7 flag.
  assert.deepEqual(Object.keys(high.risk).filter((r) => high.risk[r] >= 0.7), ["knee"])
})
