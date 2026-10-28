// Deterministic checks on a weekly split, applied after the LLM writes a plan.

type Day = { day?: string; type?: string | null; exercises?: unknown[] }

function isRest(day: Day) {
  return String(day?.type ?? "").toLowerCase() === "rest" || !Array.isArray(day?.exercises) || day.exercises.length === 0
}

/** Muscle-group family of a training day, from its type label. */
export function dayFocus(day: Day): string {
  const type = String(day?.type ?? "").toLowerCase()
  if (/leg|lower|glute|quad|hamstring/.test(type)) return "legs"
  if (/push|chest|tricep/.test(type)) return "push"
  if (/pull|back|bicep/.test(type)) return "pull"
  return type.trim()
}

/**
 * Reorders training days so the same muscle group never lands on consecutive
 * days (e.g. Wednesday and Thursday both Legs). Day labels stay put; only the
 * workouts move, and rest days never move. Returns the plan unchanged when no
 * swap fixes a clash.
 */
export function separateConsecutiveFocus<T extends Day>(plan: T[]): T[] {
  if (!Array.isArray(plan)) return plan
  const out = plan.map((d) => ({ ...d }))
  const swapContent = (a: number, b: number) => {
    const { day: labelA } = out[a]
    const { day: labelB } = out[b]
    const tmp = out[a]
    out[a] = { ...out[b], day: labelA }
    out[b] = { ...tmp, day: labelB }
  }
  const clashes = (i: number) =>
    i > 0 && !isRest(out[i]) && !isRest(out[i - 1]) && dayFocus(out[i]) !== "" && dayFocus(out[i]) === dayFocus(out[i - 1])

  for (let i = 1; i < out.length; i++) {
    if (!clashes(i)) continue
    // Try every other training day; keep the first swap that leaves no clash
    // at either position.
    for (let j = 0; j < out.length; j++) {
      if (j === i || j === i - 1 || isRest(out[j])) continue
      swapContent(i, j)
      if (!clashes(i) && !clashes(i + 1 < out.length ? i + 1 : i) && !clashes(j) && !clashes(j + 1 < out.length ? j + 1 : j)) break
      swapContent(i, j) // undo
    }
  }
  return out
}
