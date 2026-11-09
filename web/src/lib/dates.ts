// Shared calendar-day helpers for the dashboard.
//
// `new Date().toISOString().split("T")[0]` is the UTC date, which in India is
// still "yesterday" until 05:30, so pages that mixed it with local dates showed
// different days, streaks and totals. Every client page should use these.

/** YYYY-MM-DD for the user's local calendar day. */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Local YYYY-MM-DD for `n` days before today. */
export function daysAgoStr(n: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

/** Whole days between two YYYY-MM-DD strings (a - b), DST-safe. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000)
}

/**
 * Consecutive active days ending today or yesterday (a streak survives until
 * the day is over). Accepts YYYY-MM-DD dates or ISO timestamps.
 */
export function currentStreak(dates: (string | null | undefined)[], today: string = localDateStr()): number {
  const unique = Array.from(
    new Set(dates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10)))
  )
    .filter((d) => d <= today)
    .sort()
    .reverse()
  if (unique.length === 0 || dayDiff(today, unique[0]) > 1) return 0
  let streak = 1
  for (let i = 1; i < unique.length; i++) {
    if (dayDiff(unique[i - 1], unique[i]) === 1) streak++
    else break
  }
  return streak
}

/** Longest run of consecutive active days. */
export function longestStreak(dates: (string | null | undefined)[]): number {
  const unique = Array.from(
    new Set(dates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10)))
  ).sort()
  let best = 0
  let run = 0
  for (let i = 0; i < unique.length; i++) {
    run = i > 0 && dayDiff(unique[i], unique[i - 1]) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/**
 * Several tables use `timestamp without time zone`, so Supabase returns
 * "2026-10-29T08:00:00" with no offset and `new Date()` reads it as local time.
 * The values are UTC; mark them so they display in the user's zone.
 */
export function parseDbTimestamp(value: string): Date {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasZone || !value.includes("T") ? value : `${value}Z`)
}

/** "1 day", "3 days". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}
