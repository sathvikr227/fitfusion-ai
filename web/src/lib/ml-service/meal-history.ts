// A user's meal history for the hybrid recommender (Model 2): the Food.com
// recipe IDs of plan meals they marked as eaten.
//
// meal_execution stores (date, meal_name, eaten); the recipe behind a meal name
// is the `recipe_id` that /api/generate-plan wrote into the plan active on that
// date. Plans written before recipes were enforced have no recipe_id and are
// skipped, so older users simply start cold (popularity ranking).

import type { SupabaseClient } from "@supabase/supabase-js"

const MAX_HISTORY = 500

type PlanRow = { plan: unknown; created_at: string }
type EatenRow = { date: string; meal_name: string | null }
type PlanMeal = { name?: unknown; items?: Array<{ recipe_id?: unknown }> }

function recipeIdsByMeal(plan: unknown): Map<string, number> {
  const parsed = typeof plan === "string" ? safeParse(plan) : plan
  const meals = (parsed as { diet_plan?: { meals?: PlanMeal[] } } | null)?.diet_plan?.meals
  const out = new Map<string, number>()
  if (!Array.isArray(meals)) return out
  for (const meal of meals) {
    const id = Number(meal?.items?.[0]?.recipe_id)
    const name = String(meal?.name ?? "").trim().toLowerCase()
    if (name && Number.isInteger(id) && id > 0) out.set(name, id)
  }
  return out
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Recipe IDs the user ate, most recent first, de-duplicated. Never throws. */
export async function likedRecipeIds(supabase: SupabaseClient, userId: string): Promise<number[]> {
  try {
    const [plansRes, eatenRes] = await Promise.all([
      supabase
        .from("workout_plans")
        .select("plan, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("meal_execution")
        .select("date, meal_name")
        .eq("user_id", userId)
        .eq("eaten", true)
        .order("date", { ascending: false })
        .limit(2000),
    ])
    const plans = ((plansRes.data ?? []) as PlanRow[]).map((p) => ({
      day: String(p.created_at).slice(0, 10),
      meals: recipeIdsByMeal(p.plan),
    }))
    if (plans.length === 0) return []

    const ids: number[] = []
    const seen = new Set<number>()
    for (const row of (eatenRes.data ?? []) as EatenRow[]) {
      const date = String(row.date)
      // The plan in force that day: the latest one created on or before it.
      let active = null as (typeof plans)[number] | null
      for (const p of plans) {
        if (p.day <= date) active = p
        else break
      }
      const id = active?.meals.get(String(row.meal_name ?? "").trim().toLowerCase())
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
        if (ids.length >= MAX_HISTORY) break
      }
    }
    return ids
  } catch (err) {
    console.warn("[meal-history] could not read eaten meals:", err)
    return []
  }
}
