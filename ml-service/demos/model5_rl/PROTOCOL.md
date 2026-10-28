# Model 5 — pre-registered protocol

Written and committed on 2026-10-28, **before** the calibration curves were computed, the
environment was rebuilt, or any policy was trained. The project owner delegated the design
decisions for Model 5 (2026-10-28). Anything changed after this commit goes under "Deviations"
in RESULTS.md.

## Audit of the previous Model 5

| Finding | Effect |
|---|---|
| Reward = +1 whenever completion rises | Cutting the plan reliably raises completion, so the policy learns REDUCE (87% of actions) and never targets fitness |
| Calibrated on "pilot data" of 2 users | That Supabase history is seeded/test data (owner-confirmed), so the calibration is void |
| The environment's "trajectory" is a completion-rate change | The app now sends Model 4's pace trajectory, a different signal |
| Injury hazard weights invented; safety learned, not enforced | Nothing guarantees no INCREASE while injured |
| Result | PPO mean reward 3.77 vs 3.88 for the threshold rule: worse than what it replaced |

## Spec kept from the slides

State `[completion_rate, sleep_avg/10, injury_flag, trajectory_score/2, min(streak,14)/14]`.
Actions REDUCE / MAINTAIN / INCREASE (planned load ×0.85 / ×1 / ×1.15, as the app applies
±15%). Stable-Baselines3 PPO, about 100k timesteps, 500 test episodes against the rule-based
baseline. **Episodes and timesteps are different things:** one timestep is one simulated week,
and one episode is one simulated user over up to 26 weeks.

## Environment (rebuilt): what is real and what is assumed

| Component | Source | Status |
|---|---|---|
| Weekly fitness change vs load ratio R = this week's done load / mean of the previous 4 weeks | Strava logs (Model 4 data, CC BY 4.0): binned mean change in 10 km-equivalent pace over the next 4 weeks vs the previous 4, per weekly km ratio bin, divided by 4 for a weekly rate | **real, estimated here** |
| Injury hazard vs acute:chronic ratio (7-day km / 28-day mean weekly km) | Runners data (Model 3, CC0): daily series reconstructed from consecutive event days; injury rate per ACWR bin, as relative risk vs the 0.8-1.3 band | **real, estimated here** |
| Baseline weekly injury probability | Runners data: 1 − (1 − daily rate)^7 | **real** (elite runners; likely high for gym users) |
| Weekly sleep: mean, spread, week-to-week persistence | SoccerMon sleep_duration, player-week means | **real** |
| Adherence (completion) response to load, sleep and injury; injury duration; churn | none available (FitFusion data is seeded) | **assumption**, stress-tested below |

Hidden state: fitness F (cumulative pace improvement, a fraction), planned load L, the
history of done load, and an injury countdown. Weekly order of events: the action changes L;
sleep is drawn; completion c = clip(a₀ − β·max(0, L − 1) − 0.5·injured + γ·(sleep − 7) + noise);
done load D = L·c; R and ACWR come from D; fitness moves by g(R); an injury starts with
probability base × RR(ACWR); the injury lasts a geometric number of weeks with mean 2; churn
happens when c < 0.2 for two weeks in a row. The trajectory label uses Model 4's thresholds
(−2.23% / +2.11%) on the 4-week fitness change, which is the same signal the app sends.

Assumed values (default scenario): a₀ = 0.85, β = 0.6, γ = 0.04, noise sd 0.07, injury mean
2 weeks. Episode length 26 weeks.

## Reward (decided here)

`r = 100·ΔF − 3·injury_onset − 5·churn`

ΔF is the weekly fitness change: +0.5 per 0.5 percentage points of pace improvement. Injury
onset and churn are costed in the same "weeks of progress" currency: an injury costs about 6
good weeks, and losing the user costs more. Completion itself earns nothing, so cutting the plan
cannot score on its own.

## Hard safety mask (decided here)

`safe_action(action, state)`: if injury_flag = 1, or sleep_avg < 5.5 h, INCREASE becomes
MAINTAIN. It is applied inside the environment step (so training sees it), in every evaluated
policy, and in `POST /rl/action`. The app's own guards (pain notes block INCREASE, progression
caps, injury stripping) stay in place on top.

## Training

PPO (`MlpPolicy`, SB3 defaults: lr 3e-4, n_steps 2048, batch 64, 10 epochs, gamma 0.99),
**100,000 timesteps**, seeds 42 (served candidate), 0, 1, 2. Monitor CSV logs give a learning
curve per seed.

## Evaluation (all simulated, and labelled so)

- **Standard scenarios:** 500 episodes, evaluation seeds 100000–100499. These were never used
  in training, and every policy sees the same seeds (common random numbers).
- **Stressed scenarios:** 500 episodes in which each assumed parameter (a₀, β, γ, noise,
  injury duration) is scaled by an independent U(0.75, 1.25) per episode.
- **Policies:** PPO (each seed), the threshold rule shipped today (completion < 0.6 REDUCE,
  > 0.85 INCREASE, else MAINTAIN), always-MAINTAIN, and uniform random. All are masked.
- **Metrics:** mean episode return with a 95% bootstrap CI; paired differences with CIs;
  injuries per episode; churn rate; fitness gain per episode; action distribution.

## Serving rule

Serve PPO seed 42 **iff**, on the standard scenarios:
1. the paired return difference against the best baseline (rule or always-MAINTAIN) has a 95%
   CI lower bound > 0, **and**
2. its injuries per episode are not significantly higher than the threshold rule's (the paired
   CI of the difference includes or lies below 0).

Otherwise the endpoint serves the masked threshold rule (`stub: true` with a `reason`).
Results on the stressed scenarios are reported either way, and a policy that only wins on the
standard set is flagged.
