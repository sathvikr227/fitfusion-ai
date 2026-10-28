// Run with: npm test
import assert from "node:assert/strict"
import { test } from "node:test"

import { buildRunSessions } from "./run-sessions.ts"

const run = (date, km, minutes, activity = "Running") => ({ date, activity, distance_km: km, duration_minutes: minutes })

test("needs a 5th, earlier run day for the first gap", () => {
  const four = [run("2026-10-01", 5, 30), run("2026-10-03", 5, 30), run("2026-10-05", 5, 30), run("2026-10-07", 5, 30)]
  assert.deepEqual(buildRunSessions(four), [])
  assert.equal(buildRunSessions([run("2026-09-28", 5, 30), ...four]).length, 4)
})

test("maps runs onto the model's session features", () => {
  const rows = [
    run("2026-09-28", 6, 33),
    run("2026-10-01", 5, 30),
    run("2026-10-01", 3, 18, "Treadmill jog"), // same day: summed, as in the daily training file
    run("2026-10-02", 20, 45, "Cycling"),      // not a run
    run("2026-10-04", 10, 52),
    run("2026-10-05", 0.5, 4),                  // under 1 km: dropped
    run("2026-10-08", 12, 64),
    run("2026-10-12", 8, 41),
  ]
  const sessions = buildRunSessions(rows)
  assert.deepEqual(sessions.map((s) => s.date), ["2026-10-01", "2026-10-04", "2026-10-08", "2026-10-12"])
  assert.deepEqual(sessions[0], {
    date: "2026-10-01", duration: 0.8, distance_km: 8, gap_days: 3, day_of_week: 3, // Thursday
    completion_rate: 1, workout_type: "Cardio",
  })
  assert.deepEqual(sessions.map((s) => s.gap_days), [3, 3, 4, 4])
  assert.equal(sessions[3].day_of_week, 0) // 2026-10-12 is a Monday
})

test("drops paces outside 3-15 min/km", () => {
  const rows = [run("2026-10-01", 5, 10), run("2026-10-02", 5, 30), run("2026-10-03", 5, 30),
    run("2026-10-04", 5, 30), run("2026-10-05", 5, 30), run("2026-10-06", 5, 30)]
  assert.equal(buildRunSessions(rows)[0].date, "2026-10-03")
})
