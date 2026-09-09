// Maps FitFusion profile rows onto the feature values the ML models expect.
// Shared by /api/generate-plan and /api/adaptive-replan so both derive the same
// numbers from the same profile.

type ProfileRow = Record<string, any> | null | undefined

/**
 * The Gym Members dataset encodes experience as 1 (beginner), 2 (intermediate),
 * 3 (advanced). FitFusion stores an activity level instead, so map across.
 * Mirrors _experience_from_activity() in ml-service/app/supabase_reader.py.
 */
export function experienceLevelFromProfile(profile: ProfileRow): number {
  const text = String(profile?.activity_level ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_")

  if (!text) return 1
  if (["sedentary", "lightly_active", "light"].includes(text)) return 1
  if (["moderately_active", "moderate"].includes(text)) return 2
  if (["very_active", "extremely_active", "athlete", "active"].includes(text)) return 3
  return 1
}

/** Weekly training days implied by the profile's rest-day preference. */
export function workoutFrequencyFromProfile(profile: ProfileRow): number {
  const restDays = [profile?.rest_days_per_week, profile?.days_off]
    .map((v) => Number(v))
    .find((n) => Number.isFinite(n))

  if (restDays === undefined) return 4
  return Math.min(7, Math.max(0, 7 - Math.trunc(restDays)))
}

/**
 * Active injuries as free text the recommender and injury model can match on.
 * Combines the profile's prose `injuries` field with rows from the injuries
 * table, since the app writes to both.
 */
export function injuryListFromProfile(
  profile: ProfileRow,
  injuryRows: Array<{ body_part?: string | null; name?: string | null }> = []
): string[] {
  const entries: string[] = []

  const prose = String(profile?.injuries ?? "").trim()
  const isNegative = ["", "no", "none", "na", "n/a", "nil", "false"].includes(
    prose.toLowerCase()
  )
  if (!isNegative) entries.push(prose)

  for (const row of injuryRows) {
    if (row?.body_part) entries.push(String(row.body_part))
    if (row?.name) entries.push(String(row.name))
  }

  return Array.from(new Set(entries.filter(Boolean)))
}

/** Dietary restrictions, tolerating both the jsonb array and a legacy string. */
export function dietaryRestrictionsFromProfile(profile: ProfileRow): string[] {
  const raw = profile?.dietary_restrictions

  if (Array.isArray(raw)) {
    return raw.map((r) => String(r)).filter(Boolean)
  }

  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map((r) => String(r)).filter(Boolean)
    } catch {
      return raw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    }
  }

  // A vegetarian/vegan diet preference is a hard constraint too.
  const preference = String(profile?.diet_preference ?? "").trim().toLowerCase()
  if (["vegetarian", "vegan", "eggetarian", "pescatarian"].includes(preference)) {
    return [preference]
  }

  return []
}
