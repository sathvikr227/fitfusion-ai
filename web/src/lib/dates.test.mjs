// Run with: npm test
import assert from "node:assert/strict"
import { test } from "node:test"

import { currentStreak, daysAgoStr, localDateStr, longestStreak, parseDbTimestamp, plural } from "./dates.ts"

test("localDateStr uses the local calendar day", () => {
  const d = new Date(2026, 9, 29, 1, 15) // 01:15 local
  assert.equal(localDateStr(d), "2026-10-29")
  assert.equal(daysAgoStr(1, d), "2026-10-28")
})

test("streak survives until the end of the day", () => {
  const today = "2026-10-29"
  assert.equal(currentStreak([], today), 0)
  assert.equal(currentStreak(["2026-10-28"], today), 1)
  assert.equal(currentStreak(["2026-10-29", "2026-10-28", "2026-10-27"], today), 3)
  assert.equal(currentStreak(["2026-10-27"], today), 0)
  assert.equal(currentStreak(["2026-10-29T08:00:00Z", "2026-10-29", "2026-10-28"], today), 2)
  assert.equal(currentStreak(["2026-10-29", "2026-10-27"], today), 1)
})

test("timestamps without a zone are read as UTC", () => {
  assert.equal(parseDbTimestamp("2026-10-29T08:00:00").toISOString(), "2026-10-29T08:00:00.000Z")
  assert.equal(parseDbTimestamp("2026-10-29T08:00:00.123+00:00").toISOString(), "2026-10-29T08:00:00.123Z")
  assert.equal(parseDbTimestamp("2026-10-29T13:30:00+05:30").toISOString(), "2026-10-29T08:00:00.000Z")
})

test("longest streak and plurals", () => {
  assert.equal(longestStreak(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10"]), 3)
  assert.equal(plural(1, "day"), "1 day")
  assert.equal(plural(2, "session"), "2 sessions")
})
