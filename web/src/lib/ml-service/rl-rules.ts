/**
 * The masked threshold rule, mirroring `rule_based_action` and `safe_action` in
 * ml-service/app/rl_env.py. It answers whenever the PPO agent cannot (service
 * down, not configured, agent missing), so the app and the service must agree.
 *
 *   completion < 0.60 -> REDUCE,  > 0.85 -> INCREASE,  otherwise MAINTAIN
 *   safety mask: never INCREASE while injured or on < 5.5 h average sleep
 *
 * The mask turns INCREASE into MAINTAIN. It does not force REDUCE: an ongoing
 * injury keeps `injury_flag` at 1 every week, so forcing REDUCE cut a fully
 * adherent user's sets by 15% at every check-in until one set was left. The
 * exercises that load the injured area are stripped separately
 * (`applyInjuryAdjustments`).
 */

import type { RLAction } from "./types"

export const REDUCE_BELOW_COMPLETION = 0.6
export const INCREASE_ABOVE_COMPLETION = 0.85
export const SLEEP_FLOOR_FOR_INCREASE = 5.5

export const INTENSITY_DELTA: Record<RLAction, number> = {
  REDUCE: -0.15,
  MAINTAIN: 0,
  INCREASE: 0.15,
}

type RuleInput = {
  completion_rate: number
  sleep_avg: number
  injury_flag: number
}

export function safeAction(action: RLAction, input: RuleInput): RLAction {
  const unsafe = input.injury_flag >= 0.5 || input.sleep_avg < SLEEP_FLOOR_FOR_INCREASE
  return action === "INCREASE" && unsafe ? "MAINTAIN" : action
}

export function ruleBasedAction(input: RuleInput): RLAction {
  const action: RLAction =
    input.completion_rate < REDUCE_BELOW_COMPLETION
      ? "REDUCE"
      : input.completion_rate > INCREASE_ABOVE_COMPLETION
        ? "INCREASE"
        : "MAINTAIN"
  return safeAction(action, input)
}
