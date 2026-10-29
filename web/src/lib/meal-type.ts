// Plan meals carry only a display name ("Breakfast", "Afternoon Snack", ...).
// The Today page and the Diet tab must file them under the same meal_logs
// meal_type, or a ticked meal shows up twice or in the wrong slot.

export type LoggedMealType = "breakfast" | "lunch" | "dinner" | "snacks"

const ORDER: LoggedMealType[] = ["breakfast", "lunch", "dinner", "snacks"]

export function mealTypeFromName(name: unknown, index?: number): LoggedMealType {
  const v = String(name ?? "").toLowerCase()
  // Snack first: "post-lunch snack" is a snack, not lunch.
  if (v.includes("snack")) return "snacks"
  if (v.includes("breakfast")) return "breakfast"
  if (v.includes("lunch")) return "lunch"
  if (v.includes("dinner") || v.includes("supper")) return "dinner"
  if (index !== undefined) return ORDER[Math.min(index, ORDER.length - 1)]
  return "snacks"
}
